import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { db } from "@/server/db";
import { createDraft, loadCase, saveDraft, submitCase } from "@/server/workflow/cases";
import { uploadChatBatch, uploadPdfPage, processChatJob, retryChatJob } from "@/server/workflow/chat-documents";
import { chatExtractionSchema } from "@/lib/domain/chat-extraction";
import {
  getReportChat,
  sendReportChatMessage,
  confirmDocumentBelongs,
  skipOptionalQuestions,
  writeDescription,
  type ReportChatView,
} from "@/server/workflow/report-chat";
import { form } from "../fixtures/form";
import { todayInAppZone } from "@/lib/format";
import * as provider from "@/server/ai/provider";
import { hasTestDb, userFor } from "./helpers";

async function setup() {
  const user = await userFor("pharmacist@demo.test");
  return { user, id: (await createDraft(user)).id };
}
async function image(name = "fictional-prescription-clean.png") {
  const bytes = await readFile(`samples/prescriptions/${name}`);
  return new File([bytes], name, { type: name.endsWith("jpg") ? "image/jpeg" : "image/png" });
}
type User = Awaited<ReturnType<typeof userFor>>;
const say = (user: User, id: string, view: ReportChatView, content: string, answer = true) =>
  sendReportChatMessage(user, id, {
    requestId: randomUUID(),
    revision: view.revision,
    lockVersion: view.lockVersion,
    content,
    questionKey: answer ? (view.question?.key ?? null) : null,
  });
function mockChat(updates: Record<string, unknown>[], roles: Record<string, unknown>[] = []) {
  return vi.spyOn(provider, "generateWithFallback").mockResolvedValue({
    output: { updates: updates.map((u) => ({ approximate: false, uncertain: false, ...u })), roles },
    provider: "fixture",
    model: "test",
    meta: {},
    attempts: [],
  });
}
/** Answers the combined "what reaction, and when did it start" question, as the AI would read it. */
async function giveReaction(user: User, id: string, view: ReportChatView) {
  mockChat([
    { entity: "case", entityName: "", field: "reactionTerms", value: "Rash", sourceText: "rash" },
    { entity: "case", entityName: "", field: "reactionStartDate", value: "2026-10-14", sourceText: "14/10/2026" },
  ]);
  const next = await say(user, id, view, "rash on 14/10/2026");
  vi.restoreAllMocks();
  return next;
}
const lastReply = (view: ReportChatView) => view.messages.filter((m) => m.role !== "USER").at(-1)?.content ?? "";

describe.skipIf(!hasTestDb)("report assistant: automatic filling with one final confirmation", () => {
  beforeEach(() => vi.stubEnv("AI_PROVIDER", "fixture"));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("fills the report from a read document without a per-detail check and asks only how each medicine belongs", async () => {
    const { user, id } = await setup(),
      file = await image(),
      requestId = randomUUID();
    const first = await uploadChatBatch(user, id, requestId, [file, file]);
    expect(await uploadChatBatch(user, id, requestId, [file, file])).toEqual(first);
    expect(await db.uploadedDocument.count({ where: { caseId: id } })).toBe(1);
    let view = await getReportChat(user, id);
    expect(view.processing).toBe(true);
    expect(view.question).toBeNull();
    expect(await processChatJob(id, user)).toEqual({ processed: true });
    view = await getReportChat(user, id);
    let c = (await loadCase(user, id)).c;
    // Patient details went straight in.
    expect(c.patientInitials).toBe("R.K.");
    expect(c.ageValue).toBe(34);
    expect(c.gender).toBe("FEMALE");
    // Medicines wait until the reporter says which one is suspected: one question, not one per medicine.
    expect(c.suspectedMedicines).toHaveLength(0);
    expect(view.question?.field).toBe("reaction");
    expect(lastReply(view)).toMatch(/Added to the report: .*Patient initials: R\.K\./);
    // The medicines read are listed even though they wait for the suspected-medicine question.
    expect(lastReply(view)).toMatch(/Medicines found: Amoxicillin 500 mg capsule, Paracetamol 500 mg tablet\./);
    view = await giveReaction(user, id, view);
    expect(view.question?.kind).toBe("suspect");
    expect(Object.keys(view.question!.options!)).toEqual(["Amoxicillin 500 mg capsule", "Paracetamol 500 mg tablet"]);
    view = await say(user, id, view, "Amoxicillin 500 mg capsule");
    expect(view.summary.info.some((n) => /Paracetamol/.test(n.label) && /another medicine/.test(n.message))).toBe(true);
    c = (await loadCase(user, id)).c;
    expect(c.suspectedMedicines.map((m) => [m.name, m.dose, m.route, m.frequency])).toEqual([
      ["Amoxicillin 500 mg capsule", "1 cap", "Oral", "TID"],
    ]);
    expect(c.concomitantProducts.map((m) => m.name)).toEqual(["Paracetamol 500 mg tablet"]);
    // The unclear "SOS" reading was used but is marked for a look at the final confirmation.
    expect(view.summary.attention.some((n) => n.kind === "UNCLEAR" && /SOS/.test(n.message))).toBe(true);
    const provenance = await db.fieldProvenance.findMany({ where: { caseId: id, source: "DOCUMENT_EXTRACTED" } });
    expect(provenance.length).toBeGreaterThan(8);
    expect(provenance.every((p) => p.verifiedById === null)).toBe(true);
  }, 30_000);

  it("claims independent page jobs once when workers overlap", async () => {
    const { user, id } = await setup();
    await uploadChatBatch(user, id, randomUUID(), [await image(), await image("fictional-prescription-scan.jpg")]);
    await Promise.all([processChatJob(id, user), processChatJob(id, user)]);
    const jobs = await db.documentExtractionJob.findMany({ where: { caseId: id } });
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => j.status === "SUCCEEDED" && j.attempts === 1)).toBe(true);
    expect(new Set(jobs.map((j) => j.runId)).size).toBe(2);
  }, 30_000);

  it("keeps PDF originals and prepares/reads every page independently", async () => {
    const { user, id } = await setup(),
      pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
    await uploadChatBatch(user, id, randomUUID(), [
      new File([new Uint8Array(await pdf.save())], "two-pages.pdf", { type: "application/pdf" }),
    ]);
    let view = await getReportChat(user, id);
    expect(view.jobs.map((j) => j.status)).toEqual(["WAITING_PAGES", "WAITING_PAGES"]);
    const jpeg = await image("fictional-prescription-scan.jpg"),
      doc = view.documents[0];
    await uploadPdfPage(user, id, doc.id, 1, jpeg);
    await processChatJob(id, user);
    view = await getReportChat(user, id);
    expect(view.processing).toBe(true);
    expect(view.question).toBeNull();
    await uploadPdfPage(user, id, doc.id, 2, jpeg);
    await processChatJob(id, user);
    view = await getReportChat(user, id);
    expect(view.processing).toBe(false);
    expect(view.jobs.every((j) => j.status === "SUCCEEDED")).toBe(true);
    const runs = await db.extractionRun.findMany({ where: { document: { caseId: id } } });
    expect(new Set(runs.map((r) => r.sourcePage))).toEqual(new Set([1, 2]));
  }, 30_000);

  it("saves direct answers immediately, asks the next question and never repeats an idempotent message", async () => {
    const { user, id } = await setup();
    let view = await getReportChat(user, id);
    // One question for the patient, read without the AI.
    expect(view.question?.field).toBe("patient");
    const spy = vi.spyOn(provider, "generateWithFallback");
    const body = {
      requestId: randomUUID(),
      revision: view.revision,
      lockVersion: view.lockVersion,
      content: "C.B., 34/F",
      questionKey: view.question!.key,
    };
    view = await sendReportChatMessage(user, id, body);
    const c = (await loadCase(user, id)).c;
    expect([c.patientInitials, c.ageValue, c.ageUnit, c.gender]).toEqual(["C.B.", 34, "YEARS", "FEMALE"]);
    expect(spy).not.toHaveBeenCalled();
    expect((await sendReportChatMessage(user, id, body)).messages.filter((m) => m.role === "USER")).toHaveLength(1);
    expect(view.question?.field).toBe("reaction");
  }, 30_000);

  it("never saves 'not sure' as a value and never asks the same question forever", async () => {
    const { user, id } = await setup();
    await saveDraft(
      user,
      id,
      0,
      form({ patientInitials: "T.S.", reactionManagement: "Stopped", medicalHistory: "None" }),
    );
    let view = await getReportChat(user, id);
    // Work through to the optional manufacturer/batch/expiry question.
    for (let i = 0; i < 12 && view.question && view.question.field !== "optionalDetails"; i++)
      view = await say(user, id, view, "I don't know");
    expect(view.question?.field).toBe("optionalDetails");
    const groupKey = view.question!.key;
    for (const answer of ["not sure", "n/a"]) {
      view = await say(user, id, view, answer);
      expect(view.question?.key).not.toBe(groupKey);
    }
    const m = (await loadCase(user, id)).c.suspectedMedicines[0];
    expect([m.manufacturer, m.batchLot]).toEqual([null, null]);
    expect(m.unknownFields).toEqual(expect.arrayContaining(["manufacturer", "batchLot", "expiryDate"]));
    // An answer the assistant cannot use: asked again once, then skipped (optional), never looped.
    await skipOptionalQuestions(user, id);
    const { id: other } = await setup();
    await saveDraft(user, other, 0, form());
    view = await getReportChat(user, other);
    while (view.question && !view.question.optional) view = await say(user, other, view, "unknown");
    const optionalKey = view.question?.key;
    view = await say(user, other, view, "hmm, let me check the box later and come back to this one please");
    expect(view.question?.key).toBe(optionalKey);
    expect(lastReply(view)).toMatch(/No report detail found in the answer/);
    view = await say(user, other, view, "hmm, let me check the box later and come back to this one please");
    expect(view.question?.key).not.toBe(optionalKey);
    expect(view.messages.filter((m) => m.role === "ASSISTANT").at(-1)?.content).toMatch(
      /The question has been skipped/,
    );
  }, 60_000);

  it("takes several explicit facts from one message but ignores protected writes and absent quotes", async () => {
    const { user, id } = await setup();
    const view = await getReportChat(user, id);
    mockChat([
      { entity: "case", entityName: "", field: "patientInitials", value: "M.T.", sourceText: "M.T." },
      { entity: "case", entityName: "", field: "reactionTerms", value: "Rash", sourceText: "rash" },
      { entity: "case", entityName: "", field: "status", value: "APPROVED", sourceText: "rash" },
      { entity: "case", entityName: "", field: "weightKg", value: "89", sourceText: "not in message" },
      { entity: "case", entityName: "", field: "gender", value: "Female", sourceText: "she" },
    ]);
    const saved = await say(user, id, view, "M.T. had a rash, she is fine now", false);
    const c = (await loadCase(user, id)).c;
    expect([c.patientInitials, c.reactionTerms, c.gender, c.weightKg, c.status]).toEqual([
      "M.T.",
      "Rash",
      "FEMALE",
      null,
      "DRAFT",
    ]);
    expect(lastReply(saved)).toMatch(/Patient initials: M\.T\..*Reaction or symptoms: Rash/);
  });

  it("does not expose another reporter's conversation", async () => {
    const { id } = await setup(),
      other = await userFor("physician@demo.test");
    await expect(getReportChat(other, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("offers the named medicines as buttons when one answer names several, and uses explicit roles when given", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form({ suspectedMedicines: [] }));
    let view = await getReportChat(user, id);
    expect(view.question?.kind).toBe("suspect");
    mockChat([
      { entity: "medicine", entityName: "Amoxicillin", field: "name", value: "Amoxicillin", sourceText: "Amoxicillin" },
      { entity: "medicine", entityName: "Paracetamol", field: "name", value: "Paracetamol", sourceText: "paracetamol" },
    ]);
    view = await say(user, id, view, "Amoxicillin and paracetamol were both given.");
    expect(view.question?.kind).toBe("suspect");
    expect(Object.keys(view.question!.options!)).toEqual(["Amoxicillin", "Paracetamol"]);
    vi.restoreAllMocks();
    mockChat(
      [
        {
          entity: "medicine",
          entityName: "Amoxicillin",
          field: "name",
          value: "Amoxicillin",
          sourceText: "Amoxicillin",
        },
        {
          entity: "medicine",
          entityName: "Paracetamol",
          field: "name",
          value: "Paracetamol",
          sourceText: "paracetamol",
        },
      ],
      [
        { entityName: "Amoxicillin", role: "SUSPECTED", sourceText: "Amoxicillin is suspected" },
        { entityName: "Paracetamol", role: "CONCOMITANT", sourceText: "paracetamol was also taken" },
      ],
    );
    view = await say(user, id, view, "Amoxicillin is suspected and paracetamol was also taken.", false);
    const c = (await loadCase(user, id)).c;
    expect(c.suspectedMedicines.map((m) => m.name)).toEqual(["Amoxicillin"]);
    expect(c.concomitantProducts.map((m) => m.name)).toEqual(["Paracetamol"]);
  });

  it("never lets a document overwrite the report, while the reporter's own answer does", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form({ patientInitials: "R.K.", gender: "MALE", suspectedMedicines: [] }));
    await uploadChatBatch(user, id, randomUUID(), [await image()]);
    await processChatJob(id, user);
    let view = await getReportChat(user, id);
    expect((await loadCase(user, id)).c.gender).toBe("MALE");
    expect(view.summary.attention.some((n) => n.kind === "CONFLICT" && /reads "Female"/.test(n.message))).toBe(true);
    mockChat([{ entity: "case", entityName: "", field: "gender", value: "FEMALE", sourceText: "she is female" }]);
    view = await say(user, id, view, "Sorry, she is female.", false);
    expect((await loadCase(user, id)).c.gender).toBe("FEMALE");
    expect(lastReply(view)).toMatch(/Updated: Gender Male → Female/);
  }, 30_000);

  it("holds back a document with different patient initials until the reporter says it belongs", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form({ patientInitials: "Z.Z.", ageValue: "", suspectedMedicines: [] }));
    await uploadChatBatch(user, id, randomUUID(), [await image()]);
    await processChatJob(id, user);
    let view = await getReportChat(user, id);
    expect((await loadCase(user, id)).c.ageValue).toBeNull();
    const heldNote = view.summary.attention.find((n) => n.kind === "HELD");
    expect(heldNote?.message).toMatch(/R\.K\..*Z\.Z\./);
    // The held document's medicines are not offered.
    expect(Object.keys(view.question?.options ?? {})).toEqual([]);
    view = await confirmDocumentBelongs(user, id, heldNote!.documentId!);
    const c = (await loadCase(user, id)).c;
    expect(c.ageValue).toBe(34);
    expect(c.patientInitials).toBe("Z.Z.");
    expect(Object.keys(view.question?.options ?? {})).toEqual([
      "Amoxicillin 500 mg capsule",
      "Paracetamol 500 mg tablet",
    ]);
  }, 30_000);

  it("enters the same medicine once across sources, keeps the fullest name and fills the route from the form", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form({ patientInitials: "R.K." }));
    await uploadChatBatch(user, id, randomUUID(), [await image()]);
    await processChatJob(id, user);
    let view = await getReportChat(user, id);
    let c = (await loadCase(user, id)).c;
    expect(c.suspectedMedicines.map((m) => m.name)).toEqual(["Amoxicillin 500 mg capsule"]);
    expect(view.summary.info.some((n) => n.kind === "MERGED")).toBe(true);
    mockChat(
      [
        {
          entity: "medicine",
          entityName: "Fluticasone nasal spray",
          field: "name",
          value: "Fluticasone nasal spray",
          sourceText: "fluticasone nasal spray",
        },
        {
          entity: "medicine",
          entityName: "Cap. Amoxycillin",
          field: "dose",
          value: "1 capsule",
          sourceText: "1 capsule",
        },
      ],
      [{ entityName: "Fluticasone nasal spray", role: "CONCOMITANT", sourceText: "also used fluticasone nasal spray" }],
    );
    view = await say(
      user,
      id,
      view,
      "She also used fluticasone nasal spray, and took 1 capsule of Cap. Amoxycillin.",
      false,
    );
    c = (await loadCase(user, id)).c;
    expect(c.suspectedMedicines).toHaveLength(1);
    // "1 capsule" says the same as the prescription's "1 cap": kept, and not reported as a difference.
    expect(c.suspectedMedicines[0].dose).toBe("1 cap");
    expect(view.summary.attention.some((n) => n.kind === "CONFLICT" && /Dose/.test(n.label))).toBe(false);
    const spray = c.concomitantProducts.find((m) => /fluticasone/i.test(m.name ?? ""));
    expect(spray?.route).toBe("Nasal");
    expect(lastReply(view)).toMatch(/Completed from the details given: Fluticasone nasal spray \(route Nasal\)/);
    expect(view.question?.field).not.toBe("route");
  }, 30_000);

  it("places a medicine given for the reaction as treatment without asking", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form());
    const view = await getReportChat(user, id);
    mockChat([
      {
        entity: "medicine",
        entityName: "Cetirizine 10 mg",
        field: "name",
        value: "Cetirizine 10 mg",
        sourceText: "cetirizine 10 mg",
      },
      {
        entity: "medicine",
        entityName: "Cetirizine 10 mg",
        field: "usedToTreatReaction",
        value: "true",
        sourceText: "given cetirizine 10 mg for the rash",
      },
    ]);
    await say(user, id, view, "She was given cetirizine 10 mg for the rash.", false);
    const c = (await loadCase(user, id)).c;
    expect(c.concomitantProducts.map((m) => [m.name, m.usedToTreatReaction])).toEqual([["Cetirizine 10 mg", true]]);
  });

  it("writes item 7 from the details and marks anything not found in them for a look", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form());
    const view = await writeDescription(user, id);
    const c = (await loadCase(user, id)).c;
    expect(c.reactionDescription).toMatch(/amoxicillin/i);
    const note = [...view.summary.attention, ...view.summary.info].find((n) => n.key === "reactionDescription");
    expect(note?.message).toMatch(/Written by the app/);
    expect(lastReply(view)).toMatch(/Description of the reaction \(item 7\) drafted/);
  });

  it("recovers an expired worker lease and lets an exhausted job be explicitly retried", async () => {
    const { user, id } = await setup();
    await uploadChatBatch(user, id, randomUUID(), [await image()]);
    const job = await db.documentExtractionJob.findFirstOrThrow({ where: { caseId: id } });
    await db.documentExtractionJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", attempts: 5, leaseToken: "interrupted", leaseUntil: new Date(Date.now() - 1000) },
    });
    expect(await processChatJob(id, user)).toEqual({ processed: false });
    expect((await getReportChat(user, id)).jobs[0].status).toBe("FAILED");
    await retryChatJob(user, id, job.id);
    await processChatJob(id, user);
    expect((await getReportChat(user, id)).jobs[0].status).toBe("SUCCEEDED");
  });

  it("keeps extra document facts and explicit approximate dates", async () => {
    const { user, id } = await setup();
    await uploadChatBatch(user, id, randomUUID(), [await image()]);
    const fixture = provider.configuredProviders({ AI_PROVIDER: "fixture" })[0];
    const result = await fixture.generate({
      task: "extract-document",
      system: "",
      prompt: "",
      schema: chatExtractionSchema,
    });
    result.output.extraFields = [
      {
        entity: "case",
        medicationIndex: null,
        field: "dateOfBirth",
        reading: { value: "1992", sourceText: "born about 1992", uncertain: false, approximate: false },
      },
      {
        entity: "case",
        medicationIndex: null,
        field: "outcome",
        reading: { value: "RECOVERED", sourceText: "Recovered", uncertain: false, approximate: false },
      },
      {
        entity: "medicine",
        medicationIndex: 0,
        field: "actionTaken",
        reading: { value: "DRUG_WITHDRAWN", sourceText: "Amoxicillin stopped", uncertain: false, approximate: false },
      },
    ];
    vi.spyOn(provider, "generateWithFallback").mockResolvedValue({
      ...result,
      provider: "fixture",
      model: "test",
      attempts: [],
    });
    await processChatJob(id, user);
    vi.restoreAllMocks();
    let view = await getReportChat(user, id);
    let c = (await loadCase(user, id)).c;
    expect([c.dateOfBirth, c.dateOfBirthApprox, c.outcome]).toEqual(["1992", true, "RECOVERED"]);
    view = await giveReaction(user, id, view);
    view = await say(user, id, view, "Amoxicillin 500 mg capsule");
    c = (await loadCase(user, id)).c;
    expect(c.suspectedMedicines[0].actionTaken).toBe("DRUG_WITHDRAWN");
    expect(view.question?.field).not.toBe("actionTaken");
  });

  it("treats submission as the single confirmation of everything filled automatically", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form({ patientInitials: "R.K." }));
    await uploadChatBatch(user, id, randomUUID(), [await image()]);
    await processChatJob(id, user);
    let view = await getReportChat(user, id);
    while (view.question?.kind === "role") view = await say(user, id, view, "CONCOMITANT");
    const c = (await loadCase(user, id)).c;
    await submitCase(user, id, { lockVersion: c.lockVersion, declaration: true });
    const provenance = await db.fieldProvenance.findMany({ where: { caseId: id } });
    expect(provenance.length).toBeGreaterThan(0);
    expect(provenance.every((p) => p.verifiedById === user.id && p.verifiedAt)).toBe(true);
    const runs = await db.extractionRun.findMany({ where: { document: { caseId: id } }, include: { items: true } });
    expect(runs.flatMap((r) => r.items).some((i) => i.status === "ACCEPTED" && i.decidedById === user.id)).toBe(true);
  }, 30_000);
  // The reporter's own live test (1 November 2026), replayed with the AI reading exactly as it behaved live:
  // it left out two medicines and called amoxicillin "another medicine" from "she was taking".
  it("live test: catches medicines the AI missed, asks roles the words do not state, and is ready to submit", async () => {
    const { user, id } = await setup();
    await uploadChatBatch(user, id, randomUUID(), [await image()]);
    await processChatJob(id, user);
    let view = await getReportChat(user, id);
    const message =
      "She was taking Amoxycillin 500mg caps three times a day and Dolo 650 for fever. She also used Fluticasone nasal spray, Salbutamol inhaler 2 puffs, Moxifloxacin eye drops and Inj. Ceftriaxone 1 g. She had Ampicillin last year. The itchy rash started on 14 Oct 2026, she was given cetirizine tablets for it and recovered on 18 Oct 2026. Not serious.";
    const med = (entityName: string, field: string, value: string, sourceText: string) => ({
      entity: "medicine",
      entityName,
      field,
      value,
      sourceText,
    });
    const role = (entityName: string, r: string, sourceText: string) => ({ entityName, role: r, sourceText });
    mockChat(
      [
        { entity: "case", entityName: "", field: "reactionTerms", value: "itchy rash", sourceText: "itchy rash" },
        {
          entity: "case",
          entityName: "",
          field: "reactionStartDate",
          value: "2026-10-14",
          sourceText: "started on 14 Oct 2026",
        },
        {
          entity: "case",
          entityName: "",
          field: "reactionStopDate",
          value: "2026-10-18",
          sourceText: "recovered on 18 Oct 2026",
        },
        { entity: "case", entityName: "", field: "outcome", value: "RECOVERED", sourceText: "recovered" },
        { entity: "case", entityName: "", field: "seriousAnswer", value: "NO", sourceText: "Not serious" },
        med("Amoxycillin", "name", "Amoxycillin", "Amoxycillin 500mg caps"),
        med("Amoxycillin", "dose", "500mg", "500mg"),
        med("Amoxycillin", "frequency", "three times a day", "three times a day"),
        med("Dolo 650", "name", "Dolo 650", "Dolo 650"),
        med("Dolo 650", "indication", "fever", "for fever"),
        med("Salbutamol inhaler", "name", "Salbutamol inhaler", "Salbutamol inhaler"),
        med("Salbutamol inhaler", "dose", "2 puffs", "2 puffs"),
        med("Inj. Ceftriaxone", "name", "Inj. Ceftriaxone", "Inj. Ceftriaxone"),
        med("Inj. Ceftriaxone", "dose", "1 g", "1 g"),
        med("Ampicillin", "name", "Ampicillin", "Ampicillin"),
        med("Ampicillin", "startDate", "2025", "last year"),
        med("cetirizine", "name", "cetirizine", "cetirizine tablets"),
        med("cetirizine", "usedToTreatReaction", "true", "given cetirizine tablets for it"),
      ],
      [
        role("Amoxycillin", "CONCOMITANT", "She was taking Amoxycillin"),
        role("Dolo 650", "CONCOMITANT", "Dolo 650"),
        role("Salbutamol inhaler", "CONCOMITANT", "She also used"),
        role("Inj. Ceftriaxone", "CONCOMITANT", "She also used"),
        role("Ampicillin", "CONCOMITANT", "She had Ampicillin last year"),
        role("cetirizine", "TREATMENT", "given cetirizine tablets for it"),
      ],
    );
    view = await say(user, id, view, message, false);
    vi.restoreAllMocks();
    const reply = lastReply(view);
    // One name per medicine in the reply: the merged spelling "Amoxycillin" is shown under the report's name.
    expect(reply).not.toMatch(/Amoxycillin \(/);
    // "She was taking" does not say whether amoxicillin is suspected: one question, with the medicines
    // whose role the words leave open as buttons (the AI's missed medicines included).
    expect(view.question?.kind).toBe("suspect");
    const offered = Object.keys(view.question!.options!);
    expect(offered.some((n) => /amoxicillin/i.test(n))).toBe(true);
    expect(offered.some((n) => /fluticasone nasal spray/i.test(n))).toBe(true);
    expect(offered.some((n) => /moxifloxacin eye drops/i.test(n))).toBe(true);
    expect(offered.some((n) => /salbutamol|ceftriaxone|cetirizine/i.test(n))).toBe(false);
    view = await say(
      user,
      id,
      view,
      offered.find((n) => /amoxicillin/i.test(n))!,
    );
    const c = (await loadCase(user, id)).c;
    const all = [...c.suspectedMedicines, ...c.concomitantProducts];
    const find = (re: RegExp) => all.filter((m) => re.test(m.name ?? ""));
    expect(c.suspectedMedicines.map((m) => m.name)).toEqual(["Amoxicillin 500 mg capsule"]);
    expect(find(/amox/i)).toHaveLength(1);
    expect(find(/parac|dolo/i)).toHaveLength(1);
    expect(find(/ampicillin/i)).toHaveLength(1);
    expect(find(/fluticasone/i)[0]?.route).toBe("Nasal");
    expect(find(/moxifloxacin/i)[0]?.route).toBe("Ophthalmic");
    expect(find(/salbutamol/i)[0]?.route).toBe("Inhalation");
    expect(find(/amox/i)[0]?.route).toBe("Oral");
    expect(find(/cetirizine/i)[0]?.route).toBe("Oral");
    expect(c.concomitantProducts.find((m) => /cetirizine/i.test(m.name ?? ""))?.usedToTreatReaction).toBe(true);
    expect(find(/ceftriaxone/i)[0]?.route ?? "").toBe("");
    // "TID" on the prescription and "three times a day" typed agree: no difference reported.
    expect(view.summary.attention.some((n) => n.kind === "CONFLICT" && /Frequency/.test(n.label))).toBe(false);
    // "Last year" is worked out by the fixed date rules and says how, instead of being flagged as an AI guess.
    const ampicillin = view.summary.info.find((n) => /Ampicillin: Date started/.test(n.label));
    expect(ampicillin?.message).toMatch(/Worked out from "last year", counted from today/);
    expect(view.summary.attention.some((n) => n.kind === "SIMILAR")).toBe(true);
    // Dolo 650 was merged with the prescription's Paracetamol 500 mg: the different strength is pointed out.
    expect(view.summary.attention.some((n) => /different strengths \(500 mg, 650\)/.test(n.message))).toBe(true);
    expect(view.question?.kind).not.toBe("suspect");
    expect(view.completeness.missing.map((m) => m.path)).not.toContain("suspectedMedicines");
  }, 60_000);

  it("never shows a new medicine's default 'No' as a change, and keeps a full free-text answer", async () => {
    const { user, id } = await setup();
    await saveDraft(
      user,
      id,
      0,
      form({
        reactionDescription: "Rash on both arms",
        reactionManagement: "Stopped amoxicillin",
        suspectedMedicines: [
          {
            ...form().suspectedMedicines[0],
            dose: "500 mg",
            route: "Oral",
            frequency: "TID",
            stopDate: { value: "2026-10-21", approx: false },
            actionTaken: "DRUG_WITHDRAWN",
            rechallenge: "NOT_REINTRODUCED",
            indication: "Sinusitis",
          },
        ],
      }),
    );
    let view = await getReportChat(user, id);
    mockChat(
      [
        {
          entity: "medicine",
          entityName: "fluticasone nasal spray",
          field: "name",
          value: "fluticasone nasal spray",
          sourceText: "fluticasone nasal spray",
        },
        {
          entity: "medicine",
          entityName: "fluticasone nasal spray",
          field: "frequency",
          value: "daily",
          sourceText: "daily",
        },
        {
          entity: "medicine",
          entityName: "fluticasone nasal spray",
          field: "ongoing",
          value: "true",
          sourceText: "also uses fluticasone nasal spray daily",
        },
      ],
      [{ entityName: "fluticasone nasal spray", role: "CONCOMITANT", sourceText: "also uses" }],
    );
    view = await say(user, id, view, "She also uses fluticasone nasal spray daily.", false);
    vi.restoreAllMocks();
    expect(lastReply(view)).toMatch(/still being taken yes/i);
    expect(lastReply(view)).not.toMatch(/No → Yes|Updated:/);
    expect([...view.summary.attention, ...view.summary.info].some((n) => n.kind === "CHANGED")).toBe(false);
    expect(view.summary.attention.some((n) => /Still being taken/.test(n.label))).toBe(false);
    // The medical history answer is kept as the reporter wrote it, not cut down by the AI.
    while (view.question && view.question.field !== "medicalHistory") view = await say(user, id, view, "not sure");
    expect(view.question?.field).toBe("medicalHistory");
    mockChat([
      {
        entity: "case",
        entityName: "",
        field: "medicalHistory",
        value: "known diabetic on metformin",
        sourceText: "known diabetic on metformin",
      },
      { entity: "medicine", entityName: "metformin", field: "name", value: "metformin", sourceText: "metformin" },
    ]);
    view = await say(user, id, view, "no allergies, known diabetic on metformin");
    const after = (await loadCase(user, id)).c;
    expect(after.medicalHistory).toBe("no allergies, known diabetic on metformin");
    // The suspected medicine is known, so metformin is added as another medicine without a question.
    expect(after.concomitantProducts.map((m) => m.name)).toContain("metformin");
    expect(view.question?.kind).not.toBe("suspect");
  }, 60_000);
  // Reported on 1 November 2026: "it is given as flutifer nassal spary, but the chatbot is still asking for the route".
  it("never asks the route of a medicine typed as 'flutifer nassal spary'", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form({ suspectedMedicines: [] }));
    let view = await getReportChat(user, id);
    expect(view.question?.kind).toBe("suspect");
    // The AI reading keeps the misspelling and gives no route, as it did live.
    mockChat([
      {
        entity: "medicine",
        entityName: "flutifer nassal spary",
        field: "name",
        value: "flutifer nassal spary",
        sourceText: "flutifer nassal spary",
      },
    ]);
    view = await say(user, id, view, "flutifer nassal spary");
    vi.restoreAllMocks();
    const c = (await loadCase(user, id)).c;
    expect(c.suspectedMedicines.map((m) => [m.name, m.route])).toEqual([["flutifer nasal spray", "Nasal"]]);
    expect(lastReply(view)).toMatch(/route Nasal/);
    expect(view.question?.field).not.toBe("route");
    expect(view.question?.text).not.toMatch(/How was .* given/);
    // Nothing about the route or the corrected spelling needs a separate look.
    expect(view.summary.attention.some((n) => /Route|Medicine name/.test(n.label))).toBe(false);
  });

  it("reads a handwritten prescription like the reporter's Flutifer sample without asking the route", async () => {
    const { user, id } = await setup();
    await uploadChatBatch(user, id, randomUUID(), [await image()]);
    const fixture = provider.configuredProviders({ AI_PROVIDER: "fixture" })[0];
    const base = await fixture.generate({
      task: "extract-document",
      system: "",
      prompt: "",
      schema: chatExtractionSchema,
    });
    const read = (value: string, sourceText: string, uncertain = false) => ({
      value,
      sourceText,
      uncertain,
      approximate: false,
    });
    const none = { value: null, sourceText: null, uncertain: false, approximate: false };
    // How a reader may see the handwriting: "Flutifer Nanal spry — 0-0-1, 2 sprays every nostril for 2 weeks".
    base.output.patient = {
      initials: read("A.K.", "A. Kumar"),
      age: read("24", "24"),
      ageUnit: read("YEARS", "24"),
      gender: read("MALE", "M"),
      weightKg: read("54", "54kg"),
    };
    base.output.medications = [
      {
        name: read("Flutifer Nanal spry", "Flutifer Nanal spry", true),
        dose: read("2 sprays every nostril", "2 sprays every nostril"),
        route: none,
        frequency: read("0-0-1", "0-0-1"),
        startDate: none,
        stopDate: none,
        duration: read("2 weeks", "for 2 weeks"),
        indication: none,
        manufacturer: none,
        batchLot: none,
        expiryDate: none,
      },
    ];
    vi.spyOn(provider, "generateWithFallback").mockResolvedValue({
      ...base,
      provider: "fixture",
      model: "test",
      attempts: [],
    });
    await processChatJob(id, user);
    vi.restoreAllMocks();
    let view = await getReportChat(user, id);
    view = await giveReaction(user, id, view);
    // The misread "Nanal spry" is offered under its corrected name.
    expect(view.question?.options).toEqual({ "Flutifer Nasal spray": "Yes, Flutifer Nasal spray" });
    view = await say(user, id, view, "Flutifer Nasal spray");
    const c = (await loadCase(user, id)).c;
    expect([c.patientInitials, c.ageValue, c.gender, c.weightKg]).toEqual(["A.K.", 24, "MALE", 54]);
    const m = c.suspectedMedicines[0];
    expect([m.name, m.route, m.dose, m.frequency]).toEqual([
      "Flutifer Nasal spray",
      "Nasal",
      "2 sprays every nostril",
      "0-0-1",
    ]);
    // The duration is never turned into a stop date.
    expect(m.stopDate).toBeNull();
    expect(view.question?.field).not.toBe("route");
  }, 30_000);

  it("flags a pack's licence number or manufacturing date read as batch or expiry", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form({ patientInitials: "R.K.", suspectedMedicines: [] }));
    await uploadChatBatch(user, id, randomUUID(), [await image()]);
    const fixture = provider.configuredProviders({ AI_PROVIDER: "fixture" })[0];
    const base = await fixture.generate({
      task: "extract-document",
      system: "",
      prompt: "",
      schema: chatExtractionSchema,
    });
    const read = (value: string, sourceText: string) => ({ value, sourceText, uncertain: false, approximate: false });
    const none = { value: null, sourceText: null, uncertain: false, approximate: false };
    // The pack prints labels and values in separate columns; a careless reading takes the wrong line for each.
    base.output.medications = [
      {
        name: read("Flutifer", "Flutifer"),
        dose: none,
        route: none,
        frequency: none,
        startDate: none,
        stopDate: none,
        duration: none,
        indication: none,
        manufacturer: read("Sava Healthcare Limited", "Manufactured by: SAVA HEALTHCARE LIMITED"),
        batchLot: read("G/25/536", "Mfg. Lic. No.: G/25/536"),
        expiryDate: read("2025-11", "Mfg. Date: 11/2025"),
      },
    ];
    vi.spyOn(provider, "generateWithFallback").mockResolvedValue({
      ...base,
      provider: "fixture",
      model: "test",
      attempts: [],
    });
    await processChatJob(id, user);
    vi.restoreAllMocks();
    let view = await getReportChat(user, id);
    view = await say(user, id, view, "Flutifer");
    const attention = view.summary.attention.map((n) => `${n.kind} ${n.label}`);
    expect(attention).toContain("UNCLEAR Flutifer: Batch or lot");
    expect(attention).toContain("UNCLEAR Flutifer: Expiry date");
    expect(view.completeness.warnings.some((w) => /expiry date is before the reaction started/.test(w.message))).toBe(
      true,
    );
  }, 30_000);
  // Live audit, 24 November 2026: this note led to 12 questions and lost "HS" and "stat".
  it("hospital shorthand note: no role questions, prescription details kept, treatment filled in, names kept as written", async () => {
    const { user, id } = await setup();
    let view = await getReportChat(user, id);
    const note =
      "Pt R.K, 34/F, k/c/o DM on T. Metformin 500 BD. Started T. Azithromycin 500 OD x 3d on 10/11/26 for URTI. On 12/11 c/o generalised urticaria & itching. Azithro stopped, given Inj. Avil 1 amp IM stat + T. Cetrizine 10mg HS. Recovered by 15/11. Not serious.";
    const c = (field: string, value: string, sourceText: string) => ({
      entity: "case",
      entityName: "",
      field,
      value,
      sourceText,
    });
    const m = (entityName: string, field: string, value: string, sourceText: string) => ({
      entity: "medicine",
      entityName,
      field,
      value,
      sourceText,
    });
    // What the live AI returned: no frequency for Avil and Cetrizine, no role for Metformin or Azithromycin.
    mockChat(
      [
        c("patientInitials", "R.K", "R.K"),
        c("ageValue", "34", "34/F"),
        c("ageUnit", "YEARS", "34/F"),
        c("gender", "FEMALE", "34/F"),
        c("medicalHistory", "DM", "k/c/o DM"),
        c("reactionTerms", "generalised urticaria & itching", "generalised urticaria & itching"),
        c("reactionStartDate", "2026-11-12", "On 12/11"),
        c("reactionStopDate", "2026-11-15", "Recovered by 15/11"),
        c("outcome", "RECOVERED", "Recovered"),
        c("seriousAnswer", "NO", "Not serious"),
        m("Metformin 500mg tablet", "name", "Metformin 500mg tablet", "T. Metformin 500"),
        m("Metformin 500mg tablet", "dose", "500", "500"),
        m("Azithromycin 500mg tablet", "name", "Azithromycin 500mg tablet", "T. Azithromycin 500"),
        m("Azithromycin 500mg tablet", "dose", "500", "500"),
        m("Azithromycin 500mg tablet", "frequency", "OD", "OD"),
        m("Azithromycin 500mg tablet", "startDate", "2026-11-10", "on 10/11/26"),
        m("Azithromycin 500mg tablet", "stopDate", "2026-11-12", "Azithro stopped"),
        m("Azithromycin 500mg tablet", "indication", "URTI", "for URTI"),
        m("Azithromycin 500mg tablet", "actionTaken", "DRUG_WITHDRAWN", "Azithro stopped"),
        m("Avil 1 ampoule injection", "name", "Avil 1 ampoule injection", "Inj. Avil"),
        m("Avil 1 ampoule injection", "usedToTreatReaction", "true", "given Inj. Avil"),
        m("Cetrizine 10mg tablet", "name", "Cetrizine 10mg tablet", "T. Cetrizine 10mg"),
        m("Cetrizine 10mg tablet", "usedToTreatReaction", "true", "given Inj. Avil 1 amp IM stat + T. Cetrizine"),
      ],
      [
        { entityName: "Azithromycin 500mg tablet", role: "SUSPECTED", sourceText: "Azithro stopped" },
        { entityName: "Avil 1 ampoule injection", role: "TREATMENT", sourceText: "given Inj. Avil" },
        { entityName: "Cetrizine 10mg tablet", role: "TREATMENT", sourceText: "T. Cetrizine" },
      ],
    );
    view = await say(user, id, view, note, false);
    vi.restoreAllMocks();
    const r = (await loadCase(user, id)).c;
    expect(r.suspectedMedicines.map((x) => x.name)).toEqual(["Azithromycin 500mg tablet"]);
    const other = (re: RegExp) => r.concomitantProducts.find((x) => re.test(x.name ?? ""))!;
    // Metformin ("k/c/o DM on T. Metformin") is placed as another medicine without a question.
    expect(other(/metformin/i).usedToTreatReaction).toBe(false);
    expect(other(/metformin/i).frequency).toBe("BD");
    // Read from the prescription lines when the AI left them out.
    expect([other(/avil/i).dose, other(/avil/i).route, other(/avil/i).frequency]).toEqual([
      "1 amp",
      "Intramuscular",
      "stat",
    ]);
    expect([other(/cetrizine/i).name, other(/cetrizine/i).frequency]).toEqual(["Cetrizine 10mg tablet", "HS"]);
    // Treatment is written from the medicines stopped and given.
    expect(r.reactionManagement).toMatch(/Azithromycin 500mg tablet stopped; given Avil/);
    // Kept as written; the recognised medicine is noted.
    expect(
      view.summary.info.some((n) => /Kept as written; recognised as Cetirizine \(cetirizine\)/.test(n.message)),
    ).toBe(true);
    // Nothing required is left to ask: at most the optional questions.
    const asked: string[] = [];
    for (let i = 0; i < 10 && view.question; i++) {
      asked.push(view.question.field);
      expect(view.question.optional, view.question.text).toBe(true);
      view = await say(user, id, view, "I don't know");
    }
    expect(asked.length).toBeLessThanOrEqual(2);
  }, 60_000);

  // Live audit, 24 November 2026: this message led to 18 questions and "crosin" was not recognised.
  it("'rash after taking crosin': recognised as Crocin (paracetamol) and finished in a few short answers", async () => {
    const { user, id } = await setup();
    let view = await getReportChat(user, id);
    mockChat(
      [
        { entity: "case", entityName: "", field: "reactionTerms", value: "Rash", sourceText: "rash" },
        { entity: "medicine", entityName: "crosin", field: "name", value: "crosin", sourceText: "crosin" },
      ],
      [{ entityName: "crosin", role: "SUSPECTED", sourceText: "rash after taking crosin" }],
    );
    view = await say(user, id, view, "rash after taking crosin", false);
    vi.restoreAllMocks();
    const s = (await loadCase(user, id)).c.suspectedMedicines;
    expect(s.map((x) => x.name)).toEqual(["crosin"]);
    const answers: Record<string, string> = {
      patient: "R.K., 30, F",
      reactionStartDate: "14/11/2026",
      outcome: "RECOVERED",
      seriousness: "NOT_SERIOUS",
      actionTaken: "DRUG_WITHDRAWN",
      medicalHistory: "none",
    };
    const asked: string[] = [];
    while (view.question && !view.question.optional && asked.length < 15) {
      asked.push(view.question.field);
      view = await say(user, id, view, answers[view.question.field] ?? "I don't know");
    }
    // Was 18 questions. Now: patient, start date, outcome, seriousness, medicine details, action taken, history
    // (treatment is filled in from "drug withdrawn").
    expect(asked).toEqual([
      "patient",
      "reactionStartDate",
      "outcome",
      "seriousness",
      "details",
      "actionTaken",
      "medicalHistory",
    ]);
    expect((await loadCase(user, id)).c.reactionManagement).toBe("Crosin stopped.");
    const done = (await loadCase(user, id)).c;
    expect([done.patientInitials, done.ageValue, done.gender, done.reactionStartDate]).toEqual([
      "R.K.",
      30,
      "FEMALE",
      "2026-11-14",
    ]);
    expect([done.seriousAnswer, done.outcome, done.medicalHistory]).toEqual(["NO", "RECOVERED", "None"]);
    expect(view.completeness.missing).toEqual([]);
  }, 60_000);
  // Requested 25 November 2026: dates given in words must be understood and entered correctly.
  it("enters dates given in words: yesterday, days ago, and counted from the prescription date", async () => {
    const shift = (days: number) => {
      const d = new Date(`${todayInAppZone()}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const noStart = { value: "", approx: false };
    // A direct answer, worked out without the AI.
    let { user, id } = await setup();
    await saveDraft(user, id, 0, form({ reactionStartDate: noStart }));
    let view = await getReportChat(user, id);
    expect(view.question?.field).toBe("reactionStartDate");
    const spy = vi.spyOn(provider, "generateWithFallback");
    view = await say(user, id, view, "yesterday");
    expect(spy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    expect((await loadCase(user, id)).c.reactionStartDate).toBe(shift(-1));
    expect(view.summary.info.some((n) => /Worked out from "yesterday", counted from today/.test(n.message))).toBe(true);

    // The AI's arithmetic is replaced by the fixed count ("3 days ago").
    ({ user, id } = await setup());
    await saveDraft(user, id, 0, form({ reactionStartDate: noStart }));
    view = await getReportChat(user, id);
    mockChat([
      { entity: "case", entityName: "", field: "reactionStartDate", value: "2026-01-01", sourceText: "3 days ago" },
    ]);
    view = await say(user, id, view, "The rash started 3 days ago.", false);
    vi.restoreAllMocks();
    expect((await loadCase(user, id)).c.reactionStartDate).toBe(shift(-3));
    expect(view.summary.attention.some((n) => /Reaction start date/.test(n.label))).toBe(false);

    // Counted from the date written on the prescription.
    ({ user, id } = await setup());
    await saveDraft(user, id, 0, form({ patientInitials: "R.K.", reactionStartDate: noStart }));
    await uploadChatBatch(user, id, randomUUID(), [await image()]);
    const fixture = provider.configuredProviders({ AI_PROVIDER: "fixture" })[0];
    const base = await fixture.generate({
      task: "extract-document",
      system: "",
      prompt: "",
      schema: chatExtractionSchema,
    });
    base.output.documentDate = {
      value: "2026-11-10",
      sourceText: "Date: 10/11/2026",
      uncertain: false,
      approximate: false,
    };
    vi.spyOn(provider, "generateWithFallback").mockResolvedValue({
      ...base,
      provider: "fixture",
      model: "test",
      attempts: [],
    });
    await processChatJob(id, user);
    vi.restoreAllMocks();
    view = await getReportChat(user, id);
    expect(view.question?.field).toBe("reactionStartDate");
    view = await say(user, id, view, "2 days from the day of prescription");
    expect((await loadCase(user, id)).c.reactionStartDate).toBe("2026-11-12");
    expect(view.summary.info.some((n) => /counted from the prescription date/.test(n.message))).toBe(true);
  }, 60_000);
  // Requested 25 November 2026: the front and back photos of one pack are one medicine, not two.
  it("pack photos: front (brand + composition) and back (no name) are entered as one medicine with all details", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form({ patientInitials: "A.K.", suspectedMedicines: [] }));
    const fixture = provider.configuredProviders({ AI_PROVIDER: "fixture" })[0];
    const base = (
      await fixture.generate({ task: "extract-document", system: "", prompt: "", schema: chatExtractionSchema })
    ).output;
    const none = { value: null, sourceText: null, uncertain: false, approximate: false };
    const read = (value: string, sourceText: string) => ({ value, sourceText, uncertain: false, approximate: false });
    const med = (fields: Partial<(typeof base.medications)[number]>) =>
      ({
        ...Object.fromEntries(Object.keys(base.medications[0]).map((k) => [k, none])),
        ...fields,
      }) as (typeof base.medications)[number];
    const pack = (medications: (typeof base.medications)[number][], extraFields: typeof base.extraFields = []) => ({
      ...base,
      documentType: "MEDICINE_PACK" as const,
      patient: { initials: none, age: none, ageUnit: none, gender: none, weightKg: none },
      medications,
      extraFields,
      documentDate: null,
    });
    const composition = (value: string) => ({
      entity: "medicine" as const,
      medicationIndex: 0,
      field: "composition" as const,
      reading: read(value, value),
    });
    const front = pack(
      [med({ name: read("Flutifer", "Flutifer") })],
      [composition("Fluticasone Furoate Nasal Spray IP 27.5 mcg")],
    );
    const back = pack([
      med({
        name: none,
        batchLot: read("HND0361A", "Batch No.: HND0361A"),
        expiryDate: read("2027-10", "Expiry Date: 10/2027"),
        manufacturer: read("Sava Healthcare Limited", "Manufactured by: SAVA HEALTHCARE LIMITED"),
      }),
    ]);
    const spy = vi.spyOn(provider, "generateWithFallback");
    spy.mockResolvedValueOnce({ output: front, provider: "fixture", model: "test", meta: {}, attempts: [] });
    spy.mockResolvedValueOnce({ output: back, provider: "fixture", model: "test", meta: {}, attempts: [] });
    await uploadChatBatch(user, id, randomUUID(), [await image(), await image("fictional-prescription-scan.jpg")]);
    await processChatJob(id, user);
    await processChatJob(id, user);
    vi.restoreAllMocks();
    let view = await getReportChat(user, id);
    // One medicine offered, not two.
    expect(view.question?.kind).toBe("suspect");
    expect(Object.keys(view.question!.options!)).toEqual(["Flutifer"]);
    view = await say(user, id, view, "Flutifer");
    // Typed later under its brand, it is still the same medicine.
    mockChat([
      {
        entity: "medicine",
        entityName: "flutifer nasal spray",
        field: "frequency",
        value: "0-0-1",
        sourceText: "0-0-1",
      },
    ]);
    view = await say(user, id, view, "flutifer nasal spray 0-0-1", false);
    vi.restoreAllMocks();
    const c = (await loadCase(user, id)).c;
    expect(c.concomitantProducts).toHaveLength(0);
    expect(c.suspectedMedicines).toHaveLength(1);
    const m = c.suspectedMedicines[0];
    expect([m.name, m.batchLot, m.expiryDate, m.manufacturer, m.route, m.frequency]).toEqual([
      "Flutifer (Fluticasone Furoate Nasal Spray IP 27.5 mcg)",
      "HND0361A",
      "2027-10",
      "Sava Healthcare Limited",
      "Nasal",
      "0-0-1",
    ]);
  }, 60_000);

  it("pack photos: a back photo that only shows the composition joins the brand; an unmatched one is flagged", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form({ patientInitials: "A.K." }));
    const fixture = provider.configuredProviders({ AI_PROVIDER: "fixture" })[0];
    const base = (
      await fixture.generate({ task: "extract-document", system: "", prompt: "", schema: chatExtractionSchema })
    ).output;
    const none = { value: null, sourceText: null, uncertain: false, approximate: false };
    const read = (value: string) => ({ value, sourceText: value, uncertain: false, approximate: false });
    const med = (fields: Partial<(typeof base.medications)[number]>) =>
      ({
        ...Object.fromEntries(Object.keys(base.medications[0]).map((k) => [k, none])),
        ...fields,
      }) as (typeof base.medications)[number];
    const noPatient = { initials: none, age: none, ageUnit: none, gender: none, weightKg: none };
    // A prescription with two medicines, then a pack back photo with no name and no composition: it cannot be
    // matched to one medicine, so it is flagged instead of guessed.
    const prescription = { ...base, patient: noPatient, documentDate: null };
    const back = {
      ...base,
      documentType: "MEDICINE_PACK" as const,
      patient: noPatient,
      medications: [med({ name: none, batchLot: read("ZX123"), expiryDate: read("2027-01") })],
      extraFields: [],
      documentDate: null,
    };
    const spy = vi.spyOn(provider, "generateWithFallback");
    spy.mockResolvedValueOnce({ output: prescription, provider: "fixture", model: "test", meta: {}, attempts: [] });
    spy.mockResolvedValueOnce({ output: back, provider: "fixture", model: "test", meta: {}, attempts: [] });
    await uploadChatBatch(user, id, randomUUID(), [await image(), await image("fictional-prescription-scan.jpg")]);
    await processChatJob(id, user);
    await processChatJob(id, user);
    vi.restoreAllMocks();
    const view = await getReportChat(user, id);
    const flagged = view.summary.attention.find((n) => /no medicine name/.test(n.message));
    expect(flagged?.message).toMatch(/batch ZX123, expiry 2027-01/);
    const c = (await loadCase(user, id)).c;
    expect(c.suspectedMedicines.some((m) => m.batchLot === "ZX123")).toBe(false);
    // The prescription's other medicines are recorded as concomitant (the suspected one is already known).
    expect(c.concomitantProducts.map((x) => x.name).sort()).toEqual(["Paracetamol 500 mg tablet"]);
  }, 60_000);
});

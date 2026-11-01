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
    // Medicines wait for the reporter to say how they belong.
    expect(c.suspectedMedicines).toHaveLength(0);
    expect(view.question?.kind).toBe("role");
    expect(view.question?.entityName).toMatch(/Amoxicillin/);
    expect(lastReply(view)).toMatch(/Added to the report: .*Patient initials: R\.K\./);
    view = await say(user, id, view, "SUSPECTED");
    expect(view.question?.kind).toBe("role");
    expect(view.question?.entityName).toMatch(/Paracetamol/);
    view = await say(user, id, view, "Another medicine the patient was taking");
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
    expect(view.question?.field).toBe("patientInitials");
    const body = {
      requestId: randomUUID(),
      revision: view.revision,
      lockVersion: view.lockVersion,
      content: "C.B.",
      questionKey: view.question!.key,
    };
    view = await sendReportChatMessage(user, id, body);
    expect((await loadCase(user, id)).c.patientInitials).toBe("C.B.");
    expect((await sendReportChatMessage(user, id, body)).messages.filter((m) => m.role === "USER")).toHaveLength(1);
    expect(view.question?.field).toBe("ageValue");
    view = await say(user, id, view, "34 years");
    const c = (await loadCase(user, id)).c;
    expect([c.ageValue, c.ageUnit]).toEqual([34, "YEARS"]);
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
    for (let i = 0; i < 12 && view.question && view.question.kind !== "group"; i++)
      view = await say(user, id, view, "I don't know");
    expect(view.question?.kind).toBe("group");
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
    expect(lastReply(view)).toMatch(/couldn't find a report detail/);
    view = await say(user, other, view, "hmm, let me check the box later and come back to this one please");
    expect(view.question?.key).not.toBe(optionalKey);
    expect(lastReply(view)).toMatch(/skipped it for now/);
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

  it("asks each medicine's role when one answer names several, and uses explicit roles when given", async () => {
    const { user, id } = await setup();
    await saveDraft(user, id, 0, form({ suspectedMedicines: [] }));
    let view = await getReportChat(user, id);
    expect(view.question?.kind).toBe("suspect");
    mockChat([
      { entity: "medicine", entityName: "Amoxicillin", field: "name", value: "Amoxicillin", sourceText: "Amoxicillin" },
      { entity: "medicine", entityName: "Paracetamol", field: "name", value: "Paracetamol", sourceText: "paracetamol" },
    ]);
    view = await say(user, id, view, "Amoxicillin and paracetamol were both given.");
    expect(view.question?.kind).toBe("role");
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
    expect(view.question?.kind).not.toBe("role");
    view = await confirmDocumentBelongs(user, id, heldNote!.documentId!);
    const c = (await loadCase(user, id)).c;
    expect(c.ageValue).toBe(34);
    expect(c.patientInitials).toBe("Z.Z.");
    expect(view.question?.kind).toBe("role");
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
    expect(lastReply(view)).toMatch(/Filled in from the details given: Fluticasone nasal spray \(route Nasal\)/);
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
    expect(lastReply(view)).toMatch(/I wrote the description of the reaction/);
  });

  it("recovers an expired worker lease and lets an exhausted job be explicitly retried", async () => {
    const { user, id } = await setup();
    await uploadChatBatch(user, id, randomUUID(), [await image()]);
    const job = await db.documentExtractionJob.findFirstOrThrow({ where: { caseId: id } });
    await db.documentExtractionJob.update({
      where: { id: job.id },
      data: { status: "RUNNING", attempts: 3, leaseToken: "interrupted", leaseUntil: new Date(Date.now() - 1000) },
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
    view = await say(user, id, view, "SUSPECTED");
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
    // "She was taking" does not say whether amoxicillin is suspected, so the reporter is asked.
    const asked: string[] = [];
    while (view.question?.kind === "role") {
      asked.push(view.question.entityName);
      view = await say(user, id, view, /amox/i.test(view.question.entityName) ? "SUSPECTED" : "CONCOMITANT");
    }
    expect(asked.some((n) => /amoxicillin/i.test(n))).toBe(true);
    expect(asked.some((n) => /fluticasone nasal spray/i.test(n))).toBe(true);
    expect(asked.some((n) => /moxifloxacin eye drops/i.test(n))).toBe(true);
    expect(asked.some((n) => /salbutamol|ceftriaxone|cetirizine/i.test(n))).toBe(false);
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
    // An AI reading of "last year" is described as understood, not as taken word for word.
    const ampicillin = view.summary.attention.find((n) => /Ampicillin: Date started/.test(n.label));
    expect(ampicillin?.message).toMatch(/Understood from your words "last year"/);
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
    expect((await loadCase(user, id)).c.medicalHistory).toBe("no allergies, known diabetic on metformin");
    expect(view.question?.kind).toBe("role");
    expect(view.question?.entityName).toBe("metformin");
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
    expect(view.question?.kind).toBe("role");
    view = await say(user, id, view, "SUSPECTED");
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
    view = await say(user, id, view, "SUSPECTED");
    const attention = view.summary.attention.map((n) => `${n.kind} ${n.label}`);
    expect(attention).toContain("UNCLEAR Flutifer: Batch or lot");
    expect(attention).toContain("UNCLEAR Flutifer: Expiry date");
    expect(view.completeness.warnings.some((w) => /expiry date is before the reaction started/.test(w.message))).toBe(
      true,
    );
  }, 30_000);
});

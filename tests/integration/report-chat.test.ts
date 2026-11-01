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
    expect(c.suspectedMedicines[0].dose).toBe("1 capsule");
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
});

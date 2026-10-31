import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { db } from "@/server/db";
import { createDraft, loadCase, saveDraft } from "@/server/workflow/cases";
import { uploadChatBatch, uploadPdfPage, processChatJob, retryChatJob } from "@/server/workflow/chat-documents";
import { chatExtractionSchema } from "@/lib/domain/chat-extraction";
import {
  getReportChat,
  sendReportChatMessage,
  applyReportChatFacts,
  type ReportChatView,
} from "@/server/workflow/report-chat";
import { entityKey } from "@/lib/domain/report-chat";
import { toFormValues } from "@/lib/domain/case-form";
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
function choices(view: ReportChatView) {
  return {
    requestId: randomUUID(),
    revision: view.revision,
    lockVersion: view.lockVersion,
    verified: true,
    choices: view.groups.map((g) => ({ id: g.facts[0].id, value: g.facts[0].value, confirmedUncertain: true })),
    roles: Object.fromEntries(
      view.groups
        .filter((g) => g.facts[0].entity === "medicine")
        .map((g) => [g.entityKey, /Paracetamol/i.test(g.entityName) ? "CONCOMITANT" : "SUSPECTED"]),
    ),
    identityConfirmed: view.documents.map((d) => d.id),
  };
}
describe.skipIf(!hasTestDb)("durable report conversations", () => {
  beforeEach(() => vi.stubEnv("AI_PROVIDER", "fixture"));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await db.$disconnect();
  });
  it("deduplicates batch retries and identical files, then waits for extraction before asking questions", async () => {
    const { user, id } = await setup(),
      file = await image(),
      requestId = randomUUID();
    const first = await uploadChatBatch(user, id, requestId, [file, file]);
    expect(await uploadChatBatch(user, id, requestId, [file, file])).toEqual(first);
    expect(await db.uploadedDocument.count({ where: { caseId: id } })).toBe(1);
    let view = await getReportChat(user, id);
    expect(view.processing).toBe(true);
    expect(view.question).toBeNull();
    expect(view.jobs).toHaveLength(1);
    expect(await processChatJob(id, user)).toEqual({ processed: true });
    view = await getReportChat(user, id);
    expect(view.processing).toBe(false);
    expect(view.groups.length).toBeGreaterThan(10);
    expect(view.question).toBeNull();
    expect(view.state.roles[entityKey("medicine", "Amoxicillin 500 mg capsule")]).toBeUndefined();
    await expect(applyReportChatFacts(user, id, { ...choices(view), verified: false })).rejects.toThrow(
      /Check the selected/,
    );
    await expect(applyReportChatFacts(user, id, { ...choices(view), roles: {} })).rejects.toThrow(/Choose how/);
    expect((await loadCase(user, id)).c.patientInitials).toBeNull();
    const apply = choices(view),
      saved = await applyReportChatFacts(user, id, apply);
    const c = (await loadCase(user, id)).c;
    expect(c.patientInitials).toBe("R.K.");
    expect(c.suspectedMedicines).toHaveLength(1);
    expect(c.concomitantProducts).toHaveLength(1);
    expect(saved.question?.field).toBe("reactionTerms");
    expect(saved.groups).toHaveLength(0);
    await applyReportChatFacts(user, id, apply);
    expect((await loadCase(user, id)).c.lockVersion).toBe(c.lockVersion);
    expect(await db.fieldProvenance.count({ where: { caseId: id, source: "DOCUMENT_EXTRACTED" } })).toBeGreaterThan(8);
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
    const pages = new Set(view.groups.flatMap((g) => g.facts.map((f) => f.sourcePage)));
    expect(pages).toEqual(new Set([1, 2]));
  }, 30_000);
  it("persists direct chat answers, asks the next missing field and rejects stale saves", async () => {
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
    expect(view.groups[0].field).toBe("patientInitials");
    expect((await sendReportChatMessage(user, id, body)).messages.filter((m) => m.role === "USER")).toHaveLength(1);
    view = await applyReportChatFacts(user, id, choices(view));
    expect(view.question?.field).toBe("ageValue");
    view = await sendReportChatMessage(user, id, {
      requestId: randomUUID(),
      revision: view.revision,
      lockVersion: view.lockVersion,
      content: "34 years",
      questionKey: view.question!.key,
    });
    expect(view.groups.map((g) => g.field)).toEqual(expect.arrayContaining(["ageValue", "ageUnit"]));
    const stale = choices(view),
      c = (await loadCase(user, id)).c;
    await saveDraft(user, id, c.lockVersion, toFormValues(c));
    await expect(applyReportChatFacts(user, id, stale)).rejects.toThrow(/changed/);
  }, 30_000);
  it("allows a message to propose multiple explicit facts but ignores protected writes and absent quotes", async () => {
    const { user, id } = await setup();
    const view = await getReportChat(user, id);
    vi.spyOn(provider, "generateWithFallback").mockResolvedValue({
      output: {
        updates: [
          {
            entity: "case",
            entityName: "",
            field: "patientInitials",
            value: "M.T.",
            sourceText: "M.T.",
            approximate: false,
          },
          {
            entity: "case",
            entityName: "",
            field: "reactionTerms",
            value: "Rash",
            sourceText: "rash",
            approximate: false,
          },
          {
            entity: "case",
            entityName: "",
            field: "status",
            value: "APPROVED",
            sourceText: "rash",
            approximate: false,
          },
          {
            entity: "case",
            entityName: "",
            field: "weightKg",
            value: "89",
            sourceText: "not in message",
            approximate: false,
          },
        ],
      },
      provider: "fixture",
      model: "test",
      meta: {},
      attempts: [],
    });
    const saved = await sendReportChatMessage(user, id, {
      requestId: randomUUID(),
      revision: view.revision,
      lockVersion: view.lockVersion,
      content: "M.T. had a rash",
      questionKey: view.question!.key,
    });
    expect(saved.groups.map((g) => g.field)).toEqual(["patientInitials", "reactionTerms"]);
    expect((await loadCase(user, id)).c.status).toBe("DRAFT");
  });
  it("does not expose another reporter's conversation", async () => {
    const { id } = await setup(),
      other = await userFor("physician@demo.test");
    await expect(getReportChat(other, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("does not assume every medicine in a multi-medicine answer is suspected",async()=>{
    const {user,id}=await setup();await saveDraft(user,id,0,form({suspectedMedicines:[]}));
    const view=await getReportChat(user,id);expect(view.question?.field).toBe("name");
    vi.spyOn(provider,"generateWithFallback").mockResolvedValue({output:{updates:[
      {entity:"medicine",entityName:"Amoxicillin",field:"name",value:"Amoxicillin",sourceText:"Amoxicillin",approximate:false},
      {entity:"medicine",entityName:"Paracetamol",field:"name",value:"Paracetamol",sourceText:"paracetamol",approximate:false},
    ]},provider:"fixture",model:"test",meta:{},attempts:[]});
    const result=await sendReportChatMessage(user,id,{requestId:randomUUID(),revision:view.revision,lockVersion:view.lockVersion,questionKey:view.question!.key,content:"Amoxicillin is suspected and paracetamol is concomitant."});
    expect(result.state.roles[entityKey("medicine","Amoxicillin")]).toBeUndefined();
    expect(result.state.roles[entityKey("medicine","Paracetamol")]).toBeUndefined();
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
  it("preserves extra document facts and explicit approximate dates through the shared form", async () => {
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
    const view = await getReportChat(user, id);
    expect(view.groups.find((g) => g.field === "dateOfBirth")?.facts[0].approximate).toBe(true);
    await applyReportChatFacts(user, id, choices(view));
    const c = (await loadCase(user, id)).c;
    expect(c.dateOfBirth).toBe("1992");
    expect(c.dateOfBirthApprox).toBe(true);
    expect(c.outcome).toBe("RECOVERED");
    expect(c.suspectedMedicines[0].actionTaken).toBe("DRUG_WITHDRAWN");
  });
});

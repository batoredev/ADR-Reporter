// Learning from submitted reports, end to end on the test database: a pack is read (the reader takes the
// factory's PIN code for the batch), the reporter corrects the batch, submits, and a reviewer approves.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ChecklistItemKey } from "@/generated/prisma/enums";
import { chatExtractionSchema, type ChatExtraction } from "@/lib/domain/chat-extraction";
import { toFormValues } from "@/lib/domain/case-form";
import * as provider from "@/server/ai/provider";
import type { CompactReading } from "@/server/ai/two-step";
import { db } from "@/server/db";
import { createDraft, loadCase, saveDraft, submitCase } from "@/server/workflow/cases";
import { processChatJob, uploadChatBatch } from "@/server/workflow/chat-documents";
import { getReportChat, sendReportChatMessage } from "@/server/workflow/report-chat";
import { approveCase, claimCase, recordChecklistItem } from "@/server/workflow/review";
import { hasTestDb, userFor } from "./helpers";

type User = Awaited<ReturnType<typeof userFor>>;
const none = { value: null, sourceText: null, uncertain: false, approximate: false };
const read = (value: string, sourceText = value) => ({ value, sourceText, uncertain: false, approximate: false });

// Fictional pack text, as the de-identified copy the two-step reader keeps.
const PACK = `Zifi
Cefixime Tablets IP
Batch No.: KZ4417A
Mfg. Date: 03/2026
Expiry Date: 02/2028
Plot No. 12, Industrial Area, Baddi (HP) 173 205`;
const compact: CompactReading = {
  documentType: "MEDICINE_PACK",
  documentDate: null,
  patientName: null,
  age: null,
  ageUnit: null,
  gender: null,
  weightKg: null,
  diagnosis: null,
  reaction: null,
  reactionStartDate: null,
  reactionStopDate: null,
  reactionDetails: null,
  reactionTreatment: null,
  medicalHistory: null,
  medicines: [
    {
      name: "Zifi",
      composition: "Cefixime Tablets IP",
      dose: null,
      route: null,
      frequency: null,
      duration: null,
      indication: null,
      startDate: null,
      stopDate: null,
      manufacturer: null,
      batch: "173 205",
      mfgDate: "03/2026",
      expiryDate: "02/2028",
    },
  ],
  tests: [],
};

let base: ChatExtraction;
const packReading = (): ChatExtraction => ({
  ...base,
  documentType: "MEDICINE_PACK",
  readability: "CLEAR",
  patient: { initials: none, age: none, ageUnit: none, gender: none, weightKg: none },
  reaction: { terms: none, startDate: none, stopDate: none, description: none, management: none },
  medicalHistory: none,
  investigations: [],
  extraFields: [],
  documentDate: null,
  documentNotes: null,
  medications: [
    {
      name: read("Zifi"),
      dose: none,
      route: none,
      frequency: none,
      startDate: none,
      stopDate: none,
      duration: none,
      indication: none,
      manufacturer: none,
      batchLot: read("173 205", "Plot No. 12, Industrial Area, Baddi (HP) 173 205"),
      expiryDate: read("2028-02", "Expiry Date: 02/2028"),
    },
  ],
});

let uploads = 0;
async function readPack(user: User, id: string) {
  const bytes = await readFile("samples/prescriptions/fictional-prescription-scan.jpg");
  const file = new File([new Uint8Array([...bytes, uploads++ % 250, 7])], `pack-${uploads}.jpg`, {
    type: "image/jpeg",
  });
  vi.spyOn(provider, "generateWithFallback").mockResolvedValueOnce({
    output: packReading(),
    provider: "ollama",
    model: "qwen3-vl:2b-instruct+adr-structurer",
    meta: { steps: 2, learning: { textModel: "adr-structurer", transcript: PACK, reading: compact } },
    attempts: [],
  });
  await uploadChatBatch(user, id, randomUUID(), [file]);
  await processChatJob(id, user);
  vi.restoreAllMocks();
}

/** The reporter gives the reaction; the only medicine becomes the suspect; then fills the rest and fixes the batch. */
async function correctAndSubmit(user: User, id: string) {
  const view = await getReportChat(user, id);
  vi.spyOn(provider, "generateWithFallback").mockResolvedValue({
    output: {
      updates: [
        {
          entity: "case",
          entityName: "",
          field: "reactionTerms",
          value: "Rash",
          sourceText: "rash",
          approximate: false,
          uncertain: false,
        },
        {
          entity: "case",
          entityName: "",
          field: "reactionStartDate",
          value: "2026-11-02",
          sourceText: "2/11/2026",
          approximate: false,
          uncertain: false,
        },
      ],
      roles: [],
    },
    provider: "fixture",
    model: "test",
    meta: {},
    attempts: [],
  });
  await sendReportChatMessage(user, id, {
    requestId: randomUUID(),
    revision: view.revision,
    lockVersion: view.lockVersion,
    content: "rash on 2/11/2026",
    questionKey: view.question?.key ?? null,
  });
  vi.restoreAllMocks();
  const { c } = await loadCase(user, id);
  expect(c.suspectedMedicines.map((m) => [m.name, m.batchLot])).toEqual([["Zifi", "173 205"]]);
  const values = toFormValues(c);
  const saved = await saveDraft(user, id, c.lockVersion, {
    ...values,
    patientInitials: "N.P.",
    ageValue: "45",
    ageUnit: "YEARS",
    gender: "FEMALE",
    seriousAnswer: "NO",
    outcome: "RECOVERED",
    suspectedMedicines: values.suspectedMedicines.map((m) => ({
      ...m,
      batchLot: "KZ4417A",
      startDate: { value: "2026-10-30", approx: false },
    })),
  });
  await submitCase(user, id, { lockVersion: saved.lockVersion, declaration: true });
}

describe.skipIf(!hasTestDb)("learning from submitted reports", () => {
  beforeAll(async () => {
    const fixture = provider.configuredProviders({ AI_PROVIDER: "fixture" })[0];
    base = (await fixture.generate({ task: "extract-document", system: "", prompt: "", schema: chatExtractionSchema }))
      .output as ChatExtraction;
  });
  beforeEach(() => vi.stubEnv("AI_PROVIDER", "fixture"));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("keeps each reading as the reporter corrected it, and makes it training data once a reviewer approves", async () => {
    const user = await userFor("pharmacist@demo.test");
    const { id } = await createDraft(user);
    await readPack(user, id);
    await correctAndSubmit(user, id);

    const [example] = await db.learningExample.findMany({ where: { caseId: id } });
    expect(example).toMatchObject({
      documentType: "MEDICINE_PACK",
      textModel: "adr-structurer",
      status: "SUBMITTED",
      trainable: true,
    });
    expect((example.target as CompactReading).medicines[0]).toMatchObject({ batch: "KZ4417A", expiryDate: "02/2028" });
    expect(example.corrections).toEqual([
      { path: "medicines.0.batch", change: "CHANGED", from: "173 205", to: "KZ4417A", found: true },
    ]);

    const reviewer = await userFor("pharmacologist@demo.test");
    await claimCase(reviewer, id);
    for (const item of Object.values(ChecklistItemKey))
      await recordChecklistItem(reviewer, id, { item, outcome: "VERIFIED" });
    await approveCase(reviewer, id);
    expect((await db.learningExample.findUniqueOrThrow({ where: { id: example.id } })).status).toBe("APPROVED");
  }, 60_000);

  it("keeps nothing when learning is switched off", async () => {
    vi.stubEnv("LEARN_FROM_REPORTS", "off");
    const user = await userFor("pharmacist@demo.test");
    const { id } = await createDraft(user);
    await readPack(user, id);
    await correctAndSubmit(user, id);
    expect(await db.learningExample.count({ where: { caseId: id } })).toBe(0);
  }, 60_000);
});

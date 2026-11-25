// Scenarios built from the reporter's own test photos (25 November 2026): a handwritten Flutifer prescription and
// its pack, a paediatric prescription with four syrups and a Meftal-P strip, Moxikind front and back photos and a
// loose batch/expiry photo of another pack. Each document is given the reading a careful reader makes of that photo,
// so these tests check how the assistant connects the readings and what it asks, not the AI's eyesight (that is
// measured separately with `npm run ai:evaluate-chat`).
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { createDraft, loadCase } from "@/server/workflow/cases";
import { uploadChatBatch, processChatJob } from "@/server/workflow/chat-documents";
import { chatExtractionSchema, type ChatExtraction } from "@/lib/domain/chat-extraction";
import { getReportChat, sendReportChatMessage, type ReportChatView } from "@/server/workflow/report-chat";
import * as provider from "@/server/ai/provider";
import { hasTestDb, userFor } from "./helpers";

type User = Awaited<ReturnType<typeof userFor>>;
type Reading = { value: string | null; sourceText: string | null; uncertain: boolean; approximate: boolean };
type Med = ChatExtraction["medications"][number];

const none: Reading = { value: null, sourceText: null, uncertain: false, approximate: false };
const read = (value: string, sourceText = value, uncertain = false): Reading => ({
  value,
  sourceText,
  uncertain,
  approximate: false,
});
const med = (fields: Partial<Record<keyof Med, Reading>>): Med =>
  ({
    name: none,
    dose: none,
    route: none,
    frequency: none,
    startDate: none,
    stopDate: none,
    duration: none,
    indication: none,
    manufacturer: none,
    batchLot: none,
    expiryDate: none,
    ...fields,
  }) as Med;
const composition = (medicationIndex: number, value: string) => ({
  entity: "medicine" as const,
  medicationIndex,
  field: "composition" as const,
  reading: read(value),
});
let base: ChatExtraction;
const reading = (parts: Partial<ChatExtraction>): ChatExtraction => ({
  ...base,
  documentType: "PRESCRIPTION",
  readability: "CLEAR",
  patient: { initials: none, age: none, ageUnit: none, gender: none, weightKg: none },
  reaction: { terms: none, startDate: none, stopDate: none, description: none, management: none },
  medicalHistory: none,
  investigations: [],
  medications: [],
  extraFields: [],
  documentDate: null,
  documentNotes: null,
  ...parts,
});

/** A distinct upload per document (the app stores identical files once). */
async function photo(n: number) {
  const bytes = await readFile("samples/prescriptions/fictional-prescription-scan.jpg");
  const tail = new Uint8Array(n + 1).fill(n % 250);
  return new File([new Uint8Array([...bytes, ...tail])], `photo-${n}.jpg`, { type: "image/jpeg" });
}
let uploads = 0;
/** Uploads the documents in order and reads each with the given reading. */
async function readDocuments(user: User, id: string, readings: ChatExtraction[]) {
  const spy = vi.spyOn(provider, "generateWithFallback");
  for (const output of readings)
    spy.mockResolvedValueOnce({ output, provider: "fixture", model: "test", meta: {}, attempts: [] });
  await uploadChatBatch(user, id, randomUUID(), await Promise.all(readings.map(() => photo(uploads++))));
  for (let i = 0; i < readings.length; i++) await processChatJob(id, user);
  spy.mockRestore();
  return getReportChat(user, id);
}
const say = (user: User, id: string, view: ReportChatView, content: string) =>
  sendReportChatMessage(user, id, {
    requestId: randomUUID(),
    revision: view.revision,
    lockVersion: view.lockVersion,
    content,
    questionKey: view.question?.key ?? null,
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

// The handwritten prescription: "22/10/2026 · A. Kumar, 24, M · 54 kg · Flutifer Nasal spray — 0-0-1, 2 sprays
// every nostril for 2 weeks".
const flutiferRx = () =>
  reading({
    patient: {
      initials: read("A.K.", "A. Kumar"),
      age: read("24"),
      ageUnit: read("YEARS", "24"),
      gender: read("MALE", "M"),
      weightKg: read("54", "54kg"),
    },
    documentDate: read("2026-10-22", "22/10/2026"),
    medications: [
      med({
        name: read("Flutifer Nasal spray"),
        dose: read("2 sprays every nostril"),
        frequency: read("0-0-1"),
        duration: read("2 weeks", "for 2 weeks"),
      }),
    ],
  });
// The back of the Flutifer box: batch, dates and maker; "Marketed by" Swares is not the manufacturer.
const flutiferPack = () =>
  reading({
    documentType: "MEDICINE_PACK",
    medications: [
      med({
        name: read("Flutifer"),
        batchLot: read("HND0361A", "Batch No.: HND0361A"),
        expiryDate: read("2027-10", "Expiry Date: 10/2027"),
        manufacturer: read("Sava Healthcare Limited", "Manufactured by: SAVA HEALTHCARE LIMITED"),
      }),
    ],
  });
const moxikindFront = () =>
  reading({
    documentType: "MEDICINE_PACK",
    medications: [med({ name: read("Moxikind CV 1 gm") })],
    extraFields: [composition(0, "Amoxycillin & Potassium Clavulanate Tablets IP")],
  });
// The back shows the composition and pack details but not the brand.
const moxikindBack = () =>
  reading({
    documentType: "MEDICINE_PACK",
    medications: [
      med({
        batchLot: read("A7AEZ002", "Batch No. A7AEZ002"),
        expiryDate: read("2027-10", "Expiry Date: 10/2027"),
        manufacturer: read(
          "Copmed Pharmaceuticals Pvt. Ltd.",
          "Manufactured in India by: Copmed Pharmaceuticals Pvt. Ltd.",
        ),
      }),
    ],
    extraFields: [
      composition(
        0,
        "Amoxycillin Trihydrate IP eq. to Amoxycillin 875 mg, Potassium Clavulanate Diluted IP equivalent to Clavulanic Acid 125 mg",
      ),
    ],
  });
// The side of a different box: "per 10 Tablets", no name.
const loosePackSide = () =>
  reading({
    documentType: "MEDICINE_PACK",
    medications: [
      med({
        batchLot: read("GKH1585A", "Batch No.: GKH1585A"),
        expiryDate: read("2028-02", "Expiry Date: 02/2028"),
      }),
    ],
  });

describe.skipIf(!hasTestDb)("report assistant with the reporter's sample photos", () => {
  beforeEach(async () => {
    vi.stubEnv("AI_PROVIDER", "fixture");
    const fixture = provider.configuredProviders({ AI_PROVIDER: "fixture" })[0];
    base = (await fixture.generate({ task: "extract-document", system: "", prompt: "", schema: chatExtractionSchema }))
      .output as ChatExtraction;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await db.$disconnect();
  });

  it("one medicine: never asks which medicine caused it, links the pack to it and asks details with context", async () => {
    const user = await userFor("pharmacist@demo.test");
    const { id } = await createDraft(user);
    let view = await readDocuments(user, id, [flutiferRx(), flutiferPack()]);
    let c = (await loadCase(user, id)).c;
    expect([c.patientInitials, c.ageValue, c.gender, c.weightKg]).toEqual(["A.K.", 24, "MALE", 54]);
    expect(c.suspectedMedicines).toHaveLength(1);
    expect(c.concomitantProducts).toHaveLength(0);
    const m = c.suspectedMedicines[0];
    expect([m.route, m.frequency, m.batchLot, m.expiryDate, m.manufacturer]).toEqual([
      "Nasal",
      "0-0-1",
      "HND0361A",
      "2027-10",
      "Sava Healthcare Limited",
    ]);
    // The duration is never turned into a stop date.
    expect(m.stopDate).toBeNull();
    expect(view.summary.info.some((n) => /only medicine in this report/.test(n.message))).toBe(true);
    // The first question is the reaction, with no example text.
    expect(view.question?.field).toBe("reaction");
    expect(view.question?.text).not.toMatch(/example/i);
    mockChat([
      { entity: "case", entityName: "", field: "reactionTerms", value: "Epistaxis", sourceText: "nose bleed" },
      { entity: "case", entityName: "", field: "reactionStartDate", value: "2026-10-24", sourceText: "24/10/2026" },
    ]);
    view = await say(user, id, view, "nose bleed on 24/10/2026");
    vi.restoreAllMocks();
    const asked: string[] = [];
    while (view.question && view.question.field !== "details" && asked.length < 6) {
      asked.push(view.question.field);
      expect(view.question.kind).not.toBe("suspect");
      view = await say(user, id, view, view.question.field === "seriousness" ? "NOT_SERIOUS" : "RECOVERED");
    }
    expect(asked).toEqual(["outcome", "seriousness"]);
    // What the prescription says is shown in the question, so "same day" or "finished the course" can be answered.
    expect(view.question?.text).toBe(
      "Flutifer Nasal spray (prescribed 22 October 2026 for 2 weeks): start date, stop date and what it was for?",
    );
    c = (await loadCase(user, id)).c;
    expect(c.suspectedMedicines.map((x) => x.name)).toEqual(["Flutifer Nasal spray"]);
  }, 60_000);

  it("a medicine found later reopens the choice; picking it moves the first one to other medicines", async () => {
    const user = await userFor("pharmacist@demo.test");
    const { id } = await createDraft(user);
    await readDocuments(user, id, [flutiferRx()]);
    expect((await loadCase(user, id)).c.suspectedMedicines.map((m) => m.name)).toEqual(["Flutifer Nasal spray"]);
    // A second upload brings another medicine: the earlier automatic choice no longer holds.
    let view = await readDocuments(user, id, [moxikindFront()]);
    let c = (await loadCase(user, id)).c;
    expect(c.concomitantProducts).toHaveLength(0);
    // The reaction comes first; "not known" to it is not followed by the same question in parts.
    expect(view.question?.field).toBe("reaction");
    view = await say(user, id, view, "I don't know");
    expect(view.question?.kind).toBe("suspect");
    expect(Object.keys(view.question!.options!).sort()).toEqual(["Flutifer Nasal spray", "Moxikind CV 1 gm"].sort());
    view = await say(user, id, view, "Moxikind CV 1 gm");
    c = (await loadCase(user, id)).c;
    expect(c.suspectedMedicines.map((m) => m.name)).toEqual([
      "Moxikind CV 1 gm (Amoxycillin & Potassium Clavulanate Tablets IP)",
    ]);
    expect(c.concomitantProducts.map((m) => m.name)).toEqual(["Flutifer Nasal spray"]);
    expect(view.summary.info.some((n) => /only medicine in this report/.test(n.message))).toBe(false);
    expect(view.question?.kind).not.toBe("suspect");
  }, 60_000);

  it("four syrups and a strip: one question with four choices, diagnosis as indication, form mismatch flagged", async () => {
    const user = await userFor("pharmacist@demo.test");
    const { id } = await createDraft(user);
    const urti = () => read("URTI", "Clinical Description: URTI");
    const rx = reading({
      patient: {
        initials: read("A.", "ASHVIKA"),
        age: read("4", "4 yr"),
        ageUnit: read("YEARS", "4 yr"),
        gender: read("FEMALE", "F"),
        weightKg: read("13.25", "13.25 kg"),
      },
      documentDate: read("2022-09-20", "Date: 20-9-2022"),
      medications: [
        med({
          name: read("Syp. Calpol (250/5)", "SYP CALPOL (250/5)"),
          dose: read("4 ml", "4 ML"),
          frequency: read("Q6H"),
          duration: read("3 days", "x 3d"),
          indication: urti(),
        }),
        med({
          name: read("Syp. Delcon", "SYP DELCON"),
          dose: read("3 ml", "3 ML"),
          frequency: read("TDS"),
          duration: read("5 days", "x 5d"),
          indication: urti(),
        }),
        med({
          name: read("Syp. Levolin", "SYP LEVOLIN"),
          dose: read("3 ml", "3 ML"),
          frequency: read("TDS"),
          duration: read("5 days", "x 5d"),
          indication: urti(),
        }),
        med({
          name: read("Syp. Meftal-P (100/5)", "SYP MEFTAL-P (100/5)"),
          dose: read("3 ml", "3 ML"),
          frequency: read("SOS"),
          indication: urti(),
        }),
      ],
    });
    const strip = reading({
      documentType: "MEDICINE_PACK",
      medications: [med({ name: read("MEFTAL-P"), manufacturer: read("Blue Cross Laboratories Pvt. Ltd.") })],
      extraFields: [composition(0, "Mefenamic Acid Dispersible Tablets 100 mg")],
    });
    let view = await readDocuments(user, id, [rx, strip]);
    // The strip is the same medicine as the prescribed Meftal-P: four choices, not five.
    expect(view.question?.field).toBe("reaction");
    view = await say(user, id, view, "I don't know");
    expect(view.question?.kind).toBe("suspect");
    expect(Object.keys(view.question!.options!)).toHaveLength(4);
    const meftal = Object.keys(view.question!.options!).find((n) => /meftal/i.test(n))!;
    view = await say(user, id, view, meftal);
    const c = (await loadCase(user, id)).c;
    expect(c.suspectedMedicines).toHaveLength(1);
    const suspect = c.suspectedMedicines[0];
    expect([suspect.dose, suspect.frequency, suspect.route, suspect.indication, suspect.manufacturer]).toEqual([
      "3 ml",
      "SOS",
      "Oral",
      "URTI",
      "Blue Cross Laboratories Pvt. Ltd.",
    ]);
    // The other three are placed without a question, each with the prescription's diagnosis as its indication.
    expect(c.concomitantProducts.map((m) => [m.indication, m.route])).toEqual([
      ["URTI", "Oral"],
      ["URTI", "Oral"],
      ["URTI", "Oral"],
    ]);
    // Syrup on the prescription, tablets on the strip: a person would ask which one the child took.
    const form = view.summary.attention.find((n) => n.key.startsWith("form:"));
    expect(form?.message).toMatch(/syrup .* and tablet .*Check which form the patient took/);
  }, 60_000);

  it("a loose batch photo beside a pack that already has its own batch is not attached to it", async () => {
    const user = await userFor("pharmacist@demo.test");
    const { id } = await createDraft(user);
    // Uploaded in this order: the loose side photo sits next to the Moxikind front.
    const view = await readDocuments(user, id, [loosePackSide(), moxikindFront(), moxikindBack()]);
    const c = (await loadCase(user, id)).c;
    expect(c.suspectedMedicines).toHaveLength(1);
    const m = c.suspectedMedicines[0];
    expect([m.batchLot, m.expiryDate, m.manufacturer]).toEqual([
      "A7AEZ002",
      "2027-10",
      "Copmed Pharmaceuticals Pvt. Ltd.",
    ]);
    const flagged = view.summary.attention.find((n) => n.key.startsWith("pack:"));
    expect(flagged?.message).toMatch(/batch GKH1585A, expiry 2028-02/);
    expect(flagged?.message).toMatch(/already has batch A7AEZ002 .* so this is a different pack/);
  }, 60_000);

  it("a patient answer that also names the reaction and medicine is read in full, not cut to the patient line", async () => {
    const user = await userFor("pharmacist@demo.test");
    const { id } = await createDraft(user);
    let view = await getReportChat(user, id);
    expect(view.question?.field).toBe("patient");
    expect(view.question?.text).not.toMatch(/example/i);
    const spy = mockChat(
      [
        { entity: "case", entityName: "", field: "patientInitials", value: "A.K.", sourceText: "A.K." },
        { entity: "case", entityName: "", field: "ageValue", value: "24", sourceText: "24" },
        { entity: "case", entityName: "", field: "gender", value: "MALE", sourceText: "M" },
        { entity: "case", entityName: "", field: "reactionTerms", value: "Nose bleed", sourceText: "nose bleed" },
        { entity: "medicine", entityName: "flutifer", field: "name", value: "flutifer", sourceText: "flutifer" },
      ],
      [{ entityName: "flutifer", role: "SUSPECTED", sourceText: "nose bleed after flutifer" }],
    );
    view = await say(user, id, view, "A.K. 24 M, nose bleed after flutifer");
    expect(spy).toHaveBeenCalled();
    vi.restoreAllMocks();
    const c = (await loadCase(user, id)).c;
    expect([c.patientInitials, c.ageValue, c.gender, c.reactionTerms]).toEqual(["A.K.", 24, "MALE", "Nose bleed"]);
    expect(c.suspectedMedicines.map((m) => m.name)).toEqual(["flutifer"]);
  }, 60_000);
});

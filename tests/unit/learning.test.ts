import { describe, expect, it } from "vitest";
import { deidentify, type CompactReading } from "@/server/ai/two-step";
import { correctReading, writtenForm } from "@/server/workflow/learning";

// Fictional documents only.
const blank = (parts: Partial<CompactReading>): CompactReading => ({
  documentType: "PRESCRIPTION",
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
  medicines: [],
  tests: [],
  ...parts,
});
const medicine = (m: Partial<CompactReading["medicines"][number]>) => ({
  name: null,
  composition: null,
  dose: null,
  route: null,
  frequency: null,
  duration: null,
  indication: null,
  startDate: null,
  stopDate: null,
  manufacturer: null,
  batch: null,
  mfgDate: null,
  expiryDate: null,
  ...m,
});

const PACK = `Zifi
Cefixime Tablets IP
Mfg. Lic. No.: KTK/28/512
Batch No.: KZ4417A
Mfg. Date: 03/2026
Expiry Date: 02/2028
Plot No. 12, Industrial Area, Baddi (HP) 173 205`;

describe("learning from submitted reports", () => {
  it("keeps only a de-identified copy: initials for the name, no contact or record numbers", () => {
    const transcript =
      "Name: Ravi Menon   Age/Sex: 52 yrs/M\nAddress: 14 Lake Road, Kochi\nPh: 98470 12345\nIP No: 448812\nRavi Menon developed urticaria after Tab Cefixime 200mg";
    const { transcript: kept, reading } = deidentify(
      transcript,
      blank({ patientName: "Ravi Menon", reactionDetails: "Ravi Menon developed urticaria after Tab Cefixime 200mg" }),
    );
    expect(kept).not.toMatch(/Ravi|Menon|Lake Road|98470|448812/);
    expect(kept).toContain("R. M. developed urticaria after Tab Cefixime 200mg");
    expect(JSON.stringify(reading)).not.toMatch(/Ravi|Menon/);
    // A batch number and a lab pH are not personal details.
    expect(deidentify("Batch No.: KZ4417A\nUrine pH 6.0", blank({})).transcript).toBe(
      "Batch No.: KZ4417A\nUrine pH 6.0",
    );
  });

  it("finds a confirmed value as the document writes it, or reports that the document lacks it", () => {
    expect(writtenForm(PACK, "date", "2028-02")).toBe("02/2028");
    expect(writtenForm(PACK, "text", "kz4417a")).toBe("KZ4417A");
    expect(writtenForm(PACK, "text", "KZ4417B")).toBeNull();
    expect(writtenForm("Rx Amoxicillin 250 mg\nDate 10/3/00\nSpringfield, IL 62701", "date", "2000-10-03")).toBe(
      "10/3/00",
    );
  });

  it("teaches the correction a reporter made, and nothing the document does not say", () => {
    const reading = blank({
      documentType: "MEDICINE_PACK",
      medicines: [medicine({ name: "Zifi", batch: "173 205", expiryDate: "03/2026", mfgDate: "03/2026" })],
    });
    const result = correctReading(PACK, reading, [
      // The reporter replaced the batch (the reader took the PIN code) and the expiry.
      { path: ["medicines", 0, "batch"], kind: "text", change: "CHANGED", final: "KZ4417A" },
      { path: ["medicines", 0, "expiryDate"], kind: "date", change: "CHANGED", final: "2028-02" },
      // The manufacturer was missed and is on the pack; a value the pack does not show is not taught.
      { path: ["medicines", 0, "manufacturer"], kind: "text", change: "MISSED", final: "Baddi (HP)" },
    ]);
    expect(result.trainable).toBe(true);
    expect(result.target.medicines[0]).toMatchObject({
      batch: "KZ4417A",
      expiryDate: "02/2028",
      manufacturer: "Baddi (HP)",
    });
    expect(result.corrections.map((c) => c.path)).toEqual([
      "medicines.0.batch",
      "medicines.0.expiryDate",
      "medicines.0.manufacturer",
    ]);
  });

  it("treats the same value written two ways as no correction, and a removed reading as null", () => {
    const reading = blank({ medicines: [medicine({ name: "Moxikind CV", dose: "1 tab" })] });
    const result = correctReading("Moxikind CV\n1 tab BD", reading, [
      {
        path: ["medicines", 0, "name"],
        kind: "text",
        change: "CHANGED",
        final: "Moxikind CV (amoxicillin+clavulanate)",
      },
      { path: ["medicines", 0, "dose"], kind: "text", change: "CLEARED", final: null },
    ]);
    expect(result.corrections).toEqual([
      { path: "medicines.0.dose", change: "CLEARED", from: "1 tab", to: null, found: true },
    ]);
    expect(result.target.medicines[0]).toMatchObject({ name: "Moxikind CV", dose: null });
  });

  it("does not train the structuring step on a correction the transcript cannot support", () => {
    // The photo said A7AEZ002 but was transcribed as A7AEZ0O2: a reading slip, not a structuring one.
    const result = correctReading("Batch No.: A7AEZ0O2", blank({ medicines: [medicine({ batch: "A7AEZ0O2" })] }), [
      { path: ["medicines", 0, "batch"], kind: "text", change: "CHANGED", final: "A7AEZ002" },
    ]);
    expect(result.trainable).toBe(false);
    expect(result.corrections[0]).toMatchObject({ found: false, to: "A7AEZ002" });
    expect(result.target.medicines[0].batch).toBe("A7AEZ0O2");
  });
});

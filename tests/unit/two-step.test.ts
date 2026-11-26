import { describe, expect, it, vi } from "vitest";
import { chatExtractionSchema } from "@/lib/domain/chat-extraction";
import { AiError } from "@/server/ai/provider";
import {
  cleanTranscript,
  confirmedBy,
  createTwoStepProvider,
  sharedWords,
  expandReading,
  ingredientsIn,
  initialsOf,
  isoDate,
  reviseReading,
  sourceLine,
  type CompactReading,
} from "@/server/ai/two-step";

// Transcripts the local vision model produced from the reporter's photos (25 November 2026), shortened.
const FLUTIFER_BOX = `Flutifer
Mfg. Lic. No.: G/25/536
Batch No.: HND0361A
11/2025
Mfg. Date: 10/2027
389.06
Expiry Date:
Marketed by:
SWARES PHARMA
Manufactured by :
SAVA HEALTHCARE LIMITED`;
const FLUTIFER_RX = `22/10/2026. 54kg
A. Kumar, 24, M. 111/69 mmHg.
Rx
Platifier Nand spray - 0-0-1
2 sprays every nostril for 2 weeks`;

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

describe("two-step local reading: the fixed part", () => {
  it("drops looping repeats and non-English lines from a transcript", () => {
    const raw = `Rx Mefenamic Acid Dispersible Tablets\nMEFTAL-P\n${"MEFTAL-P\n".repeat(80)}(கொடுமை விளையாட்டு)\nMfg. Lic. No.: 271`;
    expect(cleanTranscript(raw).split("\n")).toEqual([
      "Rx Mefenamic Acid Dispersible Tablets",
      "MEFTAL-P",
      "Mfg. Lic. No.: 271",
    ]);
  });

  it("reads dates day first, month-year on packs, and month first only on a US form", () => {
    expect(isoDate("22/10/2026")).toEqual({ value: "2026-10-22", uncertain: false });
    expect(isoDate("20-9-2022")).toEqual({ value: "2022-09-20", uncertain: false });
    expect(isoDate("10/2027")).toEqual({ value: "2027-10", uncertain: false });
    expect(isoDate("10/3/00", true)).toEqual({ value: "2000-10-03", uncertain: true });
  });

  it("forms initials from a name and never keeps the name", () => {
    expect(initialsOf("A. Kumar")).toBe("A.K.");
    expect(initialsOf("ASHVIKA")).toBe("A.");
    expect(initialsOf("John Smith")).toBe("J.S.");
    const reading = expandReading(
      blank({ patientName: "A. Kumar", age: "24", ageUnit: "YEARS", gender: "MALE", weightKg: "54kg" }),
      FLUTIFER_RX,
    );
    expect(JSON.stringify(reading)).not.toMatch(/Kumar/);
    expect(reading.patient.initials.value).toBe("A.K.");
    expect([reading.patient.age.value, reading.patient.weightKg.value]).toEqual(["24", "54"]);
    expect(reading.patient.age.sourceText).toBe("A. K., 24, M. 111/69 mmHg.");
  });

  it("takes the later of a pack's two dates as its expiry when the columns were read out of order", () => {
    const reading = expandReading(
      blank({
        documentType: "MEDICINE_PACK",
        medicines: [
          medicine({
            name: "Flutifer",
            batch: "HND0361A",
            mfgDate: "10/2027",
            expiryDate: null,
            manufacturer: "SAVA HEALTHCARE LIMITED",
          }),
        ],
      }),
      FLUTIFER_BOX,
    );
    const m = reading.medications[0];
    expect([m.batchLot.value, m.expiryDate.value, m.manufacturer.value]).toEqual([
      "HND0361A",
      "2027-10",
      "SAVA HEALTHCARE LIMITED",
    ]);
    // Worked out, so it is shown for a check.
    expect(m.expiryDate.uncertain).toBe(true);
    expect(m.batchLot.sourceText).toBe("Batch No.: HND0361A");
  });

  it("gives each prescribed medicine the document's diagnosis as its indication, with source lines", () => {
    const transcript = `Date: 20-9-2022\nClinical Description:\nURTl RR-22/min\nsyp CALPOL (250/5) 4ML Q6H x 3d\nsyp DELCON 3 ML TDS x 5d`;
    const reading = expandReading(
      blank({
        documentDate: "20-9-2022",
        diagnosis: "URTl",
        medicines: [
          medicine({ name: "syp CALPOL (250/5)", dose: "4ML", frequency: "Q6H", duration: "x 3d" }),
          medicine({ name: "syp DELCON", dose: "3 ML", frequency: "TDS", duration: "x 5d" }),
        ],
      }),
      transcript,
    );
    expect(reading.documentDate?.value).toBe("2022-09-20");
    expect(reading.medications.map((m) => m.indication.value)).toEqual(["URTl", "URTl"]);
    expect(reading.medications[0].frequency.sourceText).toBe("syp CALPOL (250/5) 4ML Q6H x 3d");
    expect(chatExtractionSchema.safeParse(reading).success).toBe(true);
  });

  it("corrects the small model's predictable slips the way a careful reader would", () => {
    // US practice script: the dosing line is not a second medicine; "# 42" is a quantity.
    const script = reviseReading(
      blank({
        patientName: "John Smith",
        medicines: [
          medicine({ name: "Amoxicillin 250 mg tablets", dose: "# 42" }),
          medicine({
            name: "T T tablets",
            dose: "2 tablets",
            route: "p.o.",
            frequency: "T.i.d.",
            duration: "X 7 days",
          }),
        ],
      }),
      "Rx Amoxicillin 250 mg tablets # 42\nT T tablets p.o. T.i.d. X 7 days",
    );
    expect(script.medicines).toHaveLength(1);
    expect(script.medicines[0]).toMatchObject({ dose: "2 tablets", frequency: "T.i.d.", duration: "X 7 days" });

    // Moxikind front: a box that says "Rx" is still a pack; the brand is split from the generic text.
    const front = reviseReading(
      blank({
        medicines: [
          medicine({ name: "Amoxycillin & Potassium Clavulanate Tablets IP Moxikind® CV 1 gm", dose: "3 x 6 Tablets" }),
        ],
      }),
      "Rx Amoxycillin & Potassium Clavulanate Tablets IP\nMoxikind® CV 1 gm\n3 x 6 Tablets\nMankind",
    );
    expect(front.documentType).toBe("MEDICINE_PACK");
    expect(front.medicines[0]).toMatchObject({
      name: "Moxikind CV 1 gm",
      composition: "Amoxycillin & Potassium Clavulanate Tablets IP",
      dose: null,
    });

    // Meftal-P strip: the brand on its own line is the name, not the generic text.
    const strip = reviseReading(
      blank({
        documentType: "MEDICINE_PACK",
        medicines: [medicine({ name: "Mefenamic Acid Dispersible Tablets", composition: "Mefenamic Acid IP 100 mg" })],
      }),
      "Rx Mefenamic Acid Dispersible Tablets\nMEFTAL-P\nMfg. Lic. No.: 271\nBLUE\nCROSS",
    );
    expect(strip.medicines[0]).toMatchObject({ name: "MEFTAL-P", composition: "Mefenamic Acid IP 100 mg" });

    // Moxikind back: both ingredient lines of the composition block.
    const back = reviseReading(
      blank({
        documentType: "MEDICINE_PACK",
        medicines: [medicine({ composition: "Potassium Clavulanate Diluted IP equivalent to Clavulanic Acid" })],
      }),
      "Composition:\nEach film coated tablet contains :\nAmoxycillin Trihydrate IP\neq. to Amoxycillin\nPotassium Clavulanate Diluted IP\nequivalent to Clavulanic Acid\nExcipients",
    );
    expect(ingredientsIn(back.medicines[0].composition).sort()).toEqual(["amoxicillin", "clavulanate"]);

    // Four syrups: diagnosis without the vital signs, SOS and "x 5d" despite the handwriting.
    const syrups = reviseReading(
      blank({
        medicines: [
          medicine({ name: "syp DELCON", duration: "x sd" }),
          medicine({ name: "syp MEFTAL-P (100/5)", frequency: "50S" }),
        ],
      }),
      cleanTranscript("Clinical Description:\nURTl RR-22/min\nsyp DELCON 3 ML TDS x sd\nsyp MEFTAL-P (100/5) 3 ML 50s"),
    );
    expect(syrups.diagnosis).toBe("URTI");
    expect(syrups.medicines.map((m) => [m.duration, m.frequency])).toEqual([
      ["x 5d", null],
      [null, "SOS"],
    ]);
  });

  it("hides a name found in the text even when the model did not report it, in every value and quote", () => {
    const transcript =
      "Patient Name: Ramesh Iyer Age: 40\nDate: 12/11/2026\nRamesh Iyer complains of rash\nTab Cefixime 200mg BD x 5d";
    const reading = expandReading(
      blank({
        patientName: null,
        documentDate: "12/11/2026",
        reactionDetails: "Ramesh Iyer complains of rash",
        medicines: [medicine({ name: "Tab Cefixime 200mg", frequency: "BD" })],
      }),
      transcript,
    );
    expect(JSON.stringify(reading)).not.toMatch(/Ramesh|Iyer/i);
    expect(reading.patient.initials.value).toBe("R.I.");
    expect(reading.reaction.description.value).toBe("R. I. complains of rash");
    // "c/o" in an address means "care of": it is never read as a diagnosis.
    const address = reviseReading(
      blank({ medicines: [medicine({ name: "Tab Cefixime 200mg" })] }),
      "c/o Suresh Nair\nRx\nTab Cefixime 200mg",
    );
    expect(address.diagnosis).toBeNull();
  });

  it("marks a value no transcript line supports as uncertain", () => {
    expect(sourceLine(["Batch No.: A7AEZ002"], "ZZ999")).toBeNull();
    const reading = expandReading(blank({ medicines: [medicine({ name: "Augmentin 625" })] }), FLUTIFER_RX);
    expect(reading.medications[0].name.uncertain).toBe(true);
  });
});

describe("two-step local reading: the double-read check", () => {
  // Two real readings of the same handwritten prescription: the brand was misread differently each time.
  const FIRST =
    "22/10/2026. 54kg\nA. Kumar, 24, M. 111/69 mmHg.\nRx\nPlutifer Nand spray - 0-0-1\n2 sprays every nostril for 2 weeks";
  const SECOND =
    "22/10/2026. 54kg.\nA. Kumar, 24, M. 111/69 mmHg.\nRx\nPlatifier Nand spray -0-0-1\n2 sprays every nostril for 2 weeks";

  it("measures agreement by words, ignoring line breaks and punctuation", () => {
    expect(
      sharedWords("Each tablet contains:\nMefenamic Acid IP 100 mg", "Each tablet contains: Mefenamic Acid IP 100 mg"),
    ).toBe(1);
    expect(sharedWords(FIRST, SECOND)).toBeGreaterThan(0.9);
    expect(sharedWords("Tab Dexamethasone 100 mg daily", SECOND)).toBeLessThan(0.3);
  });

  it("marks only the value the second reading does not confirm", () => {
    const reading = expandReading(
      blank({
        documentDate: "22/10/2026",
        medicines: [medicine({ name: "Plutifer Nand spray", frequency: "0-0-1", dose: "2 sprays every nostril" })],
      }),
      FIRST,
      confirmedBy(SECOND),
    );
    const m = reading.medications[0];
    expect([m.name.uncertain, m.frequency.uncertain, m.dose.uncertain]).toEqual([true, false, false]);
    expect(reading.documentDate?.uncertain).toBe(false);
  });

  const compactReply = JSON.stringify(
    blank({ medicines: [medicine({ name: "Plutifer Nand spray", frequency: "0-0-1" })] }),
  );
  function ollama(...contents: (string | Error)[]) {
    const fetchImpl = vi.fn(async () => {
      const next = contents.shift();
      if (next instanceof Error) throw next;
      return new Response(JSON.stringify({ message: { content: next }, eval_count: 10 }), { status: 200 });
    });
    const provider = createTwoStepProvider({
      baseUrl: "http://localhost:11434",
      visionModel: "vision",
      textModel: "text",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const read = () =>
      provider.generate({
        task: "extract-document",
        system: "",
        prompt: "",
        document: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" },
        schema: chatExtractionSchema,
      });
    return { fetchImpl, read };
  }

  it("reads the photo twice and keeps a reading both agree on", async () => {
    const { fetchImpl, read } = ollama(FIRST, SECOND, compactReply);
    const { output, meta } = await read();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(output.readability).toBe("CLEAR");
    expect(output.medications[0].name.uncertain).toBe(true);
    expect(output.medications[0].frequency.uncertain).toBe(false);
    expect(meta).toMatchObject({ steps: 3 });
  });

  it("fills nothing in when the two readings disagree: the model was inventing", async () => {
    const invented = "Drug interaction: long acting\nDosage form: oral tablet\nDate of last visit: 20/05/2023";
    const { fetchImpl, read } = ollama(FIRST, invented, compactReply);
    await expect(read()).rejects.toThrow(AiError);
    await expect(ollama(FIRST, invented, compactReply).read()).rejects.toThrow(/two readings of it disagree/);
    // Refused before the structuring step: no time spent on a reading that cannot be trusted.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("uses the first reading as before when the check reading fails", async () => {
    const { read } = ollama(FIRST, new Error("timeout"), compactReply);
    const { output, meta } = await read();
    expect(output.medications[0].name.value).toBe("Plutifer Nand spray");
    expect(output.medications[0].name.uncertain).toBe(false);
    expect(meta).toMatchObject({ steps: 2 });
  });
});

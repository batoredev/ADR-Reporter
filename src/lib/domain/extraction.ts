// What an AI provider must return when reading a prescription. Every value
// carries the text it was read from and an "uncertain" flag; anything not
// written on the document is null. The reporter decides what is used.
import { z } from "zod";

const extracted = z.object({
  value: z
    .string()
    .nullable()
    .describe("The value as it should be recorded, or null if it is not written on the document."),
  sourceText: z.string().nullable().describe("The exact text read from the document, or null."),
  uncertain: z.boolean().describe("True if the writing is unclear or you are not sure of the reading."),
});

export const extractedMedicationSchema = z.object({
  name: extracted.describe("Medicine name (brand or generic) with strength and form as written."),
  dose: extracted.describe("Dose per administration as written, e.g. '500 mg' or '1 tablet'."),
  route: extracted.describe("Route as written, e.g. 'Oral'."),
  frequency: extracted.describe("Frequency as written, e.g. 'TID' or 'twice daily'."),
  startDate: extracted.describe("Start date only if written: ISO YYYY-MM-DD, or YYYY-MM / YYYY if partly written."),
  duration: extracted.describe("Duration as written, e.g. '5 days'. Informational only."),
  indication: extracted.describe("Indication or diagnosis written for this medicine."),
  manufacturer: extracted.describe("Manufacturer, only if written."),
  batchLot: extracted.describe("Batch or lot number, only if written."),
  expiryDate: extracted.describe("Expiry date, only if written: ISO YYYY-MM-DD or YYYY-MM."),
});

export const extractionSchema = z.object({
  medications: z.array(extractedMedicationSchema),
  documentNotes: z
    .string()
    .nullable()
    .describe("Anything the reporter should know, e.g. 'handwriting partly illegible'. Null if nothing."),
});

export type Extraction = z.infer<typeof extractionSchema>;
export type ExtractedMedication = z.infer<typeof extractedMedicationSchema>;

export type ExtractedField = keyof ExtractedMedication;

export const EXTRACTED_FIELD_LABELS: Record<ExtractedField, string> = {
  name: "Name",
  dose: "Dose",
  route: "Route",
  frequency: "Frequency",
  startDate: "Date started",
  duration: "Duration (not used for dates)",
  indication: "Indication",
  manufacturer: "Manufacturer",
  batchLot: "Batch / lot no.",
  expiryDate: "Expiry date",
};

/** Which extracted fields can fill which kind of medicine row. Duration is never used to infer dates. */
export const FILLABLE: Record<"SUSPECTED" | "CONCOMITANT", ExtractedField[]> = {
  SUSPECTED: [
    "name",
    "dose",
    "route",
    "frequency",
    "startDate",
    "indication",
    "manufacturer",
    "batchLot",
    "expiryDate",
  ],
  CONCOMITANT: ["name", "dose", "route", "frequency", "startDate", "indication"],
};

export const DATE_FIELDS: ExtractedField[] = ["startDate", "expiryDate"];

export const EXTRACTION_INSTRUCTIONS = `You are reading a FICTIONAL prescription for a pharmacovigilance training prototype.
Extract each prescribed medicine.
Rules:
- Report only what is visibly written. Never guess, infer, or complete missing information.
- If a value is not on the document, return null for both value and sourceText.
- sourceText must be copied exactly as written on the document.
- Set uncertain to true whenever handwriting or print is unclear, or you are not sure of the reading.
- Dates: give value in ISO format (YYYY-MM-DD, or YYYY-MM / YYYY when only partly written). Never invent a day or month.
- Do not decide which medicine caused any adverse reaction and do not add clinical judgements.`;

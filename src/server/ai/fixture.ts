import "server-only";
import type { DocumentExtraction } from "@/lib/domain/extraction";
import type { ConsistencyOutput } from "@/lib/domain/ai-checks";
import type { NarrativeOutput } from "@/lib/domain/narrative";
import { AiError, type AiProvider, type AiTask } from "./types";

const none = { sourceText: null, value: null, uncertain: false };
const read = (value: string, sourceText: string, uncertain = false) => ({ value, sourceText, uncertain });

/** Saved replies for the fictional samples, so automated tests never call an AI service. */
const SAVED: Record<AiTask, DocumentExtraction | NarrativeOutput | ConsistencyOutput> = {
  "extract-document": {
    documentType: "PRESCRIPTION",
    patient: {
      initials: read("R.K.", "Pt: R.K."),
      age: read("34", "34 y"),
      ageUnit: read("YEARS", "34 y"),
      gender: read("FEMALE", "F"),
      weightKg: none,
    },
    reaction: { terms: none, startDate: none, stopDate: none, description: none, management: none },
    medicalHistory: none,
    investigations: [],
    medications: [
      {
        name: read("Amoxicillin 500 mg capsule", "Cap. Amoxicillin 500 mg"),
        dose: read("500 mg", "1 cap"),
        route: read("Oral", "oral"),
        frequency: read("TID", "TID x 5 days"),
        startDate: read("2026-10-12", "Date: 12/10/2026"),
        duration: read("5 days", "x 5 days"),
        indication: read("Acute sinusitis", "Dx: Acute sinusitis"),
        manufacturer: none,
        batchLot: none,
        expiryDate: none,
      },
      {
        name: read("Paracetamol 500 mg tablet", "Tab. Paracetamol 500 mg"),
        dose: read("500 mg", "1 tab"),
        route: read("Oral", "oral"),
        frequency: read("SOS", "SOS for fever", true),
        startDate: read("2026-10-12", "Date: 12/10/2026"),
        duration: none,
        indication: read("Fever", "for fever"),
        manufacturer: none,
        batchLot: none,
        expiryDate: none,
      },
    ],
    documentNotes: "Saved test data for the fictional sample prescription; no AI service was called.",
  },
  narrative: {
    narrative:
      "The patient started amoxicillin 500 mg three times daily on 12 October 2026. A rash appeared on 14 October 2026. Amoxicillin was stopped on 15 October 2026 and cetirizine was given. The rash had improved by 17 October 2026.",
    needsChecking: [],
    leftOut: [],
  },
  consistency: {
    findings: [
      {
        kind: "UNCLEAR",
        field: "outcome",
        message: "The description says the rash improved, but no outcome is selected. Check item 15.",
        evidence: "The rash had improved",
      },
    ],
  },
};

/** Test-only provider: returns the saved reply for each task. The UI labels it as test data. */
export function createFixtureProvider(): AiProvider {
  return {
    name: "fixture",
    model: "saved-test-data",
    tier: "test",
    canRead: () => true,
    async generate({ task, schema }) {
      const parsed = schema.safeParse(SAVED[task]);
      if (!parsed.success) throw new AiError("The saved test data does not match the expected format.");
      return { output: parsed.data, meta: { fixture: true } };
    },
  };
}

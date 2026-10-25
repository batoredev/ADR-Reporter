// A complete, fictional structured report as the form submits it.
import { emptySuspectedMedicine, type CaseFormValues } from "@/lib/domain/case-form";

export const date = (value = "", approx = false) => ({ value, approx });

export function form(overrides: Partial<CaseFormValues> = {}): CaseFormValues {
  return {
    patientInitials: "T.S.",
    ageValue: "40",
    ageUnit: "YEARS",
    dateOfBirth: date(),
    gender: "FEMALE",
    weightKg: "",
    reactionTerms: "Urticarial rash",
    reactionDescription: "",
    reactionManagement: "",
    reactionStartDate: date("2026-10-20"),
    reactionStopDate: date(),
    reactionOngoing: false,
    medicalHistory: "",
    historyFlags: [],
    seriousAnswer: "NO",
    seriousnessCriteria: [],
    deathDate: date(),
    outcome: "RECOVERING",
    additionalInformation: "",
    unknownFields: [],
    investigations: [],
    suspectedMedicines: [{ ...emptySuspectedMedicine(), name: "Amoxicillin", startDate: date("2026-10-12") }],
    concomitantProducts: [],
    ...overrides,
  };
}

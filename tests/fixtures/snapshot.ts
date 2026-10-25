// Fictional case snapshots for tests that do not need the database.
import type { CaseSnapshot } from "@/lib/domain/snapshot";

type Med = CaseSnapshot["suspectedMedicines"][number];
type Conc = CaseSnapshot["concomitantProducts"][number];

const dateFields = (prefix: string) => ({ [prefix]: null, [`${prefix}Approx`]: false });

export function medicine(overrides: Partial<Med> = {}): Med {
  return {
    id: `med-${Math.random().toString(36).slice(2, 8)}`,
    position: 0,
    name: "Amoxicillin",
    manufacturer: null,
    batchLot: null,
    ...dateFields("expiryDate"),
    dose: "500 mg",
    route: "Oral",
    frequency: "TID",
    ...dateFields("startDate"),
    ...dateFields("stopDate"),
    ongoing: false,
    indication: null,
    actionTaken: null,
    rechallenge: null,
    rechallengeDose: null,
    unknownFields: [],
    ...overrides,
  } as Med;
}

export function concomitant(overrides: Partial<Conc> = {}): Conc {
  return {
    id: `conc-${Math.random().toString(36).slice(2, 8)}`,
    position: 0,
    name: "Paracetamol",
    dose: "500 mg",
    route: "Oral",
    frequency: "SOS",
    ...dateFields("startDate"),
    ...dateFields("stopDate"),
    ongoing: false,
    indication: null,
    usedToTreatReaction: false,
    unknownFields: [],
    ...overrides,
  } as Conc;
}

export function snapshot(overrides: Partial<CaseSnapshot> = {}): CaseSnapshot {
  return {
    schemaVersion: 1,
    caseNumber: "ADR-900",
    status: "SUBMITTED",
    patient: {
      initials: "T.S.",
      ageValue: 40,
      ageUnit: "YEARS",
      dateOfBirth: null,
      dateOfBirthApprox: false,
      gender: "FEMALE",
      weightKg: null,
    },
    reaction: {
      terms: "Urticarial rash",
      description: "Itchy wheals on both arms.",
      management: null,
      startDate: "2026-10-20",
      startDateApprox: false,
      stopDate: null,
      stopDateApprox: false,
      ongoing: false,
    },
    history: { text: null, flags: [] },
    seriousness: { answer: "NO", criteria: [], deathDate: null, deathDateApprox: false, isPotentiallySerious: false },
    outcome: "RECOVERING",
    additionalInformation: null,
    unknownFields: [],
    investigations: [],
    suspectedMedicines: [medicine()],
    concomitantProducts: [],
    reporter: {
      name: "Demo Clinical Pharmacist",
      address: "Demo General Hospital (Fictional)",
      pin: "000000",
      email: "pharmacist@demo.test",
      phone: "+91 00000 00001",
      occupation: "Clinical Pharmacist",
      reportDate: "2026-10-25",
    },
    ...overrides,
  } as CaseSnapshot;
}

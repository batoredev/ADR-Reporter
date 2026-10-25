// The structured report form (PvPI sections A-D): its values, validation and
// conversion to and from the database. Shared by the browser form, the server
// actions and the tests.
import { z } from "zod";
import {
  ActionTaken,
  AgeUnit,
  Gender,
  HistoryFlag,
  Outcome,
  Rechallenge,
  SeriousAnswer,
  SeriousnessCriterion,
} from "@/generated/prisma/enums";
import { isValidPartialDate } from "./partial-date";
import { isPotentiallySerious } from "./seriousness";

// ---------------------------------------------------------------------------
// Fields that may be marked "Unknown" (mandatory fields cannot be).
// ---------------------------------------------------------------------------

export const CASE_UNKNOWABLE = [
  "gender",
  "weightKg",
  "reactionStopDate",
  "medicalHistory",
  "seriousAnswer",
  "outcome",
] as const;
export const SUSPECTED_UNKNOWABLE = [
  "manufacturer",
  "batchLot",
  "expiryDate",
  "dose",
  "route",
  "frequency",
  "startDate",
  "stopDate",
  "indication",
] as const;
export const CONCOMITANT_UNKNOWABLE = ["dose", "route", "frequency", "startDate", "stopDate", "indication"] as const;
export const INVESTIGATION_UNKNOWABLE = ["date"] as const;

// ---------------------------------------------------------------------------
// Form values (strings for inputs; "" means "not entered").
// ---------------------------------------------------------------------------

const optionalEnum = <T extends Record<string, string>>(values: T) =>
  z.union([z.enum(Object.values(values) as [T[keyof T], ...T[keyof T][]]), z.literal("")]);

const textField = (max: number) => z.string().max(max, `Keep this under ${max} characters`);

export const partialDateSchema = z.object({
  value: z
    .string()
    .refine((v) => v === "" || isValidPartialDate(v), "Enter a real date (exact, month and year, or year only)"),
  approx: z.boolean(),
});

const unknownList = (allowed: readonly string[]) =>
  z.array(z.string()).refine((list) => list.every((f) => allowed.includes(f)), "Unknown field not allowed");

export const investigationSchema = z.object({
  id: z.string().optional(),
  testName: textField(200),
  result: textField(300),
  date: partialDateSchema,
  unknownFields: unknownList(INVESTIGATION_UNKNOWABLE),
});

export const suspectedMedicineSchema = z.object({
  id: z.string().optional(),
  name: textField(200),
  manufacturer: textField(200),
  batchLot: textField(100),
  expiryDate: partialDateSchema,
  dose: textField(100),
  route: textField(100),
  frequency: textField(100),
  startDate: partialDateSchema,
  stopDate: partialDateSchema,
  ongoing: z.boolean(),
  indication: textField(200),
  actionTaken: optionalEnum(ActionTaken),
  rechallenge: optionalEnum(Rechallenge),
  rechallengeDose: textField(100),
  unknownFields: unknownList(SUSPECTED_UNKNOWABLE),
});

export const concomitantProductSchema = z.object({
  id: z.string().optional(),
  name: textField(200),
  dose: textField(100),
  route: textField(100),
  frequency: textField(100),
  startDate: partialDateSchema,
  stopDate: partialDateSchema,
  ongoing: z.boolean(),
  indication: textField(200),
  usedToTreatReaction: z.boolean(),
  unknownFields: unknownList(CONCOMITANT_UNKNOWABLE),
});

export const caseFormSchema = z.object({
  patientInitials: textField(10),
  ageValue: z.string().refine((v) => v === "" || (/^\d{1,3}$/.test(v) && Number(v) <= 150), "Enter a whole number"),
  ageUnit: optionalEnum(AgeUnit),
  dateOfBirth: partialDateSchema,
  gender: optionalEnum(Gender),
  weightKg: z
    .string()
    .refine(
      (v) => v === "" || (/^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number(v) <= 500),
      "Enter kg, e.g. 58 or 58.5",
    ),
  reactionTerms: textField(300),
  reactionDescription: textField(4000),
  reactionManagement: textField(4000),
  reactionStartDate: partialDateSchema,
  reactionStopDate: partialDateSchema,
  reactionOngoing: z.boolean(),
  medicalHistory: textField(4000),
  historyFlags: z.array(z.enum(Object.values(HistoryFlag) as [HistoryFlag, ...HistoryFlag[]])),
  seriousAnswer: optionalEnum(SeriousAnswer),
  seriousnessCriteria: z.array(
    z.enum(Object.values(SeriousnessCriterion) as [SeriousnessCriterion, ...SeriousnessCriterion[]]),
  ),
  deathDate: partialDateSchema,
  outcome: optionalEnum(Outcome),
  additionalInformation: textField(4000),
  unknownFields: unknownList(CASE_UNKNOWABLE),
  investigations: z.array(investigationSchema).max(20),
  suspectedMedicines: z.array(suspectedMedicineSchema).max(10),
  concomitantProducts: z.array(concomitantProductSchema).max(20),
});

export type CaseFormValues = z.infer<typeof caseFormSchema>;
export type SuspectedMedicineValues = z.infer<typeof suspectedMedicineSchema>;
export type ConcomitantProductValues = z.infer<typeof concomitantProductSchema>;
export type InvestigationValues = z.infer<typeof investigationSchema>;
export type PartialDateValue = z.infer<typeof partialDateSchema>;

const emptyDate = (): PartialDateValue => ({ value: "", approx: false });

export const emptySuspectedMedicine = (): SuspectedMedicineValues => ({
  name: "",
  manufacturer: "",
  batchLot: "",
  expiryDate: emptyDate(),
  dose: "",
  route: "",
  frequency: "",
  startDate: emptyDate(),
  stopDate: emptyDate(),
  ongoing: false,
  indication: "",
  actionTaken: "",
  rechallenge: "",
  rechallengeDose: "",
  unknownFields: [],
});

export const emptyConcomitantProduct = (): ConcomitantProductValues => ({
  name: "",
  dose: "",
  route: "",
  frequency: "",
  startDate: emptyDate(),
  stopDate: emptyDate(),
  ongoing: false,
  indication: "",
  usedToTreatReaction: false,
  unknownFields: [],
});

export const emptyInvestigation = (): InvestigationValues => ({
  testName: "",
  result: "",
  date: emptyDate(),
  unknownFields: [],
});

// ---------------------------------------------------------------------------
// Database <-> form conversion
// ---------------------------------------------------------------------------

type Nullable<T> = T | null | undefined;
const s = (v: Nullable<string | number>) => (v === null || v === undefined ? "" : String(v));
const d = (value: Nullable<string>, approx: Nullable<boolean>): PartialDateValue => ({
  value: value ?? "",
  approx: Boolean(approx),
});
const n = (v: string) => (v.trim() === "" ? null : v.trim());
const dateOut = (v: PartialDateValue) =>
  v.value ? { value: v.value, approx: v.approx } : { value: null, approx: false };

export interface CaseRecordForForm {
  patientInitials: string | null;
  ageValue: number | null;
  ageUnit: AgeUnit | null;
  dateOfBirth: string | null;
  dateOfBirthApprox: boolean;
  gender: Gender | null;
  weightKg: number | null;
  reactionTerms: string | null;
  reactionDescription: string | null;
  reactionManagement: string | null;
  reactionStartDate: string | null;
  reactionStartDateApprox: boolean;
  reactionStopDate: string | null;
  reactionStopDateApprox: boolean;
  reactionOngoing: boolean;
  medicalHistory: string | null;
  historyFlags: HistoryFlag[];
  seriousAnswer: SeriousAnswer | null;
  seriousnessCriteria: SeriousnessCriterion[];
  deathDate: string | null;
  deathDateApprox: boolean;
  outcome: Outcome | null;
  additionalInformation: string | null;
  unknownFields: string[];
  investigations: {
    id: string;
    testName: string | null;
    result: string | null;
    date: string | null;
    dateApprox: boolean;
    unknownFields: string[];
  }[];
  suspectedMedicines: {
    id: string;
    name: string | null;
    manufacturer: string | null;
    batchLot: string | null;
    expiryDate: string | null;
    expiryDateApprox: boolean;
    dose: string | null;
    route: string | null;
    frequency: string | null;
    startDate: string | null;
    startDateApprox: boolean;
    stopDate: string | null;
    stopDateApprox: boolean;
    ongoing: boolean;
    indication: string | null;
    actionTaken: ActionTaken | null;
    rechallenge: Rechallenge | null;
    rechallengeDose: string | null;
    unknownFields: string[];
  }[];
  concomitantProducts: {
    id: string;
    name: string | null;
    dose: string | null;
    route: string | null;
    frequency: string | null;
    startDate: string | null;
    startDateApprox: boolean;
    stopDate: string | null;
    stopDateApprox: boolean;
    ongoing: boolean;
    indication: string | null;
    usedToTreatReaction: boolean;
    unknownFields: string[];
  }[];
}

export function toFormValues(c: CaseRecordForForm): CaseFormValues {
  return {
    patientInitials: s(c.patientInitials),
    ageValue: s(c.ageValue),
    ageUnit: c.ageUnit ?? "",
    dateOfBirth: d(c.dateOfBirth, c.dateOfBirthApprox),
    gender: c.gender ?? "",
    weightKg: s(c.weightKg),
    reactionTerms: s(c.reactionTerms),
    reactionDescription: s(c.reactionDescription),
    reactionManagement: s(c.reactionManagement),
    reactionStartDate: d(c.reactionStartDate, c.reactionStartDateApprox),
    reactionStopDate: d(c.reactionStopDate, c.reactionStopDateApprox),
    reactionOngoing: c.reactionOngoing,
    medicalHistory: s(c.medicalHistory),
    historyFlags: c.historyFlags ?? [],
    seriousAnswer: c.seriousAnswer ?? "",
    seriousnessCriteria: c.seriousnessCriteria ?? [],
    deathDate: d(c.deathDate, c.deathDateApprox),
    outcome: c.outcome ?? "",
    additionalInformation: s(c.additionalInformation),
    unknownFields: c.unknownFields ?? [],
    investigations: c.investigations.map((r) => ({
      id: r.id,
      testName: s(r.testName),
      result: s(r.result),
      date: d(r.date, r.dateApprox),
      unknownFields: r.unknownFields ?? [],
    })),
    suspectedMedicines: c.suspectedMedicines.map((r) => ({
      id: r.id,
      name: s(r.name),
      manufacturer: s(r.manufacturer),
      batchLot: s(r.batchLot),
      expiryDate: d(r.expiryDate, r.expiryDateApprox),
      dose: s(r.dose),
      route: s(r.route),
      frequency: s(r.frequency),
      startDate: d(r.startDate, r.startDateApprox),
      stopDate: d(r.stopDate, r.stopDateApprox),
      ongoing: r.ongoing,
      indication: s(r.indication),
      actionTaken: r.actionTaken ?? "",
      rechallenge: r.rechallenge ?? "",
      rechallengeDose: s(r.rechallengeDose),
      unknownFields: r.unknownFields ?? [],
    })),
    concomitantProducts: c.concomitantProducts.map((r) => ({
      id: r.id,
      name: s(r.name),
      dose: s(r.dose),
      route: s(r.route),
      frequency: s(r.frequency),
      startDate: d(r.startDate, r.startDateApprox),
      stopDate: d(r.stopDate, r.stopDateApprox),
      ongoing: r.ongoing,
      indication: s(r.indication),
      usedToTreatReaction: r.usedToTreatReaction,
      unknownFields: r.unknownFields ?? [],
    })),
  };
}

/** A field marked "Unknown" is stored with no value, so the two can never disagree. */
const unless = <T>(unknown: string[], field: string, value: T): T | null => (unknown.includes(field) ? null : value);

export function caseFieldsFromForm(v: CaseFormValues) {
  const u = v.unknownFields;
  const start = dateOut(v.reactionStartDate);
  const stop = dateOut(v.reactionStopDate);
  const dob = dateOut(v.dateOfBirth);
  const death = dateOut(v.deathDate);
  const criteria = v.seriousnessCriteria;
  const seriousAnswer = unless(u, "seriousAnswer", v.seriousAnswer || null);
  return {
    patientInitials: n(v.patientInitials)?.toUpperCase() ?? null,
    ageValue: v.ageValue ? Number(v.ageValue) : null,
    ageUnit: v.ageValue ? v.ageUnit || "YEARS" : null,
    dateOfBirth: dob.value,
    dateOfBirthApprox: dob.approx,
    gender: unless(u, "gender", v.gender || null),
    weightKg: unless(u, "weightKg", v.weightKg ? Number(v.weightKg) : null),
    reactionTerms: n(v.reactionTerms),
    reactionDescription: n(v.reactionDescription),
    reactionManagement: n(v.reactionManagement),
    reactionStartDate: start.value,
    reactionStartDateApprox: start.approx,
    reactionStopDate: unless(u, "reactionStopDate", v.reactionOngoing ? null : stop.value),
    reactionStopDateApprox: v.reactionOngoing || u.includes("reactionStopDate") ? false : stop.approx,
    reactionOngoing: v.reactionOngoing,
    medicalHistory: unless(u, "medicalHistory", n(v.medicalHistory)),
    historyFlags: v.historyFlags,
    seriousAnswer,
    seriousnessCriteria: criteria,
    deathDate: criteria.includes("DEATH") ? death.value : null,
    deathDateApprox: criteria.includes("DEATH") ? death.approx : false,
    outcome: unless(u, "outcome", v.outcome || null),
    additionalInformation: n(v.additionalInformation),
    unknownFields: u,
    isPotentiallySerious: isPotentiallySerious(seriousAnswer, criteria),
  };
}

export function suspectedFieldsFromForm(r: SuspectedMedicineValues, position: number) {
  const u = r.unknownFields;
  const exp = dateOut(r.expiryDate);
  const start = dateOut(r.startDate);
  const stop = dateOut(r.stopDate);
  return {
    position,
    name: n(r.name),
    manufacturer: unless(u, "manufacturer", n(r.manufacturer)),
    batchLot: unless(u, "batchLot", n(r.batchLot)),
    expiryDate: unless(u, "expiryDate", exp.value),
    expiryDateApprox: u.includes("expiryDate") ? false : exp.approx,
    dose: unless(u, "dose", n(r.dose)),
    route: unless(u, "route", n(r.route)),
    frequency: unless(u, "frequency", n(r.frequency)),
    startDate: unless(u, "startDate", start.value),
    startDateApprox: u.includes("startDate") ? false : start.approx,
    stopDate: unless(u, "stopDate", r.ongoing ? null : stop.value),
    stopDateApprox: r.ongoing || u.includes("stopDate") ? false : stop.approx,
    ongoing: r.ongoing,
    indication: unless(u, "indication", n(r.indication)),
    actionTaken: r.actionTaken || null,
    rechallenge: r.rechallenge || null,
    rechallengeDose: r.rechallenge === "YES" ? n(r.rechallengeDose) : null,
    unknownFields: u,
  };
}

export function concomitantFieldsFromForm(r: ConcomitantProductValues, position: number) {
  const u = r.unknownFields;
  const start = dateOut(r.startDate);
  const stop = dateOut(r.stopDate);
  return {
    position,
    name: n(r.name),
    dose: unless(u, "dose", n(r.dose)),
    route: unless(u, "route", n(r.route)),
    frequency: unless(u, "frequency", n(r.frequency)),
    startDate: unless(u, "startDate", start.value),
    startDateApprox: u.includes("startDate") ? false : start.approx,
    stopDate: unless(u, "stopDate", r.ongoing ? null : stop.value),
    stopDateApprox: r.ongoing || u.includes("stopDate") ? false : stop.approx,
    ongoing: r.ongoing,
    indication: unless(u, "indication", n(r.indication)),
    usedToTreatReaction: r.usedToTreatReaction,
    unknownFields: u,
  };
}

export function investigationFieldsFromForm(r: InvestigationValues, position: number) {
  const date = dateOut(r.date);
  return {
    position,
    testName: n(r.testName),
    result: n(r.result),
    date: unless(r.unknownFields, "date", date.value),
    dateApprox: r.unknownFields.includes("date") ? false : date.approx,
    unknownFields: r.unknownFields,
  };
}

/** Common frequency codes offered as one-click choices; any other text is allowed. */
export const FREQUENCY_SUGGESTIONS = ["OD", "BD", "TID", "QID", "HS", "SOS", "STAT", "Weekly"];
export const ROUTE_SUGGESTIONS = ["Oral", "Intravenous", "Intramuscular", "Subcutaneous", "Topical", "Inhalation"];

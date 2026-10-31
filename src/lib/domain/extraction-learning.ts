import { z } from "zod";
import {
  chatExtractionSchema,
  CHAT_EXTRA_CASE_FIELDS,
  CHAT_EXTRA_MED_FIELDS,
  type ChatExtraction,
} from "./chat-extraction";
import {
  documentExtractionSchema,
  extractedMedicationSchema,
  extractedInvestigationSchema,
  EXTRACTED_FIELD_LABELS,
  INVESTIGATION_FIELD_LABELS,
  SINGLE_FIELDS,
  SINGLE_FIELD_ORDER,
  singleValue,
  type ExtractedValue,
} from "./extraction";
import { DATE_FIELDS, parsedFactValue, CASE_FIELDS, MED_FIELDS } from "./report-chat";
import { isValidPartialDate } from "./partial-date";

export const LABEL_REASONS = ["READABLE", "CORRECTED", "NOT_ON_DOCUMENT", "UNREADABLE", "DERIVED_INITIALS"] as const;
export const labelReasonSchema = z.object({
  reason: z.enum(LABEL_REASONS),
  note: z.string().trim().max(1000).default(""),
  region: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    })
    .refine((b) => b.x + b.width <= 1 && b.y + b.height <= 1)
    .nullable()
    .optional(),
});
export type LabelReason = z.infer<typeof labelReasonSchema>;
export interface LabelField {
  path: string;
  label: string;
  group: string;
  reading: ExtractedValue;
  formField: string;
}
const none = (): ExtractedValue => ({
  value: null,
  sourceText: null,
  uncertain: false,
  approximate: false,
  sourcePage: 1,
});
const fields = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, none()]));
export function emptyLabelDocument(): ChatExtraction {
  return chatExtractionSchema.parse({
    documentType: "OTHER",
    readability: "PARTIAL",
    patient: fields(Object.keys(documentExtractionSchema.shape.patient.shape)),
    reaction: fields(Object.keys(documentExtractionSchema.shape.reaction.shape)),
    medicalHistory: none(),
    medications: [],
    investigations: [],
    documentNotes: null,
    extraFields: [],
  });
}
export const blankLabelMedicine = () =>
  extractedMedicationSchema.parse(fields(Object.keys(extractedMedicationSchema.shape)));
export const blankLabelInvestigation = () =>
  extractedInvestigationSchema.parse(fields(Object.keys(extractedInvestigationSchema.shape)));
export function labelFields(doc: ChatExtraction): LabelField[] {
  const result: LabelField[] = SINGLE_FIELD_ORDER.map((key) => ({
    path: key,
    label: SINGLE_FIELDS[key].label,
    group: key.startsWith("patient.") ? "Patient" : key.startsWith("reaction.") ? "Reaction" : "History",
    reading: singleValue(doc, key),
    formField: key === "patient.age" ? "ageValue" : key === "patient.ageUnit" ? "ageUnit" : SINGLE_FIELDS[key].path,
  }));
  doc.medications.forEach((row, index) =>
    Object.entries(row).forEach(([key, reading]) =>
      result.push({
        path: `medications.${index}.${key}`,
        label: EXTRACTED_FIELD_LABELS[key as keyof typeof EXTRACTED_FIELD_LABELS],
        group: `Medicine ${index + 1}`,
        reading,
        formField: key,
      }),
    ),
  );
  doc.investigations.forEach((row, index) =>
    Object.entries(row).forEach(([key, reading]) =>
      result.push({
        path: `investigations.${index}.${key}`,
        label: INVESTIGATION_FIELD_LABELS[key as keyof typeof INVESTIGATION_FIELD_LABELS],
        group: `Test ${index + 1}`,
        reading,
        formField: key,
      }),
    ),
  );
  doc.extraFields.forEach((extra, index) =>
    result.push({
      path: `extraFields.${index}.reading`,
      label: (extra.entity === "case" ? CASE_FIELDS : MED_FIELDS)[extra.field] ?? extra.field,
      group: extra.entity === "case" ? "Additional details" : `Medicine ${(extra.medicationIndex ?? 0) + 1}`,
      reading: extra.reading,
      formField: extra.field,
    }),
  );
  return result;
}
export function setLabelReading(doc: ChatExtraction, path: string, reading: ExtractedValue): ChatExtraction {
  if (!labelFields(doc).some((field) => field.path === path)) throw new Error("Unknown document field.");
  const next = structuredClone(doc),
    keys = path.split(".");
  let parent: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) parent = parent[key] as Record<string, unknown>;
  parent[keys.at(-1)!] = reading;
  return next;
}
export const labelInputSchema = z.object({
  pageNumber: z.number().int().positive(),
  transcription: z.string().max(40000),
  labels: chatExtractionSchema,
  reasons: z.record(z.string().max(200), labelReasonSchema),
  completePageReviewed: z.literal(true),
  language: z.literal("en"),
});
export function validateDocumentLabel(input: z.infer<typeof labelInputSchema>): string[] {
  const errors: string[] = [];
  if (input.labels.medications.length > 30 || input.labels.investigations.length > 30)
    errors.push("Split a page with more than 30 rows into clearly identified regions before labelling.");
  for (const field of labelFields(input.labels)) {
    const decision = input.reasons[field.path],
      reading = field.reading;
    if (!decision) {
      errors.push(`${field.label}: choose whether it is readable, absent or unclear.`);
      continue;
    }
    if (decision.reason === "NOT_ON_DOCUMENT") {
      if (reading.value !== null || reading.sourceText !== null || reading.uncertain)
        errors.push(`${field.label}: absent fields must be empty and marked clear.`);
      continue;
    }
    if (decision.reason === "UNREADABLE") {
      if (reading.value !== null || !reading.uncertain)
        errors.push(`${field.label}: an unreadable value must be empty and marked uncertain.`);
      if (input.labels.readability === "CLEAR") errors.push("Use partially readable when any field is unreadable.");
      continue;
    }
    if (decision.reason === "DERIVED_INITIALS") {
      if (
        field.path !== "patient.initials" ||
        !reading.value ||
        !/^(?:[A-Z][. ]?){1,5}$/.test(reading.value) ||
        reading.sourceText !== null ||
        !decision.note
      )
        errors.push("Derived initials need initials only, no copied name, and an explanation.");
      continue;
    }
    if (!reading.value?.trim() || !reading.sourceText?.trim() || !input.transcription.includes(reading.sourceText))
      errors.push(`${field.label}: give a value and an exact quote from your transcription.`);
    if (reading.uncertain)
      errors.push(`${field.label}: use unreadable and leave it empty when the value cannot be read reliably.`);
    if (decision.reason === "CORRECTED" && !decision.note)
      errors.push(`${field.label}: explain the source-supported correction.`);
    if (DATE_FIELDS.has(field.formField) && reading.value && !isValidPartialDate(reading.value))
      errors.push(`${field.label}: use a valid exact or partial date.`);
    if (
      DATE_FIELDS.has(field.formField) &&
      /\b(?:about|approx(?:imate(?:ly)?)?|around|circa)\b|~/i.test(reading.sourceText ?? "") &&
      !reading.approximate
    )
      errors.push(`${field.label}: retain the approximate-date marker from the source.`);
    if (
      field.path === "patient.age" &&
      reading.value &&
      (!/^\d{1,3}$/.test(reading.value) || Number(reading.value) > 150)
    )
      errors.push("Age must be a whole number no greater than 150.");
    if (
      field.path === "patient.weightKg" &&
      reading.value &&
      (!/^\d{1,3}(?:\.\d{1,2})?$/.test(reading.value) || Number(reading.value) <= 0 || Number(reading.value) > 500)
    )
      errors.push("Weight must be recorded in kilograms.");
    if (field.path === "patient.initials" && reading.value && !/^(?:[A-Z][. ]?){1,5}$/.test(reading.value))
      errors.push("Patient value must contain initials only.");
    if (
      reading.value &&
      [
        "gender",
        "ageUnit",
        "seriousAnswer",
        "outcome",
        "historyFlags",
        "seriousnessCriteria",
        "ongoing",
        "reactionOngoing",
        "actionTaken",
        "rechallenge",
      ].includes(field.formField)
    ) {
      try {
        parsedFactValue(field.formField, reading.value, reading.approximate);
      } catch {
        errors.push(`${field.label}: choose a valid form value.`);
      }
    }
  }
  for (const extra of input.labels.extraFields) {
    if (extra.entity === "case" && !(CHAT_EXTRA_CASE_FIELDS as readonly string[]).includes(extra.field))
      errors.push("An additional case field is not allowed.");
    if (
      extra.entity === "medicine" &&
      (!(CHAT_EXTRA_MED_FIELDS as readonly string[]).includes(extra.field) ||
        extra.medicationIndex === null ||
        !input.labels.medications[extra.medicationIndex])
    )
      errors.push("An additional medicine detail does not match a medicine on this page.");
  }
  if (
    input.labels.readability === "UNREADABLE" &&
    labelFields(input.labels).some((field) => field.reading.value !== null)
  )
    errors.push("An unreadable page cannot supply clinical values.");
  return [...new Set(errors)];
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${stableJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export const RELEASE_POLICY = {
  scope: "TEST_ONLY",
  minReviewedPages: 100,
  minTestPages: 30,
  minTestGroups: 10,
  minCriticalSupport: 5,
  minUnreadableSupport: 5,
  minCriticalRecall: 0.98,
  minEntityAssociation: 0.98,
  maxFalseFillRate: 0.01,
  minJsonValidity: 1,
  minUnreadableAbstention: 0.99,
  maxP95Ms: 60000,
  maxBaselineF1Regression: 0.002,
} as const;
export const CRITICAL_FIELDS = [
  "patient.initials",
  "patient.age_or_birth",
  "medications.name",
  "medications.dose",
  "medications.route",
  "medications.frequency",
  "reaction.terms",
  "reaction.startDate",
  "investigations.result",
] as const;
export const evaluationMetricsSchema = z.object({
  sampleCount: z.number().int().nonnegative(),
  groupCount: z.number().int().nonnegative(),
  reviewedPageCount: z.number().int().nonnegative(),
  fieldF1: z.number().min(0).max(1),
  criticalRecall: z.number().min(0).max(1),
  entityAssociation: z.number().min(0).max(1),
  falseFillRate: z.number().min(0).max(1),
  jsonValidity: z.number().min(0).max(1),
  unreadableAbstention: z.number().min(0).max(1),
  p95Ms: z.number().nonnegative(),
  criticalSupport: z.record(z.string(), z.number().int().nonnegative()),
  unreadableSupport: z.number().int().nonnegative(),
  documentTypeAccuracy: z.number().min(0).max(1),
  readabilityAccuracy: z.number().min(0).max(1),
  syntheticOnly: z.boolean(),
});
export function releaseGate(
  metrics: z.infer<typeof evaluationMetricsSchema>,
  baseline: z.infer<typeof evaluationMetricsSchema>,
): string[] {
  const p = RELEASE_POLICY,
    failures: string[] = [];
  if (metrics.syntheticOnly) failures.push("A synthetic-only pilot is not eligible for application deployment.");
  if (metrics.reviewedPageCount < p.minReviewedPages)
    failures.push(`Need ${p.minReviewedPages} independently reviewed pages.`);
  if (metrics.sampleCount < p.minTestPages || metrics.groupCount < p.minTestGroups)
    failures.push("The independent test set is too small.");
  if (CRITICAL_FIELDS.some((field) => (metrics.criticalSupport[field] ?? 0) < p.minCriticalSupport))
    failures.push("Critical fields need more held-out examples.");
  if (metrics.unreadableSupport < p.minUnreadableSupport)
    failures.push("Include independently labelled unreadable fields in the test set.");
  if (metrics.documentTypeAccuracy < 0.95 || metrics.readabilityAccuracy < 0.98)
    failures.push("Document/readability classification is below the release threshold.");
  if (metrics.criticalRecall < p.minCriticalRecall)
    failures.push("Critical-field recall is below the release threshold.");
  if (metrics.entityAssociation < p.minEntityAssociation)
    failures.push("Medicine/test association is below the release threshold.");
  if (metrics.falseFillRate > p.maxFalseFillRate)
    failures.push("Too many values are filled incorrectly or without source support.");
  if (metrics.jsonValidity < p.minJsonValidity)
    failures.push("Some predictions did not match the required document format.");
  if (metrics.unreadableAbstention < p.minUnreadableAbstention)
    failures.push("The model does not reliably abstain on unreadable fields.");
  if (metrics.p95Ms > p.maxP95Ms) failures.push("Local inference is too slow for the application deadline.");
  if (metrics.fieldF1 + p.maxBaselineF1Regression < baseline.fieldF1)
    failures.push("Field performance regressed from the baseline.");
  if (metrics.sampleCount !== baseline.sampleCount || metrics.groupCount !== baseline.groupCount)
    failures.push("Candidate and baseline were not tested on the same independent set.");
  return failures;
}

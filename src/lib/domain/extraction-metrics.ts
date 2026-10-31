import { chatExtractionSchema, type ChatExtraction } from "./chat-extraction";
import { CRITICAL_FIELDS, type evaluationMetricsSchema } from "./extraction-learning";
import type { z } from "zod";

export interface EvaluationTruth {
  id: string;
  groupKey: string;
  labels: ChatExtraction;
  transcription: string;
}
export interface EvaluationPrediction {
  id: string;
  output: unknown;
  latencyMs: number;
}
interface Count {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  support: number;
}
const empty = (): Count => ({ tp: 0, fp: 0, fn: 0, tn: 0, support: 0 });
const canon = (value: string | null | undefined) => (value ?? "").trim().replace(/\s+/g, " ");
const nameKey = (value: string | null | undefined) =>
  canon(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
type Reading = { value: string | null; sourceText: string | null; uncertain: boolean; approximate?: boolean };
type Flat = { key: string; category: string; reading: Reading };

function flatten(doc: ChatExtraction, prefix = ""): Flat[] {
  const rows: Flat[] = [];
  for (const group of ["patient", "reaction"] as const)
    for (const [field, reading] of Object.entries(doc[group]))
      rows.push({ key: `${prefix}${group}.${field}`, category: `${group}.${field}`, reading });
  rows.push({ key: `${prefix}medicalHistory`, category: "medicalHistory", reading: doc.medicalHistory });
  for (const [list, category] of [
    ["medications", "medications"],
    ["investigations", "investigations"],
  ] as const)
    doc[list].forEach((row, index) =>
      Object.entries(row).forEach(([field, reading]) =>
        rows.push({ key: `${prefix}${list}.${index}.${field}`, category: `${category}.${field}`, reading }),
      ),
    );
  for (const extra of doc.extraFields)
    rows.push({
      key: `${prefix}extra.${extra.entity}.${extra.medicationIndex ?? "case"}.${extra.field}`,
      category: extra.field === "dateOfBirth" ? "patient.dateOfBirth" : `extra.${extra.field}`,
      reading: extra.reading,
    });
  return rows;
}
/** Match named entities independently of output ordering; repeated names also use dates and dose as tie breakers. */
function align(pred: ChatExtraction, truth: ChatExtraction) {
  const copy = structuredClone(pred);
  let correct = 0,
    total = 0;
  for (const list of ["medications", "investigations"] as const) {
    const expected = truth[list],
      actual = copy[list];
    const used = new Set<number>();
    const aligned: typeof actual = [];
    for (const row of expected) {
      const name = "name" in row ? row.name : row.testName;
      const candidates = actual
        .map((candidate, index) => ({ candidate, index }))
        .filter(
          ({ candidate, index }) =>
            !used.has(index) &&
            nameKey("name" in candidate ? candidate.name.value : candidate.testName.value) === nameKey(name.value) &&
            nameKey(name.value),
        );
      candidates.sort((a, b) => {
        const score = (candidate: (typeof actual)[number]) =>
          Object.entries(row).reduce(
            (sum, [field, reading]) =>
              sum +
              Number(
                Boolean(reading.value) &&
                  canon((candidate as unknown as Record<string, Reading>)[field]?.value) === canon(reading.value),
              ),
            0,
          );
        return score(b.candidate) - score(a.candidate);
      });
      const found = candidates[0];
      total++;
      if (found) {
        used.add(found.index);
        aligned.push(found.candidate as never);
        if (
          Object.entries(row).every(
            ([field, reading]) =>
              !reading.value ||
              canon((found.candidate as unknown as Record<string, Reading>)[field]?.value) === canon(reading.value),
          )
        )
          correct++;
      } else
        aligned.push(
          Object.fromEntries(
            Object.keys(row).map((field) => [
              field,
              { value: null, sourceText: null, uncertain: false, approximate: false },
            ]),
          ) as never,
        );
    }
    actual.forEach((row, index) => {
      if (!used.has(index)) {
        aligned.push(row as never);
        if (Object.values(row).some((reading) => reading.value)) total++;
      }
    });
    // Extra medicine fields must follow the same matched row, rather than their original output index.
    if (list === "medications")
      copy.extraFields = copy.extraFields.map((extra) => {
        if (extra.entity !== "medicine" || extra.medicationIndex === null) return extra;
        const original = actual[extra.medicationIndex];
        const index = aligned.findIndex((row) => row === original);
        return { ...extra, medicationIndex: index < 0 ? extra.medicationIndex : index };
      });
    (copy[list] as unknown[]) = aligned;
  }
  return { output: copy, correct, total };
}
export function scoreExtractions(
  truths: EvaluationTruth[],
  predictions: EvaluationPrediction[],
  reviewedPageCount: number,
  syntheticOnly = false,
) {
  const byId = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  const counts: Record<string, Count> = {};
  let valid = 0,
    correctEntities = 0,
    totalEntities = 0,
    unreadable = 0,
    abstained = 0,
    docTypes = 0,
    readability = 0;
  const perSample: { id: string; valid: boolean; errors: number }[] = [];
  for (const truth of truths) {
    const prediction = byId.get(truth.id),
      parsed = chatExtractionSchema.safeParse(prediction?.output);
    if (parsed.success) {
      valid++;
      if (parsed.data.documentType === truth.labels.documentType) docTypes++;
      if (parsed.data.readability === truth.labels.readability) readability++;
    }
    const predicted = parsed.success ? align(parsed.data, truth.labels) : null;
    if (predicted) {
      correctEntities += predicted.correct;
      totalEntities += predicted.total;
    } else totalEntities += truth.labels.medications.length + truth.labels.investigations.length;
    const expected = flatten(truth.labels),
      actual = predicted ? flatten(predicted.output) : [];
    const actualMap = new Map(actual.map((field) => [field.key, field]));
    const expectedKeys = new Set(expected.map((field) => field.key));
    let errors = 0;
    const inspect = (field: Flat, proposed: Reading | undefined) => {
      const count = (counts[field.category] ??= empty());
      const value = canon(field.reading.value),
        read = canon(proposed?.value);
      const hasValue = Boolean(value),
        hasRead = Boolean(read);
      if (hasValue) count.support++;
      const proof =
        (hasRead && Boolean(proposed?.sourceText && truth.transcription.includes(proposed.sourceText))) ||
        (field.key === "patient.initials" && field.reading.sourceText === null && hasRead);
      if (
        hasValue &&
        hasRead &&
        value === read &&
        Boolean(field.reading.approximate) === Boolean(proposed?.approximate) &&
        proof
      )
        count.tp++;
      else if (hasValue && hasRead) {
        count.fp++;
        count.fn++;
        errors++;
      } else if (hasValue) {
        count.fn++;
        errors++;
      } else if (hasRead) {
        count.fp++;
        errors++;
      } else count.tn++;
      if (field.reading.uncertain && field.reading.value === null) {
        unreadable++;
        if (!hasRead && proposed?.uncertain) abstained++;
      }
    };
    expected.forEach((field) => inspect(field, actualMap.get(field.key)?.reading));
    actual
      .filter((field) => !expectedKeys.has(field.key))
      .forEach((field) =>
        inspect({ ...field, reading: { value: null, sourceText: null, uncertain: false } }, field.reading),
      );
    perSample.push({ id: truth.id, valid: parsed.success, errors });
  }
  const sum = Object.values(counts).reduce(
    (a, c) => ({ tp: a.tp + c.tp, fp: a.fp + c.fp, fn: a.fn + c.fn, tn: a.tn + c.tn, support: a.support + c.support }),
    empty(),
  );
  const criticalCounts = Object.entries(counts)
    .filter(([key]) => CRITICAL_FIELDS.includes(key as never) || key === "patient.age" || key === "patient.dateOfBirth")
    .map(([, value]) => value);
  const critical = criticalCounts.reduce(
    (a, c) => ({ tp: a.tp + c.tp, fp: a.fp + c.fp, fn: a.fn + c.fn, tn: a.tn + c.tn, support: a.support + c.support }),
    empty(),
  );
  const criticalSupport = Object.fromEntries(
    CRITICAL_FIELDS.map((key) => [
      key,
      key === "patient.age_or_birth"
        ? (counts["patient.age"]?.support ?? 0) + (counts["patient.dateOfBirth"]?.support ?? 0)
        : (counts[key]?.support ?? 0),
    ]),
  );
  const times = predictions.map((p) => p.latencyMs).sort((a, b) => a - b);
  const metrics: z.infer<typeof evaluationMetricsSchema> = {
    sampleCount: truths.length,
    groupCount: new Set(truths.map((t) => t.groupKey)).size,
    reviewedPageCount,
    fieldF1: (2 * sum.tp) / (2 * sum.tp + sum.fp + sum.fn || 1),
    criticalRecall: critical.tp / (critical.tp + critical.fn || 1),
    entityAssociation: totalEntities ? correctEntities / totalEntities : 1,
    falseFillRate: sum.fp / (sum.tp + sum.fp || 1),
    jsonValidity: valid / (truths.length || 1),
    unreadableAbstention: unreadable ? abstained / unreadable : 1,
    p95Ms: times[Math.max(0, Math.ceil(times.length * 0.95) - 1)] ?? 0,
    criticalSupport,
    unreadableSupport: unreadable,
    documentTypeAccuracy: docTypes / (truths.length || 1),
    readabilityAccuracy: readability / (truths.length || 1),
    syntheticOnly,
  };
  return {
    metrics,
    perField: counts,
    perSample,
    documentTypeAccuracy: docTypes / (truths.length || 1),
    readabilityAccuracy: readability / (truths.length || 1),
  };
}

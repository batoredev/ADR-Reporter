// Learning from submitted reports. When a report is submitted, each document the two-step reader read
// becomes one de-identified example: its transcript and the reading as the reporter finally confirmed it.
// A reviewer's approval makes the example training data (scripts/export-learning-examples.ts).
//
// Corrections are taken conservatively, so the reader is never taught something the document does not say:
//  - a reading the reporter used and then changed or removed is corrected;
//  - a medicine's name, batch, manufacturer, dose, route or frequency the reader missed is filled in only
//    when the confirmed value is written in this document's own text;
//  - a correction that cannot be found in the text marks the example not trainable for this step (the photo
//    was misread, or the value came from elsewhere).
import type { Prisma } from "@/generated/prisma/client";
import { toFormValues } from "@/lib/domain/case-form";
import { caseSnapshotInclude } from "@/lib/domain/snapshot";
import { compactSchema, isoDate, type CompactReading } from "@/server/ai/two-step";

export type FieldKind = "text" | "date" | "number" | "enum";
export interface Correction {
  /** Where in the compact reading, e.g. ["medicines", 0, "batch"] or ["gender"]. */
  path: (string | number)[];
  kind: FieldKind;
  change: "CHANGED" | "CLEARED" | "MISSED";
  /** The confirmed value in the report's own form (ISO dates, MALE/FEMALE). */
  final: string | null;
}
export interface AppliedCorrection {
  path: string;
  change: Correction["change"];
  from: string | null;
  to: string | null;
  found: boolean;
}

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
// "22/10/2026", "10/3/00", "20-9-2022" and month-year "02/2028".
const DATE_WRITTEN = /\b\d{1,2}\s*[/.-]\s*(?:\d{4}|\d{1,2}(?:\s*[/.-]\s*\d{2,4})?)\b/g;

/** The confirmed value as this document writes it, or null when the document does not contain it. */
export function writtenForm(transcript: string, kind: FieldKind, final: string): string | null {
  if (kind === "enum") return final;
  if (kind === "date") {
    const us = /\b[A-Z]{2}\s+\d{5}\b/.test(transcript);
    return transcript.match(DATE_WRITTEN)?.find((w) => isoDate(w, us)?.value === final) ?? null;
  }
  if (kind === "number")
    return new RegExp(`(?<![\\d.])${final.replace(".", "\\.")}(?![\\d.])`).test(transcript) ? final : null;
  const wanted = squash(final);
  if (wanted.length < 2) return null;
  for (const line of transcript.split("\n")) {
    const at = squash(line).indexOf(wanted);
    if (at < 0) continue;
    // Return the document's own spelling of the same words.
    const words = line.trim().split(/\s+/);
    const count = wanted.split(" ").length;
    for (let i = 0; i + count <= words.length; i++) {
      const piece = words.slice(i, i + count).join(" ");
      if (squash(piece) === wanted) return piece;
    }
    return final;
  }
  return null;
}

function same(kind: FieldKind, reading: string | null, final: string | null): boolean {
  if (!reading || !final) return !reading && !final;
  if (kind === "date") return isoDate(reading)?.value === final || isoDate(reading, true)?.value === final;
  if (kind === "number") return Number.parseFloat(reading) === Number.parseFloat(final);
  const a = squash(reading);
  const b = squash(final);
  // "Moxikind CV" and "Moxikind CV (amoxicillin+clavulanate)" are the same medicine named two ways.
  return a === b || a.includes(b) || b.includes(a);
}

/** Applies the reporter's confirmed values to a reading; pure, so it can be tested without a database. */
export function correctReading(transcript: string, reading: CompactReading, corrections: Correction[]) {
  const target = structuredClone(reading) as unknown as Record<string, unknown>;
  const applied: AppliedCorrection[] = [];
  let trainable = true;
  for (const c of corrections) {
    const parent = c.path
      .slice(0, -1)
      .reduce<unknown>((o, k) => (o as Record<string | number, unknown>)?.[k], target) as
      Record<string | number, unknown> | undefined;
    const key = c.path[c.path.length - 1];
    if (!parent) continue;
    const from = (parent[key] as string | null) ?? null;
    if (c.change !== "CLEARED" && same(c.kind, from, c.final)) continue;
    const to = c.change === "CLEARED" || !c.final ? null : writtenForm(transcript, c.kind, c.final);
    const found = c.change === "CLEARED" || to !== null;
    applied.push({ path: c.path.join("."), change: c.change, from, to: to ?? c.final, found });
    if (!found) {
      trainable = false;
      continue;
    }
    parent[key] = to;
  }
  const parsed = compactSchema.safeParse(target);
  return {
    target: parsed.success ? parsed.data : reading,
    corrections: applied,
    trainable: trainable && parsed.success,
  };
}

// Report fields a reading fills, by the compact field the reader writes.
const CASE_FIELDS = [
  { compact: "age", form: "ageValue", path: "age", item: "case:patient.age", kind: "number" },
  { compact: "ageUnit", form: "ageUnit", path: "age", item: "case:patient.ageUnit", kind: "enum" },
  { compact: "gender", form: "gender", path: "gender", item: "case:patient.gender", kind: "enum" },
  { compact: "weightKg", form: "weightKg", path: "weightKg", item: "case:patient.weightKg", kind: "number" },
  { compact: "reaction", form: "reactionTerms", path: "reactionTerms", item: "case:reaction.terms", kind: "text" },
  {
    compact: "reactionStartDate",
    form: "reactionStartDate",
    path: "reactionStartDate",
    item: "case:reaction.startDate",
    kind: "date",
  },
  {
    compact: "reactionStopDate",
    form: "reactionStopDate",
    path: "reactionStopDate",
    item: "case:reaction.stopDate",
    kind: "date",
  },
] as const;
const MEDICINE_FIELDS = [
  { compact: "name", form: "name", item: "name", kind: "text", missable: true },
  { compact: "dose", form: "dose", item: "dose", kind: "text", missable: true },
  { compact: "route", form: "route", item: "route", kind: "text", missable: true },
  { compact: "frequency", form: "frequency", item: "frequency", kind: "text", missable: true },
  { compact: "startDate", form: "startDate", item: "startDate", kind: "date", missable: false },
  { compact: "stopDate", form: "stopDate", item: "stopDate", kind: "date", missable: false },
  { compact: "manufacturer", form: "manufacturer", item: "manufacturer", kind: "text", missable: true },
  { compact: "batch", form: "batchLot", item: "batchLot", kind: "text", missable: true },
  { compact: "expiryDate", form: "expiryDate", item: "expiryDate", kind: "date", missable: false },
] as const;
const TEST_FIELDS = [
  { compact: "name", form: "testName", item: "investigation:testName", kind: "text", missable: true },
  { compact: "result", form: "result", item: "investigation:result", kind: "text", missable: true },
  { compact: "date", form: "date", item: "investigation:date", kind: "date", missable: false },
] as const;
const ROW_PATH = /^(suspectedMedicines|concomitantProducts|investigations)\.([^.]+)\.(\w+)$/;

interface LearningMeta {
  textModel: string;
  transcript: string;
  reading: CompactReading;
}
function learningOf(raw: unknown): LearningMeta | null {
  const meta = (raw as { meta?: { learning?: unknown } } | null)?.meta?.learning as Partial<LearningMeta> | undefined;
  if (!meta || typeof meta.transcript !== "string" || typeof meta.textModel !== "string") return null;
  const reading = compactSchema.safeParse(meta.reading);
  return reading.success ? { textModel: meta.textModel, transcript: meta.transcript, reading: reading.data } : null;
}

/**
 * On submission (inside its transaction): one example per document reading, built from what the reporter
 * confirmed. Resubmitting refreshes them. Returns how many were saved.
 */
export async function captureLearningExamples(tx: Prisma.TransactionClient, caseId: string) {
  if (process.env.LEARN_FROM_REPORTS?.trim().toLowerCase() === "off") return 0;
  const runs = await tx.extractionRun.findMany({
    where: { document: { caseId }, status: "SUCCEEDED" },
    select: {
      id: true,
      rawResponse: true,
      items: { select: { id: true, fieldName: true, medicationIndex: true, status: true } },
    },
  });
  const readable = runs.flatMap((run) => {
    const learning = learningOf(run.rawResponse);
    return learning ? [{ run, learning }] : [];
  });
  if (!readable.length) return 0;
  const [record, provenance] = await Promise.all([
    tx.adrCase.findUniqueOrThrow({ where: { id: caseId }, include: caseSnapshotInclude }),
    tx.fieldProvenance.findMany({
      where: { caseId },
      select: {
        fieldPath: true,
        source: true,
        extractedItem: { select: { runId: true, medicationIndex: true } },
      },
    }),
  ]);
  const values = toFormValues(record);
  const byPath = new Map(provenance.map((p) => [p.fieldPath, p]));
  const rowsByKey = {
    suspectedMedicines: new Map(values.suspectedMedicines.map((r) => [r.id, r as Record<string, unknown>])),
    concomitantProducts: new Map(values.concomitantProducts.map((r) => [r.id, r as Record<string, unknown>])),
    investigations: new Map(values.investigations.map((r) => [r.id, r as Record<string, unknown>])),
  };
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

  let saved = 0;
  for (const { run, learning } of readable) {
    const used = (fieldName: string, index: number) =>
      run.items.some(
        (i) => i.fieldName === fieldName && i.medicationIndex === index && ["ACCEPTED", "EDITED"].includes(i.status),
      );
    const rejected = (fieldName: string, index: number) =>
      run.items.some((i) => i.fieldName === fieldName && i.medicationIndex === index && i.status === "REJECTED");
    const sourceOf = (path: string) => {
      const p = byPath.get(path);
      if (!p || p.source === "USER_ENTERED") return "PERSON" as const;
      return p.extractedItem?.runId === run.id ? ("THIS" as const) : ("OTHER" as const);
    };
    const corrections: Correction[] = [];
    const consider = (
      path: (string | number)[],
      field: { kind: FieldKind; item: string; missable?: boolean },
      index: number,
      fieldPath: string,
      reading: string | null,
      final: string | null,
    ) => {
      const source = sourceOf(fieldPath);
      if (source === "THIS" || source === "OTHER") return;
      if (used(field.item, index) || rejected(field.item, index)) {
        // The reporter used this reading and then changed or removed it.
        corrections.push({
          path,
          kind: field.kind,
          change: final && !rejected(field.item, index) ? "CHANGED" : "CLEARED",
          final,
        });
      } else if (!reading && final && field.missable) {
        corrections.push({ path, kind: field.kind, change: "MISSED", final });
      }
    };

    for (const f of CASE_FIELDS)
      if (learning.reading[f.compact] !== null)
        consider([f.compact], f, 0, f.path, learning.reading[f.compact], text(values[f.form]));

    // Rows this reading filled: any field of the row still traced to this reading.
    const linked = new Map<string, { list: keyof typeof rowsByKey; id: string; index: number }>();
    for (const p of provenance) {
      const m = p.fieldPath.match(ROW_PATH);
      if (!m || p.extractedItem?.runId !== run.id) continue;
      linked.set(`${m[1]}.${m[2]}`, {
        list: m[1] as keyof typeof rowsByKey,
        id: m[2],
        index: p.extractedItem.medicationIndex,
      });
    }
    for (const [rowKey, { list, id, index }] of linked) {
      const row = rowsByKey[list].get(id);
      if (!row) continue;
      if (list === "investigations") {
        const test = learning.reading.tests[index];
        if (!test) continue;
        for (const f of TEST_FIELDS)
          consider(["tests", index, f.compact], f, index, `${rowKey}.${f.form}`, test[f.compact], text(row[f.form]));
        continue;
      }
      const medicine = learning.reading.medicines[index];
      if (!medicine) continue;
      for (const f of MEDICINE_FIELDS) {
        if (!(f.form in row)) continue; // a concomitant row has no batch, manufacturer or expiry
        consider(
          ["medicines", index, f.compact],
          f,
          index,
          `${rowKey}.${f.form}`,
          medicine[f.compact],
          text(row[f.form]),
        );
      }
    }

    const result = correctReading(learning.transcript, learning.reading, corrections);
    const data = {
      documentType: learning.reading.documentType,
      textModel: learning.textModel,
      transcript: learning.transcript,
      reading: learning.reading as unknown as Prisma.InputJsonValue,
      target: result.target as unknown as Prisma.InputJsonValue,
      corrections: result.corrections as unknown as Prisma.InputJsonValue,
      trainable: result.trainable,
      status: "SUBMITTED" as const,
    };
    await tx.learningExample.upsert({
      where: { runId: run.id },
      create: { caseId, runId: run.id, ...data },
      update: data,
    });
    saved++;
  }
  return saved;
}

/** A reviewer's decision: an approved report's examples become training data; a returned one waits again. */
export async function setLearningStatus(tx: Prisma.TransactionClient, caseId: string, approved: boolean) {
  await tx.learningExample.updateMany({
    where: { caseId, status: { not: "EXCLUDED" } },
    data: { status: approved ? "APPROVED" : "SUBMITTED" },
  });
}

import "server-only";
import { z } from "zod";
import type { AgeUnit, Gender, Prisma } from "@/generated/prisma/client";
import {
  DATE_FIELDS,
  documentExtractionSchema,
  EXTRACTED_FIELD_LABELS,
  EXTRACTION_INSTRUCTIONS,
  FILLABLE,
  INVESTIGATION_FIELD_LABELS,
  normalizeSingle,
  SINGLE_FIELD_ORDER,
  SINGLE_FIELDS,
  singleFieldProblem,
  singleValue,
  type DocumentExtraction,
  type DocumentType,
  type ExtractedField,
  type InvestigationField,
  type SingleField,
} from "@/lib/domain/extraction";
import { patientInitialsMatch, qualityKey, reviewExtraction } from "@/lib/domain/extraction-quality";
import { isValidPartialDate } from "@/lib/domain/partial-date";
import { AiError, AiUnavailableError, generateWithFallback, type AiAttempt } from "@/server/ai/provider";
import type { DocumentMimeType } from "@/server/ai/types";
import { writeAudit } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { readStoredFile, saveFile, sniffType } from "@/server/storage";
import { loadCase, lockCase } from "./cases";
import { WorkflowError } from "./errors";

const MAX_BYTES = 10 * 1024 * 1024;

export async function uploadDocument(user: CurrentUser, caseId: string, file: File | null) {
  if (!file || file.size === 0) throw new WorkflowError("Choose a file to upload.");
  if (file.size > MAX_BYTES) throw new WorkflowError("The file is larger than 10 MB.");
  const { c, access } = await loadCase(user, caseId);
  if (!access.edit)
    throw new WorkflowError("Documents can only be added while the report is being edited.", "FORBIDDEN");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffType(bytes);
  if (!type) throw new WorkflowError("Only JPG, PNG or PDF files are accepted.");
  const stored = await saveFile("uploads", type.extension, bytes);
  const name = (file.name || `document.${type.extension}`).replace(/[^\w.\- ()]/g, "_").slice(0, 120);
  const doc = await db.uploadedDocument.create({
    data: {
      caseId: c.id,
      uploadedById: user.id,
      originalName: name,
      mimeType: type.mimeType,
      sizeBytes: bytes.length,
      sha256: stored.sha256,
      storageKey: stored.key,
    },
    select: { id: true, originalName: true, mimeType: true, createdAt: true },
  });
  await writeAudit({
    institutionId: user.institutionId,
    actorId: user.id,
    caseId: c.id,
    action: "DOCUMENT_UPLOADED",
    details: { documentId: doc.id, name, mimeType: type.mimeType, sizeBytes: bytes.length },
  });
  return { id: doc.id, name: doc.originalName, mimeType: doc.mimeType, uploadedAt: doc.createdAt.toISOString() };
}

export interface ProposedValue {
  itemId: string;
  value: string | null;
  sourceText: string | null;
  uncertain: boolean;
  approximate: boolean;
  sourcePage: number | null;
  warnings: string[];
}

export interface ExtractionView {
  runId: string;
  lockVersion: number;
  documentId: string;
  provider: string;
  model: string;
  /** Free providers tried first that could not answer. */
  attempts: AiAttempt[];
  documentType: DocumentType;
  notes: string | null;
  readability: DocumentExtraction["readability"];
  patientMatch: "MATCH" | "DIFFERENT" | "UNKNOWN";
  reportInitials: string | null;
  documentInitials: string | null;
  /** Case-level values (patient, reaction, history) with what the report holds now. */
  singles: { field: SingleField; proposal: ProposedValue; current: string | null }[];
  investigations: { index: number; fields: Record<InvestigationField, ProposedValue> }[];
  medications: { index: number; fields: Partial<Record<ExtractedField, ProposedValue>> }[];
}

const SINGLE_PREFIX = "case:";
const INVESTIGATION_PREFIX = "investigation:";

type CaseRow = Awaited<ReturnType<typeof loadCase>>["c"];

/** What the report currently holds for a single field, as text. */
function currentValue(c: CaseRow, field: SingleField): string | null {
  const v = {
    "patient.initials": c.patientInitials,
    "patient.age": c.ageValue === null ? null : String(c.ageValue),
    "patient.ageUnit": c.ageUnit,
    "patient.gender": c.gender,
    "patient.weightKg": c.weightKg === null ? null : String(c.weightKg),
    "reaction.terms": c.reactionTerms,
    "reaction.startDate": c.reactionStartDate,
    "reaction.stopDate": c.reactionStopDate,
    "reaction.description": c.reactionDescription,
    "reaction.management": c.reactionManagement,
    medicalHistory: c.medicalHistory,
  }[field];
  return v === null || v === "" ? null : v;
}

export async function runExtraction(user: CurrentUser, caseId: string, documentId: string): Promise<ExtractionView> {
  const { c, access } = await loadCase(user, caseId);
  if (!access.edit)
    throw new WorkflowError("Extraction is only available while the report is being edited.", "FORBIDDEN");
  const doc = await db.uploadedDocument.findFirst({ where: { id: documentId, caseId: c.id } });
  if (!doc) throw new WorkflowError("Document not found.", "NOT_FOUND");

  const startedAt = new Date();
  const bytes = await readStoredFile(doc.storageKey);
  let outcome;
  try {
    outcome = await generateWithFallback({
      task: "extract-document",
      system: EXTRACTION_INSTRUCTIONS,
      prompt: "Read this document and extract what it says.",
      document: { bytes: new Uint8Array(bytes), mimeType: doc.mimeType as DocumentMimeType },
      schema: documentExtractionSchema,
      maxOutputTokens: 16000,
      validateOutput: (output) => {
        if (output.readability === "UNREADABLE")
          throw new AiError(
            "The document could not be read reliably. Upload a clearer image or PDF, or enter details manually.",
          );
      },
    });
  } catch (error) {
    const message =
      error instanceof AiError ? error.message : "The extraction failed unexpectedly. Nothing was filled in.";
    const attempts = error instanceof AiUnavailableError ? error.attempts : [];
    const last = attempts.at(-1);
    await db.extractionRun.create({
      data: {
        documentId: doc.id,
        requestedById: user.id,
        provider: last?.provider ?? "none",
        model: last?.model ?? "none",
        status: attempts.length ? "FAILED" : "UNAVAILABLE",
        startedAt,
        completedAt: new Date(),
        errorMessage: message,
        rawResponse: { attempts } as unknown as Prisma.InputJsonValue,
      },
    });
    await writeAudit({
      institutionId: user.institutionId,
      actorId: user.id,
      caseId: c.id,
      action: "EXTRACTION_RUN",
      details: { documentId: doc.id, status: "FAILED", attempts },
    });
    if (!(error instanceof AiError)) console.error("Extraction failed", error);
    throw new WorkflowError(message);
  }

  if (outcome.output.readability === "UNREADABLE")
    throw new WorkflowError("The document could not be read reliably. Upload a clearer copy.");
  const { output, issues } = reviewExtraction(outcome.output);
  const run = await db.extractionRun.create({
    data: {
      documentId: doc.id,
      requestedById: user.id,
      provider: outcome.provider,
      model: outcome.model,
      status: "SUCCEEDED",
      startedAt,
      completedAt: new Date(),
      rawResponse: {
        output,
        originalOutput: outcome.output,
        qualityIssues: issues,
        meta: outcome.meta,
        attempts: outcome.attempts,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  // One row per proposed value, so each decision (accepted, edited, rejected) is recorded.
  const rows: Prisma.ExtractedItemCreateManyInput[] = [];
  for (const field of SINGLE_FIELD_ORDER) {
    const p = singleValue(output, field);
    const value = normalizeSingle(SINGLE_FIELDS[field].kind, p.value);
    if (value === null) continue;
    rows.push({
      runId: run.id,
      medicationIndex: 0,
      fieldName: `${SINGLE_PREFIX}${field}`,
      proposedValue: value,
      sourceText: p.sourceText,
      uncertain: p.uncertain,
    });
  }
  output.investigations.forEach((inv, index) => {
    for (const field of Object.keys(INVESTIGATION_FIELD_LABELS) as InvestigationField[]) {
      rows.push({
        runId: run.id,
        medicationIndex: index,
        fieldName: `${INVESTIGATION_PREFIX}${field}`,
        proposedValue: inv[field].value,
        sourceText: inv[field].sourceText,
        uncertain: inv[field].uncertain,
      });
    }
  });
  output.medications.forEach((medication, index) => {
    for (const field of Object.keys(EXTRACTED_FIELD_LABELS) as ExtractedField[]) {
      rows.push({
        runId: run.id,
        medicationIndex: index,
        fieldName: field,
        proposedValue: medication[field].value,
        sourceText: medication[field].sourceText,
        uncertain: medication[field].uncertain,
      });
    }
  });
  if (rows.length)
    await db.extractedItem.createManyAndReturn({
      data: rows,
      select: {
        id: true,
        fieldName: true,
        medicationIndex: true,
        proposedValue: true,
        sourceText: true,
        uncertain: true,
      },
    });

  const view = await getExtraction(user, caseId, run.id);

  await writeAudit({
    institutionId: user.institutionId,
    actorId: user.id,
    caseId: c.id,
    action: "EXTRACTION_RUN",
    details: {
      runId: run.id,
      status: "SUCCEEDED",
      provider: outcome.provider,
      model: outcome.model,
      documentType: output.documentType,
      values: view.singles.length,
      investigations: output.investigations.length,
      medications: output.medications.length,
      attempts: outcome.attempts,
    },
  });
  return view;
}

/** Resume a persisted extraction with fresh current values; no provider call. */
export async function getExtraction(user: CurrentUser, caseId: string, runId: string): Promise<ExtractionView> {
  const { c, access } = await loadCase(user, caseId);
  if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
  const run = await db.extractionRun.findFirst({
    where: { id: runId, document: { caseId }, status: "SUCCEEDED" },
    include: { items: true },
  });
  if (!run) throw new WorkflowError("This extraction was not found.", "NOT_FOUND");
  if (run.items.some((i) => i.status !== "PENDING"))
    throw new WorkflowError("These suggestions were already decided.", "CONFLICT");
  const raw = run.rawResponse as unknown as { output: DocumentExtraction; attempts?: AiAttempt[] };
  const parsedOutput = documentExtractionSchema.safeParse(raw.output);
  if (!parsedOutput.success)
    throw new WorkflowError("This saved extraction uses an older format. Read the document with AI again.");
  const { output, issues } = reviewExtraction(parsedOutput.data);
  const detailsFor = (i: (typeof run.items)[number]) => {
    if (i.fieldName.startsWith(SINGLE_PREFIX))
      return singleValue(output, i.fieldName.slice(SINGLE_PREFIX.length) as SingleField);
    if (i.fieldName.startsWith(INVESTIGATION_PREFIX))
      return output.investigations[i.medicationIndex]?.[
        i.fieldName.slice(INVESTIGATION_PREFIX.length) as InvestigationField
      ];
    return output.medications[i.medicationIndex]?.[i.fieldName as ExtractedField];
  };
  const proposal = (i: (typeof run.items)[number]): ProposedValue => ({
    itemId: i.id,
    value: i.proposedValue,
    sourceText: i.sourceText,
    uncertain: i.uncertain || Boolean(detailsFor(i)?.uncertain),
    sourcePage: detailsFor(i)?.sourcePage ?? null,
    warnings: issues
      .filter((p) => qualityKey(p.fieldName, p.index) === qualityKey(i.fieldName, i.medicationIndex))
      .map((p) => p.message),
    approximate: Boolean(
      i.fieldName.startsWith(SINGLE_PREFIX)
        ? singleValue(output, i.fieldName.slice(SINGLE_PREFIX.length) as SingleField)?.approximate
        : i.fieldName.startsWith(INVESTIGATION_PREFIX)
          ? output.investigations[i.medicationIndex]?.[
              i.fieldName.slice(INVESTIGATION_PREFIX.length) as InvestigationField
            ]?.approximate
          : output.medications[i.medicationIndex]?.[i.fieldName as ExtractedField]?.approximate,
    ),
  });
  const view: ExtractionView = {
    runId: run.id,
    lockVersion: c.lockVersion,
    documentId: run.documentId,
    provider: run.provider,
    model: run.model,
    attempts: raw.attempts ?? [],
    documentType: output.documentType,
    notes: output.documentNotes,
    readability: output.readability,
    patientMatch: patientInitialsMatch(c.patientInitials, output.patient.initials.value),
    reportInitials: c.patientInitials,
    documentInitials: output.patient.initials.value,
    singles: [],
    investigations: [],
    medications: [],
  };
  for (const item of run.items) {
    if (item.fieldName.startsWith(SINGLE_PREFIX)) {
      const field = item.fieldName.slice(SINGLE_PREFIX.length) as SingleField;
      view.singles.push({ field, proposal: proposal(item), current: currentValue(c, field) });
    } else if (item.fieldName.startsWith(INVESTIGATION_PREFIX)) {
      const field = item.fieldName.slice(INVESTIGATION_PREFIX.length) as InvestigationField;
      let row = view.investigations.find((r) => r.index === item.medicationIndex);
      if (!row) {
        row = { index: item.medicationIndex, fields: {} as Record<InvestigationField, ProposedValue> };
        view.investigations.push(row);
      }
      row.fields[field] = proposal(item);
    } else {
      let row = view.medications.find((r) => r.index === item.medicationIndex);
      if (!row) {
        row = { index: item.medicationIndex, fields: {} };
        view.medications.push(row);
      }
      row.fields[item.fieldName as ExtractedField] = proposal(item);
    }
  }
  view.investigations.sort((a, b) => a.index - b.index);
  view.medications.sort((a, b) => a.index - b.index);

  return view;
}

export async function pendingExtractions(user: CurrentUser, caseId: string) {
  const { access } = await loadCase(user, caseId);
  if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
  return db.extractionRun.findMany({
    where: {
      document: { caseId },
      status: "SUCCEEDED",
      items: { some: { status: "PENDING" }, every: { status: "PENDING" } },
    },
    orderBy: { startedAt: "desc" },
    take: 20,
    select: { id: true, document: { select: { originalName: true } } },
  });
}

export async function discardExtraction(user: CurrentUser, caseId: string, runId: string) {
  return db.$transaction(async (tx) => {
    const { access } = await lockCase(user, caseId, tx);
    if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
    const run = await tx.extractionRun.findFirst({ where: { id: runId, document: { caseId } } });
    if (!run) throw new WorkflowError("This extraction was not found.", "NOT_FOUND");
    await tx.extractedItem.updateMany({
      where: { runId, status: "PENDING" },
      data: { status: "REJECTED", decidedById: user.id, decidedAt: new Date() },
    });
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId,
        action: "EXTRACTION_DISCARDED",
        details: { runId },
      },
      tx,
    );
    return null;
  });
}

const choiceSchema = z.object({
  itemId: z.string(),
  use: z.boolean(),
  value: z.string().max(4000),
  confirmedUncertain: z.boolean(),
  approximate: z.boolean().default(false),
});

const applySchema = z.object({
  lockVersion: z.number().int().min(0),
  verifiedAgainstSource: z.boolean().default(false),
  confirmedPatientMatch: z.boolean().default(false),
  singles: z.array(choiceSchema.extend({ mode: z.enum(["replace", "append"]).default("replace") })).default([]),
  investigations: z
    .array(z.object({ index: z.number().int().min(0), add: z.boolean(), fields: z.array(choiceSchema) }))
    .default([]),
  medications: z
    .array(
      z.object({
        index: z.number().int().min(0),
        target: z.enum(["SUSPECTED", "CONCOMITANT", "SKIP"]),
        fields: z.array(choiceSchema),
      }),
    )
    .default([]),
});

export type ApplyInput = z.input<typeof applySchema>;

type ItemRow = {
  id: string;
  fieldName: string;
  medicationIndex: number;
  uncertain: boolean;
  proposedValue: string | null;
};

function checkChoice(item: ItemRow, label: string, value: string, confirmedUncertain: boolean) {
  if (!value) throw new WorkflowError(`${label} is empty; untick it or enter a value.`);
  if (item.uncertain && !confirmedUncertain)
    throw new WorkflowError(`Confirm that you checked the unclear ${label.toLowerCase()} against the document.`);
}

export async function applyExtraction(user: CurrentUser, caseId: string, runId: string, input: unknown) {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError("The choices could not be read. Reload and try again.");
  if (!parsed.data.verifiedAgainstSource)
    throw new WorkflowError("Verify the selected values against the source document before adding them.");
  return db.$transaction(
    async (tx) => {
      const { c, access } = await lockCase(user, caseId, tx);
      if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "CONFLICT");
      if (c.lockVersion !== parsed.data.lockVersion)
        throw new WorkflowError(
          "The report changed since these suggestions were displayed. Reload saved suggestions and review the current values.",
          "CONFLICT",
        );
      const run = await tx.extractionRun.findFirst({
        where: { id: runId, status: "SUCCEEDED", document: { caseId: c.id } },
        include: { items: true },
      });
      if (!run) throw new WorkflowError("This extraction was not found.", "NOT_FOUND");
      const raw = run.rawResponse as unknown as { output?: unknown };
      const parsedOutput = documentExtractionSchema.safeParse(raw?.output);
      if (!parsedOutput.success)
        throw new WorkflowError("Read the document again; its saved extraction uses an older format.");
      const reviewed = reviewExtraction(parsedOutput.data);
      if (reviewed.output.readability === "UNREADABLE")
        throw new WorkflowError("Unreadable documents cannot populate a report. Upload a clearer copy.");
      if (
        patientInitialsMatch(c.patientInitials, reviewed.output.patient.initials.value) === "DIFFERENT" &&
        !parsed.data.confirmedPatientMatch
      )
        throw new WorkflowError(
          "The document and report have different patient initials. Verify that the document belongs to this report first.",
        );
      const flagged = new Set(reviewed.issues.map((p) => qualityKey(p.fieldName, p.index)));
      run.items.forEach((i) => {
        if (flagged.has(qualityKey(i.fieldName, i.medicationIndex))) i.uncertain = true;
      });
      if (run.items.some((i) => i.status !== "PENDING"))
        throw new WorkflowError("These suggestions were already used.", "CONFLICT");
      const ids = [
        ...parsed.data.singles,
        ...parsed.data.investigations.flatMap((i) => i.fields),
        ...parsed.data.medications.flatMap((m) => m.fields),
      ].map((i) => i.itemId);
      if (new Set(ids).size !== ids.length) throw new WorkflowError("A suggestion was supplied more than once.");
      const items = new Map(run.items.map((i) => [i.id, i]));
      const lookup = (itemId: string) => {
        const item = items.get(itemId);
        if (!item) throw new WorkflowError("A suggestion did not match this extraction.");
        return item;
      };
      const now = new Date();
      const decisions: {
        item: ItemRow;
        used: boolean;
        finalValue: string | null;
        target: string | null;
        rowId: string | null;
      }[] = [];
      const provenance: { fieldPath: string; itemId: string }[] = [];

      // --- Case-level values (patient, reaction, history) ---
      const caseData: Prisma.AdrCaseUpdateInput = {};
      const clearedUnknown = new Set<string>();
      let filled = 0;
      for (const choice of parsed.data.singles) {
        const item = lookup(choice.itemId);
        if (!item.fieldName.startsWith(SINGLE_PREFIX))
          throw new WorkflowError("A suggestion did not match this extraction.");
        const field = item.fieldName.slice(SINGLE_PREFIX.length) as SingleField;
        const spec = SINGLE_FIELDS[field];
        const value = choice.value.trim();
        if (!choice.use) {
          decisions.push({ item, used: false, finalValue: null, target: null, rowId: null });
          continue;
        }
        checkChoice(item, spec.label, value, choice.confirmedUncertain);
        const problem = singleFieldProblem(spec.kind, value, isValidPartialDate);
        if (problem) throw new WorkflowError(`${spec.label}: ${problem}`);
        const append = (current: string | null) => {
          const next = choice.mode === "append" && current ? `${current}\n\n${value}` : value;
          if (next.length > 4000) throw new WorkflowError(`${spec.label} would be longer than 4000 characters.`);
          return next;
        };
        switch (field) {
          case "patient.initials":
            caseData.patientInitials = value;
            break;
          case "patient.age":
            caseData.ageValue = Number(value);
            break;
          case "patient.ageUnit":
            caseData.ageUnit = value as AgeUnit;
            break;
          case "patient.gender":
            caseData.gender = value as Gender;
            clearedUnknown.add("gender");
            break;
          case "patient.weightKg":
            caseData.weightKg = Number(value);
            clearedUnknown.add("weightKg");
            break;
          case "reaction.terms":
            caseData.reactionTerms = value;
            break;
          case "reaction.startDate":
            caseData.reactionStartDate = value;
            caseData.reactionStartDateApprox = choice.approximate;
            break;
          case "reaction.stopDate":
            caseData.reactionStopDate = value;
            caseData.reactionStopDateApprox = choice.approximate;
            caseData.reactionOngoing = false;
            clearedUnknown.add("reactionStopDate");
            break;
          case "reaction.description":
            caseData.reactionDescription = append(c.reactionDescription);
            break;
          case "reaction.management":
            caseData.reactionManagement = append(c.reactionManagement);
            break;
          case "medicalHistory":
            caseData.medicalHistory = append(c.medicalHistory);
            clearedUnknown.add("medicalHistory");
            break;
        }
        filled += 1;
        decisions.push({ item, used: true, finalValue: value, target: "CASE", rowId: null });
        provenance.push({ fieldPath: spec.path, itemId: item.id });
      }
      if (clearedUnknown.size) caseData.unknownFields = c.unknownFields.filter((f) => !clearedUnknown.has(f));

      // --- Investigations ---
      let investigationsAdded = 0;
      let investigationCount = c.investigations.length;
      for (const inv of parsed.data.investigations) {
        const decided = inv.fields.map((f) => {
          const item = lookup(f.itemId);
          if (!item.fieldName.startsWith(INVESTIGATION_PREFIX) || item.medicationIndex !== inv.index)
            throw new WorkflowError("A suggestion did not match this extraction.");
          return { f, item, field: item.fieldName.slice(INVESTIGATION_PREFIX.length) as InvestigationField };
        });
        const used = inv.add ? decided.filter((d) => d.f.use) : [];
        for (const { f, item, field } of used) {
          checkChoice(item, INVESTIGATION_FIELD_LABELS[field], f.value.trim(), f.confirmedUncertain);
          if (field === "date" && !isValidPartialDate(f.value.trim()))
            throw new WorkflowError("A test date must be a date like 2026-10-12, 2026-10 or 2026.");
          if (field !== "date" && f.value.trim().length > (field === "testName" ? 200 : 300))
            throw new WorkflowError(`A test ${field === "testName" ? "name" : "result"} is too long.`);
        }
        let rowId: string | null = null;
        if (used.length) {
          const value = (field: InvestigationField) => used.find((u) => u.field === field)?.f.value.trim() ?? null;
          if (!value("testName") && !value("result"))
            throw new WorkflowError("Each test you add needs its name or result ticked.");
          if (investigationCount >= 20) throw new WorkflowError("A report can hold at most 20 investigations.");
          rowId = (
            await tx.investigation.create({
              data: {
                caseId: c.id,
                position: investigationCount,
                testName: value("testName"),
                result: value("result"),
                date: value("date"),
                dateApprox: used.find((u) => u.field === "date")?.f.approximate ?? false,
              },
              select: { id: true },
            })
          ).id;
          investigationCount += 1;
          investigationsAdded += 1;
        }
        for (const { f, item, field } of decided) {
          const isUsed = rowId !== null && used.some((u) => u.item.id === item.id);
          decisions.push({
            item,
            used: isUsed,
            finalValue: isUsed ? f.value.trim() : null,
            target: "INVESTIGATION",
            rowId,
          });
          if (isUsed && rowId) provenance.push({ fieldPath: `investigations.${rowId}.${field}`, itemId: item.id });
        }
      }

      // --- Medicines ---
      let medicinesAdded = 0;
      const counts = { SUSPECTED: c.suspectedMedicines.length, CONCOMITANT: c.concomitantProducts.length };
      for (const med of parsed.data.medications) {
        const decided = med.fields.map((f) => {
          const item = lookup(f.itemId);
          if (item.medicationIndex !== med.index || item.fieldName.includes(":"))
            throw new WorkflowError("A suggestion did not match this extraction.");
          return { f, item, field: item.fieldName as ExtractedField };
        });
        const used = med.target === "SKIP" ? [] : decided.filter((d) => d.f.use);
        for (const { f, item, field } of used) {
          if (!FILLABLE[med.target as "SUSPECTED" | "CONCOMITANT"].includes(field))
            throw new WorkflowError(`${EXTRACTED_FIELD_LABELS[field]} cannot be added to this kind of medicine.`);
          checkChoice(item, EXTRACTED_FIELD_LABELS[field], f.value.trim(), f.confirmedUncertain);
          if (f.value.trim().length > (["name", "manufacturer", "indication"].includes(field) ? 200 : 100))
            throw new WorkflowError(`${EXTRACTED_FIELD_LABELS[field]} is too long.`);
          if (DATE_FIELDS.includes(field) && !isValidPartialDate(f.value.trim()))
            throw new WorkflowError(
              `${EXTRACTED_FIELD_LABELS[field]} must be a date like 2026-10-12, 2026-10 or 2026.`,
            );
        }
        let rowId: string | null = null;
        let list: "suspectedMedicines" | "concomitantProducts" | null = null;
        if (used.length) {
          const value = (field: ExtractedField) => used.find((u) => u.field === field)?.f.value.trim() ?? null;
          if (!value("name")) throw new WorkflowError("Each medicine you add needs its name ticked.");
          if (med.target === "SUSPECTED") {
            if (counts.SUSPECTED >= 10) throw new WorkflowError("A report can hold at most 10 suspected medicines.");
            list = "suspectedMedicines";
            rowId = (
              await tx.suspectedMedicine.create({
                data: {
                  caseId: c.id,
                  position: counts.SUSPECTED++,
                  name: value("name"),
                  dose: value("dose"),
                  route: value("route"),
                  frequency: value("frequency"),
                  startDate: value("startDate"),
                  startDateApprox: used.find((u) => u.field === "startDate")?.f.approximate ?? false,
                  stopDate: value("stopDate"),
                  stopDateApprox: used.find((u) => u.field === "stopDate")?.f.approximate ?? false,
                  indication: value("indication"),
                  manufacturer: value("manufacturer"),
                  batchLot: value("batchLot"),
                  expiryDate: value("expiryDate"),
                  expiryDateApprox: used.find((u) => u.field === "expiryDate")?.f.approximate ?? false,
                },
                select: { id: true },
              })
            ).id;
          } else {
            if (counts.CONCOMITANT >= 20) throw new WorkflowError("A report can hold at most 20 concomitant products.");
            list = "concomitantProducts";
            rowId = (
              await tx.concomitantProduct.create({
                data: {
                  caseId: c.id,
                  position: counts.CONCOMITANT++,
                  name: value("name"),
                  dose: value("dose"),
                  route: value("route"),
                  frequency: value("frequency"),
                  startDate: value("startDate"),
                  startDateApprox: used.find((u) => u.field === "startDate")?.f.approximate ?? false,
                  stopDate: value("stopDate"),
                  stopDateApprox: used.find((u) => u.field === "stopDate")?.f.approximate ?? false,
                  indication: value("indication"),
                },
                select: { id: true },
              })
            ).id;
          }
          medicinesAdded += 1;
        }
        for (const { f, item, field } of decided) {
          const isUsed = rowId !== null && used.some((u) => u.item.id === item.id);
          decisions.push({
            item,
            used: isUsed,
            finalValue: isUsed ? f.value.trim() : null,
            target: med.target === "SKIP" ? null : med.target,
            rowId,
          });
          if (isUsed && list && rowId) provenance.push({ fieldPath: `${list}.${rowId}.${field}`, itemId: item.id });
        }
      }

      for (const d of decisions.filter((x) => x.used)) {
        await tx.extractedItem.update({
          where: { id: d.item.id },
          data: {
            uncertain: d.item.uncertain,
            status: d.finalValue === (d.item.proposedValue ?? "") ? "ACCEPTED" : "EDITED",
            finalValue: d.finalValue,
            decidedById: user.id,
            decidedAt: now,
            targetKind: d.target,
            targetRowId: d.rowId,
          },
        });
      }
      for (const p of provenance) {
        const data = {
          source: "DOCUMENT_EXTRACTED" as const,
          documentId: run.documentId,
          extractedItemId: p.itemId,
          verifiedById: user.id,
          verifiedAt: now,
        };
        await tx.fieldProvenance.upsert({
          where: { caseId_fieldPath: { caseId: c.id, fieldPath: p.fieldPath } },
          create: { caseId: c.id, fieldPath: p.fieldPath, ...data },
          update: data,
        });
      }
      // Everything not used, including suggestions the reporter did not send back, counts as rejected.
      await tx.extractedItem.updateMany({
        where: { runId: run.id, status: "PENDING" },
        data: { status: "REJECTED", decidedById: user.id, decidedAt: now },
      });
      await tx.adrCase.update({ where: { id: c.id }, data: { ...caseData, lockVersion: { increment: 1 } } });
      await writeAudit(
        {
          institutionId: user.institutionId,
          actorId: user.id,
          caseId: c.id,
          action: "EXTRACTION_APPLIED",
          details: {
            runId: run.id,
            fieldsFilled: filled,
            investigationsAdded,
            medicinesAdded,
            verifiedAgainstSource: true,
            patientMatch: patientInitialsMatch(c.patientInitials, reviewed.output.patient.initials.value),
            confirmedPatientMatch: parsed.data.confirmedPatientMatch,
            verifiedFields: decisions
              .filter((d) => d.used)
              .map((d) => ({
                itemId: d.item.id,
                finalValue: d.finalValue,
                uncertainReadingVerified: d.item.uncertain,
              })),
          },
        },
        tx,
      );
      return { filled, investigationsAdded, added: medicinesAdded };
    },
    { timeout: 20_000 },
  );
}

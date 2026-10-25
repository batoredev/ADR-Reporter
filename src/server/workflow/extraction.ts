import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import {
  DATE_FIELDS,
  EXTRACTED_FIELD_LABELS,
  FILLABLE,
  type ExtractedField,
  type Extraction,
} from "@/lib/domain/extraction";
import { isValidPartialDate } from "@/lib/domain/partial-date";
import { AiError, getAiProvider, type ExtractionMimeType } from "@/server/ai/provider";
import { writeAudit } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { readStoredFile, saveFile, sniffType } from "@/server/storage";
import { loadCase } from "./cases";
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

export interface ExtractionView {
  runId: string;
  documentId: string;
  provider: string;
  model: string;
  notes: string | null;
  medications: {
    index: number;
    fields: Partial<
      Record<ExtractedField, { itemId: string; value: string | null; sourceText: string | null; uncertain: boolean }>
    >;
  }[];
}

export async function runExtraction(user: CurrentUser, caseId: string, documentId: string): Promise<ExtractionView> {
  const { c, access } = await loadCase(user, caseId);
  if (!access.edit)
    throw new WorkflowError("Extraction is only available while the report is being edited.", "FORBIDDEN");
  const doc = await db.uploadedDocument.findFirst({ where: { id: documentId, caseId: c.id } });
  if (!doc) throw new WorkflowError("Document not found.", "NOT_FOUND");
  const provider = getAiProvider();
  if (!provider) throw new WorkflowError("AI extraction is not configured. Enter the details manually.");

  const run = await db.extractionRun.create({
    data: { documentId: doc.id, requestedById: user.id, provider: provider.name, model: provider.model },
  });
  let output: Extraction;
  try {
    const bytes = await readStoredFile(doc.storageKey);
    const result = await provider.extractMedications({ bytes, mimeType: doc.mimeType as ExtractionMimeType });
    output = result.output;
    await db.extractionRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        completedAt: new Date(),
        rawResponse: { output, meta: result.raw } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    const message =
      error instanceof AiError ? error.message : "The extraction failed unexpectedly. Nothing was filled in.";
    await db.extractionRun.update({
      where: { id: run.id },
      data: { status: "FAILED", completedAt: new Date(), errorMessage: message },
    });
    await writeAudit({
      institutionId: user.institutionId,
      actorId: user.id,
      caseId: c.id,
      action: "EXTRACTION_RUN",
      details: { runId: run.id, status: "FAILED", provider: provider.name, model: provider.model },
    });
    if (!(error instanceof AiError)) console.error("Extraction failed", error);
    throw new WorkflowError(message);
  }

  const view: ExtractionView = {
    runId: run.id,
    documentId: doc.id,
    provider: provider.name,
    model: provider.model,
    notes: output.documentNotes,
    medications: [],
  };
  for (const [index, medication] of output.medications.entries()) {
    const fields: ExtractionView["medications"][number]["fields"] = {};
    for (const field of Object.keys(EXTRACTED_FIELD_LABELS) as ExtractedField[]) {
      const proposal = medication[field];
      const item = await db.extractedItem.create({
        data: {
          runId: run.id,
          medicationIndex: index,
          fieldName: field,
          proposedValue: proposal.value,
          sourceText: proposal.sourceText,
          uncertain: proposal.uncertain,
        },
        select: { id: true },
      });
      fields[field] = {
        itemId: item.id,
        value: proposal.value,
        sourceText: proposal.sourceText,
        uncertain: proposal.uncertain,
      };
    }
    view.medications.push({ index, fields });
  }
  await writeAudit({
    institutionId: user.institutionId,
    actorId: user.id,
    caseId: c.id,
    action: "EXTRACTION_RUN",
    details: {
      runId: run.id,
      status: "SUCCEEDED",
      provider: provider.name,
      model: provider.model,
      medications: output.medications.length,
    },
  });
  return view;
}

const applySchema = z.object({
  medications: z.array(
    z.object({
      index: z.number().int().min(0),
      target: z.enum(["SUSPECTED", "CONCOMITANT", "SKIP"]),
      fields: z.array(
        z.object({
          itemId: z.string(),
          use: z.boolean(),
          value: z.string().max(300),
          confirmedUncertain: z.boolean(),
        }),
      ),
    }),
  ),
});

export type ApplyInput = z.infer<typeof applySchema>;

export async function applyExtraction(user: CurrentUser, caseId: string, runId: string, input: unknown) {
  const parsed = applySchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError("The choices could not be read. Reload and try again.");
  return db.$transaction(async (tx) => {
    const { c, access } = await loadCase(user, caseId, tx);
    if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "CONFLICT");
    const run = await tx.extractionRun.findFirst({
      where: { id: runId, status: "SUCCEEDED", document: { caseId: c.id } },
      include: { items: true },
    });
    if (!run) throw new WorkflowError("This extraction was not found.", "NOT_FOUND");
    if (run.items.some((i) => i.status !== "PENDING"))
      throw new WorkflowError("These suggestions were already used.", "CONFLICT");
    const items = new Map(run.items.map((i) => [i.id, i]));
    const now = new Date();
    let added = 0;

    for (const med of parsed.data.medications) {
      const decided = med.fields.map((f) => {
        const item = items.get(f.itemId);
        if (!item || item.medicationIndex !== med.index)
          throw new WorkflowError("A suggestion did not match this extraction.");
        return { f, item, field: item.fieldName as ExtractedField };
      });
      const used = med.target === "SKIP" ? [] : decided.filter((d) => d.f.use);
      for (const { f, item, field } of used) {
        if (!FILLABLE[med.target as "SUSPECTED" | "CONCOMITANT"].includes(field))
          throw new WorkflowError(`${EXTRACTED_FIELD_LABELS[field]} cannot be added to this kind of medicine.`);
        if (!f.value.trim())
          throw new WorkflowError(`${EXTRACTED_FIELD_LABELS[field]} is empty; untick it or enter a value.`);
        if (item.uncertain && !f.confirmedUncertain)
          throw new WorkflowError(
            `Confirm that you checked the unclear ${EXTRACTED_FIELD_LABELS[field].toLowerCase()} against the document.`,
          );
        if (DATE_FIELDS.includes(field) && !isValidPartialDate(f.value.trim()))
          throw new WorkflowError(`${EXTRACTED_FIELD_LABELS[field]} must be a date like 2026-10-12, 2026-10 or 2026.`);
      }
      let rowId: string | null = null;
      let list: "suspectedMedicines" | "concomitantProducts" | null = null;
      if (used.length) {
        const value = (field: ExtractedField) => used.find((u) => u.field === field)?.f.value.trim() ?? null;
        if (!value("name")) throw new WorkflowError("Each medicine you add needs its name ticked.");
        if (med.target === "SUSPECTED") {
          list = "suspectedMedicines";
          const position = await tx.suspectedMedicine.count({ where: { caseId: c.id } });
          rowId = (
            await tx.suspectedMedicine.create({
              data: {
                caseId: c.id,
                position,
                name: value("name"),
                dose: value("dose"),
                route: value("route"),
                frequency: value("frequency"),
                startDate: value("startDate"),
                indication: value("indication"),
                manufacturer: value("manufacturer"),
                batchLot: value("batchLot"),
                expiryDate: value("expiryDate"),
              },
              select: { id: true },
            })
          ).id;
        } else {
          list = "concomitantProducts";
          const position = await tx.concomitantProduct.count({ where: { caseId: c.id } });
          rowId = (
            await tx.concomitantProduct.create({
              data: {
                caseId: c.id,
                position,
                name: value("name"),
                dose: value("dose"),
                route: value("route"),
                frequency: value("frequency"),
                startDate: value("startDate"),
                indication: value("indication"),
              },
              select: { id: true },
            })
          ).id;
        }
        added += 1;
      }
      for (const { f, item, field } of decided) {
        const isUsed = rowId !== null && used.some((u) => u.item.id === item.id);
        const finalValue = f.value.trim();
        await tx.extractedItem.update({
          where: { id: item.id },
          data: {
            status: !isUsed ? "REJECTED" : finalValue === (item.proposedValue ?? "") ? "ACCEPTED" : "EDITED",
            finalValue: isUsed ? finalValue : null,
            decidedById: user.id,
            decidedAt: now,
            targetKind: med.target === "SKIP" ? null : med.target,
            targetRowId: rowId,
          },
        });
        if (isUsed && list && rowId) {
          const fieldPath = `${list}.${rowId}.${field}`;
          await tx.fieldProvenance.upsert({
            where: { caseId_fieldPath: { caseId: c.id, fieldPath } },
            create: {
              caseId: c.id,
              fieldPath,
              source: "DOCUMENT_EXTRACTED",
              documentId: run.documentId,
              extractedItemId: item.id,
              verifiedById: user.id,
              verifiedAt: now,
            },
            update: {
              source: "DOCUMENT_EXTRACTED",
              documentId: run.documentId,
              extractedItemId: item.id,
              verifiedById: user.id,
              verifiedAt: now,
            },
          });
        }
      }
    }
    // Items for medicines the reporter did not send back count as rejected.
    const sent = new Set(parsed.data.medications.flatMap((m) => m.fields.map((f) => f.itemId)));
    await tx.extractedItem.updateMany({
      where: { runId: run.id, id: { notIn: [...sent] }, status: "PENDING" },
      data: { status: "REJECTED", decidedById: user.id, decidedAt: now },
    });
    await tx.adrCase.update({ where: { id: c.id }, data: { lockVersion: { increment: 1 } } });
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: c.id,
        action: "EXTRACTION_APPLIED",
        details: { runId: run.id, medicinesAdded: added },
      },
      tx,
    );
    return { added };
  });
}

import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import type { Prisma } from "@/generated/prisma/client";
import { canCoordinate, canReview } from "@/lib/domain/access";
import { chatExtractionSchema } from "@/lib/domain/chat-extraction";
import {
  emptyLabelDocument,
  labelFields,
  labelInputSchema,
  setLabelReading,
  validateDocumentLabel,
  stableJson,
  RELEASE_POLICY,
  CRITICAL_FIELDS,
  evaluationMetricsSchema,
  releaseGate,
} from "@/lib/domain/extraction-learning";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { readStoredFile, saveFile, sniffType } from "@/server/storage";
import { writeAudit } from "@/server/audit";
import { WorkflowError } from "./errors";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export const extractionSchemaHash = () => sha(stableJson(z.toJSONSchema(chatExtractionSchema)));
const reviewer = (user: CurrentUser) => {
  if (!canReview(user)) throw new WorkflowError("Document verification is for reviewers.", "FORBIDDEN");
};
const coordinator = (user: CurrentUser) => {
  if (!canCoordinate(user)) throw new WorkflowError("This action needs a coordinator.", "FORBIDDEN");
};
async function lockInstitution(user: CurrentUser, tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM "Institution" WHERE id=${user.institutionId} FOR UPDATE`;
}
async function sharedDocument(
  user: CurrentUser,
  documentId: string,
  client: typeof db | Prisma.TransactionClient = db,
) {
  reviewer(user);
  const document = await client.uploadedDocument.findFirst({
    where: { id: documentId, adrCase: { institutionId: user.institutionId } },
    include: { trainingPermission: true, adrCase: { select: { caseNumber: true, institutionId: true } }, pages: true },
  });
  if (
    !document ||
    (!canCoordinate(user) &&
      (!document.trainingPermission ||
        document.trainingPermission.revokedAt ||
        !(document.trainingPermission.allowedForTraining || document.trainingPermission.allowedForEvaluation)))
  )
    throw new WorkflowError("This document was not found.", "NOT_FOUND");
  return document;
}

export async function learningDocuments(user: CurrentUser) {
  reviewer(user);
  const documents = await db.uploadedDocument.findMany({
    where: {
      adrCase: { institutionId: user.institutionId },
      ...(canCoordinate(user)
        ? {}
        : {
            trainingPermission: { revokedAt: null, OR: [{ allowedForTraining: true }, { allowedForEvaluation: true }] },
          }),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      trainingPermission: true,
      adrCase: { select: { caseNumber: true } },
      labelRevisions: { orderBy: { createdAt: "desc" }, include: { review: true } },
      runs: {
        take: 1,
        orderBy: { startedAt: "desc" },
        include: { items: { select: { status: true, uncertain: true } } },
      },
    },
  });
  return {
    canManage: canCoordinate(user),
    documents: documents
      .map((doc) => ({
        id: doc.id,
        name: doc.originalName,
        caseNumber: doc.adrCase.caseNumber,
        pageCount: doc.pageCount,
        permitted: Boolean(
          doc.trainingPermission &&
          !doc.trainingPermission.revokedAt &&
          (doc.trainingPermission.allowedForTraining || doc.trainingPermission.allowedForEvaluation),
        ),
        reviewedPages: new Set(
          doc.labelRevisions.filter((label) => label.review?.decision === "VERIFIED").map((label) => label.pageNumber),
        ).size,
        attention: doc.runs[0]?.items.filter((item) => item.uncertain || item.status === "EDITED").length ?? 0,
      }))
      .sort((a, b) => b.attention - a.attention),
  };
}

const permissionInput = z.object({
  groupKey: z.string().trim().min(3).max(150),
  fictional: z.literal(true),
  deidentified: z.literal(true),
  allowedForTraining: z.boolean(),
  allowedForEvaluation: z.boolean(),
  reason: z.string().trim().min(10).max(1000),
});
export async function setTrainingPermission(user: CurrentUser, documentId: string, input: unknown) {
  coordinator(user);
  const parsed = permissionInput.safeParse(input);
  if (!parsed.success)
    throw new WorkflowError("Confirm fictional, de-identified data and explain the document-use permission.");
  return db.$transaction(async (tx) => {
    await lockInstitution(user, tx);
    const doc = await sharedDocument(user, documentId, tx),
      body = parsed.data;
    const revoked = !body.allowedForTraining && !body.allowedForEvaluation;
    await tx.documentTrainingPermission.upsert({
      where: { documentId },
      create: { documentId, ...body, grantedById: user.id, revokedAt: revoked ? new Date() : null },
      update: { ...body, grantedById: user.id, revokedAt: revoked ? new Date() : null },
    });
    if (revoked) {
      const active = await tx.extractionDeployment.findUnique({
        where: { institutionId: user.institutionId },
        include: {
          activeModelVersion: {
            include: {
              trainingRun: {
                include: { datasetVersion: { include: { samples: { where: { documentId }, select: { id: true } } } } },
              },
            },
          },
        },
      });
      if (active?.activeModelVersion?.trainingRun.datasetVersion.samples.length) {
        await tx.extractionDeployment.update({
          where: { institutionId: user.institutionId },
          data: { activeModelVersionId: null, revision: { increment: 1 }, updatedById: user.id },
        });
        await writeAudit(
          {
            institutionId: user.institutionId,
            actorId: user.id,
            caseId: doc.caseId,
            action: "EXTRACTION_RELEASE_DISABLED",
            details: {
              modelVersionId: active.activeModelVersionId,
              reason: "A source document's permission was revoked.",
            },
          },
          tx,
        );
      }
    }
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: doc.caseId,
        action: revoked ? "TRAINING_PERMISSION_REVOKED" : "TRAINING_PERMISSION_RECORDED",
        details: {
          documentId,
          groupKey: body.groupKey,
          training: body.allowedForTraining,
          evaluation: body.allowedForEvaluation,
          reason: body.reason,
        },
      },
      tx,
    );
    return { saved: true };
  });
}

export async function learningDocument(user: CurrentUser, documentId: string, pageNumber: number) {
  let doc = await sharedDocument(user, documentId);
  if (doc.mimeType === "application/pdf" && !doc.pages.length) {
    const count = (
      await PDFDocument.load(await readStoredFile(doc.storageKey), { updateMetadata: false })
    ).getPageCount();
    if (count !== doc.pageCount) {
      await db.uploadedDocument.update({ where: { id: doc.id }, data: { pageCount: count } });
      doc = { ...doc, pageCount: count };
    }
  }
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.pageCount)
    throw new WorkflowError("This document page was not found.", "NOT_FOUND");
  const [label, run] = await Promise.all([
    db.documentLabelRevision.findFirst({
      where: { documentId, pageNumber },
      orderBy: { revision: "desc" },
      include: {
        review: { include: { reviewedBy: { select: { name: true } } } },
        labelledBy: { select: { name: true } },
      },
    }),
    db.extractionRun.findFirst({
      where: {
        documentId,
        status: "SUCCEEDED",
        OR: [{ sourcePage: pageNumber }, ...(doc.mimeType !== "application/pdf" ? [{ sourcePage: null }] : [])],
      },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const parsed = chatExtractionSchema.safeParse(
    label?.labels ?? (run?.rawResponse as { output?: unknown } | null)?.output,
  );
  return {
    document: { id: doc.id, name: doc.originalName, mimeType: doc.mimeType, pageCount: doc.pageCount },
    pageNumber,
    prepared: doc.mimeType !== "application/pdf" || doc.pages.some((page) => page.pageNumber === pageNumber),
    permission: doc.trainingPermission,
    canManage: canCoordinate(user),
    canVerify: Boolean(label && label.labelledById !== user.id && !label.review),
    latest: label
      ? {
          id: label.id,
          revision: label.revision,
          labelledBy: label.labelledBy.name,
          review: label.review
            ? { decision: label.review.decision, notes: label.review.notes, reviewedBy: label.review.reviewedBy.name }
            : null,
        }
      : null,
    transcription: label?.transcription ?? "",
    labels: parsed.success ? parsed.data : emptyLabelDocument(),
    reasons: label?.reasons ?? {},
  };
}
export async function learningSource(user: CurrentUser, documentId: string, pageNumber: number) {
  const doc = await sharedDocument(user, documentId);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.pageCount)
    throw new WorkflowError("Page not found.", "NOT_FOUND");
  const page = doc.pages.find((p) => p.pageNumber === pageNumber);
  return {
    bytes: new Uint8Array(await readStoredFile(page?.storageKey ?? doc.storageKey)),
    mimeType: page ? "image/jpeg" : doc.mimeType,
    name: page ? `document-page-${pageNumber}.jpg` : doc.originalName,
  };
}
export async function prepareLearningPage(
  user: CurrentUser,
  documentId: string,
  pageNumber: number,
  upload: File | null,
) {
  const doc = await sharedDocument(user, documentId);
  if (
    !doc.trainingPermission ||
    doc.trainingPermission.revokedAt ||
    !doc.trainingPermission.fictional ||
    !doc.trainingPermission.deidentified
  )
    throw new WorkflowError("Record document-use permission first.");
  if (
    doc.mimeType !== "application/pdf" ||
    !Number.isInteger(pageNumber) ||
    pageNumber < 1 ||
    pageNumber > doc.pageCount ||
    !upload ||
    upload.size > 2 * 1024 * 1024
  )
    throw new WorkflowError("Choose a valid PDF page smaller than 2 MB.");
  const bytes = new Uint8Array(await upload.arrayBuffer());
  if (sniffType(bytes)?.mimeType !== "image/jpeg") throw new WorkflowError("Prepared pages must be JPEG images.");
  return db.$transaction(async (tx) => {
    await lockInstitution(user, tx);
    await sharedDocument(user, documentId, tx);
    const old = await tx.documentPage.findUnique({ where: { documentId_pageNumber: { documentId, pageNumber } } });
    if (old) return { saved: true };
    const stored = await saveFile("uploads", "jpg", bytes, tx);
    await tx.documentPage.create({
      data: { documentId, pageNumber, storageKey: stored.key, sha256: stored.sha256, sizeBytes: bytes.length },
    });
    return { saved: true };
  });
}
export async function saveDocumentLabel(user: CurrentUser, documentId: string, input: unknown) {
  reviewer(user);
  const parsed = labelInputSchema.safeParse(input);
  if (!parsed.success) throw new WorkflowError("Check the page, transcription and field labels before saving.");
  const body = parsed.data,
    errors = validateDocumentLabel(body);
  if (errors.length) throw new WorkflowError(errors.slice(0, 4).join(" "));
  return db.$transaction(async (tx) => {
    await lockInstitution(user, tx);
    const doc = await sharedDocument(user, documentId, tx),
      permission = doc.trainingPermission;
    if (!permission || permission.revokedAt || !permission.fictional || !permission.deidentified)
      throw new WorkflowError("Record permission for this fictional document first.");
    if (
      body.pageNumber > doc.pageCount ||
      (doc.mimeType === "application/pdf" && !doc.pages.some((page) => page.pageNumber === body.pageNumber))
    )
      throw new WorkflowError("Prepare this source page before labelling it.");
    const latest = await tx.documentLabelRevision.findFirst({
      where: { documentId, pageNumber: body.pageNumber },
      orderBy: { revision: "desc" },
      select: { revision: true },
    });
    let labels = body.labels;
    for (const field of labelFields(labels))
      labels = setLabelReading(labels, field.path, { ...field.reading, sourcePage: body.pageNumber });
    const created = await tx.documentLabelRevision.create({
      data: {
        documentId,
        pageNumber: body.pageNumber,
        revision: (latest?.revision ?? 0) + 1,
        labelledById: user.id,
        transcription: body.transcription,
        labels: json(labels),
        reasons: json(body.reasons),
        completePageReviewed: true,
      },
    });
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: doc.caseId,
        action: "DOCUMENT_LABEL_SAVED",
        details: { documentId, pageNumber: body.pageNumber, labelRevisionId: created.id, revision: created.revision },
      },
      tx,
    );
    return { id: created.id };
  });
}
export async function reviewDocumentLabel(user: CurrentUser, labelRevisionId: string, input: unknown) {
  reviewer(user);
  const parsed = z
    .object({ decision: z.enum(["VERIFIED", "REJECTED"]), notes: z.string().trim().min(10).max(2000) })
    .safeParse(input);
  if (!parsed.success) throw new WorkflowError("Record your independent verification and notes.");
  return db.$transaction(async (tx) => {
    await lockInstitution(user, tx);
    const label = await tx.documentLabelRevision.findFirst({
      where: { id: labelRevisionId, document: { adrCase: { institutionId: user.institutionId } } },
      include: { review: true },
    });
    if (!label) throw new WorkflowError("Label revision not found.", "NOT_FOUND");
    await sharedDocument(user, label.documentId, tx);
    if (label.labelledById === user.id)
      throw new WorkflowError("A second reviewer must verify these labels.", "FORBIDDEN");
    if (label.review)
      throw new WorkflowError("This revision was already reviewed. Save a new revision to change it.", "CONFLICT");
    const latest = await tx.documentLabelRevision.findFirst({
      where: { documentId: label.documentId, pageNumber: label.pageNumber },
      orderBy: { revision: "desc" },
      select: { id: true },
    });
    if (latest?.id !== label.id)
      throw new WorkflowError("A newer label revision exists. Review that revision instead.", "CONFLICT");
    await tx.documentLabelReview.create({ data: { labelRevisionId, reviewedById: user.id, ...parsed.data } });
    const doc = await sharedDocument(user, label.documentId, tx);
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: doc.caseId,
        action: "DOCUMENT_LABEL_REVIEWED",
        details: { labelRevisionId, ...parsed.data },
      },
      tx,
    );
    return { saved: true };
  });
}

import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { UPLOAD_LIMITS } from "@/lib/domain/report-chat";
import { toolError } from "@/lib/api/tool-error";
import { db } from "@/server/db";
import { saveFile, sniffType, readStoredFile } from "@/server/storage";
import { activeUserById, type CurrentUser } from "@/server/auth/current-user";
import { writeAudit } from "@/server/audit";
import { lockCase, loadCase } from "./cases";
import { runExtraction } from "./extraction";
import { WorkflowError } from "./errors";

const keySchema = z.string().uuid();
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Bound streamed uploads before multipart parsing, including requests without Content-Length. */
export async function limitedFormData(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new WorkflowError("The upload is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new WorkflowError("Choose files to upload.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new WorkflowError("The upload is too large.");
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return await new Response(body, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new WorkflowError("The upload could not be read. Select your files again.");
  }
}

/** Originals are stored atomically. PDF page preparation can resume independently. */
export async function uploadChatBatch(user: CurrentUser, caseId: string, requestId: string, files: File[]) {
  if (!keySchema.safeParse(requestId).success) throw new WorkflowError("Start a new upload and try again.");
  if (!files.length || files.length > UPLOAD_LIMITS.files) throw new WorkflowError("Choose between 1 and 20 files.");
  if (files.some((f) => !f.size || f.size > UPLOAD_LIMITS.fileBytes))
    throw new WorkflowError("Each file must be non-empty and no larger than 10 MB.");
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  if (totalBytes > UPLOAD_LIMITS.batchBytes) throw new WorkflowError("The batch is larger than 50 MB.");
  const { access } = await loadCase(user, caseId);
  if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
  const prepared: {
    bytes: Uint8Array;
    type: NonNullable<ReturnType<typeof sniffType>>;
    pageCount: number;
    hash: string;
    name: string;
  }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = sniffType(bytes);
    if (!type) throw new WorkflowError("Only JPG, PNG or PDF files are accepted.");
    let pageCount = 1;
    if (type.extension === "pdf") {
      try {
        pageCount = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
      } catch {
        throw new WorkflowError(`${file.name}: this PDF cannot be read. Remove its password or use clear photos.`);
      }
      if (!pageCount || pageCount > UPLOAD_LIMITS.pagesPerPdf)
        throw new WorkflowError("Split PDFs longer than 20 pages into smaller files.");
    }
    prepared.push({
      bytes,
      type,
      pageCount,
      hash: digest(bytes),
      name: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || `document.${type.extension}`,
    });
  }
  if (prepared.reduce((n, f) => n + f.pageCount, 0) > UPLOAD_LIMITS.pagesPerBatch)
    throw new WorkflowError("Split batches longer than 100 pages into smaller batches.");
  const manifest = prepared.map((f) => f.hash);
  return db.$transaction(
    async (tx) => {
      const { c, access } = await lockCase(user, caseId, tx);
      if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "CONFLICT");
      const chat = await tx.reportChat.upsert({ where: { caseId }, create: { caseId }, update: {} });
      const existing = await tx.reportUploadBatch.findUnique({
        where: { chatId_requestId: { chatId: chat.id, requestId } },
      });
      if (existing) {
        if (JSON.stringify(existing.manifest) !== JSON.stringify(manifest))
          throw new WorkflowError("This upload identifier was already used for other files.", "CONFLICT");
        return { batchId: existing.id };
      }
      const batch = await tx.reportUploadBatch.create({ data: { chatId: chat.id, requestId, totalBytes, manifest } });
      for (const file of prepared) {
        let doc = await tx.uploadedDocument.findFirst({ where: { caseId, sha256: file.hash } });
        if (!doc) {
          const stored = await saveFile("uploads", file.type.extension, file.bytes, tx);
          doc = await tx.uploadedDocument.create({
            data: {
              caseId,
              uploadedById: user.id,
              originalName: file.name,
              mimeType: file.type.mimeType,
              sizeBytes: file.bytes.length,
              sha256: stored.sha256,
              storageKey: stored.key,
              pageCount: file.pageCount,
            },
          });
          await writeAudit(
            {
              institutionId: user.institutionId,
              actorId: user.id,
              caseId,
              action: "DOCUMENT_UPLOADED",
              details: { documentId: doc.id, name: doc.originalName, pages: file.pageCount, batchId: batch.id },
            },
            tx,
          );
        } else if (
          doc.pageCount !== file.pageCount &&
          !(await tx.documentExtractionJob.count({ where: { documentId: doc.id } }))
        ) {
          doc = await tx.uploadedDocument.update({ where: { id: doc.id }, data: { pageCount: file.pageCount } });
        }
        for (let pageNumber = 1; pageNumber <= doc.pageCount; pageNumber++) {
          const job = await tx.documentExtractionJob.upsert({
            where: { documentId_pageNumber: { documentId: doc.id, pageNumber } },
            create: {
              caseId: c.id,
              documentId: doc.id,
              pageNumber,
              requestedById: user.id,
              status: doc.mimeType === "application/pdf" ? "WAITING_PAGES" : "QUEUED",
            },
            update: {},
          });
          await tx.reportUploadBatchItem.upsert({
            where: { batchId_jobId: { batchId: batch.id, jobId: job.id } },
            create: { batchId: batch.id, jobId: job.id },
            update: {},
          });
        }
      }
      await tx.reportChat.update({ where: { id: chat.id }, data: { revision: { increment: 1 } } });
      return { batchId: batch.id };
    },
    { timeout: 60_000 },
  );
}

/** Bring documents uploaded in the structured form into the same resumable workflow. */
export async function startReportChatDocuments(user: CurrentUser, caseId: string) {
  const { access } = await loadCase(user, caseId);
  if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
  const documents = await db.uploadedDocument.findMany({ where: { caseId, extractionJobs: { none: {} } } });
  for (const doc of documents) {
    try {
      const bytes = new Uint8Array(await readStoredFile(doc.storageKey));
      await uploadChatBatch(user, caseId, randomUUID(), [new File([bytes], doc.originalName, { type: doc.mimeType })]);
    } catch (error) {
      await db.documentExtractionJob.upsert({
        where: { documentId_pageNumber: { documentId: doc.id, pageNumber: 1 } },
        create: {
          caseId,
          documentId: doc.id,
          pageNumber: 1,
          requestedById: user.id,
          status: "FAILED",
          errorMessage: toolError(error instanceof Error ? error.message : "This document could not be prepared."),
        },
        update: {},
      });
    }
  }
  return { ready: true };
}

export async function uploadPdfPage(
  user: CurrentUser,
  caseId: string,
  documentId: string,
  pageNumber: number,
  file: File | null,
) {
  if (!file || !file.size || file.size > 2 * 1024 * 1024)
    throw new WorkflowError("Each prepared page must be smaller than 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniffType(bytes)?.mimeType !== "image/jpeg") throw new WorkflowError("A prepared page must be a JPEG image.");
  const hash = digest(bytes);
  return db.$transaction(
    async (tx) => {
      const { access } = await lockCase(user, caseId, tx);
      if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
      const doc = await tx.uploadedDocument.findFirst({
        where: { id: documentId, caseId, mimeType: "application/pdf" },
      });
      if (!doc || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.pageCount)
        throw new WorkflowError("This document page was not found.", "NOT_FOUND");
      const existing = await tx.documentPage.findUnique({
        where: { documentId_pageNumber: { documentId, pageNumber } },
      });
      if (existing) {
        if (existing.sha256 !== hash)
          throw new WorkflowError("This page has already been prepared. Reload to use the saved page.", "CONFLICT");
        return { saved: true };
      }
      const stored = await saveFile("uploads", "jpg", bytes, tx);
      await tx.documentPage.create({
        data: { documentId, pageNumber, storageKey: stored.key, sha256: stored.sha256, sizeBytes: bytes.length },
      });
      await tx.documentExtractionJob.updateMany({
        where: { documentId, pageNumber, status: "WAITING_PAGES" },
        data: { status: "QUEUED", nextAttemptAt: new Date() },
      });
      return { saved: true };
    },
    { timeout: 30_000 },
  );
}

export async function retryChatJob(user: CurrentUser, caseId: string, jobId: string) {
  return db.$transaction(async (tx) => {
    const { access } = await lockCase(user, caseId, tx);
    if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
    const result = await tx.documentExtractionJob.updateMany({
      where: { id: jobId, caseId, status: "FAILED" },
      data: {
        status: "QUEUED",
        attempts: 0,
        nextAttemptAt: new Date(),
        errorMessage: null,
        leaseToken: null,
        leaseUntil: null,
      },
    });
    if (!result.count) throw new WorkflowError("This page is already queued or complete.", "CONFLICT");
    return { queued: true };
  });
}

/** One bounded job per invocation; SKIP LOCKED and a lease prevent duplicate workers. */
export async function processChatJob(caseId?: string, user?: CurrentUser) {
  if (user && caseId) {
    const { access } = await loadCase(user, caseId);
    if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
  }
  const token = randomUUID();
  const now = new Date();
  const job = await db.$transaction(async (tx) => {
    // Exhausted leases must become terminal; otherwise a crashed third attempt would stay RUNNING forever.
    await tx.documentExtractionJob.updateMany({
      where: { ...(caseId ? { caseId } : {}), status: "RUNNING", leaseUntil: { lt: now }, attempts: { gte: 3 } },
      data: {
        status: "FAILED",
        leaseUntil: null,
        leaseToken: null,
        errorMessage: "Reading was interrupted. Retry this page.",
      },
    });
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT j.id FROM "DocumentExtractionJob" j JOIN "AdrCase" c ON c.id=j."caseId"
      WHERE (${caseId ?? null}::text IS NULL OR j."caseId"=${caseId ?? null}) AND c.status IN ('DRAFT','RETURNED') AND j.attempts<3
      AND ((j.status='QUEUED' AND j."nextAttemptAt"<=${now}) OR (j.status='RUNNING' AND j."leaseUntil"<${now}))
      ORDER BY j."createdAt",j."pageNumber" FOR UPDATE OF j SKIP LOCKED LIMIT 1`;
    if (!rows[0]) return null;
    return tx.documentExtractionJob.update({
      where: { id: rows[0].id },
      data: {
        status: "RUNNING",
        attempts: { increment: 1 },
        leaseToken: token,
        leaseUntil: new Date(now.getTime() + 180_000),
      },
      include: { document: { select: { mimeType: true } } },
    });
  });
  if (!job) return { processed: false };
  try {
    const actor = await activeUserById(job.requestedById);
    if (!actor) throw new WorkflowError("The upload owner is no longer active.");
    const page =
      job.document.mimeType === "application/pdf"
        ? await db.documentPage.findUnique({
            where: { documentId_pageNumber: { documentId: job.documentId, pageNumber: job.pageNumber } },
          })
        : null;
    if (job.document.mimeType === "application/pdf" && !page)
      throw new WorkflowError("Prepare this PDF page before reading it.");
    const run = await runExtraction(actor, job.caseId, job.documentId, {
      extended: true,
      ...(page
        ? { page: { bytes: new Uint8Array(await readStoredFile(page.storageKey)), pageNumber: job.pageNumber } }
        : {}),
    });
    await db.documentExtractionJob.updateMany({
      where: { id: job.id, leaseToken: token, status: "RUNNING" },
      data: { status: "SUCCEEDED", runId: run.runId, errorMessage: null, leaseToken: null, leaseUntil: null },
    });
  } catch (error) {
    const message = toolError(
      error instanceof WorkflowError
        ? error.message
        : "This page could not be read. Try again or enter the details manually.",
    );
    await db.documentExtractionJob.updateMany({
      where: { id: job.id, leaseToken: token, status: "RUNNING" },
      data: {
        status: job.attempts >= 3 ? "FAILED" : "QUEUED",
        nextAttemptAt: new Date(Date.now() + Math.min(60_000, job.attempts * 15_000)),
        errorMessage: message,
        leaseToken: null,
        leaseUntil: null,
      },
    });
  }
  return { processed: true };
}

export async function processScheduledChatJob(request: Request) {
  const configured = process.env.CHAT_WORKER_SECRET ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(configured),
    b = Buffer.from(supplied);
  if (a.length < 32 || a.length !== b.length || !timingSafeEqual(a, b))
    throw new WorkflowError("Unauthorized.", "UNAUTHORIZED");
  return processChatJob();
}

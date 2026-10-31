-- AlterTable
ALTER TABLE "UploadedDocument" ADD COLUMN     "pageCount" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ExtractionRun" ADD COLUMN     "sourcePage" INTEGER;

-- CreateTable
CREATE TABLE "DocumentPage" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,

    CONSTRAINT "DocumentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportChat" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL DEFAULT '{}',
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportChatMessage" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "requestId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETE',
    "metadata" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentExtractionJob" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL DEFAULT 1,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "runId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentExtractionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportUploadBatch" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "totalBytes" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportUploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportUploadBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,

    CONSTRAINT "ReportUploadBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPage_storageKey_key" ON "DocumentPage"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPage_documentId_pageNumber_key" ON "DocumentPage"("documentId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReportChat_caseId_key" ON "ReportChat"("caseId");

-- CreateIndex
CREATE INDEX "ReportChatMessage_chatId_createdAt_idx" ON "ReportChatMessage"("chatId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReportChatMessage_chatId_requestId_role_key" ON "ReportChatMessage"("chatId", "requestId", "role");

-- CreateIndex
CREATE INDEX "DocumentExtractionJob_status_nextAttemptAt_idx" ON "DocumentExtractionJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "DocumentExtractionJob_caseId_idx" ON "DocumentExtractionJob"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentExtractionJob_documentId_pageNumber_key" ON "DocumentExtractionJob"("documentId", "pageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReportUploadBatch_chatId_requestId_key" ON "ReportUploadBatch"("chatId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportUploadBatchItem_batchId_jobId_key" ON "ReportUploadBatchItem"("batchId", "jobId");

-- AddForeignKey
ALTER TABLE "DocumentPage" ADD CONSTRAINT "DocumentPage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "UploadedDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportChat" ADD CONSTRAINT "ReportChat_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportChatMessage" ADD CONSTRAINT "ReportChatMessage_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "ReportChat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExtractionJob" ADD CONSTRAINT "DocumentExtractionJob_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExtractionJob" ADD CONSTRAINT "DocumentExtractionJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "UploadedDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentExtractionJob" ADD CONSTRAINT "DocumentExtractionJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportUploadBatch" ADD CONSTRAINT "ReportUploadBatch_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "ReportChat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportUploadBatchItem" ADD CONSTRAINT "ReportUploadBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ReportUploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportUploadBatchItem" ADD CONSTRAINT "ReportUploadBatchItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DocumentExtractionJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- These tables are private to the authenticated application API. No Data API policies are granted.
ALTER TABLE "DocumentPage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportChat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportChatMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentExtractionJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportUploadBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportUploadBatchItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UploadedDocument" ADD CONSTRAINT "UploadedDocument_pageCount_check" CHECK ("pageCount" > 0);
ALTER TABLE "DocumentPage" ADD CONSTRAINT "DocumentPage_pageNumber_check" CHECK ("pageNumber" > 0);
ALTER TABLE "DocumentExtractionJob" ADD CONSTRAINT "DocumentExtractionJob_status_check" CHECK (status IN ('WAITING_PAGES','QUEUED','RUNNING','SUCCEEDED','FAILED'));
ALTER TABLE "DocumentExtractionJob" ADD CONSTRAINT "DocumentExtractionJob_attempts_check" CHECK (attempts >= 0 AND "pageNumber" > 0);
ALTER TABLE "ReportChatMessage" ADD CONSTRAINT "ReportChatMessage_role_check" CHECK (role IN ('USER','ASSISTANT','SYSTEM'));
ALTER TABLE "ReportChatMessage" ADD CONSTRAINT "ReportChatMessage_status_check" CHECK (status IN ('PENDING','COMPLETE','FAILED'));

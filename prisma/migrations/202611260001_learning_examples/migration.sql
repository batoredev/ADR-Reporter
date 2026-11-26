-- CreateEnum
CREATE TYPE "LearningStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'EXCLUDED');

-- CreateTable
CREATE TABLE "LearningExample" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "textModel" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "reading" JSONB NOT NULL,
    "target" JSONB NOT NULL,
    "corrections" JSONB NOT NULL,
    "trainable" BOOLEAN NOT NULL,
    "status" "LearningStatus" NOT NULL DEFAULT 'SUBMITTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearningExample_runId_key" ON "LearningExample"("runId");

-- CreateIndex
CREATE INDEX "LearningExample_caseId_idx" ON "LearningExample"("caseId");

-- CreateIndex
CREATE INDEX "LearningExample_status_trainable_idx" ON "LearningExample"("status", "trainable");

-- AddForeignKey
ALTER TABLE "LearningExample" ADD CONSTRAINT "LearningExample_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningExample" ADD CONSTRAINT "LearningExample_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

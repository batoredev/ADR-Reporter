-- CreateTable
CREATE TABLE "DocumentTrainingPermission" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "fictional" BOOLEAN NOT NULL,
    "deidentified" BOOLEAN NOT NULL,
    "allowedForTraining" BOOLEAN NOT NULL DEFAULT false,
    "allowedForEvaluation" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTrainingPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLabelRevision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "labelledById" TEXT NOT NULL,
    "transcription" TEXT NOT NULL,
    "labels" JSONB NOT NULL,
    "reasons" JSONB NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'chat-extraction-v1',
    "completePageReviewed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentLabelRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentLabelReview" (
    "id" TEXT NOT NULL,
    "labelRevisionId" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentLabelReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionDatasetVersion" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionDatasetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionDatasetSample" (
    "id" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "labelRevisionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "split" TEXT NOT NULL,
    "groupKey" TEXT NOT NULL,
    "sourceSha256" TEXT NOT NULL,
    "originalSha256" TEXT NOT NULL,
    "pageStorageKey" TEXT NOT NULL,

    CONSTRAINT "ExtractionDatasetSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionTrainingRun" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "datasetVersionId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "config" JSONB NOT NULL,
    "receipt" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExtractionTrainingRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionModelVersion" (
    "id" TEXT NOT NULL,
    "trainingRunId" TEXT NOT NULL,
    "weightsSha256" TEXT NOT NULL,
    "baseModel" TEXT NOT NULL,
    "baseRevision" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "evaluation" JSONB NOT NULL,
    "gatePassed" BOOLEAN NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionModelVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionDeployment" (
    "institutionId" TEXT NOT NULL,
    "activeModelVersionId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionDeployment_pkey" PRIMARY KEY ("institutionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTrainingPermission_documentId_key" ON "DocumentTrainingPermission"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLabelRevision_documentId_pageNumber_revision_key" ON "DocumentLabelRevision"("documentId", "pageNumber", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentLabelReview_labelRevisionId_key" ON "DocumentLabelReview"("labelRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionDatasetVersion_institutionId_sha256_key" ON "ExtractionDatasetVersion"("institutionId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionDatasetSample_datasetVersionId_labelRevisionId_key" ON "ExtractionDatasetSample"("datasetVersionId", "labelRevisionId");

-- AddForeignKey
ALTER TABLE "DocumentTrainingPermission" ADD CONSTRAINT "DocumentTrainingPermission_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "UploadedDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTrainingPermission" ADD CONSTRAINT "DocumentTrainingPermission_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLabelRevision" ADD CONSTRAINT "DocumentLabelRevision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "UploadedDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLabelRevision" ADD CONSTRAINT "DocumentLabelRevision_labelledById_fkey" FOREIGN KEY ("labelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLabelReview" ADD CONSTRAINT "DocumentLabelReview_labelRevisionId_fkey" FOREIGN KEY ("labelRevisionId") REFERENCES "DocumentLabelRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentLabelReview" ADD CONSTRAINT "DocumentLabelReview_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionDatasetVersion" ADD CONSTRAINT "ExtractionDatasetVersion_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionDatasetVersion" ADD CONSTRAINT "ExtractionDatasetVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionDatasetSample" ADD CONSTRAINT "ExtractionDatasetSample_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "ExtractionDatasetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionDatasetSample" ADD CONSTRAINT "ExtractionDatasetSample_labelRevisionId_fkey" FOREIGN KEY ("labelRevisionId") REFERENCES "DocumentLabelRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionDatasetSample" ADD CONSTRAINT "ExtractionDatasetSample_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "UploadedDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionTrainingRun" ADD CONSTRAINT "ExtractionTrainingRun_datasetVersionId_fkey" FOREIGN KEY ("datasetVersionId") REFERENCES "ExtractionDatasetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionTrainingRun" ADD CONSTRAINT "ExtractionTrainingRun_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionTrainingRun" ADD CONSTRAINT "ExtractionTrainingRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionModelVersion" ADD CONSTRAINT "ExtractionModelVersion_trainingRunId_fkey" FOREIGN KEY ("trainingRunId") REFERENCES "ExtractionTrainingRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionModelVersion" ADD CONSTRAINT "ExtractionModelVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionDeployment" ADD CONSTRAINT "ExtractionDeployment_activeModelVersionId_fkey" FOREIGN KEY ("activeModelVersionId") REFERENCES "ExtractionModelVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionDeployment" ADD CONSTRAINT "ExtractionDeployment_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionDeployment" ADD CONSTRAINT "ExtractionDeployment_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

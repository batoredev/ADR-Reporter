-- ADR Reporter: Tables, enums, indexes and the database rules that keep the audit log append-only and approved versions frozen.
-- Same SQL as prisma/migrations/20261022175505_init/migration.sql (the source of truth).

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('REPORTER', 'REVIEWER', 'COORDINATOR');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'RESUBMITTED', 'APPROVED', 'EXTERNALLY_SUBMITTED', 'ACKNOWLEDGED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "AgeUnit" AS ENUM ('YEARS', 'MONTHS', 'WEEKS', 'DAYS');

-- CreateEnum
CREATE TYPE "HistoryFlag" AS ENUM ('ALLERGY', 'PREGNANCY', 'ADDICTION', 'HEPATIC_DYSFUNCTION', 'RENAL_DYSFUNCTION');

-- CreateEnum
CREATE TYPE "SeriousAnswer" AS ENUM ('YES', 'NO', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SeriousnessCriterion" AS ENUM ('DEATH', 'LIFE_THREATENING', 'HOSPITALISATION', 'CONGENITAL_ANOMALY', 'DISABILITY', 'OTHER_MEDICALLY_IMPORTANT');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('RECOVERED', 'RECOVERING', 'NOT_RECOVERED', 'FATAL', 'RECOVERED_WITH_SEQUELAE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ActionTaken" AS ENUM ('DRUG_WITHDRAWN', 'DOSE_INCREASED', 'DOSE_REDUCED', 'DOSE_NOT_CHANGED', 'NOT_APPLICABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "Rechallenge" AS ENUM ('YES', 'NO', 'EFFECT_UNKNOWN', 'NOT_REINTRODUCED');

-- CreateEnum
CREATE TYPE "VersionReason" AS ENUM ('SUBMITTED', 'RESUBMITTED', 'APPROVED');

-- CreateEnum
CREATE TYPE "AssignmentAction" AS ENUM ('CLAIMED', 'RELEASED', 'REASSIGNED');

-- CreateEnum
CREATE TYPE "ChecklistItemKey" AS ENUM ('PATIENT_DATA', 'REACTION_CHRONOLOGY', 'SUSPECTED_MEDICATION', 'CLINICAL_EVIDENCE', 'SERIOUSNESS_OUTCOME', 'REPORTER_COMPLETENESS');

-- CreateEnum
CREATE TYPE "ChecklistOutcome" AS ENUM ('VERIFIED', 'VERIFIED_WITH_EXCEPTION');

-- CreateEnum
CREATE TYPE "CommentKind" AS ENUM ('NOTE', 'ISSUE');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'ACKNOWLEDGED_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('APPROVE', 'RETURN');

-- CreateEnum
CREATE TYPE "ExternalSubmissionKind" AS ENUM ('ROUTINE', 'URGENT_NOTIFICATION');

-- CreateEnum
CREATE TYPE "ExternalSubmissionMethod" AS ENUM ('AMC_EMAIL', 'AMC_HAND_DELIVERY', 'NCC_EMAIL', 'PVPI_HELPLINE', 'ADRPVPI_APP', 'OTHER');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "ExtractedItemStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EDITED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProvenanceSource" AS ENUM ('USER_ENTERED', 'DOCUMENT_EXTRACTED');

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "department" TEXT,
    "nextCaseNumber" INTEGER NOT NULL DEFAULT 1,
    "urgentAckTargetMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" "Role"[],
    "designation" TEXT,
    "occupation" TEXT,
    "address" TEXT,
    "pin" TEXT,
    "phone" TEXT,
    "isUrgentContact" BOOLEAN NOT NULL DEFAULT false,
    "canReassign" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdrCase" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "status" "CaseStatus" NOT NULL DEFAULT 'DRAFT',
    "reporterId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "firstSubmittedAt" TIMESTAMP(3),
    "lastSubmittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "lockVersion" INTEGER NOT NULL DEFAULT 0,
    "isPotentiallySerious" BOOLEAN NOT NULL DEFAULT false,
    "patientInitials" TEXT,
    "ageValue" INTEGER,
    "ageUnit" "AgeUnit",
    "dateOfBirth" TEXT,
    "dateOfBirthApprox" BOOLEAN NOT NULL DEFAULT false,
    "gender" "Gender",
    "weightKg" DOUBLE PRECISION,
    "reactionTerms" TEXT,
    "reactionDescription" TEXT,
    "reactionManagement" TEXT,
    "reactionStartDate" TEXT,
    "reactionStartDateApprox" BOOLEAN NOT NULL DEFAULT false,
    "reactionStopDate" TEXT,
    "reactionStopDateApprox" BOOLEAN NOT NULL DEFAULT false,
    "reactionOngoing" BOOLEAN NOT NULL DEFAULT false,
    "medicalHistory" TEXT,
    "historyFlags" "HistoryFlag"[],
    "seriousAnswer" "SeriousAnswer",
    "seriousnessCriteria" "SeriousnessCriterion"[],
    "deathDate" TEXT,
    "deathDateApprox" BOOLEAN NOT NULL DEFAULT false,
    "outcome" "Outcome",
    "additionalInformation" TEXT,
    "unknownFields" TEXT[],
    "reporterName" TEXT,
    "reporterAddress" TEXT,
    "reporterPin" TEXT,
    "reporterEmail" TEXT,
    "reporterPhone" TEXT,
    "reporterOccupation" TEXT,
    "reportDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdrCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "testName" TEXT,
    "result" TEXT,
    "date" TEXT,
    "dateApprox" BOOLEAN NOT NULL DEFAULT false,
    "unknownFields" TEXT[],

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuspectedMedicine" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT,
    "manufacturer" TEXT,
    "batchLot" TEXT,
    "expiryDate" TEXT,
    "expiryDateApprox" BOOLEAN NOT NULL DEFAULT false,
    "dose" TEXT,
    "route" TEXT,
    "frequency" TEXT,
    "startDate" TEXT,
    "startDateApprox" BOOLEAN NOT NULL DEFAULT false,
    "stopDate" TEXT,
    "stopDateApprox" BOOLEAN NOT NULL DEFAULT false,
    "ongoing" BOOLEAN NOT NULL DEFAULT false,
    "indication" TEXT,
    "actionTaken" "ActionTaken",
    "rechallenge" "Rechallenge",
    "rechallengeDose" TEXT,
    "unknownFields" TEXT[],

    CONSTRAINT "SuspectedMedicine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConcomitantProduct" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT,
    "dose" TEXT,
    "route" TEXT,
    "frequency" TEXT,
    "startDate" TEXT,
    "startDateApprox" BOOLEAN NOT NULL DEFAULT false,
    "stopDate" TEXT,
    "stopDateApprox" BOOLEAN NOT NULL DEFAULT false,
    "ongoing" BOOLEAN NOT NULL DEFAULT false,
    "indication" TEXT,
    "usedToTreatReaction" BOOLEAN NOT NULL DEFAULT false,
    "unknownFields" TEXT[],

    CONSTRAINT "ConcomitantProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseVersion" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "reason" "VersionReason" NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseAssignment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "action" "AssignmentAction" NOT NULL,
    "fromUserId" TEXT,
    "toUserId" TEXT,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewChecklistItem" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "item" "ChecklistItemKey" NOT NULL,
    "outcome" "ChecklistOutcome" NOT NULL,
    "exceptionReason" TEXT,
    "reviewerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewComment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "kind" "CommentKind" NOT NULL,
    "fieldPath" TEXT,
    "body" TEXT NOT NULL,
    "issueStatus" "IssueStatus",
    "resolutionNote" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewDecision" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "DecisionType" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrgentEscalation" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "raisedById" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closingNote" TEXT,

    CONSTRAINT "UrgentEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSubmission" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" "ExternalSubmissionKind" NOT NULL,
    "method" "ExternalSubmissionMethod" NOT NULL,
    "methodOther" TEXT,
    "destination" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "recordedById" TEXT NOT NULL,
    "externalReference" TEXT,
    "notes" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgementReference" TEXT,
    "acknowledgementNotes" TEXT,
    "acknowledgementRecordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadedDocument" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionRun" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "rawResponse" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExtractionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "medicationIndex" INTEGER NOT NULL,
    "fieldName" TEXT NOT NULL,
    "proposedValue" TEXT,
    "sourceText" TEXT,
    "uncertain" BOOLEAN NOT NULL DEFAULT false,
    "status" "ExtractedItemStatus" NOT NULL DEFAULT 'PENDING',
    "finalValue" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "targetKind" TEXT,
    "targetRowId" TEXT,

    CONSTRAINT "ExtractedItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldProvenance" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "source" "ProvenanceSource" NOT NULL,
    "documentId" TEXT,
    "extractedItemId" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FieldProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "caseId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_institutionId_idx" ON "User"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "AdrCase_institutionId_status_idx" ON "AdrCase"("institutionId", "status");

-- CreateIndex
CREATE INDEX "AdrCase_institutionId_reporterId_idx" ON "AdrCase"("institutionId", "reporterId");

-- CreateIndex
CREATE INDEX "AdrCase_institutionId_assigneeId_idx" ON "AdrCase"("institutionId", "assigneeId");

-- CreateIndex
CREATE INDEX "AdrCase_institutionId_isPotentiallySerious_lastSubmittedAt_idx" ON "AdrCase"("institutionId", "isPotentiallySerious", "lastSubmittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdrCase_institutionId_caseNumber_key" ON "AdrCase"("institutionId", "caseNumber");

-- CreateIndex
CREATE INDEX "Investigation_caseId_position_idx" ON "Investigation"("caseId", "position");

-- CreateIndex
CREATE INDEX "SuspectedMedicine_caseId_position_idx" ON "SuspectedMedicine"("caseId", "position");

-- CreateIndex
CREATE INDEX "ConcomitantProduct_caseId_position_idx" ON "ConcomitantProduct"("caseId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CaseVersion_caseId_versionNo_key" ON "CaseVersion"("caseId", "versionNo");

-- CreateIndex
CREATE INDEX "CaseAssignment_caseId_createdAt_idx" ON "CaseAssignment"("caseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewChecklistItem_caseId_versionNo_item_key" ON "ReviewChecklistItem"("caseId", "versionNo", "item");

-- CreateIndex
CREATE INDEX "ReviewComment_caseId_createdAt_idx" ON "ReviewComment"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewDecision_caseId_createdAt_idx" ON "ReviewDecision"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "UrgentEscalation_caseId_idx" ON "UrgentEscalation"("caseId");

-- CreateIndex
CREATE INDEX "UrgentEscalation_closedAt_raisedAt_idx" ON "UrgentEscalation"("closedAt", "raisedAt");

-- CreateIndex
CREATE INDEX "ExternalSubmission_caseId_idx" ON "ExternalSubmission"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "UploadedDocument_storageKey_key" ON "UploadedDocument"("storageKey");

-- CreateIndex
CREATE INDEX "UploadedDocument_caseId_idx" ON "UploadedDocument"("caseId");

-- CreateIndex
CREATE INDEX "ExtractionRun_documentId_idx" ON "ExtractionRun"("documentId");

-- CreateIndex
CREATE INDEX "ExtractedItem_runId_idx" ON "ExtractedItem"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "FieldProvenance_caseId_fieldPath_key" ON "FieldProvenance"("caseId", "fieldPath");

-- CreateIndex
CREATE INDEX "AuditLog_caseId_createdAt_idx" ON "AuditLog"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_institutionId_createdAt_idx" ON "AuditLog"("institutionId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdrCase" ADD CONSTRAINT "AdrCase_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdrCase" ADD CONSTRAINT "AdrCase_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdrCase" ADD CONSTRAINT "AdrCase_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuspectedMedicine" ADD CONSTRAINT "SuspectedMedicine_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConcomitantProduct" ADD CONSTRAINT "ConcomitantProduct_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseVersion" ADD CONSTRAINT "CaseVersion_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseVersion" ADD CONSTRAINT "CaseVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseAssignment" ADD CONSTRAINT "CaseAssignment_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewChecklistItem" ADD CONSTRAINT "ReviewChecklistItem_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewChecklistItem" ADD CONSTRAINT "ReviewChecklistItem_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewDecision" ADD CONSTRAINT "ReviewDecision_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentEscalation" ADD CONSTRAINT "UrgentEscalation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentEscalation" ADD CONSTRAINT "UrgentEscalation_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentEscalation" ADD CONSTRAINT "UrgentEscalation_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrgentEscalation" ADD CONSTRAINT "UrgentEscalation_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSubmission" ADD CONSTRAINT "ExternalSubmission_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSubmission" ADD CONSTRAINT "ExternalSubmission_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSubmission" ADD CONSTRAINT "ExternalSubmission_acknowledgementRecordedById_fkey" FOREIGN KEY ("acknowledgementRecordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedDocument" ADD CONSTRAINT "UploadedDocument_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedDocument" ADD CONSTRAINT "UploadedDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "UploadedDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractionRun" ADD CONSTRAINT "ExtractionRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedItem" ADD CONSTRAINT "ExtractedItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExtractionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedItem" ADD CONSTRAINT "ExtractedItem_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "UploadedDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_extractedItemId_fkey" FOREIGN KEY ("extractedItemId") REFERENCES "ExtractedItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldProvenance" ADD CONSTRAINT "FieldProvenance_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "AdrCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit log is append-only: reject any UPDATE, DELETE or TRUNCATE.
CREATE FUNCTION audit_log_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only; % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_mutation();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_mutation();

-- Frozen case versions are immutable as well.
CREATE FUNCTION case_version_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'CaseVersion rows are immutable; % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER case_version_no_update_delete
  BEFORE UPDATE OR DELETE ON "CaseVersion"
  FOR EACH ROW EXECUTE FUNCTION case_version_reject_mutation();

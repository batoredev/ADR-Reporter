-- ADR Reporter: Empty-list defaults, the declaration timestamp and stored PDF references.
-- Same SQL as prisma/migrations/20261025183318_list_defaults_and_pdf/migration.sql (the source of truth).

-- AlterTable
ALTER TABLE "AdrCase" ADD COLUMN     "declarationAcceptedAt" TIMESTAMP(3),
ALTER COLUMN "historyFlags" SET DEFAULT ARRAY[]::"HistoryFlag"[],
ALTER COLUMN "seriousnessCriteria" SET DEFAULT ARRAY[]::"SeriousnessCriterion"[],
ALTER COLUMN "unknownFields" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "CaseVersion" ADD COLUMN     "pdfSha256" TEXT,
ADD COLUMN     "pdfStorageKey" TEXT;

-- AlterTable
ALTER TABLE "ConcomitantProduct" ALTER COLUMN "unknownFields" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Investigation" ALTER COLUMN "unknownFields" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "SuspectedMedicine" ALTER COLUMN "unknownFields" SET DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "roles" SET DEFAULT ARRAY[]::"Role"[];

-- Existing rows: replace missing lists with empty lists, then forbid missing lists.
UPDATE "AdrCase" SET "historyFlags" = ARRAY[]::"HistoryFlag"[] WHERE "historyFlags" IS NULL;
UPDATE "AdrCase" SET "seriousnessCriteria" = ARRAY[]::"SeriousnessCriterion"[] WHERE "seriousnessCriteria" IS NULL;
UPDATE "AdrCase" SET "unknownFields" = ARRAY[]::TEXT[] WHERE "unknownFields" IS NULL;
UPDATE "Investigation" SET "unknownFields" = ARRAY[]::TEXT[] WHERE "unknownFields" IS NULL;
UPDATE "SuspectedMedicine" SET "unknownFields" = ARRAY[]::TEXT[] WHERE "unknownFields" IS NULL;
UPDATE "ConcomitantProduct" SET "unknownFields" = ARRAY[]::TEXT[] WHERE "unknownFields" IS NULL;
UPDATE "User" SET "roles" = ARRAY[]::"Role"[] WHERE "roles" IS NULL;

ALTER TABLE "AdrCase" ALTER COLUMN "historyFlags" SET NOT NULL,
  ALTER COLUMN "seriousnessCriteria" SET NOT NULL,
  ALTER COLUMN "unknownFields" SET NOT NULL;
ALTER TABLE "Investigation" ALTER COLUMN "unknownFields" SET NOT NULL;
ALTER TABLE "SuspectedMedicine" ALTER COLUMN "unknownFields" SET NOT NULL;
ALTER TABLE "ConcomitantProduct" ALTER COLUMN "unknownFields" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "roles" SET NOT NULL;

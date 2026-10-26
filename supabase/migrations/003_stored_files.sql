-- ADR Reporter: Storage for uploaded documents and approved PDFs (immutable once saved).
-- Same SQL as prisma/migrations/20261025194505_stored_files/migration.sql (the source of truth).

-- CreateTable
CREATE TABLE "StoredFile" (
    "key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("key")
);

-- Stored files (uploaded documents, approved PDFs) are immutable once saved.
CREATE FUNCTION stored_file_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'StoredFile rows are immutable; % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stored_file_no_update_delete
  BEFORE UPDATE OR DELETE ON "StoredFile"
  FOR EACH ROW EXECUTE FUNCTION stored_file_reject_mutation();

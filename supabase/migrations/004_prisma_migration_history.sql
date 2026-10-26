-- ADR Reporter: records 001-003 as applied in Prisma's migration history, so
-- `prisma migrate deploy` later applies only newer migrations. Checksums are
-- the SHA-256 of each prisma/migrations/*/migration.sql file.

CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                  VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"            VARCHAR(64) NOT NULL,
    "finished_at"         TIMESTAMPTZ,
    "migration_name"      VARCHAR(255) NOT NULL,
    "logs"                TEXT,
    "rolled_back_at"      TIMESTAMPTZ,
    "started_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);

INSERT INTO "_prisma_migrations"
  ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
VALUES
  ('99778129-d395-4e7f-ae16-e6c35a2d668d', 'c1d495021deac32ad935b74cb78708d3fb5390238b6784c8bffee07a6adfb432', now(), '20261022175505_init', NULL, NULL, now(), 1),
  ('287a3a93-3f99-45da-a4a1-b3a0c488a5c1', '8ddd8d634c88acb6c698b966b5d5ff227183ef1336599249793208d101f2a3dc', now(), '20261025183318_list_defaults_and_pdf', NULL, NULL, now(), 1),
  ('ab237b8f-d955-40b5-8453-a36e5c3b0a54', '0769a3f835c1195fde814b5e804c9a5f2a1aaf535f77558e150b65f5334bc5b4', now(), '20261025194505_stored_files', NULL, NULL, now(), 1);

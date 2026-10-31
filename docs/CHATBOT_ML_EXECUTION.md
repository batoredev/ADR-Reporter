# Chatbot, interface redesign and supervised extraction learning

Requested 31 October 2026. The approved visual direction is recorded in the local design preview gallery.

**Checkpoint:** UI (`911273b`) and chatbot (`2023f3e`) are complete and pushed. The user subsequently asked to finish the chatbot and wrap up for now. ML work is stopped at an unfinished draft saved on `wip/supervised-extraction-pipeline`; it is not deployed or the completed third delivery. Start with [CONTINUE_HERE.md](CONTINUE_HERE.md) for the handoff, remaining work, constraints and user-run deployment steps.

## Delivery sequence

1. Complete and verify the approved interface redesign, then commit and push the UI first. Remove model/provider names, fallback chains, pricing switches and backend explanations from all user-facing screens. Use plain task labels, while retaining document evidence, verification decisions and useful failure messages.
2. Complete and verify the chatbot, batch uploads and resumable extraction, then commit and push a second delivery.
3. Implement the full supervised extraction dataset, annotation, training, independent evaluation, model registry, release and rollback pipeline; run available checks and authorized local training, then commit and push a third delivery.

User questions were submitted together at the start: delivery order, labelled dataset and reviewer, GPU/budget, languages, clinical/demo scope, upload limits and Supabase login. Work that does not depend on these answers proceeds immediately. No paid compute purchases are authorized by silence.

User answers: UI first, chatbot second, full ML third. English only. Testing/demo data for now. No labelled dataset yet. Local hardware only and no paid compute. JPG/PNG/PDF, 20 files, 10 MB each and 50 MB per batch. Prepare Supabase migrations and deployment commands for the user to run; do not wait for a CLI login.

## First delivery requirements — interface

- Apply the approved page hierarchy, navigation, responsive layout and focused reporting/review controls throughout the application.
- Use task-focused language: read documents, draft descriptions and check reports. Keep implementation details in code and internal records, away from product screens, loading messages, document lists and report history.
- Preserve evidence links, uncertainty warnings, human review decisions and the demonstration-data notice.

## Second delivery requirements — chatbot

- New persistent chatbot reporting mode alongside structured and guided reporting.
- Multiple JPG/PNG/PDF uploads with per-file state, duplicate detection, a durable leased job queue, resumable processing and individual retry.
- Per-report source-linked candidate fields, document identity checks, explicit conflicts and human confirmation. Document facts and chat answers retain distinct provenance.
- Free-text answers can propose multiple allowed form updates. Fixed validation determines mandatory/applicable missing fields and prevents arbitrary or protected field writes.
- Case revision checks, idempotent messages, ownership/role checks, bounded context and prompt-injection isolation.
- Existing draft, narrative, consistency, escalation, review, PDF and external tracking flows remain integrated.

## Third delivery requirements — supervised extraction learning

- Explicit document transcription/field annotation reasons; an unused suggestion is not automatically a bad extraction.
- Independent verification of document-supported labels, training permission and de-identification records, immutable dataset versions and grouped splits.
- Reproducible supervised vision-language fine-tuning on a supported pretrained model; training and model serving run outside Supabase Edge Functions.
- Evaluation by field, entity association, false fill, missing/unclear handling and comparison against the baseline; independent held-out tests and release gates.
- Model/checkpoint records, authorized promotion, rollback, inference integration and provenance of dataset/model versions.
- No model is described as trained or clinically validated without the corresponding completed run and evidence.

## Initial environment findings

- Existing site: static Next.js export on Cloudflare Pages; authenticated Supabase Edge Function API; Prisma/PostgreSQL.
- GPU detected: NVIDIA GeForce RTX 3050 Laptop GPU, approximately 4 GB VRAM. The initial environment had no training stack. An ignored local `.venv-ml` now has CUDA PyTorch, Transformers and PEFT; the pinned public base checkpoint is downloaded. No supervised training has run.
- Supabase CLI project listing returned `Invalid access token`; the user was asked to sign in locally or choose prepared deployment commands.
- Existing image extraction has limited fictional sample coverage. It is not a labelled training corpus for broad extraction learning.

## Progress

- [x] Inspect architecture, available compute and authentication; read installed Next.js guides.
- [x] Ask initial questions together.
- [x] Interface redesign and task-focused copy across all screens.
- [x] First delivery checks, commit and push.
- [x] Chat state, extraction jobs and additive schema migration.
- [x] Evidence reconciliation, field validation, question planner and conversation service.
- [x] Batch uploads, worker integration and resumable job progress.
- [x] Chat/report/files interface.
- [x] Second delivery checks, commit and push.
- [x] Prepare user-run Supabase schema, secrets and scheduled-worker deployment commands.
- [x] Preserve the execution plan, completion evidence and unfinished ML draft for future agents.
- [ ] Supervised ML implementation, verification/training, third commit and push.
- [ ] User activates the chatbot on hosted Supabase following `docs/CHATBOT_SETUP.md`.

## UI delivery validation

- ESLint, production type checking and the production static export passed.
- 69 unit tests and all 16 browser tests passed against an isolated local PostgreSQL database.
- After simplifying the phone footer, the 4 affected mobile/PDF browser checks passed again.
- Screenshots checked at 390 px and 1440 px; no horizontal page overflow, and secondary phone actions are in More.
- No Supabase migration or API deployment is required for this UI delivery. The chatbot schema remains outside this first commit.

## Chatbot delivery progress

- Source-linked conversation, multi-file uploads, per-page PDF preparation, leased extraction jobs, evidence review and shared-form handoff are implemented.
- Additive Prisma migration `202610310001_chat_reporting` passed on the isolated test database. No hosted database or Supabase deployment was attempted.
- First 12 new unit/database tests passed. Both new browser tests passed after fixing the static PDF worker asset: multi-page batch to confirmed form rows, and mobile refresh recovery.
- Deployment preparation generates a public schema-only SQL file and private combined schema/Vault/Cron SQL plus a worker secret, both private files ignored by Git. See `docs/CHATBOT_SETUP.md`.
- Validation: the full suite passed 105 unit/database tests and 19 browser tests. Three further database tests passed for exhausted worker recovery, extra approximate-date facts and explicit medicine roles; the chatbot unit/database subset now contains 16 checks. The configured live provider passed fictional document and chat smoke checks. Production static export and API bundle builds passed; lint passed without warnings.

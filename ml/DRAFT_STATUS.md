# Unfinished supervised extraction draft

Saved at the user's request to wrap up after the completed chatbot. This branch is **not deployable**, is not the third delivery, and has not passed type checking or tests. Nothing here has trained or released model weights. Read `docs/CONTINUE_HERE.md` first; obtain the user's resume instruction before continuing this stage.

Implemented as a draft only:

- Eight Prisma models, generated client locally and generated migration DDL. No ML migration was applied anywhere.
- Canonical extraction JSON schema exported from Zod using `scripts/export-extraction-schema.ts`.
- Document label/reason validation, proposed release gates, field/entity evaluation and connected-source dataset splitting.
- Partial backend for document permissions, source pages, label revisions and independent reviews.
- Installed/pinned local Python stack and downloaded the immutable public base checkpoint. No actual training run.

Known issues and immediate next steps:

1. Typecheck, lint and review every draft file before relying on it. The metric alignment code and shared schema types need verification. The release gates are provisional engineering policy, not medical standards.
2. Complete permission revocation: removing training or evaluation permission must deactivate any affected active release according to the sample split, even if the other permission stays enabled. Add a direct revoke action that does not require re-attesting fictional/de-identified status. Recheck permission under the institution transaction lock in page preparation.
3. Finish immutable/append-only table triggers, database constraints, RLS and independent-review guards before applying the ML migration. Preserve the existing chatbot migration unchanged.
4. Build reviewed annotation UI and APIs. A skipped suggestion is not a negative label. Only document-supported values with explicit reasons and second-person review may enter the corpus.
5. Build consent-checked immutable dataset manifests, grouped TRAIN/VALIDATION/TEST splits and authenticated byte export. Keep TEST labels/transcription on the server; local training must never receive them. Bind duplicate originals/rendered pages/transcriptions and declared patient groups to one split.
6. Implement actual image/text supervised training, OCR auxiliary task, reproducible config/seeds, real gradient/weight-change receipts, safe checkpoints/resume and validation. The target must not be silently truncated. Use local compute only. A frozen vision tower and LoRA may be needed for the 4 GB GPU; the full pipeline is still required.
7. Evaluate candidate and existing baseline against the same sealed TEST set on the server; report per-field performance, association, false fills, abstention and latency. Synthetic pilots can verify execution but cannot qualify for release.
8. Implement signed receipts, immutable model registry, coordinator-only promotion/rollback, revision checks, audit and permission rechecks. Add authenticated bounded local inference and route only document extraction to an approved release. Keep Ollama/Gemini fallback and `ALLOW_PAID_AI=false`.
9. Complete unit/database/Python/browser checks, an explicitly synthetic GPU pilot if no reviewed corpus exists, deployment preparation and documentation. Never claim clinical training or accuracy from a pilot. Prepare hosted commands for the user to run.

Local base: `HuggingFaceTB/SmolVLM-256M-Instruct` at `7e3e67edbbed1bf9888184d9df282b700a323964`, Apache 2.0, English. Use safetensors, immutable revisions and `trust_remote_code=False`. Local checkpoint: ignored `ml/artifacts/base-model/`; metadata in ignored `ml/artifacts/base.json`. Environment: ignored `.venv-ml`, Python 3.12.2, CUDA torch 2.8.0+cu128, torchvision 0.23.0+cu128, transformers 4.57.6, PEFT 0.18.1. Do not commit private envs, documents, weights or receipts.

Training and serving run outside Supabase Edge Functions. Hosted Supabase cannot call localhost; a reachable authenticated endpoint is a later operator setup step. On a 4 GB GPU, training and serving should not run concurrently.

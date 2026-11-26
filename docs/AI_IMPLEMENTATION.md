# AI implementation and live setup

> Chatbot update (31 October 2026): the new report assistant adds private tables and a queue. Follow [CHATBOT_SETUP.md](CHATBOT_SETUP.md) for its required additive migration and deployment. The existing-feature description below predates that delivery.

Updated 29 October 2026. This document describes the current implementation; the original architecture plan records
the earlier prototype scope.

## Working architecture

The browser is a static Next.js export on Cloudflare Pages. It calls the authenticated API using bearer sessions.
The same API source runs in Node locally and is bundled into `supabase/functions/api/index.ts` for Supabase. Prisma
and PostgreSQL store the normalized report, private document bytes, extraction decisions, provenance and audit events.
All AI requests happen in the API. Provider keys stay on the backend.

```mermaid
flowchart LR
  UI[Structured form or guided questions] --> API[Authenticated API]
  API --> DB[(PostgreSQL)]
  API --> Router[AI router and shared Zod schemas]
  Router --> O[Ollama Cloud]
  O -->|failure or quota| G[Gemini]
  G -->|failure and paid switch enabled| C[Claude]
  Router --> Review[Human verification]
  Review --> DB
```

## Implemented workflows

| Feature                 | Behavior and durable records                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guided reporting        | Fourteen fixed question groups, two to four questions per group, mapped to existing PvPI fields. Answers use the same form validation, unknown flags, partial dates, autosave and submission path as structured reporting. Mode changes retain answers. The last visited group is saved in audit history.                                                                                |
| Guided AI follow-ups    | AI selects up to three permitted group IDs for missing, contradictory or potentially serious information. It cannot create questions or write answers. If AI fails, the next unanswered groups come from fixed rules.                                                                                                                                                                    |
| Document extraction     | JPG, PNG and PDF uploads; patient initials, demographics, reaction details, history, investigations and medication fields from prescriptions, lab reports, discharge summaries and notes. Source text and uncertain readings are shown. The reporter chooses suspected/concomitant placement and each accepted field. Duration never invents a stop date.                                |
| Extraction verification | Pending runs survive reload. The reporter can resume, edit, confirm uncertain readings, mark dates approximate, apply or discard. Applying checks the current report version, rejects duplicate item IDs and serializes simultaneous requests. Accepted/edited/rejected items and document provenance are stored. Investigation sources appear in review.                                |
| Narrative drafting      | Rough notes plus optional saved report produce an editable suggestion. Source text, current narrative changes and unmatched numeric tokens are available for comparison. Human verification is required. Append/replace saves clinical text and the complete audit record in one transaction. Overlong text is rejected without truncation. Pending drafts can be reopened or discarded. |
| Consistency checks      | Reads saved report fields and available extraction facts, with pending/verified/uncertain labels; rejected readings are excluded. The latest reading per document is used within a bounded context. Findings are suggestions, with evidence and a link to the relevant form section.                                                                                                     |
| Finding decisions       | Corrected, keep with explanation, or unsure. Decisions survive reload and appear on the submission, case and reviewer pages. A check is marked as old after report edits. Nothing automatically changes a clinical field or blocks urgent escalation.                                                                                                                                    |
| Provider resilience     | Ollama first, Gemini second. Unsupported document types, failures, quota errors, malformed JSON and timeouts move to the next eligible provider. Every reply is schema-validated. A shared deadline reserves time for later providers. Provider/model and failed attempts are recorded.                                                                                                  |
| Paid usage control      | `src/server/ai/config.ts` contains `export const ALLOW_PAID_AI: boolean = false;`. Claude is filtered from configuration and runtime routing and guarded in its adapter. Keys and environment ordering cannot override the flag. Enabled paid providers always follow preferred providers.                                                                                               |

No new database tables or migrations are required: assistance history is reconstructed from the existing append-only
audit log; extraction runs/items and field provenance use the existing models. Report saves and extraction/narrative
application lock the parent case before reading its version and rows, preventing concurrent overwrites.

## Provider configuration

Copy `.env.example` to `.env` for local development and configure your database. Add these backend secrets locally or
in Supabase Edge Functions → Secrets:

```dotenv
AI_PROVIDER=auto
OLLAMA_API_KEY=
OLLAMA_MODEL=gemma4:31b
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash,gemini-3.5-flash-lite
```

At least one provider key is required for live AI. Configure Gemini to support PDF extraction: Ollama accepts images
in this application. A custom `OLLAMA_BASE_URL` can point at a reachable local Ollama server instead of Cloud. An Edge
Function cannot reach a server on your PC through `localhost`.

To allow paid Claude, change the boolean to `true`, add `ANTHROPIC_API_KEY`, optionally set `ANTHROPIC_MODEL`, then
rebuild and redeploy the API. Its default is `claude-sonnet-5-5`. There is no automatic paid opt-in.

The preferred providers have account-dependent quotas and billing. Use accounts without paid billing if free-only
usage is required. Exhausted quota produces fallback or an actionable failure; the app cannot change account billing.
See [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) and [Ollama plans](https://ollama.com/pricing).

Ollama Cloud does not support constrained structured output, so the adapter supplies the JSON schema in the prompt
and validates the response locally. Local Ollama uses its schema parameter. See the
[official structured-output documentation](https://docs.ollama.com/capabilities/structured-outputs).

## Verification and deployment

```bash
npm ci
npm run test:db:init          # uses TEST_DATABASE_URL; never the development database
npm test
npm run lint
npm run typecheck
npm run test:e2e              # static site + local API + fictional fixture responses
npm run ai:check              # all four AI tasks against configured providers; no database needed
npm run build:api             # regenerate the deployable Supabase function
npm run build                # regenerate the Cloudflare static site
```

`AI_PROVIDER=fixture` exercises saved responses for all four tasks without a key. Fixture success verifies application
plumbing, not a live provider's availability or extraction quality. The included integration tests also cover lab
results and discharge-summary values, uncertainty, stale previews, simultaneous edits/applications, private access,
durable narrative and finding decisions. The browser test covers mode switching and restoration after reload.

Deploy the generated API and static site together. Existing Supabase projects need no new migration for this AI
update. Existing database configuration can remain in Supabase; the local API needs `DATABASE_URL` separately.

## Remaining inputs for live completion

Local verification completed: 90 unit/PostgreSQL tests and all 12 browser scenarios passed, including the extractor
source-verification and patient-mismatch controls. Lint, TypeScript, formatting, the production static build and the generated
API build passed. All four smoke-check tasks passed with `AI_PROVIDER=fixture`. Live Ollama Cloud checks have now passed for all four tasks. The updated Supabase
function still needs deployment; PDF extraction awaits a Gemini key. Browser checks used an existing Chromium executable
through `TEST_BROWSER_EXECUTABLE`; normal setup can use `npx playwright install chromium`.

1. An Ollama Cloud API key and a Gemini API key, added to backend secrets. One key can run the supported tasks;
   both provide fallback, and Gemini enables PDFs while Claude is disabled.
2. Access to the existing Supabase project and Cloudflare Pages deployment to publish the prepared files, or have
   the project owner deploy them using the README steps. Supply a local database URL only if local operation is wanted.
3. An Anthropic key only if paid Claude is wanted later; keep the code flag false otherwise.
4. Run the live smoke check and review extraction on the fictional samples with those accounts. The question bank's
   field mappings are validated in tests; clinical acceptance of wording and AI quality requires human review.

Keep keys in `.env` or the provider-secret screens. They are not needed in browser configuration or source files.

## Extractor accuracy checks

Live Ollama Cloud verification on 29 October 2026: `gemma4:31b` passed all 24 checked expectations for the clean
prescription and all 22 for the scanned prescription, with no additional evidence warnings on either response. The
PDF benchmark cases remain uncovered until a PDF-capable provider is configured. This is a limited sample result,
not a guarantee of accuracy on other documents. The Ollama key is configured in private backend environment files.

Extraction is deliberately conservative. It does not treat an issue date as a start date, calculate a stop date from
duration, replace a prescribed unit count with medicine strength, infer a generic drug or route, or treat “improved”
as a resolution date. The saved prescription fixture now preserves `1 cap` and `1 tab`, with unrecorded start dates null.

`extraction-quality.ts` checks source quotes for unsupported numbers/units, date components and meanings, ambiguous
numeric dates, missing evidence, inferred identifiers/names/routes, age/weight units and possible duplicate rows.
Questionable values are marked uncertain and remain unselected. Explicit approximate wording retains the approximate
date indicator. Unreadable replies are rejected and the next eligible provider is tried. Source page numbers are shown
when supplied. Applying values requires source verification; different patient initials require a separate confirmation.

The live benchmark is in `samples/extraction-benchmark.json`. Its prescription expectations were transcribed from the
actual clean and scanned images (these are different patients and different medicines). PDF expectations come from the
generated fictional lab and discharge documents. The benchmark checks both expected values and important null fields.

```bash
npm run ai:evaluate                     # configured provider chain, all four documents
npm run ai:evaluate -- --provider=gemini # test Gemini separately
npm run ai:evaluate -- --provider=ollama # image coverage only; PDFs report NOT COVERED
```

Results and individual failures are saved under `test-results/extractor-benchmark/`. This command requires live keys
and refuses fixture mode. Passing the supplied expectations is evidence about these samples; it does not establish
perfect extraction on arbitrary documents. Source quotes and page references are model-produced and still require
comparison with the original. The image benchmark has now passed with live Ollama credentials as recorded above. PDF coverage is still pending.

### Reading medicine packs

Medicine boxes, strips and covers are the main thing reporters photograph, so pack reading gets the most care.
The structuring instructions cover every common label (Batch No., B.No., LOT, BN; MFG, MFD, D.O.M.; EXP, Use
before), dates as printed ("MAY.2026", "05/26"), labels printed in one column with the stamped values beside
them, and "Manufactured for X by Y". After the model, fixed rules in `reviseReading` correct its predictable
slips on a pack:

- brand and generic text read the wrong way round are swapped back;
- a face showing only generic text has no brand (name empty), never an ingredient as the name;
- the brand takes the strength printed beside it on its own line ("Dolo" on a line "Dolo 650" is "Dolo 650");
- the composition is the whole ingredient block after "contains", or the generic line on the front, never the
  brand line, a pack size or a fragment;
- the manufacturer is the company after Manufactured by, Mfd. by or Made in India by, or after "by" in
  "Manufactured for X by Y"; never the marketer; none when the pack names no maker;
- Hindi or regional-language text printed beside the English is dropped from mixed lines;
- every pack date format is read: "05/2026", "05/26", "MAY.2026", "MAY-26", "MAY'26".

`npm run ai:evaluate-synthetic -- --data=ml/data/vision-packs` scores the whole reading path on drawn pack
photos with known answers (`ml/vision/render.py --kinds pack`, with `--hard` for poor photos), and reports
wrong values shown as certain separately from wrong values flagged for checking.

#### Trained structurer (27 November 2026)

`adr-structurer:v2` is Qwen3-0.6B fine-tuned locally (LoRA, 3,200 synthetic examples, 45% packs, about 1 h 46 min
on an RTX 3050). Load it with `ollama create adr-structurer:v2` from the run's GGUF and Modelfile, then set
`OLLAMA_TEXT_MODEL=adr-structurer:v2`. Results with the double read and the pack rules:

| | qwen3:4b | adr-structurer:v2 |
|---|---|---|
| Reporter's 8 real photos | 81/84, 64-178 s per photo | 82/84, 6-39 s per photo (all 5 pack photos perfect) |
| 40 drawn packs | brand 22/40, composition 18/40, batch 17/19, expiry 16/17, maker 17/22 (before the rules) | pack type 40/40, brand 34/35, composition 38/40, batch 18/18, expiry 17/17, maker 19/19; 9 s each |

On the drawn packs, v2 showed one wrong value as certain out of about 170 (a composition missing the full stop
in "eq. to"). The other miss was a misread brand, which was flagged for checking. Synthetic held-out set (brands,
reactions and wording never trained on): field accuracy 99.6%.

### The double-read check

A small vision model does not leave a photo it cannot read blank: it invents a plausible document. On drawn
photos of hurried handwriting (`ml/vision/render.py --hard`), `qwen3-vl:2b-instruct` returned invented medicines,
doses and dates for about one photo in five. Text invented in this way changes when the question is reworded;
text that is really on the page does not. So the two-step reader reads every photo a second time with
differently worded instructions (`CHECK_PROMPT`, temperature 0, right after the first reading while the model
is still loaded) and compares the two readings word by word:

- under 70% agreement nothing is filled in, and the reporter is asked to retake the photo or type the details;
- under 90% the reading is marked partly readable;
- any value that the second reading does not contain, and whose line it does not mostly contain, is marked
  uncertain, so the reporter checks it at the final confirmation.

Measured on 26 November 2026: drawn photos below 0.7 kept at most 22% of their values, photos at 0.95 or above
had an average character error of 2.7%, and the reporter's 8 real photos scored 0.91 to 1.00. The check adds one
vision call (about 5 seconds). If that call fails, the first reading is used as before.
`OLLAMA_DOUBLE_READ=off` turns it off. It cannot catch a misreading the model makes the same way both times.

### Learning from submitted reports

Every submitted report teaches the local two-step reader. When the reader reads a photo it keeps a de-identified
copy: the patient's name as initials, and addresses, phone, Aadhaar and record numbers removed. The raw transcript is
never stored. On submission `captureLearningExamples` (`src/server/workflow/learning.ts`) compares each reading with
what the reporter finally confirmed and saves one `LearningExample` per document:

- a reading the reporter used and then changed or removed becomes a correction;
- a medicine's name, batch, manufacturer, dose, route or frequency the reader missed is filled in only when the
  confirmed value is written in that document's own text, so the reader is never taught something it cannot see;
- a correction the transcript does not contain (the photo was misread) marks the example not trainable for the
  structuring step; it is exported separately for checking.

A reviewer's approval marks the report's examples `APPROVED`, and returning the report puts them back to `SUBMITTED`.
`npm run ml:export-learning` writes approved examples to `ml/data/real/` (gitignored). About one report in five goes
to a real test set, chosen by a stable hash. `ml/structurer/train.py` mixes the rest into training: each real example
counts three times, and one the reporter corrected counts six times. The real test set is then scored on its own.
`LEARN_FROM_REPORTS=off` turns this off. Before turning it on for real patients, confirm that the institution's
consent and data-protection terms cover using de-identified report data to improve the tool.

### Report assistant readings of real photos

`samples/chat-extraction-benchmark.json` holds hand-transcribed expectations for the reporter's own test photos
(handwritten Flutifer prescription and pack, a paediatric prescription with four syrups, Meftal-P strip, Moxikind
front and back, a loose batch/expiry photo, a US practice script). The photos stay outside the repository:

```bash
npm run ai:evaluate-chat -- --dir="C:/Users/<you>/Desktop/adr-samples"            # all photos
npm run ai:evaluate-chat -- --dir="..." --only=paediatric-rx-four-syrups --runs=3 # repeat one photo
```

It uses the same instructions and schema as the assistant and saves every reading under
`test-results/chat-extraction/`. On 25 November 2026 it could not run: the Ollama Cloud account returned 402 (usage
allowance used up) for every model, and no Gemini key is set locally. How the assistant connects readings and what
it asks is covered without the AI by `tests/integration/report-chat-samples.test.ts`, which gives each photo the
reading a careful reader makes of it.

## Practical limits

Narrative numeric/date checks are heuristics and do not prove semantic correctness; matching numbers can still be
attached to the wrong medicine or event. Human verification remains necessary. Consistency checking uses recorded
extraction facts rather than independently reading every uploaded file, so unextracted documents must first be read
with AI. The AI performs no causality assessment, treatment decisions, signatures, official identifiers or external
submission. Fixed completeness rules and institutional review still govern the report workflow.

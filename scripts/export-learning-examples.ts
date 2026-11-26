// Writes the reader's lessons from real reports into the training folder (gitignored), for ml/structurer/train.py.
//   npm run ml:export-learning                       approved reports only (the default)
//   npm run ml:export-learning -- --include-submitted also reports not yet reviewed
//
// Only de-identified examples are stored in the database (initials, no contact or record numbers), and only
// those are exported. About one report in five goes to the real test set, never to training, by a stable hash
// of the report, so the same report always stays on the same side.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createPrismaClient } from "../src/server/db-client";

async function main() {
  const includeSubmitted = process.argv.includes("--include-submitted");
  const out = "ml/data/real";
  const db = createPrismaClient();

  const examples = await db.learningExample.findMany({
    where: { status: includeSubmitted ? { in: ["APPROVED", "SUBMITTED"] } : "APPROVED" },
    select: { caseId: true, documentType: true, transcript: true, target: true, corrections: true, trainable: true },
    orderBy: { createdAt: "asc" },
  });
  await db.$disconnect();

  const testSide = (caseId: string) => createHash("sha256").update(caseId).digest()[0] < 51; // about 20%
  const lines = { train: [] as string[], test: [] as string[], review: [] as string[] };
  for (const e of examples) {
    const row = {
      transcript: e.transcript,
      target: e.target,
      kind: `real_${e.documentType.toLowerCase()}`,
      corrected: Array.isArray(e.corrections) && e.corrections.length > 0,
    };
    // A correction the transcript cannot support is a misread photo: kept for checking, not for this step.
    if (!e.trainable) lines.review.push(JSON.stringify({ ...row, corrections: e.corrections }));
    else lines[testSide(e.caseId) ? "test" : "train"].push(JSON.stringify(row));
  }
  mkdirSync(out, { recursive: true });
  for (const [name, rows] of Object.entries(lines))
    writeFileSync(`${out}/${name}.jsonl`, rows.map((r) => `${r}\n`).join(""));
  console.log(
    `Exported ${lines.train.length} training and ${lines.test.length} test examples from real reports to ${out}; ` +
      `${lines.review.length} with a misread photo are in ${out}/review.jsonl.`,
  );
}

void main();

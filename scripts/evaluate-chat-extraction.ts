/**
 * Reads real test photos with the report assistant's document reader and scores
 * the result against hand-transcribed expectations. Images stay outside the
 * repository:
 *
 *   npm run ai:evaluate-chat -- --dir="C:/path/to/photos" [--only=id] [--runs=3]
 *
 * Results (and every raw reading) are saved under test-results/chat-extraction/.
 */
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { configuredProviders, generateWithFallback, AiError } from "../src/server/ai/provider";
import { EXTRACTION_INSTRUCTIONS } from "../src/lib/domain/extraction";
import { chatExtractionSchema, CHAT_EXTRA_INSTRUCTIONS, type ChatExtraction } from "../src/lib/domain/chat-extraction";
import { reviewExtraction } from "../src/lib/domain/extraction-quality";
import { sniffType } from "../src/server/storage";

type Expected = string | number | boolean | null;
interface MedicineExpectation {
  name: string;
  checks?: Record<string, Expected>;
  patterns?: Record<string, string>;
}
interface Case {
  id: string;
  file: string;
  checks: Record<string, Expected>;
  patterns?: Record<string, string>;
  medicines?: MedicineExpectation[];
}
interface Check {
  field: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}

const at = (object: unknown, key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>((node, part) => (node != null ? (node as Record<string, unknown>)[part] : undefined), object);
const same = (a: unknown, b: unknown) => {
  const n = (v: unknown) =>
    typeof v === "string"
      ? v
          .toLowerCase()
          .replace(/[\s.]/g, "")
          .replace(/(\d)\.0+$/, "$1")
      : v;
  return n(a ?? null) === n(b ?? null);
};

function score(output: ChatExtraction, sample: Case): Check[] {
  const results: Check[] = [];
  const value = (object: unknown, field: string, medicineIndex?: number) =>
    field.startsWith("extra:")
      ? (output.extraFields.find(
          (e) =>
            e.field === field.slice(6) &&
            (medicineIndex === undefined || e.medicationIndex === medicineIndex || output.medications.length === 1),
        )?.reading.value ?? null)
      : field === "medications.length"
        ? output.medications.length
        : (at(object, field) ?? null);
  const run = (
    object: unknown,
    checks: Record<string, Expected> = {},
    patterns: Record<string, string> = {},
    prefix = "",
    index?: number,
  ) => {
    for (const [field, expected] of Object.entries(checks)) {
      const actual = value(object, field, index);
      results.push({ field: prefix + field, expected, actual, passed: same(expected, actual) });
    }
    for (const [field, pattern] of Object.entries(patterns)) {
      const actual = value(object, field, index);
      results.push({
        field: prefix + field,
        expected: `/${pattern}/`,
        actual,
        passed: actual !== null && new RegExp(pattern, "i").test(String(actual)),
      });
    }
  };
  run(output, sample.checks, sample.patterns);
  for (const m of sample.medicines ?? []) {
    const matches = output.medications
      .map((med, index) => ({ med, index }))
      .filter(({ med }) => new RegExp(m.name, "i").test(med.name.value ?? ""));
    results.push({
      field: `medicine /${m.name}/ found once`,
      expected: 1,
      actual: matches.length,
      passed: matches.length === 1,
    });
    if (matches.length === 1) run(matches[0].med, m.checks, m.patterns, `  ${m.name}: `, matches[0].index);
  }
  return results;
}

async function main() {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const dir = arg("dir") ?? process.env.ADR_SAMPLES_DIR;
  if (!dir) throw new Error("Give the photo folder with --dir=... or ADR_SAMPLES_DIR.");
  const runs = Math.max(1, Number(arg("runs") ?? 1));
  const only = arg("only");
  const direct = process.argv.includes("--direct");
  const providers = configuredProviders();
  if (!providers.length || providers.some((p) => p.tier === "test"))
    throw new Error("Live evaluation needs OLLAMA_API_KEY or GEMINI_API_KEY.");
  const { cases } = JSON.parse(await readFile("samples/chat-extraction-benchmark.json", "utf8")) as { cases: Case[] };
  const out = "test-results/chat-extraction";
  await mkdir(out, { recursive: true });
  let passed = 0,
    total = 0;
  const failures: string[] = [];
  // A local model reads one photo at a time; cloud models in parallel.
  const jobs = cases
    .filter((c) => !only || c.id === only)
    .flatMap((sample) => Array.from({ length: runs }, (_, attempt) => ({ sample, attempt })));
  const runOne = async ({ sample, attempt }: (typeof jobs)[number]) => {
    const label = `${sample.id}${runs > 1 ? ` #${attempt + 1}` : ""}`;
    const started = Date.now();
    try {
      const bytes = new Uint8Array(await readFile(path.join(dir, sample.file)));
      const type = sniffType(bytes);
      if (!type) throw new Error(`${sample.file} is not a JPG, PNG or PDF.`);
      const request = {
        task: "extract-document" as const,
        system: EXTRACTION_INSTRUCTIONS + CHAT_EXTRA_INSTRUCTIONS,
        prompt: "Read this document and extract what it says.",
        document: { bytes, mimeType: type.mimeType as "image/jpeg" | "image/png" | "application/pdf" },
        schema: chatExtractionSchema,
        maxOutputTokens: Number(arg("max-tokens")) || 16000,
        validateOutput: (o: ChatExtraction) => {
          if (o.readability === "UNREADABLE") throw new AiError("Unreadable.");
        },
      };
      // --direct: the first configured model without the app's time limits (slow local models).
      const outcome = direct
        ? { ...(await providers[0].generate(request)), model: providers[0].model }
        : await generateWithFallback(request);
      const reviewed = reviewExtraction(outcome.output);
      const output = { ...outcome.output, ...reviewed.output } as ChatExtraction;
      const checks = score(output, sample);
      const bad = checks.filter((c) => !c.passed);
      passed += checks.length - bad.length;
      total += checks.length;
      console.log(
        `${bad.length ? "FAIL" : "PASS"} ${label}: ${checks.length - bad.length}/${checks.length} (${((Date.now() - started) / 1000).toFixed(0)}s, ${outcome.model})`,
      );
      for (const b of bad) {
        const line = `  ${b.field}: expected ${JSON.stringify(b.expected)}, got ${JSON.stringify(b.actual)}`;
        console.log(line);
        failures.push(`${label} ${line.trim()}`);
      }
      await writeFile(
        `${out}/${sample.id}${runs > 1 ? `-${attempt + 1}` : ""}.json`,
        JSON.stringify({ checks, issues: reviewed.issues, output }, null, 2),
      );
    } catch (error) {
      total += 1;
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${label}: ${message}`);
      console.log(`ERROR ${label}: ${message}`);
    }
  };
  if (direct) for (const job of jobs) await runOne(job);
  else await Promise.all(jobs.map(runOne));
  console.log(`\nScore: ${passed}/${total} expectations (${((100 * passed) / Math.max(1, total)).toFixed(1)}%).`);
  await writeFile(`${out}/summary.txt`, `${passed}/${total}\n${failures.join("\n")}\n`);
  if (passed !== total) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

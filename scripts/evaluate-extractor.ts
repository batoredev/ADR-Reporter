import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { configuredProviders, generateWithFallback, AiError } from "../src/server/ai/provider";
import { documentExtractionSchema, EXTRACTION_INSTRUCTIONS } from "../src/lib/domain/extraction";
import { evaluateExtraction, type ExtractionBenchmarkCase } from "../src/lib/domain/extraction-benchmark";
import { reviewExtraction } from "../src/lib/domain/extraction-quality";

async function main() {
  const selected = process.argv.find((a) => a.startsWith("--provider="))?.split("=")[1];
  if (selected) process.env.AI_PROVIDER = selected;
  const providers = configuredProviders();
  if (!providers.length || providers.some((p) => p.tier === "test")) {
    console.error(
      "Live extraction evaluation needs OLLAMA_API_KEY and/or GEMINI_API_KEY. Saved fixtures are not an accuracy evaluation.",
    );
    process.exitCode = 1;
    return;
  }
  const { cases } = JSON.parse(await readFile("samples/extraction-benchmark.json", "utf8")) as {
    cases: ExtractionBenchmarkCase[];
  };
  const directory = "test-results/extractor-benchmark";
  await mkdir(directory, { recursive: true });
  let failed = false;
  for (const sample of cases) {
    if (!providers.some((p) => p.canRead(sample.mimeType))) {
      console.error(`NOT COVERED ${sample.id}: no configured provider can read ${sample.mimeType}.`);
      failed = true;
      continue;
    }
    try {
      const outcome = await generateWithFallback({
        task: "extract-document",
        system: EXTRACTION_INSTRUCTIONS,
        prompt: "Read this document and extract only what is visibly written.",
        document: { bytes: new Uint8Array(await readFile(sample.file)), mimeType: sample.mimeType },
        schema: documentExtractionSchema,
        maxOutputTokens: 16000,
        validateOutput: (output) => {
          if (output.readability === "UNREADABLE")
            throw new AiError("Provider could not read this benchmark document.");
        },
      });
      const reviewed = reviewExtraction(outcome.output);
      const checks = evaluateExtraction(reviewed.output, sample);
      const errors = checks.filter((c) => !c.passed);
      console.log(
        `${errors.length ? "FAIL" : "PASS"} ${sample.id}: ${checks.length - errors.length}/${checks.length} checked expectations; ${outcome.provider}/${outcome.model}; ${reviewed.issues.length} review warnings`,
      );
      for (const error of errors)
        console.log(
          `  ${error.field}: expected ${JSON.stringify(error.expected)}, got ${JSON.stringify(error.actual)}`,
        );
      await writeFile(
        `${directory}/${sample.id}.json`,
        JSON.stringify(
          {
            sample: sample.id,
            provider: outcome.provider,
            model: outcome.model,
            attempts: outcome.attempts,
            checks,
            issues: reviewed.issues,
            output: reviewed.output,
          },
          null,
          2,
        ),
      );
      if (errors.length) failed = true;
    } catch (error) {
      console.error(`FAIL ${sample.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
      failed = true;
    }
  }
  console.log(
    `Results: ${directory}. These checks cover the supplied fictional samples; human source review is still required.`,
  );
  if (failed) process.exitCode = 1;
}
void main().catch(() => {
  console.error("Could not start evaluation. Check the benchmark files and local configuration.");
  process.exitCode = 1;
});

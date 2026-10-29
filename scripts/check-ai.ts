import "dotenv/config";
import { readFile } from "node:fs/promises";
import { aiStatus, generateWithFallback } from "../src/server/ai/provider";
import { documentExtractionSchema, EXTRACTION_INSTRUCTIONS } from "../src/lib/domain/extraction";
import { narrativeSchema, NARRATIVE_INSTRUCTIONS } from "../src/lib/domain/narrative";
import { consistencySchema, CONSISTENCY_INSTRUCTIONS } from "../src/lib/domain/ai-checks";
import { guidedSchema, GUIDED_INSTRUCTIONS, GUIDED_STEPS } from "../src/lib/domain/guided";

// Explicitly invoked smoke check. Only fictional inputs; no database or credentials are printed.
async function main() {
  const status = aiStatus();
  console.log(`Paid Claude: ${status.paidEnabled ? "ENABLED" : "disabled"}`);
  console.log(`Provider chain: ${status.chain.map((p) => `${p.provider}/${p.model}`).join(" → ") || "none"}`);
  if (!status.available) {
    console.error(status.reason);
    process.exitCode = 1;
  } else {
    if (status.provider === "fixture") console.log("TEST FIXTURES: this does not verify a live provider.");
    const notes =
      "Fictional example. Amoxicillin 500 mg TID started 12 October 2026. Rash appeared 14 October 2026. Medicine stopped 15 October 2026. Rash improved 17 October 2026.";
    const jobs = [
      { task: "narrative" as const, system: NARRATIVE_INSTRUCTIONS, prompt: notes, schema: narrativeSchema },
      {
        task: "consistency" as const,
        system: CONSISTENCY_INSTRUCTIONS,
        prompt: `${notes}\nOutcome field is blank.`,
        schema: consistencySchema,
      },
      {
        task: "guided" as const,
        system: GUIDED_INSTRUCTIONS,
        prompt: JSON.stringify({ report: notes, bank: GUIDED_STEPS }),
        schema: guidedSchema,
      },
      {
        task: "extract-document" as const,
        system: EXTRACTION_INSTRUCTIONS,
        prompt: "Read this fictional document.",
        schema: documentExtractionSchema,
        document: {
          bytes: new Uint8Array(await readFile("samples/prescriptions/fictional-prescription-clean.png")),
          mimeType: "image/png" as const,
        },
      },
    ];
    for (const job of jobs) {
      try {
        // Erase the individual output type: each job still carries its validating schema.
        const result = await generateWithFallback<unknown>(job);
        console.log(`PASS ${job.task}: ${result.provider}/${result.model}; ${result.attempts.length} prior failures`);
      } catch (error) {
        console.error(`FAIL ${job.task}: ${error instanceof Error ? error.message : "Unknown error"}`);
        process.exitCode = 1;
      }
    }
  }
}
void main().catch(() => {
  console.error("AI smoke check could not start. Check the local configuration and sample files.");
  process.exitCode = 1;
});

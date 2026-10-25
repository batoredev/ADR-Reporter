import "server-only";
import { extractionSchema } from "@/lib/domain/extraction";
import sample from "./fixture-extraction.json";
import type { AiProvider } from "./types";

/**
 * Test-only provider: returns a saved example reply for the fictional sample
 * prescription, without calling any AI service. The UI labels it as test data.
 */
export function createFixtureProvider(): AiProvider {
  return {
    name: "fixture",
    model: "saved-test-data",
    async extractMedications() {
      return { output: extractionSchema.parse(sample), raw: { fixture: true } };
    },
  };
}

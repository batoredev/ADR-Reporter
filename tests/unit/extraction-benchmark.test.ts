import { describe, expect, it } from "vitest";
import benchmark from "../../samples/extraction-benchmark.json";
import { evaluateExtraction, type ExtractionBenchmarkCase } from "@/lib/domain/extraction-benchmark";
import { documentExtractionSchema } from "@/lib/domain/extraction";
import { createFixtureProvider } from "@/server/ai/fixture";
const cases = benchmark.cases as unknown as ExtractionBenchmarkCase[];

describe("extractor benchmark expectations", () => {
  it("matches the visually checked clean prescription and catches an invented medicine start date", async () => {
    const { output } = await createFixtureProvider().generate({
      task: "extract-document",
      system: "",
      prompt: "",
      schema: documentExtractionSchema,
    });
    const sample = cases[0];
    expect(evaluateExtraction(output, sample).every((c) => c.passed)).toBe(true);
    output.medications[0].startDate.value = "2026-10-12";
    expect(
      evaluateExtraction(output, sample)
        .filter((c) => !c.passed)
        .map((c) => c.field),
    ).toEqual([expect.stringContaining("startDate")]);
  });
  it("rejects a response from the wrong sample, including wrong patient and medicines", async () => {
    const { output } = await createFixtureProvider().generate({
      task: "extract-document",
      system: "",
      prompt: "",
      schema: documentExtractionSchema,
    });
    const failed = evaluateExtraction(output, cases[1]).filter((c) => !c.passed);
    expect(failed.some((c) => c.field === "patient.initials.value")).toBe(true);
    expect(failed.some((c) => c.field.includes("metformin"))).toBe(true);
  });
});

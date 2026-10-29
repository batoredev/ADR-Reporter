import { describe, expect, it } from "vitest";
import { documentExtractionSchema, type ExtractedValue } from "@/lib/domain/extraction";
import { patientInitialsMatch, reviewExtraction } from "@/lib/domain/extraction-quality";
import { createFixtureProvider } from "@/server/ai/fixture";
const read = (value: string, sourceText: string | null): ExtractedValue => ({
  value,
  sourceText,
  uncertain: false,
  approximate: false,
});
const sample = async () =>
  (
    await createFixtureProvider().generate({
      task: "extract-document",
      system: "",
      prompt: "",
      schema: documentExtractionSchema,
    })
  ).output;

describe("conservative extraction evidence checks", () => {
  it("keeps explicit doses instead of turning medicine strength into a dose or the issue date into a start date", async () => {
    const output = await sample();
    expect(output.medications[0].dose.value).toBe("1 cap");
    expect(output.medications[0].startDate.value).toBeNull();
    expect(output.medications[0].stopDate.value).toBeNull();
  });
  it("flags invented doses and changed units even when the numeric tokens match", async () => {
    const output = await sample();
    output.medications[0].dose = read("5 mg", "5 mcg");
    const result = reviewExtraction(output);
    expect(result.output.medications[0].dose.uncertain).toBe(true);
    expect(result.issues.some((i) => /units differ/.test(i.message))).toBe(true);
    output.medications[0].dose = read("500 mg", "1 cap");
    expect(reviewExtraction(output).issues.some((i) => /number does not/.test(i.message))).toBe(true);
  });
  it("flags absent quotes, ambiguous dates and unsupported day/year completion", async () => {
    const output = await sample();
    output.patient.weightKg = read("72", null);
    output.medications[0].startDate = read("2026-10-12", "Date: 12/10/2026");
    output.reaction.startDate = read("2026-10-14", "Rash started October 2026");
    const result = reviewExtraction(output);
    expect(result.output.patient.weightKg.uncertain).toBe(true);
    expect(result.issues.some((i) => /prescription date/.test(i.message))).toBe(true);
    expect(result.issues.some((i) => /day\/month/.test(i.message))).toBe(true);
    expect(result.issues.some((i) => /day is not explicit/.test(i.message))).toBe(true);
  });
  it("preserves an explicitly written, supported stop date and partial test date", async () => {
    const output = await sample();
    output.medications[0].stopDate = read("2026-10-15", "Stopped 15 October 2026");
    output.investigations = [
      { testName: read("ALT", "ALT"), result: read("82 U/L", "82 U/L"), date: read("2026-10", "October 2026") },
    ];
    const result = reviewExtraction(output);
    expect(result.output.medications[0].stopDate.uncertain).toBe(false);
    expect(result.output.investigations[0].date.uncertain).toBe(false);
  });
  it("flags duplicate medicine rows and compares patient initials without punctuation", async () => {
    const output = await sample();
    output.medications.push(structuredClone(output.medications[0]));
    expect(reviewExtraction(output).issues.some((i) => /duplicate medicine/.test(i.message))).toBe(true);
    expect(patientInitialsMatch("R.K.", "rk")).toBe("MATCH");
    expect(patientInitialsMatch("T.S.", "R.K.")).toBe("DIFFERENT");
    expect(patientInitialsMatch(null, "R.K.")).toBe("UNKNOWN");
  });
  it("flags an inferred generic name or route and retains explicit approximate wording", async () => {
    const output = await sample();
    output.medications[0].name = read("Amoxicillin 500 mg tablet", "BrandX 500 mg tablet");
    output.medications[0].route = read("Oral", "Tab. Metformin");
    output.reaction.startDate = read("2026-10-14", "Rash started approximately 14 October 2026");
    const result = reviewExtraction(output);
    expect(result.output.medications[0].name.uncertain).toBe(true);
    expect(result.output.medications[0].route.uncertain).toBe(true);
    expect(result.output.reaction.startDate.approximate).toBe(true);
    expect(result.output.reaction.startDate.uncertain).toBe(true);
  });
  it("does not silently assume kg, years or a gender from unrelated text", async () => {
    const output = await sample();
    output.patient.weightKg = read("70", "70 lb");
    output.patient.ageUnit = read("YEARS", "Age: 6 months");
    output.patient.gender = read("MALE", "F");
    const checked = reviewExtraction(output).output.patient;
    expect([checked.weightKg, checked.ageUnit, checked.gender].every((p) => p.uncertain)).toBe(true);
    output.patient.weightKg = read("70", "Weight: 70kg");
    expect(reviewExtraction(output).output.patient.weightKg.uncertain).toBe(false);
  });
});

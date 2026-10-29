import type { DocumentExtraction } from "./extraction";

type Expected = string | number | boolean | null;
export interface ExtractionBenchmarkCase {
  id: string;
  file: string;
  mimeType: "image/png" | "image/jpeg" | "application/pdf";
  checks: Record<string, Expected>;
  medicines?: { namePattern: string; checks: Record<string, Expected>; patterns?: Record<string, string> }[];
  tests?: { namePattern: string; checks: Record<string, Expected>; resultPattern: string }[];
}
export interface BenchmarkCheck {
  field: string;
  expected: Expected;
  actual: unknown;
  passed: boolean;
}
const at = (object: unknown, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>((node, key) => (node != null ? (node as Record<string, unknown>)[key] : undefined), object);
const normalized = (value: unknown) => {
  if (typeof value !== "string") return value;
  let text = value
    .toLowerCase()
    .trim()
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/\s+/g, " ");
  text = text.replace(/\bcapsules?\b/g, "cap").replace(/\btablets?\b/g, "tab");
  if (/^[a-z. ]+$/.test(text) && text.replace(/[^a-z]/g, "").length <= 4) text = text.replace(/[. ]/g, "");
  return text;
};

/** Checks explicit, manually transcribed expectations. Passing a small sample is not general accuracy certification. */
export function evaluateExtraction(output: DocumentExtraction, sample: ExtractionBenchmarkCase): BenchmarkCheck[] {
  const results: BenchmarkCheck[] = [];
  const check = (object: unknown, checks: Record<string, Expected>, prefix = "") => {
    for (const [field, expected] of Object.entries(checks)) {
      const actual = at(object, field);
      results.push({
        field: `${prefix}${field}`,
        expected,
        actual: actual ?? null,
        passed: normalized(expected) === normalized(actual),
      });
    }
  };
  check(output, sample.checks);
  for (const expected of sample.medicines ?? []) {
    const matches = output.medications.filter((m) => new RegExp(expected.namePattern, "i").test(m.name.value ?? ""));
    results.push({
      field: `medicine(${expected.namePattern})`,
      expected: 1,
      actual: matches.length,
      passed: matches.length === 1,
    });
    if (matches.length === 1) {
      check(matches[0], expected.checks, `medicine(${expected.namePattern}).`);
      for (const [field, pattern] of Object.entries(expected.patterns ?? {}))
        results.push({
          field: `medicine(${expected.namePattern}).${field}`,
          expected: pattern,
          actual: at(matches[0], field),
          passed: new RegExp(pattern, "i").test(String(at(matches[0], field) ?? "")),
        });
    }
  }
  for (const expected of sample.tests ?? []) {
    const matches = output.investigations.filter((t) =>
      new RegExp(expected.namePattern, "i").test(t.testName.value ?? ""),
    );
    results.push({
      field: `test(${expected.namePattern})`,
      expected: 1,
      actual: matches.length,
      passed: matches.length === 1,
    });
    if (matches.length === 1) {
      check(matches[0], expected.checks, `test(${expected.namePattern}).`);
      results.push({
        field: `test(${expected.namePattern}).result`,
        expected: expected.resultPattern,
        actual: matches[0].result.value,
        passed: new RegExp(expected.resultPattern, "i").test(matches[0].result.value ?? ""),
      });
    }
  }
  return results;
}

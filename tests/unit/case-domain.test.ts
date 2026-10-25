import { describe, expect, it } from "vitest";
import { changedPaths, commentTargets, fieldLabel, rowOrder } from "@/lib/domain/case-fields";
import { caseFormSchema } from "@/lib/domain/case-form";
import { assessCompleteness } from "@/lib/domain/completeness";
import { date, form } from "../fixtures/form";
import { medicine, snapshot } from "../fixtures/snapshot";

const reporter = { name: "Demo Clinical Pharmacist", email: "pharmacist@demo.test", phone: null, occupation: null };

describe("completeness", () => {
  it("is ready when the PvPI mandatory fields are present", () => {
    const result = assessCompleteness(form(), reporter);
    expect(result.missing).toEqual([]);
    expect(result.ready).toBe(true);
  });

  it("lists each missing mandatory field", () => {
    const result = assessCompleteness(
      form({ patientInitials: "", ageValue: "", reactionTerms: "", suspectedMedicines: [] }),
      reporter,
    );
    const paths = result.missing.map((m) => m.path);
    expect(paths).toEqual(expect.arrayContaining(["patientInitials", "age", "reactionTerms"]));
    expect(result.ready).toBe(false);
  });

  it("accepts a date of birth instead of age, including a partial one", () => {
    expect(assessCompleteness(form({ ageValue: "", dateOfBirth: date("1986") }), reporter).ready).toBe(true);
  });

  it("warns when the reaction starts before the medicine was started", () => {
    const result = assessCompleteness(form({ reactionStartDate: date("2026-10-01") }), reporter);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.ready).toBe(true);
  });

  it("does not warn when partial dates overlap", () => {
    const result = assessCompleteness(form({ reactionStartDate: date("2026-10") }), reporter);
    expect(result.warnings).toEqual([]);
  });
});

describe("form validation", () => {
  it("rejects impossible dates and accepts partial ones", () => {
    expect(caseFormSchema.safeParse(form({ reactionStartDate: date("2026-02-30") })).success).toBe(false);
    expect(caseFormSchema.safeParse(form({ reactionStartDate: date("2026-02", true) })).success).toBe(true);
  });

  it("allows Unknown only on fields that may be unknown", () => {
    expect(caseFormSchema.safeParse(form({ unknownFields: ["weightKg"] })).success).toBe(true);
    expect(caseFormSchema.safeParse(form({ unknownFields: ["patientInitials"] })).success).toBe(false);
  });
});

describe("field changes between versions", () => {
  it("reports exactly the fields that changed, by row id", () => {
    const m = medicine({ id: "m1" });
    const before = snapshot({ suspectedMedicines: [m] });
    const after = snapshot({
      suspectedMedicines: [{ ...m, batchLot: "AMX2610B" }],
      reaction: { ...before.reaction, stopDate: "2026-10-23" },
    });
    expect([...changedPaths(before, after)].sort()).toEqual(["reactionStopDate", "suspectedMedicines.m1.batchLot"]);
  });

  it("labels row fields by their position on the form", () => {
    const s = snapshot({ suspectedMedicines: [medicine({ id: "m1" }), medicine({ id: "m2", position: 1 })] });
    expect(fieldLabel("suspectedMedicines.m2.batchLot", rowOrder(s))).toMatch(/\(ii\).*Batch/);
    expect(commentTargets(s).some((t) => t.path === "suspectedMedicines.m1.dose")).toBe(true);
  });
});

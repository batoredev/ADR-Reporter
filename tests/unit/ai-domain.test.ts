import { describe, expect, it } from "vitest";
import { GUIDED_STEPS, guidedSchema, missingGuidedSteps } from "@/lib/domain/guided";
import { caseFormSchema } from "@/lib/domain/case-form";
import { aiHistory } from "@/lib/domain/ai-history";
import { unsupportedDetails } from "@/lib/domain/narrative";
import { form } from "../fixtures/form";

describe("guided question bank", () => {
  it("maps every question to an existing normalized case or row field and contains 2–4 questions per group", () => {
    for (const step of GUIDED_STEPS) {
      expect(step.questions.length).toBeGreaterThanOrEqual(2);
      expect(step.questions.length).toBeLessThanOrEqual(4);
      const shape = step.list ? caseFormSchema.shape[step.list].element.shape : caseFormSchema.shape;
      for (const q of step.questions) expect(Object.keys(shape)).toContain(q.field);
    }
    expect(guidedSchema.safeParse({ stepIds: ["invented-medical-advice"] }).success).toBe(false);
  });
  it("does not repeatedly ask optional details explicitly marked unknown", () => {
    const v = form();
    v.gender = "";
    v.weightKg = "";
    v.unknownFields = ["gender", "weightKg"];
    expect(missingGuidedSteps(v)).not.toContain("patient-other");
  });
});
it("restores finding decisions and discarded drafts from append-only history", () => {
  const events = [
    { id: "n", action: "AI_NARRATIVE_DRAFTED", details: { narrative: "test" }, createdAt: "2026-01-01" },
    { id: "c", action: "AI_CHECK_RUN", details: { findings: [{ message: "check" }] }, createdAt: "2026-01-02" },
    {
      id: "d",
      action: "AI_FINDING_DECIDED",
      details: { checkId: "c", index: 0, decision: "UNSURE", reason: "Missing records" },
      createdAt: "2026-01-03",
    },
    { id: "e", action: "AI_NARRATIVE_DISCARDED", details: { draftId: "n" }, createdAt: "2026-01-04" },
  ];
  const state = aiHistory(events.reverse());
  expect(state.narrative).toBeNull();
  expect(state.check?.decisions[0].decision).toBe("UNSURE");
});
it("flags new numeric tokens and month names, without claiming semantic verification", () => {
  expect(unsupportedDetails("500 mg on 12 November 2026", ["250 mg on 12 October 2026"])).toEqual(["500", "November"]);
});

import { describe, expect, it } from "vitest";
import {
  needsEvidenceCheck,
  chatState,
  entityKey,
  putFact,
  pendingGroups,
  nextQuestion,
  deferQuestion,
  type ChatFact,
} from "@/lib/domain/report-chat";
import { form } from "../fixtures/form";

const fact = (overrides: Partial<ChatFact> = {}): ChatFact => ({
  id: "one",
  entity: "case",
  entityKey: "case",
  entityName: "",
  field: "weightKg",
  value: "58",
  quote: "58 kg",
  approximate: false,
  uncertain: false,
  ...overrides,
});
const profile = { name: "Demo", email: "demo@example.test", phone: null, occupation: "Pharmacist" };
describe("chat field safety and question planning", () => {
  it("flags unsupported quantities, dates and paraphrases instead of preselecting them", () => {
    expect(needsEvidenceCheck("ageValue", "99", "34 years")).toBe(true);
    expect(needsEvidenceCheck("reactionTerms", "Anaphylaxis", "rash")).toBe(true);
    expect(needsEvidenceCheck("reactionStartDate", "2026-10-14", "14 October 2026")).toBe(false);
    expect(needsEvidenceCheck("reactionStartDate", "2026-10-12", "10/12/2026")).toBe(true);
    expect(needsEvidenceCheck("gender", "FEMALE", "F")).toBe(false);
  });
  it("rejects protected and prototype properties", () => {
    for (const field of ["status", "approvedAt", "reporterId", "institutionId", "__proto__", "constructor"])
      expect(() => putFact(form(), chatState({}), fact({ field }), "APPROVED")).toThrow();
  });
  it("keeps conflicting document values separate", () => {
    const groups = pendingGroups([fact(), fact({ id: "two", value: "64", quote: "64 kg" })], chatState({}), form());
    expect(groups).toHaveLength(1);
    expect(groups[0].conflict).toBe(true);
    expect(groups[0].facts).toHaveLength(2);
  });
  it("requires a human medicine role and reuses a newly identified row when its name is edited", () => {
    const values = form({ suspectedMedicines: [] }),
      state = chatState({});
    const name = fact({
      entity: "medicine",
      entityKey: entityKey("medicine", "Amox"),
      entityName: "Amox",
      field: "name",
      value: "Amox",
    });
    expect(() => putFact(structuredClone(values), state, name, name.value)).toThrow(/Choose how/);
    state.roles[name.entityKey] = "SUSPECTED";
    putFact(values, state, name, "Amoxicillin 500 mg");
    putFact(values, state, { ...name, field: "dose" }, "1 capsule");
    expect(values.suspectedMedicines).toHaveLength(1);
    expect(values.suspectedMedicines[0]).toMatchObject({ name: "Amoxicillin 500 mg", dose: "1 capsule" });
  });
  it("rejects invalid dates and unsupported enum/flag values", () => {
    for (const [field, value] of [
      ["reactionStartDate", "2026-02-30"],
      ["gender", "AUTO"],
      ["seriousnessCriteria", '["APPROVED"]'],
    ])
      expect(() => putFact(form(), chatState({}), fact({ field }), value)).toThrow();
  });
  it("asks only missing applicable details and records unavailable answers without inventing mandatory values", () => {
    const values = form({ reactionTerms: "", weightKg: "58", gender: "FEMALE" }),
      state = chatState({});
    const question = nextQuestion(values, state, [], profile)!;
    expect(question.field).toBe("reactionTerms");
    deferQuestion(values, state, question);
    expect(values.reactionTerms).toBe("");
    expect(values.unknownFields).not.toContain("reactionTerms");
    expect(nextQuestion(values, state, [], profile)?.field).not.toBe("reactionTerms");
    expect(nextQuestion(values, state, [], profile)?.field).not.toBe("weightKg");
  });
  it("does not ask questions over outstanding suggestions", () => {
    expect(nextQuestion(form(), chatState({}), [fact()], profile)).toBeNull();
  });
});

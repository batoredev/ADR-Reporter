import { describe, expect, it } from "vitest";
import {
  needsEvidenceCheck,
  chatState,
  entityKey,
  putFact,
  pendingGroups,
  nextQuestion,
  deferQuestion,
  isUnknownAnswer,
  noneAnswer,
  normalizeChatValue,
  quoteFound,
  displayValue,
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
  it("asks how a newly found medicine belongs before anything else", () => {
    const med = fact({
      entity: "medicine",
      entityKey: entityKey("medicine", "Cetirizine"),
      entityName: "Cetirizine",
      field: "name",
      value: "Cetirizine",
    });
    const question = nextQuestion(form(), chatState({}), [med], profile)!;
    expect(question.kind).toBe("role");
    expect(Object.keys(question.options!)).toEqual(["SUSPECTED", "CONCOMITANT", "TREATMENT", "SKIP"]);
  });
  it("asks the important details first, the reaction stop date after recovery, and optional ones last or never", () => {
    const values = form({ outcome: "RECOVERED", gender: "FEMALE" });
    const state = chatState({});
    const asked: string[] = [];
    for (let i = 0; i < 30; i++) {
      const q = nextQuestion(values, state, [], profile);
      if (!q) break;
      asked.push(q.kind === "group" ? q.key.split(".").pop()! : q.field);
      deferQuestion(values, state, q);
    }
    expect(asked.indexOf("reactionStopDate")).toBeGreaterThanOrEqual(0);
    expect(asked).toContain("stopDate");
    expect(asked).toContain("actionTaken");
    expect(asked.indexOf("optionalDetails")).toBeGreaterThan(asked.indexOf("indication"));
    expect(asked.filter((f) => ["manufacturer", "batchLot", "expiryDate"].includes(f))).toEqual([]);
    const skipping = chatState({ skipOptional: true });
    const fresh = form({ outcome: "RECOVERED" });
    for (let i = 0; i < 30; i++) {
      const q = nextQuestion(fresh, skipping, [], profile);
      if (!q) break;
      expect(q.optional).toBeFalsy();
      deferQuestion(fresh, skipping, q);
    }
  });
  it("never asks a deferred question again and marks it unknown where the form allows", () => {
    const values = form({ weightKg: "" });
    const state = chatState({});
    let q = nextQuestion(values, state, [], profile);
    while (q && q.field !== "weightKg") {
      deferQuestion(values, state, q);
      q = nextQuestion(values, state, [], profile);
    }
    deferQuestion(values, state, q!);
    expect(values.unknownFields).toContain("weightKg");
    expect(nextQuestion(values, state, [], profile)?.field).not.toBe("weightKg");
  });
});

describe("understanding answers", () => {
  it("recognises every common way of saying 'I don't know'", () => {
    for (const text of [
      "not sure",
      "Not sure.",
      "don't know",
      "dont know",
      "I don't know",
      "no idea",
      "n/a",
      "NA",
      "unknown",
      "can't remember",
      "not recorded",
      "skip",
      "?",
    ])
      expect(isUnknownAnswer(text), text).toBe(true);
    for (const text of ["Cipla", "none", "500 mg", "she is not sure what happened next because she was asleep"])
      expect(isUnknownAnswer(text), text).toBe(false);
  });
  it("keeps 'none' as a real answer only where it means something", () => {
    expect(noneAnswer("medicalHistory", "none")).toBe("None");
    expect(noneAnswer("medicalHistory", "NKDA")).toBe("No known allergies");
    expect(noneAnswer("reactionManagement", "no treatment")).toBe("No treatment given");
    expect(noneAnswer("manufacturer", "none")).toBeNull();
  });
  it("puts answers into the form's own codes and standard wording", () => {
    expect(normalizeChatValue("gender", "Female")).toBe("FEMALE");
    expect(normalizeChatValue("gender", "woman")).toBe("FEMALE");
    expect(normalizeChatValue("outcome", "Recovered")).toBe("RECOVERED");
    expect(normalizeChatValue("seriousAnswer", "yes")).toBe("YES");
    expect(normalizeChatValue("ongoing", "still taking")).toBe("true");
    expect(normalizeChatValue("route", "by mouth")).toBe("Oral");
    expect(normalizeChatValue("seriousnessCriteria", "Hospitalisation (initial or prolonged)")).toBe(
      '["HOSPITALISATION"]',
    );
    expect(normalizeChatValue("ageUnit", "yrs")).toBe("YEARS");
  });
  it("finds a quote regardless of case, spacing and quotation marks", () => {
    expect(quoteFound("She took “Amoxicillin”  500 mg", "amoxicillin 500 mg")).toBe(true);
    expect(quoteFound("She took amoxicillin", "paracetamol")).toBe(false);
  });
  it("does not flag clear gender words as unclear", () => {
    expect(needsEvidenceCheck("gender", "FEMALE", "45 year old woman")).toBe(false);
    expect(needsEvidenceCheck("gender", "MALE", "Mr. A.K.")).toBe(false);
  });
  it("shows labels, not codes", () => {
    expect(displayValue("gender", "FEMALE")).toBe("Female");
    expect(displayValue("seriousnessCriteria", '["HOSPITALISATION"]')).toMatch(/Hospitalisation/);
    expect(displayValue("ongoing", "true")).toBe("Yes");
    expect(displayValue("reactionStartDate", "2026-10-12")).toBe("12 October 2026");
  });
  it("puts a treatment medicine in the concomitant list marked as given for the reaction", () => {
    const values = form(),
      state = chatState({});
    const name = fact({
      entity: "medicine",
      entityKey: entityKey("medicine", "Cetirizine"),
      entityName: "Cetirizine",
      field: "name",
      value: "Cetirizine",
    });
    state.roles[name.entityKey] = "TREATMENT";
    putFact(values, state, name, "Cetirizine");
    expect(values.concomitantProducts).toEqual([
      expect.objectContaining({ name: "Cetirizine", usedToTreatReaction: true }),
    ]);
  });
  it("matches an existing medicine written differently instead of adding it twice", () => {
    const values = form({ suspectedMedicines: [{ ...form().suspectedMedicines[0], name: "Amoxicillin", id: "row1" }] }),
      state = chatState({});
    const dose = fact({
      entity: "medicine",
      entityKey: entityKey("medicine", "Cap. Amoxycillin 500mg"),
      entityName: "Cap. Amoxycillin 500mg",
      field: "dose",
      value: "1 capsule",
    });
    putFact(values, state, dose, "1 capsule");
    putFact(values, state, { ...dose, field: "name", value: "Cap. Amoxycillin 500mg" }, "Cap. Amoxycillin 500mg");
    expect(values.suspectedMedicines).toHaveLength(1);
    expect(values.suspectedMedicines[0]).toMatchObject({ name: "Cap. Amoxycillin 500mg", dose: "1 capsule" });
  });
});

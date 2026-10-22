import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The verified map of the official PvPI form (docs/reference/adrrf-v1.4-field-map.json).
const map = JSON.parse(
  readFileSync(new URL("../../docs/reference/adrrf-v1.4-field-map.json", import.meta.url), "utf8"),
);

const allFieldNames = (): string[] => {
  const names: string[] = [
    ...Object.values(map.fields as Record<string, string>),
    ...Object.values(map.neverFillAutomatically as Record<string, string>),
  ];
  for (const section of [
    "suspectedMedicines",
    "actionTakenAfterReaction",
    "reactionReappearedOnReintroduction",
    "concomitantProducts",
  ]) {
    for (const row of map[section].rows) names.push(...(Object.values(row) as string[]));
  }
  return names;
};

describe("PvPI form field map", () => {
  it("maps all 147 widgets of the official form exactly once", () => {
    const names = allFieldNames();
    expect(names).toHaveLength(147);
    expect(new Set(names).size).toBe(147);
  });

  it("has room for 4 suspected medicines and 3 concomitant products", () => {
    expect(map.suspectedMedicines.rows).toHaveLength(4);
    expect(map.actionTakenAfterReaction.rows).toHaveLength(4);
    expect(map.reactionReappearedOnReintroduction.rows).toHaveLength(4);
    expect(map.concomitantProducts.rows).toHaveLength(3);
  });

  it("keeps AMC/NCC identifiers and receiving-personnel fields out of the fillable set", () => {
    expect(Object.keys(map.neverFillAutomatically).sort()).toEqual([
      "amcUse.amcReportNo",
      "amcUse.regIpdOpdCrNo",
      "amcUse.worldwideUniqueNo",
      "receivingPersonnel.nameOrDate",
      "receivingPersonnel.signatureImage",
    ]);
    const fillable = new Set(Object.values(map.fields as Record<string, string>));
    for (const name of Object.values(map.neverFillAutomatically as Record<string, string>)) {
      expect(fillable.has(name)).toBe(false);
    }
  });
});

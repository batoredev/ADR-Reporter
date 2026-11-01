import { describe, expect, it } from "vitest";
import {
  bestMedicineName,
  compareMedicines,
  inferRoute,
  medicineKey,
  normalizeRoute,
  sameMedicine,
} from "@/lib/domain/medicines";

describe("recognising the same medicine", () => {
  it("ignores strength, dosage form, salts, spelling variants and common brand names", () => {
    for (const name of [
      "Cap. Amoxycillin 500mg",
      "AMOXICILLIN 500 MG CAPSULE",
      "amoxicillin",
      "Amoxicillin trihydrate",
    ])
      expect(medicineKey(name)).toBe("amoxicillin");
    expect(medicineKey("Dolo 650")).toBe("paracetamol");
    expect(medicineKey("Crocin")).toBe("paracetamol");
    expect(medicineKey("Fluticasone propionate nasal spray 50 mcg")).toBe("fluticasone");
    expect(medicineKey("Amlodipine besylate 5 mg")).toBe("amlodipine");
  });
  it("keeps combination products as their own medicine", () => {
    expect(medicineKey("Augmentin 625 mg")).toBe("amoxicillin+clavulanate");
    expect(medicineKey("Amoxicillin and Clavulanic acid")).toBe("amoxicillin+clavulanate");
    expect(sameMedicine("Augmentin", "Amoxicillin")).toBe(false);
  });
  it("merges a one-letter typo but never look-alike drugs", () => {
    expect(compareMedicines("cetrizine", "Cetirizine 10 mg")).toBe("TYPO");
    expect(sameMedicine("amoxicilin", "Amoxicillin")).toBe(true);
    expect(compareMedicines("Amoxicillin", "Ampicillin")).toBe("SIMILAR");
    expect(compareMedicines("Prednisone", "Prednisolone")).toBe("SIMILAR");
    expect(sameMedicine("Prednisone", "Prednisolone")).toBe(false);
    expect(compareMedicines("Metformin", "Atorvastatin")).toBe("DIFFERENT");
  });
  it("keeps the most informative name", () => {
    expect(bestMedicineName(["amoxicillin", "Amoxicillin 500 mg capsule", "Cap. Amoxycillin"])).toBe(
      "Amoxicillin 500 mg capsule",
    );
  });
});

describe("routes from dosage forms", () => {
  it.each([
    ["Fluticasone nasal spray", "Nasal"],
    ["Moxifloxacin eye drops", "Ophthalmic"],
    ["Ciprofloxacin ear drops", "Otic"],
    ["Salbutamol inhaler 2 puffs", "Inhalation"],
    ["Paracetamol 500 mg tablet", "Oral"],
    ["Amoxicillin syrup", "Oral"],
    ["Clobetasol cream", "Topical"],
    ["Nitroglycerin sublingual", "Sublingual"],
    ["Inj. Ceftriaxone 1 g IV", "Intravenous"],
    ["Insulin glargine 10 units SC", "Subcutaneous"],
  ])("%s → %s", (text, route) => expect(inferRoute([text])?.route).toBe(route));
  it("does not guess when the form does not decide the route", () => {
    expect(inferRoute(["Inj. Ceftriaxone 1 g"])).toBeNull();
    expect(inferRoute(["Throat spray"])).toBeNull();
    expect(inferRoute(["Ceftriaxone"])).toBeNull();
  });
  it("standardises how a route is written", () => {
    expect(normalizeRoute("orally")).toBe("Oral");
    expect(normalizeRoute("PO")).toBe("Oral");
    expect(normalizeRoute("i.v.")).toBe("Intravenous");
    expect(normalizeRoute("applied twice to the rash")).toBe("applied twice to the rash");
  });
});

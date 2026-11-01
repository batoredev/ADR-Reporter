import { describe, expect, it } from "vitest";
import {
  bestMedicineName,
  compareMedicines,
  findMedicineMentions,
  frequencyCode,
  inferRoute,
  isFormWord,
  medicineKey,
  normalizeRoute,
  sameMedicine,
  tidyMedicineName,
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

// Reported by the reporter on 1 November 2026: "it is given as flutifer nassal spary, but the chatbot still asks the route".
describe("misspelt and misread dosage forms", () => {
  it("reads the route from a misspelt or misread form", () => {
    expect(inferRoute(["flutifer nassal spary"])?.route).toBe("Nasal");
    expect(inferRoute(["Flutifer Nanal spry"])?.route).toBe("Nasal");
    expect(inferRoute(["2 sprays every nostril for 2 weeks"])?.route).toBe("Nasal");
    expect(inferRoute(["moxifloxacin opthalmic drops"])?.route).toBe("Ophthalmic");
    expect(inferRoute(["budesonide inhailer"])?.route).toBe("Inhalation");
    expect(inferRoute(["paracetamol tablat"])?.route).toBe("Oral");
    expect(inferRoute(["fusidic acid oinment"])?.route).toBe("Topical");
  });

  it("never takes a real look-alike word for a form", () => {
    for (const text of [
      "basal insulin",
      "patchy rash",
      "chest infection",
      "loose motions",
      "a typical rash",
      "Flutifer spray",
    ])
      expect(inferRoute([text])).toBeNull();
    expect(isFormWord("stray", "spray")).toBe(false);
    expect(isFormWord("infection", "injection")).toBe(false);
  });

  it("treats a misspelt form as the same medicine and corrects only the form words in the name", () => {
    expect(sameMedicine("flutifer nassal spary", "Flutifer Nasal spray")).toBe(true);
    expect(medicineKey("Flutifer Nanal spry")).toBe("flutifer");
    expect(tidyMedicineName("flutifer nassal spary")).toBe("flutifer nasal spray");
    expect(tidyMedicineName("Moxifloxacin eye drps")).toBe("Moxifloxacin eye drops");
    expect(tidyMedicineName("Amoxicillin 500 mg capsule")).toBe("Amoxicillin 500 mg capsule");
  });
});

describe("medicines written in a message", () => {
  it("finds every medicine written with a form or strength, as in the reporter's live test", () => {
    const names = findMedicineMentions(
      "She was taking Amoxycillin 500mg caps three times a day and Dolo 650 for fever. She also used Fluticasone nasal spray, Salbutamol inhaler 2 puffs, Moxifloxacin eye drops and Inj. Ceftriaxone 1 g. She had Ampicillin last year. She was given cetirizine tablets for it.",
    ).map((m) => m.name);
    expect(names).toEqual([
      "Amoxycillin 500mg caps",
      "Fluticasone nasal spray",
      "Salbutamol inhaler",
      "Moxifloxacin eye drops",
      "Inj. Ceftriaxone 1 g",
      "cetirizine tablets",
    ]);
  });

  it("finds misspelt and handwritten forms and keeps the quote as written", () => {
    expect(findMedicineMentions("she uses flutifer nassal spary at night")).toEqual([
      { name: "flutifer nasal spray", quote: "flutifer nassal spary" },
    ]);
    expect(findMedicineMentions("Rx Flutifer Nanal spry — 0-0-1")[0]?.name).toBe("Flutifer Nasal spray");
    expect(findMedicineMentions("moxifloxacin opthalmic drops")[0]?.name).toBe("moxifloxacin ophthalmic drops");
    expect(findMedicineMentions("Sodium valproate 200 mg and insulin glargine 10 units").map((m) => m.name)).toEqual([
      "Sodium valproate 200 mg",
      "insulin glargine 10 units",
    ]);
  });

  it("ignores lab values, negations and words that are not medicine names", () => {
    expect(
      findMedicineMentions(
        "Hb 9 g/dl, creatinine 1.2 mg/dL, weighs 54 kg. No paracetamol tablets were given. She takes blood pressure tablets, 2 tablets daily. Basal insulin, chest infection, loose motions.",
      ),
    ).toEqual([]);
  });
});

describe("frequencies in different words", () => {
  it("recognises the same frequency however it is written", () => {
    expect(new Set(["TDS", "tid", "three times a day", "1-1-1", "thrice daily"].map(frequencyCode))).toEqual(
      new Set(["3/day"]),
    );
    expect(frequencyCode("0-0-1")).toBe(frequencyCode("at night"));
    expect(frequencyCode("BD")).toBe("2/day");
    expect(frequencyCode("when the itch is bad")).toBeNull();
  });
});

// Medicine names as reporters and documents write them: "Cap. Amoxycillin 500mg",
// "amoxicillin", "AMOXICILLIN 500 MG CAPSULE". These rules decide when two
// entries are the same medicine (so a report never lists it twice) and which
// route a dosage form implies (a nasal spray is used nasally). They are fixed
// rules, not AI; anything they cannot decide is left for the reporter.

/** Spelling variants and common names mapped to one name. A starting list, not a complete dictionary. */
const SYNONYMS: Record<string, string> = {
  amoxycillin: "amoxicillin",
  acetaminophen: "paracetamol",
  crocin: "paracetamol",
  dolo: "paracetamol",
  calpol: "paracetamol",
  cephalexin: "cefalexin",
  frusemide: "furosemide",
  albuterol: "salbutamol",
  epinephrine: "adrenaline",
  lignocaine: "lidocaine",
  glyburide: "glibenclamide",
  rifampin: "rifampicin",
  clavulanic: "clavulanate",
  clavulanicacid: "clavulanate",
  "co-amoxiclav": "amoxicillin+clavulanate",
  coamoxiclav: "amoxicillin+clavulanate",
  augmentin: "amoxicillin+clavulanate",
  cotrimoxazole: "sulfamethoxazole+trimethoprim",
  "co-trimoxazole": "sulfamethoxazole+trimethoprim",
  septran: "sulfamethoxazole+trimethoprim",
  bactrim: "sulfamethoxazole+trimethoprim",
  ibuprofen: "ibuprofen",
  brufen: "ibuprofen",
  combiflam: "ibuprofen+paracetamol",
  cetzine: "cetirizine",
  allegra: "fexofenadine",
  pantop: "pantoprazole",
  pan: "pantoprazole",
  glycomet: "metformin",
  ecosprin: "aspirin",
  disprin: "aspirin",
  acetylsalicylic: "aspirin",
};

/** Dosage forms, release types, routes and packaging words that do not identify the medicine. */
const NOISE = new Set(
  (
    "tab tabs tablet tablets cap caps capsule capsules syp syr syrup susp suspension inj injection injections amp ampoule " +
    "vial vials spray sprays nasal drop drops eye eyes ear ears oint ointment cream gel lotion inhaler inhalers rotacap " +
    "rotacaps respule respules neb nebuliser nebulizer nebulisation patch patches suppository suppositories supp pessary " +
    "pessaries sachet sachets granules powder solution soln oral iv im sc sr er xr cr mr dr od bd tds tid qid sos prn " +
    "ds forte plus kid kids paed paediatric pediatric adult dispersible chewable effervescent topical mouthwash gargle " +
    "lozenge lozenges strip strips infusion bottle tube pack sterile"
  ).split(" "),
);

/** Salt names dropped when another word remains: "amlodipine besylate" is amlodipine. */
const SALTS = new Set(
  (
    "hydrochloride hcl sodium potassium sulphate sulfate maleate citrate trihydrate monohydrate dihydrate besylate besilate " +
    "succinate tartrate phosphate acetate bromide mesylate fumarate hyclate disodium dipropionate propionate valerate acid"
  ).split(" "),
);

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/(\d)([a-z%µ])/g, "$1 $2")
    .replace(/[^a-z0-9+%µ\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** The ingredient key of a medicine name: lower-case ingredients, salts and forms removed, sorted, "+"-joined. */
export function medicineKey(name: string): string {
  const raw = name
    .toLowerCase()
    .replace(/\s*(?:\+|&|\/|\band\b|\bwith\b)\s*/g, " + ")
    .trim();
  const direct = SYNONYMS[raw.replace(/[^a-z-]/g, "")];
  if (direct) return direct;
  const ingredients = raw
    .split("+")
    .map((part) => {
      const kept = words(part).filter(
        (w) => !NOISE.has(w) && !/^\d+(\.\d+)?$/.test(w) && !/^(mg|mcg|µg|g|gm|ml|iu|units?|%|w\/v|w\/w)$/.test(w),
      );
      const withoutSalts = kept.filter((w) => !SALTS.has(w));
      const tokens = (withoutSalts.length ? withoutSalts : kept).map((w) => SYNONYMS[w] ?? w);
      return tokens.join(" ").trim();
    })
    .filter(Boolean)
    .flatMap((part) => (SYNONYMS[part.replace(/\s+/g, "")] ?? part).split("+"));
  return [...new Set(ingredients)].sort().join("+") || raw.replace(/\s+/g, " ");
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

export type MedicineMatch = "SAME" | "TYPO" | "SIMILAR" | "DIFFERENT";

/**
 * How two names relate. Look-alike drugs differ by only a few letters
 * (ampicillin/amoxicillin, prednisone/prednisolone), so only identical
 * ingredients or a one-letter typo in a long name count as the same medicine.
 * Closer-but-different names are SIMILAR: shown for checking, never merged.
 */
export function compareMedicines(a: string, b: string): MedicineMatch {
  if (!a.trim() || !b.trim()) return "DIFFERENT";
  const x = medicineKey(a).split("+"),
    y = medicineKey(b).split("+");
  if (x.join("+") === y.join("+")) return "SAME";
  if (x.length !== y.length) return "DIFFERENT";
  const distances = x.map((part) => Math.min(...y.map((other) => editDistance(part, other))));
  const shortest = Math.min(...x.map((p) => p.length), ...y.map((p) => p.length));
  if (shortest >= 8 && distances.every((d) => d <= 1)) return "TYPO";
  if (shortest >= 5 && distances.every((d) => d <= 2)) return "SIMILAR";
  return "DIFFERENT";
}

/** True when two names are the same medicine: same ingredients, or a one-letter typo in a long name. */
export function sameMedicine(a: string, b: string): boolean {
  const match = compareMedicines(a, b);
  return match === "SAME" || match === "TYPO";
}

/** The strength written in a name, e.g. "500 mg", or null. */
export function strengthOf(text: string): string | null {
  const m = text
    .toLowerCase()
    .match(/(\d+(?:\.\d+)?)\s*(mg|mcg|µg|g|gm|ml|iu|units?|%)(?:\s*\/\s*(\d*\s*(?:ml|g|dose|puff)))?/);
  return m ? `${m[1]} ${m[2]}${m[3] ? `/${m[3].replace(/\s+/g, "")}` : ""}` : null;
}

/** Of several names for one medicine, the most informative one (with strength and form). */
export function bestMedicineName(names: string[]): string {
  return (
    [...names]
      .filter((n) => n.trim())
      .sort(
        (a, b) => Number(Boolean(strengthOf(b))) - Number(Boolean(strengthOf(a))) || b.trim().length - a.trim().length,
      )[0] ?? ""
  );
}

// Order matters: specific forms before general ones ("nasal spray" before "spray", "eye ointment" before "ointment").
const ROUTE_RULES: [RegExp, string][] = [
  [/\b(nasal|intranasal|nose)\b/, "Nasal"],
  [/\b(eye|ophthalmic|ocular)\b/, "Ophthalmic"],
  [/\b(ear|otic|aural)\b/, "Otic"],
  [/\b(inhaler|inhalation|inhaled|rotacaps?|respules?|nebuli[sz](er|ation|ed)?|neb|mdi|dpi|puffs?)\b/, "Inhalation"],
  [/\b(sublingual|s\/l|under the tongue)\b/, "Sublingual"],
  [/\b(transdermal|patch(es)?)\b/, "Transdermal"],
  [/\b(suppositor(y|ies)|rectal|per rectum)\b/, "Rectal"],
  [/\b(vaginal|pessar(y|ies)|per vaginum)\b/, "Vaginal"],
  [/\b(i\.?v\.?|intravenous(ly)?|infusion|drip)\b/, "Intravenous"],
  [/\b(i\.?m\.?|intramuscular(ly)?)\b/, "Intramuscular"],
  [/\b(s\.?c\.?|subcut(aneous(ly)?)?|sub-cut)\b/, "Subcutaneous"],
  [/\b(cream|ointment|oint|gel|lotion|topical(ly)?|dusting powder|local application|apply)\b/, "Topical"],
  [
    /\b(tabs?|tablets?|caps?|capsules?|syrup|syp|syr|suspension|susp|oral(ly)?|p\.?o\.?|by mouth|sachets?|granules|dispersible|chewable|lozenges?|mouth ?wash)\b/,
    "Oral",
  ],
];

/**
 * The route a dosage form implies, with the words it was taken from, or null
 * when the form does not decide it (an "injection" can be IV, IM or SC).
 */
export function inferRoute(texts: (string | null | undefined)[]): { route: string; basis: string } | null {
  const text = texts.filter(Boolean).join(" ").toLowerCase();
  if (!text.trim()) return null;
  for (const [pattern, route] of ROUTE_RULES) {
    const m = text.match(pattern);
    if (m) return { route, basis: m[0] };
  }
  return null;
}

/** A route as written ("orally", "PO", "by mouth", "i.v.") in the standard wording; unknown wording is kept. */
export function normalizeRoute(value: string): string {
  const v = value.trim();
  if (!v) return v;
  const known = inferRoute([v]);
  // Only standardise when the whole value is a route word, not a description.
  return known && v.split(/\s+/).length <= 3 ? known.route : v;
}

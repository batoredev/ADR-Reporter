// Medicine names as reporters and documents write them: "Cap. Amoxycillin 500mg",
// "amoxicillin", "AMOXICILLIN 500 MG CAPSULE". These rules decide when two
// entries are the same medicine (so a report never lists it twice) and which
// route a dosage form implies (a nasal spray is used nasally). They are fixed
// rules, not AI; anything they cannot decide is left for the reporter.

import { ABBREVIATIONS, BRAND_NAMES, GENERIC_NAMES } from "./drug-names";

/** Other spellings and names of one medicine. */
const SYNONYMS: Record<string, string> = {
  amoxycillin: "amoxicillin",
  acetaminophen: "paracetamol",
  cephalexin: "cefalexin",
  frusemide: "furosemide",
  albuterol: "salbutamol",
  epinephrine: "adrenaline",
  norepinephrine: "noradrenaline",
  lignocaine: "lidocaine",
  glyburide: "glibenclamide",
  rifampin: "rifampicin",
  clavulanic: "clavulanate",
  clavulanicacid: "clavulanate",
  "co-amoxiclav": "amoxicillin+clavulanate",
  coamoxiclav: "amoxicillin+clavulanate",
  cotrimoxazole: "sulfamethoxazole+trimethoprim",
  "co-trimoxazole": "sulfamethoxazole+trimethoprim",
  acetylsalicylic: "aspirin",
  valproic: "valproate",
  divalproex: "valproate",
  dicycloverine: "dicyclomine",
  chlorphenamine: "chlorpheniramine",
  levothyroxin: "levothyroxine",
  thyroxine: "levothyroxine",
  ondansetrone: "ondansetron",
};

/** Every known way of writing a medicine, mapped to its ingredient key. */
const KNOWN = new Map<string, string>();
for (const name of GENERIC_NAMES) KNOWN.set(name, name);
for (const [name, key] of [...Object.entries(SYNONYMS), ...Object.entries(BRAND_NAMES)]) KNOWN.set(name, key);
/** Ingredient keys of listed medicines: two different listed medicines are never merged. */
const LISTED = new Set([...KNOWN.values()].flatMap((key) => key.split("+")));
/** Names a slip may snap to: listed spellings of 4+ letters (short forms such as "pan" match exactly only). */
const SNAP_TARGETS = [...KNOWN.keys()].filter((name) => /^[a-z]{4,}$/.test(name));

/** Dosage forms, release types, routes and packaging words that do not identify the medicine. */
const NOISE = new Set(
  (
    "tab tabs tablet tablets cap caps capsule capsules syp syr syrup susp suspension inj injection injections amp ampoule " +
    "vial vials spray sprays nasal drop drops eye eyes ear ears oint ointment cream gel lotion inhaler inhalers rotacap " +
    "rotacaps respule respules neb nebuliser nebulizer nebulisation patch patches suppository suppositories supp pessary " +
    "pessaries sachet sachets granules powder solution soln oral iv im sc sr er xr cr mr dr od bd tds tid qid sos prn hs " +
    "stat ds forte plus duo kid kids paed paediatric pediatric adult dispersible chewable effervescent topical " +
    "mouthwash gargle lozenge lozenges strip strips infusion bottle tube pack sterile"
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
    // "Pan-40", "Dolo-650": a hyphen before a number only separates the strength.
    .replace(/([a-z])-(?=\d)/g, "$1 ")
    .replace(/[^a-z0-9+%µ\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const VOWELS = new Set("aeiouy");
/** Letters that handwriting, typing and reading often swap. */
const CONFUSED = new Set(["c|s", "c|k", "k|q", "s|z", "i|l", "m|n", "u|v", "i|j", "g|j", "f|v"]);
const swapCost = (x: string, y: string) =>
  x === y ? 0 : VOWELS.has(x) && VOWELS.has(y) ? 0.4 : CONFUSED.has(x < y ? `${x}|${y}` : `${y}|${x}`) ? 0.5 : 1;
/** Cost of a letter written or left out: a vowel or a doubled letter is a slip, other letters are not. */
const gapCost = (word: string, i: number) => {
  const ch = word[i];
  if (ch === word[i - 1] || ch === word[i + 1]) return 0.3;
  if (ch === "h" && /[cpt]/.test(word[i - 1] ?? "")) return 0.4;
  if (ch === "e" && i === word.length - 1) return 0.3;
  return VOWELS.has(ch) ? 0.5 : 1;
};

/**
 * How far apart two spellings are, counting the slips reporters and readings
 * make as small (e↔a, e↔o, a doubled letter, a dropped final e, c↔s), so
 * "Crosin" is close to "Crocin" and "Cefixim" to "Cefixime".
 */
export function slipDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) d[i][0] = d[i - 1][0] + gapCost(a, i - 1);
  for (let j = 1; j <= b.length; j++) d[0][j] = d[0][j - 1] + gapCost(b, j - 1);
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + gapCost(a, i - 1),
        d[i][j - 1] + gapCost(b, j - 1),
        d[i - 1][j - 1] + swapCost(a[i - 1], b[j - 1]),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 0.6);
    }
  return Math.round(d[a.length][b.length] * 100) / 100;
}
/** The largest slip a name of this length can carry and still be the same medicine. */
const slipLimit = (length: number) => (length >= 8 ? 1.5 : length >= 5 ? 1 : 0.5);

interface Snap {
  /** Ingredient key, "+"-joined for combinations. */
  key: string;
  /** The listed spelling it matched. */
  spelling: string;
  cost: number;
}
const snapCache = new Map<string, Snap | null>();
/** A written word as a listed medicine: exact, a short form, or a unique close spelling. */
function snap(word: string): Snap | null {
  if (snapCache.has(word)) return snapCache.get(word)!;
  let result: Snap | null = null;
  const exact = KNOWN.get(word) ?? ABBREVIATIONS[word];
  if (exact) result = { key: exact, spelling: word, cost: 0 };
  else if (/^[a-z]{4,}$/.test(word)) {
    let best: Snap | null = null,
      runnerUp = Infinity;
    for (const name of SNAP_TARGETS) {
      if (Math.abs(name.length - word.length) > 3) continue;
      const cost = slipDistance(word, name);
      const key = KNOWN.get(name)!;
      if (!best || cost < best.cost) {
        if (best && best.key !== key) runnerUp = Math.min(runnerUp, best.cost);
        best = { key, spelling: name, cost };
      } else if (key !== best.key) runnerUp = Math.min(runnerUp, cost);
    }
    // Close to exactly one listed medicine; near two (a look-alike pair) decides nothing.
    if (best && best.cost <= slipLimit(Math.min(word.length, best.spelling.length)) && runnerUp - best.cost >= 0.5)
      result = best;
  }
  snapCache.set(word, result);
  return result;
}

/** The words of a medicine name that identify it: forms, strengths, a leading "T."/"C." and salts removed. */
function nameWords(part: string): string[] {
  const all = words(part);
  const kept = all.filter(
    (w, i) =>
      !NOISE.has(w) &&
      !formWordOf(w) &&
      !/^\d+(\.\d+)?$/.test(w) &&
      !/^(mg|mcg|µg|g|gm|ml|iu|units?|%|w\/v|w\/w)$/.test(w) &&
      // "T. Azithro", "C. Amox": a single letter before the name is the dosage form.
      !(i === 0 && /^[tc]$/.test(w) && all.length > 1),
  );
  const withoutSalts = kept.filter((w) => !SALTS.has(w));
  return withoutSalts.length ? withoutSalts : kept;
}

/**
 * The ingredient key of a medicine name: brands, short forms and slips resolved
 * to the listed ingredient ("Crosin 500" and "Paracetamol" are both
 * "paracetamol"), salts and forms removed, sorted, "+"-joined.
 */
export function medicineKey(name: string): string {
  const raw = name
    .toLowerCase()
    .replace(/\s*(?:\+|&|\/|\band\b|\bwith\b)\s*/g, " + ")
    .trim();
  const direct = KNOWN.get(raw.replace(/[^a-z-]/g, "")) ?? ABBREVIATIONS[raw.replace(/[^a-z-]/g, "")];
  if (direct) return direct;
  const ingredients = raw.split("+").flatMap((part) => {
    const kept = nameWords(part);
    if (!kept.length) return [];
    // Hyphenated or spaced brand names: "Pan-D", "Pan D", "Taxim-O".
    const joined = KNOWN.get(kept.join("-"));
    if (joined) return joined.split("+");
    const out: string[] = [];
    const unresolved: string[] = [];
    for (const w of kept) {
      // "Mox CV": CV is clavulanate.
      if (w === "cv") {
        out.push("clavulanate");
        continue;
      }
      const s = snap(w);
      if (s) out.push(...s.key.split("+"));
      else unresolved.push(w);
    }
    if (unresolved.length) out.push(unresolved.join(" "));
    return out;
  });
  return [...new Set(ingredients)].sort().join("+") || raw.replace(/\s+/g, " ");
}

export type MedicineMatch = "SAME" | "TYPO" | "SIMILAR" | "DIFFERENT";

/**
 * How two names relate. Readings that are one slip apart are the same
 * medicine; two different listed medicines never are, however close
 * (ampicillin/amoxicillin, prednisone/prednisolone, cefixime/cefuroxime):
 * those are SIMILAR, shown for checking and never merged.
 */
export function compareMedicines(a: string, b: string): MedicineMatch {
  if (!a.trim() || !b.trim()) return "DIFFERENT";
  const x = medicineKey(a).split("+"),
    y = medicineKey(b).split("+");
  if (x.join("+") === y.join("+")) return "SAME";
  if (x.length !== y.length) return "DIFFERENT";
  const verdicts = x.map((part) => {
    if (y.includes(part)) return "SAME";
    const [other, cost] = y.map((o) => [o, slipDistance(part, o)] as const).sort((p, q) => p[1] - q[1])[0];
    if (LISTED.has(part) && LISTED.has(other)) return cost <= 2.5 ? "SIMILAR" : "DIFFERENT";
    const limit = slipLimit(Math.min(part.length, other.length));
    return cost <= limit ? "TYPO" : cost <= limit + 1 ? "SIMILAR" : "DIFFERENT";
  });
  if (verdicts.includes("DIFFERENT")) return "DIFFERENT";
  if (verdicts.includes("SIMILAR")) return "SIMILAR";
  return "TYPO";
}

/** True when two names are the same medicine: same ingredients, or a reading slip. */
export function sameMedicine(a: string, b: string): boolean {
  const match = compareMedicines(a, b);
  return match === "SAME" || match === "TYPO";
}

/**
 * A medicine name with reading slips corrected to the listed spelling
 * ("Crosin 500" → "Crocin 500", "Cetrizine" → "Cetirizine"), and what was
 * changed. Brand names stay brand names; unlisted names are left as written.
 */
export function correctMedicineSpelling(name: string): {
  name: string;
  changes: { from: string; to: string; cost: number }[];
} {
  const changes: { from: string; to: string; cost: number }[] = [];
  const corrected = name.replace(/[A-Za-z]{4,}/g, (token) => {
    const lower = token.toLowerCase();
    if (NOISE.has(lower) || SALTS.has(lower) || formWordOf(lower)) return token;
    const s = snap(lower);
    if (!s || s.cost === 0 || s.spelling === lower) return token;
    const to =
      token === token.toUpperCase()
        ? s.spelling.toUpperCase()
        : token[0] === token[0].toUpperCase()
          ? s.spelling[0].toUpperCase() + s.spelling.slice(1)
          : s.spelling;
    changes.push({ from: token, to, cost: s.cost });
    return to;
  });
  return { name: corrected, changes };
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

// ---------------------------------------------------------------------------
// Misspelt and misread form words. Reporters type quickly ("flutifer nassal
// spary") and handwriting is read imperfectly ("Nanal spry"), so form and route
// words are matched with room for one slip in longer words. Short words only
// match listed misspellings, and real words one slip away ("basal",
// "infection", "loose motions") are never taken for form words.

/** Edit distance in which two swapped letters ("spary") count as one slip. */
function typoDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

/** Listed misspellings of short form words, where general slip matching would hit real words ("stray", "basal"). */
const MISSPELT: Record<string, string[]> = {
  nasal: [
    "nassal",
    "nasel",
    "nazal",
    "nasl",
    "nasall",
    "naasal",
    "nsal",
    "nasual",
    "nesal",
    "nasaal",
    "nanal",
    "nasol",
  ],
  spray: ["spary", "sprey", "spry", "sprae", "sprsy", "spraay", "sparay", "spraye", "sprays", "spay"],
  drops: ["drop", "drps", "dorps", "drpos", "dropps", "drope"],
  syrup: ["syrp", "sirup", "syrap", "syrop", "syurp", "syrups"],
  cream: ["crem", "creem", "craem", "creme"],
  eye: ["eyes", "eys", "eyee"],
  ear: ["ears"],
};
/** Real words one slip away from a form or route word. */
const LOOK_ALIKES = new Set(
  (
    "basal natal tables tabled infection infections inflection typical tropical motion motions notion potion potions " +
    "morally rally batches matches catches watches exhalation rental recital confusion effusion stray pray"
  ).split(" "),
);

/** True when a written word is the given form or route word, allowing one slip in longer words ("inhailer"). */
export function isFormWord(token: string, word: string): boolean {
  const t = token.toLowerCase();
  if (t === word || MISSPELT[word]?.includes(t)) return true;
  if (word.length < 6 || t.length < 5 || LOOK_ALIKES.has(t)) return false;
  const distance = typoDistance(t, word);
  return distance <= 1 || (word.length >= 11 && distance <= 2);
}

/** Form words that are corrected in names and ignored when matching medicines. */
const FORM_WORDS = [
  "nasal",
  "spray",
  "drops",
  "syrup",
  "cream",
  "eye",
  "tablet",
  "tablets",
  "capsule",
  "capsules",
  "inhaler",
  "inhalers",
  "injection",
  "ointment",
  "suspension",
  "lotion",
  "respules",
  "rotacaps",
  "suppository",
  "nostril",
  "ophthalmic",
];
const formWordOf = (token: string) => FORM_WORDS.find((w) => isFormWord(token, w));

/** A medicine name with misspelt form words corrected ("flutifer nassal spary" → "flutifer nasal spray"). The medicine's own name is never changed. */
export function tidyMedicineName(name: string): string {
  return name.replace(/[A-Za-z]+/g, (token) => {
    const word = formWordOf(token);
    if (!word || token.toLowerCase() === word || NOISE.has(token.toLowerCase())) return token;
    return token[0] === token[0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word;
  });
}

// Order matters: specific forms before general ones ("nasal spray" before "spray", "eye ointment" before "ointment").
const ROUTE_RULES: { route: string; words: string[]; pattern?: RegExp }[] = [
  { route: "Nasal", words: ["nasal", "intranasal", "nostril", "nostrils", "nose"] },
  { route: "Ophthalmic", words: ["eye", "ophthalmic", "ocular", "eyedrops", "eyedrop"], pattern: /\be\/d\b/ },
  { route: "Otic", words: ["ear", "otic", "aural", "eardrops"] },
  {
    route: "Inhalation",
    words: [
      "inhaler",
      "inhalers",
      "inhalation",
      "inhaled",
      "inhale",
      "rotacap",
      "rotacaps",
      "respule",
      "respules",
      "nebulizer",
      "nebuliser",
      "nebulization",
      "nebulisation",
      "nebulized",
      "nebulised",
      "neb",
      "mdi",
      "dpi",
      "puff",
      "puffs",
    ],
  },
  { route: "Sublingual", words: ["sublingual"], pattern: /\b(?:s\/l|under the tongue)\b/ },
  { route: "Transdermal", words: ["transdermal", "patch", "patches"] },
  { route: "Rectal", words: ["suppository", "suppositories", "rectal"], pattern: /\bper rectum\b/ },
  { route: "Vaginal", words: ["vaginal", "pessary", "pessaries"], pattern: /\bper vaginum\b/ },
  { route: "Intravenous", words: ["iv", "intravenous", "intravenously", "infusion", "drip"], pattern: /\bi\.v\b/ },
  { route: "Intramuscular", words: ["im", "intramuscular", "intramuscularly"], pattern: /\bi\.m\b/ },
  { route: "Subcutaneous", words: ["sc", "subcutaneous", "subcutaneously", "subcut"], pattern: /\b(?:s\.c|sub-cut)\b/ },
  {
    route: "Topical",
    words: ["cream", "ointment", "oint", "gel", "lotion", "topical", "topically", "apply"],
    pattern: /\b(?:dusting powder|local application)\b/,
  },
  {
    route: "Oral",
    words: [
      "tab",
      "tabs",
      "tablet",
      "tablets",
      "cap",
      "caps",
      "capsule",
      "capsules",
      "syrup",
      "syp",
      "syr",
      "suspension",
      "susp",
      "oral",
      "orally",
      "po",
      "sachet",
      "sachets",
      "granules",
      "dispersible",
      "chewable",
      "lozenge",
      "lozenges",
      "mouthwash",
    ],
    pattern: /\b(?:p\.o|by mouth|mouth wash)\b/,
  },
];

/**
 * The route a dosage form implies, with the words it was taken from, or null
 * when the form does not decide it (an "injection" can be IV, IM or SC; a
 * "spray" alone can be nasal, oral or skin). Misspelt forms count.
 */
export function inferRoute(texts: (string | null | undefined)[]): { route: string; basis: string } | null {
  const text = texts.filter(Boolean).join(" ").toLowerCase();
  if (!text.trim()) return null;
  const tokens = text.match(/[a-z]+/g) ?? [];
  for (const rule of ROUTE_RULES) {
    const viaPattern = rule.pattern && text.match(rule.pattern);
    if (viaPattern) return { route: rule.route, basis: viaPattern[0] };
    const token = tokens.find((t) => rule.words.some((w) => isFormWord(t, w)));
    if (token) return { route: rule.route, basis: token };
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

// ---------------------------------------------------------------------------
// Medicines written in free text. The assistant's AI reading lists the
// medicines in a message, but it can leave one out. These fixed rules catch
// names written with a dosage form or strength ("Fluticasone nasal spray",
// "flutifer nassal spary", "Inj. Ceftriaxone", "metformin 500 mg") so none is
// silently dropped. A name found this way is never placed in the report by
// itself: the reporter is asked how it belongs (suspected, other, treatment or
// not relevant).

/** Words that can stand next to a form or strength but are not medicine names. */
const NOT_NAMES = new Set(
  (
    "the this that these those with from some many more most much also used uses using took take takes taking taken " +
    "given give gave giving start started starting stop stopped daily twice thrice once then than after before about " +
    "around approx approximately nearly over under into onto upon each every other another same dose doses dosage total " +
    "extra both their there they them when where which while what were have having been being does done just only very " +
    "again still since until till last next first second third three four five seven eight nine days weeks months years " +
    "hours morning night evening patient patients prescribed prescription medicine medicines medication medications drug " +
    "drugs pressure sugar sleeping sleep pain painkiller painkillers allergy allergic fever cough cold headache antibiotic " +
    "antibiotics steroid steroids vitamin vitamins supplement supplements herbal ayurvedic homeopathic contraceptive " +
    "thyroid diabetes diabetic asthma hemoglobin haemoglobin creatinine glucose bilirubin urea albumin protein cholesterol " +
    "platelets platelet temperature weight weighs weighing regular usual normal high higher low lower full half quarter " +
    "single double maximum minimum would could should might must will shall need needed want like such everyday rash " +
    "itching itchy swelling reaction symptoms test tests result results level levels count blood urine serum every"
  ).split(" "),
);
/** First words that belong to a two-word name ("Insulin glargine", "Sodium valproate"). */
const NAME_PREFIXES = new Set(
  "insulin vitamin ferrous folic calcium magnesium zinc sodium potassium human isosorbide".split(" "),
);
const UNITS = new Set(["mg", "mcg", "µg", "gm", "g", "ml", "iu", "unit", "units", "%"]);
const PREFIX_FORMS = [
  "tab",
  "tabs",
  "tablet",
  "cap",
  "caps",
  "capsule",
  "inj",
  "injection",
  "syp",
  "syr",
  "syrup",
  "susp",
];
const PREFIX_FORMS_TOO = ["oint", "ointment", "cream", "gel"];
const FORMS: string[][] = [
  ["nasal", "spray"],
  ["nasal", "drops"],
  ["eye", "drops"],
  ["eye", "ointment"],
  ["ear", "drops"],
  ["ophthalmic", "drops"],
  ["ophthalmic", "solution"],
  ["ophthalmic", "ointment"],
  ["otic", "drops"],
  ["oral", "suspension"],
  ["oral", "drops"],
  ["oral", "solution"],
  ["topical", "cream"],
  ["vaginal", "pessary"],
  ...[
    "nasal",
    "inhaler",
    "inhalers",
    "rotacaps",
    "rotacap",
    "respules",
    "tablet",
    "tablets",
    "tab",
    "tabs",
    "capsule",
    "capsules",
    "cap",
    "caps",
    "syrup",
    "suspension",
    "injection",
    "cream",
    "ointment",
    "gel",
    "lotion",
    "drops",
    "spray",
    "patch",
    "patches",
    "suppository",
    "pessary",
    "sachet",
    "sachets",
    "mouthwash",
    "infusion",
  ].map((w) => [w]),
];
const NEGATED = /\b(?:no|not|never|without|denies|denied|didn'?t|did not|nor|avoid(?:ed)?)\b[^.;,]*$/i;

type Token = { text: string; lower: string; start: number; end: number };
const isFormToken = (t: Token | undefined) =>
  Boolean(t) &&
  [...FORMS.flat(), ...PREFIX_FORMS, ...PREFIX_FORMS_TOO, "nostril", "nostrils", "solution"].some((w) =>
    isFormWord(t!.lower, w),
  );
const isNameToken = (t: Token | undefined) =>
  Boolean(t) &&
  /^[a-z][a-z-]{3,}$/.test(t!.lower) &&
  !NOT_NAMES.has(t!.lower) &&
  !NOISE.has(t!.lower) &&
  !SALTS.has(t!.lower) &&
  !LOOK_ALIKES.has(t!.lower) &&
  !isFormToken(t);

/** Common words that are also listed ingredients; they are not taken for medicines on their own. */
const PLAIN_WORDS = new Set(
  "iron zinc calcium vitamin magnesium potassium sodium folic lithium insulin oxygen".split(" "),
);
/** A listed medicine name written on its own: exact (4+ letters), or a slip in a name of 6+ letters. */
function knownOnItsOwn(word: string): boolean {
  if (word.length < 4 || PLAIN_WORDS.has(word) || NOT_NAMES.has(word)) return false;
  const s = snap(word);
  return Boolean(s && (s.cost === 0 || (word.length >= 6 && s.cost <= 0.5)));
}

/**
 * Medicine names written with a dosage form or strength, or a listed name on its own, as { name, quote }.
 * Deliberately narrow: a bare word with no form or strength is left to the AI
 * reading, and negated mentions ("no paracetamol tablets") are ignored. The
 * name has misspelt form words corrected; the quote is as written.
 */
export function findMedicineMentions(text: string): { name: string; quote: string }[] {
  const tokens: Token[] = [...text.matchAll(/\d+(?:\.\d+)?|[A-Za-zµ][A-Za-z-]*|%/g)].map((m) => ({
    text: m[0],
    lower: m[0].toLowerCase(),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  const gap = (a: Token, b: Token | undefined, allowDot = false) =>
    Boolean(b) && (allowDot ? /^\s*\.?\s*$/ : /^\s*$/).test(text.slice(a.end, b!.start));
  /** Tokens taken by a strength at i ("500 mg", "1 g"); lab concentrations such as "mg/dl" are not strengths. */
  const strengthAt = (i: number) =>
    /^\d/.test(tokens[i]?.text ?? "") &&
    UNITS.has(tokens[i + 1]?.lower ?? "") &&
    gap(tokens[i], tokens[i + 1]) &&
    !/^\s*\/\s*d?l\b/i.test(text.slice(tokens[i + 1].end))
      ? 2
      : 0;
  /** Tokens taken by a dosage form at i ("nasal spray", "nassal spary", "tablets"). */
  const formAt = (i: number) => {
    for (const form of FORMS)
      if (
        form.every(
          (w, k) =>
            tokens[i + k] && isFormWord(tokens[i + k].lower, w) && (k === 0 || gap(tokens[i + k - 1], tokens[i + k])),
        )
      )
        return form.length;
    return 0;
  };
  const found: { quote: string; at: number }[] = [];
  const add = (from: number, to: number) => {
    let start = tokens[from].start;
    if (NEGATED.test(text.slice(Math.max(0, start - 40), start))) return;
    // Include a first word that belongs to the name ("Sodium valproate 200 mg").
    const before = tokens[from - 1];
    if (before && NAME_PREFIXES.has(before.lower) && gap(before, tokens[from])) start = before.start;
    found.push({ quote: text.slice(start, tokens[to].end).trim(), at: start });
  };
  /** A bare number right after a name is part of it ("Dolo 650", "Metformin 500"). */
  const numberAt = (i: number) =>
    /^\d{2,4}$/.test(tokens[i]?.text ?? "") && gap(tokens[i - 1], tokens[i]) && !UNITS.has(tokens[i + 1]?.lower ?? "")
      ? 1
      : 0;
  tokens.forEach((token, i) => {
    // "T. Metformin", "C. Amox": a capital T or C with a dot is "Tab." or "Cap."
    if (/^[TC]$/.test(token.text) && text[token.end] === "." && isNameToken(tokens[i + 1])) {
      const strength = gap(tokens[i + 1], tokens[i + 2]) ? strengthAt(i + 2) || numberAt(i + 2) : 0;
      add(i, i + 1 + strength);
      return;
    }
    // "Inj. Ceftriaxone 1 g", "Tab. Dolo"
    if (
      [...PREFIX_FORMS, ...PREFIX_FORMS_TOO].some((w) => isFormWord(token.lower, w)) &&
      isNameToken(tokens[i + 1]) &&
      gap(token, tokens[i + 1], true)
    ) {
      const strength = gap(tokens[i + 1], tokens[i + 2]) ? strengthAt(i + 2) : 0;
      add(i, i + 1 + strength);
      return;
    }
    if (!isNameToken(token)) return;
    // "Fluticasone nasal spray", "Amoxycillin 500mg caps", "metformin 500 mg"
    const strength = gap(token, tokens[i + 1]) ? strengthAt(i + 1) : 0;
    const formStart = i + 1 + strength;
    const form = tokens[formStart] && gap(tokens[formStart - 1], tokens[formStart]) ? formAt(formStart) : 0;
    if (form) add(i, formStart + form - 1);
    else if (strength) add(i, i + strength);
    else if (knownOnItsOwn(token.lower)) add(i, i + numberAt(i + 1));
  });
  // One entry per medicine; the longest wording wins ("Amoxycillin 500mg caps" over "Amoxycillin 500mg").
  const byKey = new Map<string, { quote: string; at: number }>();
  for (const f of found) {
    const key = medicineKey(f.quote);
    const existing = byKey.get(key);
    if (!existing || f.quote.length > existing.quote.length) byKey.set(key, f);
  }
  return [...byKey.values()]
    .sort((a, b) => a.at - b.at)
    .map(({ quote }) => ({ name: correctMedicineSpelling(tidyMedicineName(quote)).name, quote }));
}

/** A frequency in one wording ("TDS", "1-1-1", "three times a day" are all "3/day"), or null when unrecognised. */
export function frequencyCode(text: string): string | null {
  const v = text.toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
  const rules: [RegExp, string][] = [
    [/^(?:od|qd|once (?:a |per )?day|once daily|daily|every day|1-0-0|0-1-0|1 time (?:a|per) day|q24h)$/, "1/day"],
    [
      /^(?:bd|bid|twice (?:a |per )?day|twice daily|2 times (?:a |per )?day|two times (?:a |per )?day|1-0-1|1-1-0|0-1-1|q12h|every 12 hours)$/,
      "2/day",
    ],
    [
      /^(?:tds|tid|thrice (?:a |per )?day|thrice daily|3 times (?:a |per )?day|three times (?:a |per )?day|three times daily|1-1-1|q8h|every 8 hours)$/,
      "3/day",
    ],
    [
      /^(?:qid|qds|4 times (?:a |per )?day|four times (?:a |per )?day|four times daily|1-1-1-1|q6h|every 6 hours)$/,
      "4/day",
    ],
    [/^(?:hs|at night|at bedtime|nightly|every night|once at night|0-0-1)$/, "night"],
    [/^(?:sos|prn|as needed|as required|when needed|when required|if needed|as and when required)$/, "as needed"],
    [/^(?:stat|single dose|once only|one dose)$/, "once"],
    [/^(?:weekly|once (?:a |per )?week|once weekly)$/, "1/week"],
  ];
  return rules.find(([pattern]) => pattern.test(v))?.[1] ?? null;
}

const DOSE_TEXT =
  /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|gm|g|ml|iu|units?|amps?|ampoules?|vials?|tabs?|tablets?|caps?|capsules?|puffs?|drops?|sprays?|sachets?)\b/i;
const ROUTE_TEXT =
  /\b(?:i\.?m\.?|i\.?v\.?|s\.?c\.?|s\/c|p\.?o\.?|s\/l|per oral|orally|oral|intramuscular(?:ly)?|intravenous(?:ly)?|subcutaneous(?:ly)?|sublingual)(?![a-z])/i;
const FREQUENCY_TEXT =
  /\b(?:od|bd|bid|tds|tid|qid|qds|hs|sos|prn|stat|once daily|twice daily|thrice daily|once a day|twice a day|three times a day|four times a day|at bedtime|at night|[01]-[01]-[01](?:-[01])?)\b/i;

/**
 * Dose, route and frequency written next to a medicine in prescription style:
 * "T. Cetrizine 10mg HS", "Inj. Avil 1 amp IM stat", "T. Metformin 500 BD".
 * Each value comes with the words it was read from.
 */
export function prescriptionDetails(text: string): {
  name: string;
  dose?: string;
  route?: string;
  frequency?: string;
}[] {
  const out: { name: string; dose?: string; route?: string; frequency?: string }[] = [];
  let from = 0;
  for (const mention of findMedicineMentions(text)) {
    const at = text.indexOf(mention.quote, from);
    if (at < 0) continue;
    from = at + mention.quote.length;
    // The words after the name, up to the next medicine or sentence.
    const tail = text.slice(from).match(/^[^,;\n+]*?(?=[,;\n+]|\.(?:\s|$)|\s(?:and|with|then)\s|$)/)?.[0] ?? "";
    const dose = tail.match(DOSE_TEXT)?.[0] ?? mention.quote.match(DOSE_TEXT)?.[0];
    const route = tail.match(ROUTE_TEXT)?.[0];
    const frequency = tail.match(FREQUENCY_TEXT)?.[0];
    if (dose || route || frequency)
      out.push({
        name: mention.name,
        ...(dose ? { dose: dose.trim() } : {}),
        ...(route ? { route: route.trim() } : {}),
        ...(frequency ? { frequency: frequency.trim() } : {}),
      });
  }
  return out;
}

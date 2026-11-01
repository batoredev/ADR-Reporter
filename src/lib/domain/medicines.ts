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
        (w) =>
          !NOISE.has(w) &&
          !formWordOf(w) &&
          !/^\d+(\.\d+)?$/.test(w) &&
          !/^(mg|mcg|µg|g|gm|ml|iu|units?|%|w\/v|w\/w)$/.test(w),
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

/**
 * Medicine names written with a dosage form or strength, as { name, quote }.
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
  tokens.forEach((token, i) => {
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
  });
  // One entry per medicine; the longest wording wins ("Amoxycillin 500mg caps" over "Amoxycillin 500mg").
  const byKey = new Map<string, { quote: string; at: number }>();
  for (const f of found) {
    const key = medicineKey(f.quote);
    const existing = byKey.get(key);
    if (!existing || f.quote.length > existing.quote.length) byKey.set(key, f);
  }
  return [...byKey.values()].sort((a, b) => a.at - b.at).map(({ quote }) => ({ name: tidyMedicineName(quote), quote }));
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

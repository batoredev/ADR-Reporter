// Fixed readers for the short answers hospital staff type most often: a
// patient line ("R.K., 34/F"), a date as written in India (day first:
// "14/10/26", "14 Oct 2026"). They answer instantly, without the AI, and return
// nothing when the text is not clearly in one of these forms.
import { isValidPartialDate } from "./partial-date";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
/** "26" is 2026; a two-digit year never lands in the future. */
function fullYear(y: string, today = new Date()): number {
  if (y.length === 4) return Number(y);
  const n = Number(y);
  const century = Math.floor(today.getFullYear() / 100) * 100;
  return century + n > today.getFullYear() + 1 ? century - 100 + n : century + n;
}
const monthOf = (word: string) => MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;

/**
 * A date written the Indian way, as an ISO partial date ("2026-10-14",
 * "2026-10" or "2026"), or null when the text is not just a date.
 * Numeric dates are day first: 10/11/26 is 10 November 2026.
 */
export function parseIndianDate(text: string, today = new Date()): string | null {
  const v = text
    .trim()
    .toLowerCase()
    .replace(/(\d)(st|nd|rd|th)\b/g, "$1")
    .replace(/[,]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^(?:on|from|since|by|around|about)\s+/, "")
    .replace(/\.$/, "");
  let iso: string | null = null;
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/))) iso = v;
  else if ((m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)))
    iso = `${fullYear(m[3], today)}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  else if ((m = v.match(/^(\d{1,2})[/.-](\d{4})$/))) iso = `${m[2]}-${pad(Number(m[1]))}`;
  else if ((m = v.match(/^(\d{1,2}) ([a-z]+) (\d{2}|\d{4})$/)) && monthOf(m[2]))
    iso = `${fullYear(m[3], today)}-${pad(monthOf(m[2]))}-${pad(Number(m[1]))}`;
  else if ((m = v.match(/^([a-z]+) (\d{1,2}) (\d{4})$/)) && monthOf(m[1]))
    iso = `${m[3]}-${pad(monthOf(m[1]))}-${pad(Number(m[2]))}`;
  else if ((m = v.match(/^([a-z]+) (\d{2}|\d{4})$/)) && monthOf(m[1]))
    iso = `${fullYear(m[2], today)}-${pad(monthOf(m[1]))}`;
  return iso && isValidPartialDate(iso) ? iso : null;
}

export interface PatientLine {
  initials?: string;
  age?: string;
  ageUnit?: "YEARS" | "MONTHS" | "WEEKS" | "DAYS";
  gender?: "MALE" | "FEMALE" | "OTHER";
  weightKg?: string;
}

/**
 * The patient as typed in one line: "R.K., 34, female", "RK 34/F", "A.K, 24 yrs, M, 54 kg",
 * "8 months, male". Only what is clearly there is returned.
 */
export function parsePatientLine(text: string): PatientLine {
  const out: PatientLine = {};
  let rest = ` ${text.trim()} `;
  const weight = rest.match(/(\d{1,3}(?:\.\d)?)\s*kgs?\b/i);
  if (weight) {
    out.weightKg = weight[1];
    rest = rest.replace(weight[0], " ");
  }
  const initials = rest.match(
    /^\s*(?:[Pp][Tt]\.?|[Pp]atient)?\s*([A-Za-z](?:\s?\.\s?[A-Za-z]){1,2}\.?|[A-Z]{2,3}|[A-Z]\s[A-Z])(?=[\s,;:/-])/,
  );
  if (initials) {
    const letters = initials[1].replace(/[^A-Za-z]/g, "").toUpperCase();
    if (letters.length >= 2 && letters.length <= 3) out.initials = `${letters.split("").join(".")}.`;
    rest = rest.replace(initials[0], " ");
  }
  const age = rest.match(
    /\b(\d{1,3})\s*(?:(years?|yrs?|y\/?o|y|months?|mos?|weeks?|wks?|days?)\b)?(?:\s*old)?\s*(?:\/\s*([mf])\b|([mf])\b)?/i,
  );
  if (age) {
    out.age = age[1];
    const unit = (age[2] ?? "").toLowerCase();
    if (/^(?:month|mo)/.test(unit)) out.ageUnit = "MONTHS";
    else if (/^(?:week|wk)/.test(unit)) out.ageUnit = "WEEKS";
    else if (/^day/.test(unit)) out.ageUnit = "DAYS";
    else if (unit || Number(age[1]) >= 2) out.ageUnit = "YEARS";
    const g = (age[3] ?? age[4] ?? "").toLowerCase();
    if (g) out.gender = g === "m" ? "MALE" : "FEMALE";
    rest = rest.replace(age[0], " ");
  }
  if (!out.gender) {
    if (/\b(?:male|man|boy|m|gentleman|mr)\b/i.test(rest) && !/\b(?:female|woman|girl|lady)\b/i.test(rest))
      out.gender = "MALE";
    else if (/\b(?:female|woman|girl|lady|f|mrs|ms|miss)\b/i.test(rest)) out.gender = "FEMALE";
    else if (/\b(?:other|transgender)\b/i.test(rest)) out.gender = "OTHER";
  }
  return out;
}

/**
 * True when a short line holds only patient details (initials, age and unit, gender, weight), so the fixed
 * reader above loses nothing. "A.K. 24 M, nose bleed after flutifer" or a full name returns false.
 */
export function onlyPatientWords(text: string): boolean {
  const rest = ` ${text} `
    .replace(/\b[A-Za-z](?:\s?\.\s?[A-Za-z]){1,2}\.?(?=[\s,;:/-])/g, " ")
    .replace(/\b[A-Z]{2,3}\b/g, " ")
    .replace(/\d+(?:\.\d+)?/g, " ")
    .toLowerCase()
    .replace(
      /\b(?:pt|patient|aged?|old|years?|yrs?|yr|y|y\/o|yo|months?|mos?|weeks?|wks?|days?|kgs?|kilos?|weighs?|weight|m|f|male|female|man|woman|boy|girl|lady|gentleman|mr|mrs|ms|miss|other|and)\b/g,
      " ",
    )
    .replace(/[^a-z]+/g, " ")
    .trim();
  return rest === "";
}

// ---------------------------------------------------------------------------
// Dates written relative to today or to another event: "yesterday", "3 days
// ago", "since 2 days", "last Monday", "2 days after the prescription", "on day
// 3 of amoxicillin". The arithmetic is done here, never by the AI. Anything
// ambiguous (two different prescription dates, "a few days") returns null and
// is left to the AI reading, which is then marked for a look.

/** Dates the words can be counted from. All are ISO YYYY-MM-DD. */
export interface DateAnchors {
  /** The day the words were written (India time). */
  today: string;
  /** Dates written on the uploaded prescriptions or notes. */
  prescriptions?: string[];
  /** Start dates of medicines already in the report. */
  medicineStarts?: { name: string; date: string }[];
  /** The reaction's start date, if known. */
  reactionStart?: string;
}
export interface ResolvedDate {
  date: string;
  approximate: boolean;
  /** What it was counted from, for the note shown to the reporter. */
  basis: string;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  couple: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fourteen: 14,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
};
const COUNT =
  "(\\d{1,3}|a|an|one|two|couple(?: of)?|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen|fifteen|twenty|thirty)";
const UNIT = "(days?|d|weeks?|wks?|months?|mons?)";
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const isFullDate = (d: string | undefined): d is string => Boolean(d && /^\d{4}-\d{2}-\d{2}$/.test(d));
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
function shift(iso: string, days: number) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}
function shiftMonths(iso: string, months: number) {
  const d = toDate(iso);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  return toIso(d).slice(0, 7);
}
const countOf = (word: string) => (/^\d+$/.test(word) ? Number(word) : (NUMBER_WORDS[word.replace(/ of$/, "")] ?? NaN));
const unitDays = (unit: string) => (/^w/.test(unit) ? 7 : 1);
const isMonth = (unit: string) => /^mon/.test(unit);

/** The anchor a phrase refers to ("the prescription", "starting amoxicillin", "the rash"), or null if unclear. */
function anchorFor(phrase: string, anchors: DateAnchors): { date: string; basis: string } | null {
  const p = phrase.toLowerCase();
  if (/prescri|\brx\b|visit|consult|opd|the doctor/.test(p)) {
    const dates = [...new Set((anchors.prescriptions ?? []).filter(isFullDate))];
    return dates.length === 1 ? { date: dates[0], basis: "the prescription date" } : null;
  }
  if (/rash|reaction|symptom|onset|itch|swelling|it (?:started|began|appeared)/.test(p))
    return isFullDate(anchors.reactionStart) ? { date: anchors.reactionStart, basis: "the reaction start date" } : null;
  const starts = (anchors.medicineStarts ?? []).filter((m) => isFullDate(m.date));
  const named = starts.filter((m) =>
    m.name
      .toLowerCase()
      .split(/[^a-z]+/)
      .some((w) => w.length >= 4 && p.includes(w)),
  );
  if (named.length === 1) return { date: named[0].date, basis: `the start of ${named[0].name}` };
  if (
    /start|first dose|began|taking|treatment|therapy|course|medicine|drug|tablet|injection|capsule|syrup|dose/.test(p)
  ) {
    const dates = [...new Set(starts.map((m) => m.date))];
    if (dates.length === 1) return { date: dates[0], basis: `the start of ${starts[0].name}` };
  }
  return null;
}

/**
 * A date written in words, resolved against today and the known dates, or null when it is not a relative date
 * or the reference is unclear. Partial results (a month) are returned as YYYY-MM.
 */
export function resolveRelativeDate(text: string, anchors: DateAnchors): ResolvedDate | null {
  if (!isFullDate(anchors.today)) return null;
  const v = ` ${text
    .toLowerCase()
    .replace(/[.,;!]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
  const approx = /\b(?:about|around|approx\w*|roughly|nearly|almost|~)\b/.test(v);
  const today = anchors.today;
  let m: RegExpMatchArray | null;

  // Counted from another event: "2 days after the prescription", "a week before the rash".
  if (
    (m = v.match(
      new RegExp(`\\b${COUNT}\\s*${UNIT}\\s+(after|from|post|following|later than|since|before|prior to)\\s+(.+)$`),
    ))
  ) {
    const n = countOf(m[1]);
    const anchor = anchorFor(m[4], anchors);
    if (anchor && Number.isFinite(n) && !isMonth(m[2])) {
      const sign = /before|prior/.test(m[3]) ? -1 : 1;
      return { date: shift(anchor.date, sign * n * unitDays(m[2])), approximate: approx, basis: anchor.basis };
    }
    if (anchor || !/ago|back/.test(v)) return null;
  }
  // "On day 3 of amoxicillin": day 1 is the start day.
  if ((m = v.match(/\bday\s+(\d{1,3})\s+(?:of|after starting|on)\s+(.+)$/))) {
    const anchor = anchorFor(m[2], anchors);
    return anchor ? { date: shift(anchor.date, Number(m[1]) - 1), approximate: approx, basis: anchor.basis } : null;
  }
  // "The same day as the prescription", "the next day after starting it".
  if (
    (m = v.match(
      /\b(?:the )?(same day|next day|following day|day after|day before)\b(?:\s+(?:as|after|of|the))*\s*(.*)$/,
    ))
  ) {
    const anchor = m[2].trim() ? anchorFor(m[2], anchors) : null;
    if (anchor) {
      const offset = m[1] === "same day" ? 0 : m[1] === "day before" ? -1 : 1;
      return { date: shift(anchor.date, offset), approximate: approx, basis: anchor.basis };
    }
    if (m[1] !== "day before" && m[1] !== "day after") return null;
  }

  // A day and month with no year ("on 14/10", "12 Nov"): this year, or last year if that would be in the future.
  if (
    (m = v.match(/^\s*(?:on|from|since|by|around|about)?\s*(\d{1,2})[/.-](\d{1,2})\s*$/)) ||
    (m = v.match(/^\s*(?:on|from|since|by|around|about)?\s*(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\s*$/))
  ) {
    const month = /^\d+$/.test(m[2]) ? Number(m[2]) : MONTH_NAMES.indexOf(m[2].slice(0, 3)) + 1;
    const day = Number(m[1]);
    if (month >= 1 && month <= 12) {
      let year = Number(today.slice(0, 4));
      const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (candidate > today) year -= 1;
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (isValidPartialDate(iso)) return { date: iso, approximate: approx, basis: "this year" };
    }
  }

  // Counted from today.
  if (/\bday before yesterday\b/.test(v)) return { date: shift(today, -2), approximate: approx, basis: "today" };
  if (/\b(?:yesterday|last night)\b/.test(v)) return { date: shift(today, -1), approximate: approx, basis: "today" };
  if (/\b(?:today|this morning|this afternoon|this evening|tonight|just now|now)\b/.test(v))
    return { date: today, approximate: approx, basis: "today" };
  if (
    (m = v.match(new RegExp(`\\b${COUNT}\\s*${UNIT}\\s+(?:ago|back|before now)\\b`))) ||
    (m = v.match(new RegExp(`\\bsince\\s+(?:the\\s+(?:last|past)\\s+)?${COUNT}\\s*${UNIT}\\b`)))
  ) {
    const n = countOf(m[1]);
    if (!Number.isFinite(n)) return null;
    if (isMonth(m[2])) return { date: shiftMonths(today, -n), approximate: true, basis: "today" };
    return { date: shift(today, -n * unitDays(m[2])), approximate: approx || /^w/.test(m[2]), basis: "today" };
  }
  if ((m = v.match(/\b(?:last|on|this past|past)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) {
    const back = (toDate(today).getUTCDay() - WEEKDAYS.indexOf(m[1]) + 7) % 7 || 7;
    return { date: shift(today, -back), approximate: approx, basis: "today" };
  }
  if (/\blast week\b/.test(v)) return { date: shift(today, -7), approximate: true, basis: "today" };
  if (/\blast month\b/.test(v)) return { date: shiftMonths(today, -1), approximate: approx, basis: "today" };
  if (/\bthis month\b/.test(v)) return { date: today.slice(0, 7), approximate: approx, basis: "today" };
  if (/\blast year\b/.test(v))
    return { date: String(Number(today.slice(0, 4)) - 1), approximate: approx, basis: "today" };
  return null;
}

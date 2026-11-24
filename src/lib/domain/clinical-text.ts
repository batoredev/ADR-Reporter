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

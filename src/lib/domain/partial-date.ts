// Partial dates as entered by reporters: "YYYY", "YYYY-MM" or "YYYY-MM-DD",
// optionally flagged as approximate. A missing day or month is never filled
// in, and the official form never receives placeholder characters.

export type DatePrecision = "year" | "month" | "day";

export interface PartialDate {
  year: number;
  month?: number; // 1-12
  day?: number; // 1-31
}

const PATTERN = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Parses a stored partial date; returns null for anything malformed or impossible. */
export function parsePartialDate(value: string | null | undefined): PartialDate | null {
  if (!value) return null;
  const match = PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  if (year < 1900 || year > 2100) return null;
  if (match[2] === undefined) return { year };
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  if (match[3] === undefined) return { year, month };
  const day = Number(match[3]);
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function isValidPartialDate(value: string): boolean {
  return parsePartialDate(value) !== null;
}

export function precisionOf(date: PartialDate): DatePrecision {
  if (date.day !== undefined) return "day";
  if (date.month !== undefined) return "month";
  return "year";
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Text for a box on the official PvPI form.
 * - exact date: 14/10/2026
 * - month precision: Oct 2026 (month in words, no dashes or zeros)
 * - year precision: 2026
 * - approximate: prefixed with "approx."
 */
export function formatForOfficialForm(value: string | null | undefined, approximate = false): string {
  const date = parsePartialDate(value);
  if (!date) return "";
  let text: string;
  if (date.day !== undefined && date.month !== undefined) {
    text = `${pad(date.day)}/${pad(date.month)}/${date.year}`;
  } else if (date.month !== undefined) {
    text = `${MONTHS_SHORT[date.month - 1]} ${date.year}`;
  } else {
    text = String(date.year);
  }
  return approximate ? `approx. ${text}` : text;
}

/** Human-readable text for the app's own screens, e.g. "14 October 2026" or "October 2026 (approx.)". */
export function formatForDisplay(value: string | null | undefined, approximate = false): string {
  const date = parsePartialDate(value);
  if (!date) return "";
  let text: string;
  if (date.day !== undefined && date.month !== undefined) {
    text = `${date.day} ${MONTHS_LONG[date.month - 1]} ${date.year}`;
  } else if (date.month !== undefined) {
    text = `${MONTHS_LONG[date.month - 1]} ${date.year}`;
  } else {
    text = String(date.year);
  }
  return approximate ? `${text} (approx.)` : text;
}

/**
 * The range of calendar days a partial date could refer to, as ISO strings.
 * Comparisons use the range, so "Oct 2026" is never treated as 1 October.
 */
export function dateRange(value: string | null | undefined): { earliest: string; latest: string } | null {
  const date = parsePartialDate(value);
  if (!date) return null;
  if (date.day !== undefined && date.month !== undefined) {
    const iso = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
    return { earliest: iso, latest: iso };
  }
  if (date.month !== undefined) {
    return {
      earliest: `${date.year}-${pad(date.month)}-01`,
      latest: `${date.year}-${pad(date.month)}-${pad(daysInMonth(date.year, date.month))}`,
    };
  }
  return { earliest: `${date.year}-01-01`, latest: `${date.year}-12-31` };
}

/** True only when `a` is certainly before `b` given both precisions. */
export function isDefinitelyBefore(a: string | null | undefined, b: string | null | undefined): boolean {
  const ra = dateRange(a);
  const rb = dateRange(b);
  if (!ra || !rb) return false;
  return ra.latest < rb.earliest;
}

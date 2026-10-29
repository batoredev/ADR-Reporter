import { isValidPartialDate } from "./partial-date";
import { SINGLE_FIELD_ORDER, singleValue, type DocumentExtraction, type ExtractedValue } from "./extraction";

export interface ExtractionQualityIssue {
  fieldName: string;
  index: number;
  message: string;
}
export const qualityKey = (fieldName: string, index: number) => `${index}:${fieldName}`;
export function patientInitialsMatch(
  current: string | null,
  extracted: string | null,
): "MATCH" | "DIFFERENT" | "UNKNOWN" {
  const norm = (s: string | null) => (s ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const a = norm(current);
  const b = norm(extracted);
  return !a || !b ? "UNKNOWN" : a === b ? "MATCH" : "DIFFERENT";
}
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const numbers = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));

/** Conservative evidence checks. These detect suspect replies, never certify the source image itself. */
export function reviewExtraction(input: DocumentExtraction) {
  const output = structuredClone(input);
  const issues: ExtractionQualityIssue[] = [];
  function inspect(
    p: ExtractedValue,
    fieldName: string,
    index: number,
    isDate = false,
    medicineDate?: "start" | "stop",
  ) {
    if (!p.value?.trim()) return;
    const value = p.value.trim();
    const source = p.sourceText?.trim() ?? "";
    const flag = (message: string) => {
      p.uncertain = true;
      issues.push({ fieldName, index, message });
    };
    if (!source) {
      flag("No readable source quote was supplied. Verify this value directly against the document.");
      return;
    }
    if (/\?|illegible|unreadable|unclear/i.test(source)) flag("The source quote indicates an unclear reading.");
    if (isDate) {
      if (/\b(?:approx(?:imate(?:ly)?)?|about|around|circa|estimated)\b|~/i.test(source) && !p.approximate) {
        p.approximate = true;
        flag("The source describes an approximate date; its approximate indicator has been retained for review.");
      }
      if (!isValidPartialDate(value)) flag("This is not a valid exact or partial date.");
      const [year, month, day] = value.split("-");
      const sourceNumbers = new Set(numbers(source));
      if (year && !sourceNumbers.has(String(Number(year))))
        flag("The proposed year is not explicit in its source quote.");
      if (
        month &&
        !sourceNumbers.has(String(Number(month))) &&
        !new RegExp(`\\b${months[Number(month) - 1]}[a-z]*\\b`, "i").test(source)
      )
        flag("The proposed month is not explicit in its source quote.");
      if (day && !sourceNumbers.has(String(Number(day)))) flag("The proposed day is not explicit in its source quote.");
      const numeric = source.match(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b/);
      if (numeric && Number(numeric[1]) <= 12 && Number(numeric[2]) <= 12 && numeric[1] !== numeric[2])
        flag("The source date could use day/month or month/day order. Check the original document.");
      if (medicineDate === "start" && !/\b(start(?:ed)?|since|from|commenc\w*|began|initiat\w*)\b/i.test(source))
        flag(
          "The quote does not identify a medicine start date. A prescription date must not be assumed to be a start date.",
        );
      if (
        medicineDate === "stop" &&
        !/\b(stop(?:ped)?|last|withdraw\w*|discontinu\w*|ended|until|through|to)\b/i.test(source)
      )
        flag("The quote does not identify a medicine stop date. Do not calculate it from duration or discharge date.");
    } else {
      const sourceNumbers = new Set(numbers(source));
      if (
        fieldName === "case:patient.weightKg" &&
        !/\bkg(?:s)?\b|\bkilograms?\b/i.test(source.replace(/(\d)([a-z])/gi, "$1 $2"))
      )
        flag("Kilograms are not explicit in the weight quote. Do not treat another unit as kg.");
      if (fieldName === "case:patient.ageUnit") {
        const units: Record<string, RegExp> = {
          YEARS: /\b(?:y|yrs?|years?)\b/i,
          MONTHS: /\b(?:m|mo|mos|months?)\b/i,
          WEEKS: /\b(?:w|wks?|weeks?)\b/i,
          DAYS: /\b(?:d|days?)\b/i,
        };
        if (!units[value]?.test(source.replace(/(\d)([a-z])/gi, "$1 $2")))
          flag("The age unit does not match its source quote. Do not assume years.");
      }
      if (fieldName === "case:patient.gender") {
        const genders: Record<string, RegExp> = {
          MALE: /\b(?:m|male)\b/i,
          FEMALE: /\b(?:f|female)\b/i,
          OTHER: /\bother\b/i,
        };
        if (!genders[value]?.test(source)) flag("The proposed gender is not explicit in its source quote.");
      }
      if (numbers(value).some((n) => !sourceNumbers.has(n)))
        flag("The proposed number does not appear in its source quote. Check dose, strength and units separately.");
      // Matching numbers alone cannot distinguish 5 mg from 5 mcg or mg/dL from mg/L.
      const quantities = (text: string) =>
        [...text.matchAll(/(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|kg|g|ml|l|mmol|mol|iu|u)(?:\s*\/\s*(dl|ml|l|kg))?\b/gi)].map(
          (m) => `${Number(m[1])}:${m[2].toLowerCase()}/${m[3]?.toLowerCase() ?? ""}`,
        );
      const knownQuantities = new Set(quantities(source));
      if (quantities(value).some((q) => !knownQuantities.has(q)))
        flag("The proposed quantity or units differ from the source quote. Unit conversions are not assumed.");
      if (["route", "frequency", "manufacturer", "batchLot"].includes(fieldName)) {
        const literal = (s: string) => s.toLowerCase().replace(/[\s.]/g, "");
        if (!literal(source).includes(literal(value)))
          flag(
            "This wording or identifier is not present in the source quote. Do not expand an ambiguous abbreviation or fill a missing detail.",
          );
      }
      if (fieldName === "name") {
        const canonical: Record<string, string> = {
          cap: "capsule",
          caps: "capsule",
          capsules: "capsule",
          tab: "tablet",
          tabs: "tablet",
          tablets: "tablet",
          inj: "injection",
        };
        const tokens = (s: string) => (s.toLowerCase().match(/[a-z]+/g) ?? []).map((t) => canonical[t] ?? t);
        const sourceTokens = new Set(tokens(source));
        if (tokens(value).some((t) => !sourceTokens.has(t)))
          flag(
            "The medicine name or formulation includes wording not found in its quote. Do not infer a generic name or dosage form.",
          );
      }
      if (fieldName === "frequency" && /\b(OD|QD|QOD|U|IU)\b/.test(source))
        flag("This abbreviation can be misread or ambiguous. Verify the written frequency.");
    }
  }
  for (const key of SINGLE_FIELD_ORDER) inspect(singleValue(output, key), `case:${key}`, 0, /Date$/.test(key));
  output.investigations.forEach((row, index) =>
    Object.entries(row).forEach(([field, p]) => inspect(p, `investigation:${field}`, index, field === "date")),
  );
  output.medications.forEach((row, index) =>
    Object.entries(row).forEach(([field, p]) =>
      inspect(
        p,
        field,
        index,
        /Date$/.test(field),
        field === "startDate" ? "start" : field === "stopDate" ? "stop" : undefined,
      ),
    ),
  );
  const seen = new Set<string>();
  output.medications.forEach((row, index) => {
    const identity = [row.name.value, row.dose.value, row.frequency.value, row.startDate.value]
      .map((v) => (v ?? "").toLowerCase().replace(/\s/g, ""))
      .join("|");
    if (row.name.value && seen.has(identity))
      Object.entries(row).forEach(([field, p]) => {
        if (p.value) {
          p.uncertain = true;
          issues.push({
            fieldName: field,
            index,
            message: "Possible duplicate medicine row. Check whether this is a separate prescription entry.",
          });
        }
      });
    seen.add(identity);
  });
  return { output, issues };
}

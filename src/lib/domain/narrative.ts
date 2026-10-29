// AI narrative for item 7: rough notes and the report's own fields become a
// short, factual account of what happened, in order. The AI may only restate
// what it was given; a check in code then lists every number, date and month
// in the draft that does not appear in the inputs, so the reporter can catch
// anything the model added.
import { z } from "zod";

export const narrativeSchema = z.object({
  narrative: z
    .string()
    .min(1)
    .max(4000)
    .describe("The narrative: factual, chronological, past tense, plain clinical English, at most about 150 words."),
  needsChecking: z
    .array(z.string())
    .describe("Anything in the inputs that is unclear or contradictory, each as a short question for the reporter."),
  leftOut: z
    .array(z.string())
    .describe("Details from the notes you did not use because they were unclear or not about the reaction."),
});

export type NarrativeOutput = z.infer<typeof narrativeSchema>;

export const NARRATIVE_INSTRUCTIONS = `You write the "Describe event / reaction" narrative of a FICTIONAL suspected adverse drug reaction report for a pharmacovigilance training prototype.
Turn the reporter's rough notes and the report details into a concise, professional narrative of what happened, in chronological order.
Rules:
- Use only facts present in the notes or report details. Never add a diagnosis, date, dose, lab result, symptom or outcome that is not there.
- Never state or suggest that a medicine caused the reaction; describe the sequence of events only.
- Copy dates, doses and numbers exactly as given. Write dates like "12 October 2026"; if the year is not given, leave it out.
- If something is unclear or the inputs contradict each other, do not resolve it yourself: list it in needsChecking.
- Do not include patient names or identifiers.`;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const numberTokens = (text: string) => (text.match(/\d+(?:\.\d+)?/g) ?? []).map((t) => String(Number(t)));

/** Months mentioned in a text: by name ("Oct", "October") or inside a numeric date (2026-10-12, 12/10/2026). */
function monthsIn(text: string): Set<number> {
  const found = new Set<number>();
  const lower = text.toLowerCase();
  MONTHS.forEach((name, i) => {
    if (new RegExp(`\\b${name.slice(0, 3)}(${name.slice(3)})?\\b`).test(lower)) found.add(i + 1);
  });
  for (const m of text.matchAll(/\b\d{4}-(\d{1,2})(?:-\d{1,2})?\b/g)) found.add(Number(m[1]));
  for (const m of text.matchAll(/\b\d{1,2}[/.-](\d{1,2})[/.-]\d{2,4}\b/g)) found.add(Number(m[1]));
  return found;
}

/**
 * Numbers and months in the draft that appear nowhere in the inputs. These are
 * the facts most likely to have been invented; the reporter must check them.
 */
export function unsupportedDetails(draft: string, inputs: string[]): string[] {
  const source = inputs.join("\n");
  const knownNumbers = new Set(numberTokens(source));
  const knownMonths = monthsIn(source);
  const flagged = new Set<string>();
  for (const raw of draft.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!knownNumbers.has(String(Number(raw)))) flagged.add(raw);
  }
  const lower = draft.toLowerCase();
  MONTHS.forEach((name, i) => {
    // Only a month used as a date ("12 May", "May 2026"), so "may" the verb is not flagged.
    const asDate = new RegExp(`\\b\\d{1,2}(st|nd|rd|th)?\\s+${name}\\b|\\b${name}\\s+\\d{1,4}\\b`);
    if (asDate.test(lower) && !knownMonths.has(i + 1)) {
      flagged.add(name[0].toUpperCase() + name.slice(1));
    }
  });
  return [...flagged];
}

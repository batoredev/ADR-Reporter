// Completeness and consistency checks for a report. They point out missing or
// contradictory information; they never change what the reporter entered.
import { todayInAppZone } from "@/lib/format";
import type { CaseFormValues } from "./case-form";
import { isDefinitelyBefore } from "./partial-date";

export interface Finding {
  path: string;
  message: string;
}

export interface Completeness {
  /** Mandatory fields (PvPI form page 2, section E) that are still missing. */
  missing: Finding[];
  /** Optional details neither entered nor marked unknown. */
  gaps: Finding[];
  /** Contradictions worth checking (dates out of order and similar). */
  warnings: Finding[];
  ready: boolean;
}

export interface ReporterProfile {
  name: string | null;
  email: string | null;
  phone: string | null;
  occupation: string | null;
}

const blank = (v: string | undefined | null) => !v || v.trim() === "";

export function assessCompleteness(
  v: CaseFormValues,
  reporter?: ReporterProfile,
  today: string = todayInAppZone(),
): Completeness {
  const missing: Finding[] = [];
  const gaps: Finding[] = [];
  const warnings: Finding[] = [];
  const unknown = new Set(v.unknownFields);

  if (blank(v.patientInitials)) missing.push({ path: "patientInitials", message: "Patient initials" });
  if (blank(v.ageValue) && blank(v.dateOfBirth.value))
    missing.push({ path: "age", message: "Age at onset of reaction, or date of birth" });
  if (blank(v.reactionTerms)) missing.push({ path: "reactionTerms", message: "Reaction term(s)" });
  if (blank(v.reactionStartDate.value))
    missing.push({ path: "reactionStartDate", message: "Date the reaction started" });
  const named = v.suspectedMedicines.filter((m) => !blank(m.name));
  if (named.length === 0)
    missing.push({ path: "suspectedMedicines", message: "At least one suspected medicine (name)" });
  if (reporter) {
    if (blank(reporter.name)) missing.push({ path: "reporter", message: "Reporter name (in your profile)" });
    if (blank(reporter.email) && blank(reporter.phone))
      missing.push({ path: "reporter", message: "Reporter email or contact number (in your profile)" });
  }

  const gap = (path: string, value: string, message: string) => {
    if (blank(value) && !unknown.has(path)) gaps.push({ path, message });
  };
  gap("gender", v.gender, "Gender");
  gap("weightKg", v.weightKg, "Weight");
  gap("seriousAnswer", v.seriousAnswer || (v.seriousnessCriteria.length ? "YES" : ""), "Seriousness");
  gap("outcome", v.outcome, "Outcome");
  if (blank(v.reactionDescription)) gaps.push({ path: "reactionDescription", message: "Description of the reaction" });
  for (const m of named) {
    const rowGap = (field: string, value: string, label: string) => {
      if (blank(value) && !m.unknownFields.includes(field))
        gaps.push({ path: `suspectedMedicines.${m.id ?? "new"}.${field}`, message: `${m.name}: ${label}` });
    };
    rowGap("dose", m.dose, "dose");
    rowGap("route", m.route, "route");
    rowGap("frequency", m.frequency, "frequency");
    rowGap("startDate", m.startDate.value, "date started");
    rowGap("indication", m.indication, "indication");
    if (!m.actionTaken)
      gaps.push({ path: `suspectedMedicines.${m.id ?? "new"}.actionTaken`, message: `${m.name}: action taken` });
  }

  // Consistency: only flagged when the dates are certainly out of order.
  const start = v.reactionStartDate.value;
  if (!v.reactionOngoing && isDefinitelyBefore(v.reactionStopDate.value, start))
    warnings.push({ path: "reactionStopDate", message: "The reaction stop date is before its start date." });
  for (const m of named) {
    const row = `suspectedMedicines.${m.id ?? "new"}`;
    if (isDefinitelyBefore(start, m.startDate.value))
      warnings.push({
        path: `${row}.startDate`,
        message: `The reaction started before ${m.name} was started. Check both dates.`,
      });
    if (!m.ongoing && isDefinitelyBefore(m.stopDate.value, m.startDate.value))
      warnings.push({ path: `${row}.stopDate`, message: `${m.name} was stopped before it was started.` });
  }
  if (v.seriousAnswer === "NO" && v.seriousnessCriteria.length > 0)
    warnings.push({ path: "seriousAnswer", message: "Seriousness is 'No' but seriousness criteria are ticked." });
  if (v.outcome === "FATAL" && !v.seriousnessCriteria.includes("DEATH"))
    warnings.push({
      path: "seriousnessCriteria",
      message: "Outcome is fatal but the 'Death' criterion is not ticked.",
    });
  if (v.seriousnessCriteria.includes("DEATH") && blank(v.deathDate.value))
    gaps.push({ path: "deathDate", message: "Date of death" });
  if (v.seriousnessCriteria.includes("DEATH") && v.outcome && v.outcome !== "FATAL" && v.outcome !== "UNKNOWN")
    warnings.push({ path: "outcome", message: "The 'Death' criterion is ticked but the outcome is not fatal." });
  if (v.seriousAnswer === "YES" && v.seriousnessCriteria.length === 0)
    warnings.push({ path: "seriousnessCriteria", message: "Seriousness is 'Yes': tick the criteria that apply." });
  if (isDefinitelyBefore(v.deathDate.value, start))
    warnings.push({ path: "deathDate", message: "The date of death is before the reaction started." });
  if (v.reactionOngoing && (v.outcome === "RECOVERED" || v.outcome === "RECOVERED_WITH_SEQUELAE"))
    warnings.push({ path: "outcome", message: "The reaction is marked ongoing but the outcome says recovered." });

  // Dates cannot be in the future.
  const future = (value: string, path: string, what: string) => {
    if (isDefinitelyBefore(today, value)) warnings.push({ path, message: `${what} is in the future.` });
  };
  future(v.reactionStartDate.value, "reactionStartDate", "The reaction start date");
  if (!v.reactionOngoing) future(v.reactionStopDate.value, "reactionStopDate", "The reaction stop date");
  future(v.deathDate.value, "deathDate", "The date of death");
  for (const m of named) {
    const row = `suspectedMedicines.${m.id ?? "new"}`;
    future(m.startDate.value, `${row}.startDate`, `${m.name}: the start date`);
    if (!m.ongoing) future(m.stopDate.value, `${row}.stopDate`, `${m.name}: the stop date`);
    if (m.ongoing && m.actionTaken === "DRUG_WITHDRAWN")
      warnings.push({
        path: `${row}.actionTaken`,
        message: `${m.name} is marked as still being taken, but the action taken says it was withdrawn.`,
      });
    const reintroduced = m.rechallenge === "YES" || m.rechallenge === "NO" || m.rechallenge === "EFFECT_UNKNOWN";
    if (reintroduced && m.actionTaken === "DOSE_NOT_CHANGED")
      warnings.push({
        path: `${row}.rechallenge`,
        message: `${m.name} is recorded as reintroduced, but the action taken says the dose was not changed.`,
      });
  }
  v.investigations.forEach((i) => {
    if (i.testName || i.result)
      future(i.date.value, `investigations.${i.id ?? "new"}.date`, `${i.testName || "A test"}: the date`);
  });

  // The same medicine entered twice, or as both suspected and concomitant.
  const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
  const seen = new Map<string, string>();
  for (const m of named) {
    const k = key(m.name);
    if (seen.has(k))
      warnings.push({ path: `suspectedMedicines.${m.id ?? "new"}.name`, message: `${m.name} is listed twice.` });
    seen.set(k, "suspected");
  }
  for (const p of v.concomitantProducts.filter((p) => !blank(p.name))) {
    const row = `concomitantProducts.${p.id ?? "new"}`;
    if (seen.get(key(p.name)) === "suspected")
      warnings.push({
        path: `${row}.name`,
        message: `${p.name} is listed as both a suspected medicine and a concomitant product.`,
      });
    if (p.usedToTreatReaction && isDefinitelyBefore(p.startDate.value, start))
      warnings.push({
        path: `${row}.startDate`,
        message: `${p.name} is marked as used to treat the reaction but was started before the reaction.`,
      });
    future(p.startDate.value, `${row}.startDate`, `${p.name}: the start date`);
  }

  return { missing, gaps, warnings, ready: missing.length === 0 };
}

// Field paths and labels shared by completeness checks, field comments,
// change highlighting and the PDF continuation sheet.
//
// Case-level paths use the form field names ("reactionStartDate"); row paths
// use "<list>.<rowId>.<field>" ("suspectedMedicines.ck1.stopDate").
import type { CaseSnapshot } from "./snapshot";

export const CASE_FIELD_LABELS: Record<string, string> = {
  patientInitials: "1. Patient initials",
  age: "2. Age at onset or date of birth",
  gender: "3. Gender",
  weightKg: "4. Weight (kg)",
  reactionStartDate: "5. Reaction start date",
  reactionStopDate: "6. Reaction stop date",
  reactionTerms: "7. Reaction term(s)",
  reactionDescription: "7. Reaction description",
  reactionManagement: "7. Reaction management",
  investigations: "12. Relevant investigations",
  medicalHistory: "13. Medical and medication history",
  seriousAnswer: "14. Seriousness",
  seriousnessCriteria: "14. Seriousness criteria",
  deathDate: "14. Date of death",
  outcome: "15. Outcome",
  additionalInformation: "Additional information",
  suspectedMedicines: "8. Suspected medicines",
  concomitantProducts: "11. Concomitant products",
  reporter: "16. Reporter details",
};

export const SUSPECTED_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  manufacturer: "Manufacturer",
  batchLot: "Batch / lot number",
  expiryDate: "Expiry date",
  dose: "Dose",
  route: "Route",
  frequency: "Frequency",
  startDate: "Date started",
  stopDate: "Date stopped",
  ongoing: "Ongoing",
  indication: "Indication",
  actionTaken: "9. Action taken",
  rechallenge: "10. Reintroduction",
  rechallengeDose: "10. Dose on reintroduction",
};

export const CONCOMITANT_FIELD_LABELS: Record<string, string> = {
  name: "Name",
  dose: "Dose",
  route: "Route",
  frequency: "Frequency",
  startDate: "Date started",
  stopDate: "Date stopped",
  ongoing: "Ongoing",
  indication: "Indication",
  usedToTreatReaction: "Used to treat the reaction",
};

export const INVESTIGATION_FIELD_LABELS: Record<string, string> = {
  testName: "Test",
  result: "Result",
  date: "Date",
};

const ROMAN = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"];

/** Human label for a field path, given the row order of the case it belongs to. */
export function fieldLabel(
  path: string,
  rows?: { suspected?: string[]; concomitant?: string[]; investigations?: string[] },
) {
  const [list, rowId, field] = path.split(".");
  if (!rowId) return CASE_FIELD_LABELS[list] ?? list;
  const index = (ids?: string[]) => {
    const i = ids?.indexOf(rowId) ?? -1;
    return i >= 0 ? ` (${ROMAN[i] ?? i + 1})` : "";
  };
  if (list === "suspectedMedicines")
    return `8. Suspected medicine${index(rows?.suspected)}: ${SUSPECTED_FIELD_LABELS[field] ?? field}`;
  if (list === "concomitantProducts")
    return `11. Concomitant product${index(rows?.concomitant)}: ${CONCOMITANT_FIELD_LABELS[field] ?? field}`;
  if (list === "investigations")
    return `12. Investigation${index(rows?.investigations)}: ${INVESTIGATION_FIELD_LABELS[field] ?? field}`;
  return path;
}

export function rowOrder(
  snapshot: Pick<CaseSnapshot, "suspectedMedicines" | "concomitantProducts" | "investigations">,
) {
  return {
    suspected: snapshot.suspectedMedicines.map((r) => r.id),
    concomitant: snapshot.concomitantProducts.map((r) => r.id),
    investigations: snapshot.investigations.map((r) => r.id),
  };
}

/** Selectable targets for a field-specific review comment. */
export function commentTargets(snapshot: CaseSnapshot): { path: string; label: string }[] {
  const rows = rowOrder(snapshot);
  const targets = Object.keys(CASE_FIELD_LABELS)
    .filter((k) => !["suspectedMedicines", "concomitantProducts", "investigations"].includes(k))
    .map((path) => ({ path, label: fieldLabel(path) }));
  for (const r of snapshot.suspectedMedicines)
    for (const f of Object.keys(SUSPECTED_FIELD_LABELS)) {
      const path = `suspectedMedicines.${r.id}.${f}`;
      targets.push({ path, label: fieldLabel(path, rows) });
    }
  for (const r of snapshot.concomitantProducts)
    for (const f of Object.keys(CONCOMITANT_FIELD_LABELS)) {
      const path = `concomitantProducts.${r.id}.${f}`;
      targets.push({ path, label: fieldLabel(path, rows) });
    }
  for (const r of snapshot.investigations)
    for (const f of Object.keys(INVESTIGATION_FIELD_LABELS)) {
      const path = `investigations.${r.id}.${f}`;
      targets.push({ path, label: fieldLabel(path, rows) });
    }
  return targets;
}

const str = (v: unknown) => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(",") : String(v));

/** Flattens a snapshot into path -> comparable text, using the paths above. */
export function flattenSnapshot(s: CaseSnapshot): Record<string, string> {
  const out: Record<string, string> = {
    patientInitials: str(s.patient.initials),
    age: `${str(s.patient.ageValue)} ${str(s.patient.ageUnit)} ${str(s.patient.dateOfBirth)} ${str(s.patient.dateOfBirthApprox)}`,
    gender: str(s.patient.gender),
    weightKg: str(s.patient.weightKg),
    reactionStartDate: `${str(s.reaction.startDate)} ${str(s.reaction.startDateApprox)}`,
    reactionStopDate: `${str(s.reaction.stopDate)} ${str(s.reaction.stopDateApprox)} ${str(s.reaction.ongoing)}`,
    reactionTerms: str(s.reaction.terms),
    reactionDescription: str(s.reaction.description),
    reactionManagement: str(s.reaction.management),
    medicalHistory: `${str(s.history.text)} ${str(s.history.flags)}`,
    seriousAnswer: str(s.seriousness.answer),
    seriousnessCriteria: str(s.seriousness.criteria),
    deathDate: `${str(s.seriousness.deathDate)} ${str(s.seriousness.deathDateApprox)}`,
    outcome: str(s.outcome),
    additionalInformation: str(s.additionalInformation),
    unknownFields: str(s.unknownFields),
  };
  const rows = (list: string, items: Record<string, unknown>[], fields: string[]) => {
    for (const r of items) {
      for (const f of fields) {
        const approx = r[`${f}Approx`];
        out[`${list}.${r.id}.${f}`] = `${str(r[f])}${approx ? " approx" : ""}`;
      }
      out[`${list}.${r.id}.unknownFields`] = str(r.unknownFields);
    }
  };
  rows("suspectedMedicines", s.suspectedMedicines, Object.keys(SUSPECTED_FIELD_LABELS));
  rows("concomitantProducts", s.concomitantProducts, Object.keys(CONCOMITANT_FIELD_LABELS));
  rows("investigations", s.investigations, Object.keys(INVESTIGATION_FIELD_LABELS));
  return out;
}

/** Paths whose value differs between two versions (added or removed rows included). */
export function changedPaths(previous: CaseSnapshot, current: CaseSnapshot): Set<string> {
  const a = flattenSnapshot(previous);
  const b = flattenSnapshot(current);
  const changed = new Set<string>();
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if ((a[key] ?? "") !== (b[key] ?? "")) {
      changed.add(key.endsWith(".unknownFields") ? key.split(".").slice(0, 2).join(".") : key);
      if (key === "unknownFields") changed.add("unknownFields");
    }
  }
  return changed;
}

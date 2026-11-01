import { z } from "zod";
import {
  caseFormSchema,
  emptySuspectedMedicine,
  emptyConcomitantProduct,
  emptyInvestigation,
  CASE_UNKNOWABLE,
  SUSPECTED_UNKNOWABLE,
  CONCOMITANT_UNKNOWABLE,
  INVESTIGATION_UNKNOWABLE,
  type CaseFormValues,
} from "./case-form";
import * as labels from "./labels";
import type { ReporterProfile } from "./completeness";
import { bestMedicineName, medicineKey, normalizeRoute, sameMedicine } from "./medicines";
import { formatForDisplay, isValidPartialDate } from "./partial-date";

export const UPLOAD_LIMITS = {
  files: 20,
  fileBytes: 10 * 1024 * 1024,
  batchBytes: 50 * 1024 * 1024,
  pagesPerPdf: 20,
  pagesPerBatch: 100,
};
export type EntityKind = "case" | "medicine" | "investigation";
/** TREATMENT: a concomitant product given to treat the reaction (printed under item 7 of the PvPI form). */
export type MedicineRole = "SUSPECTED" | "CONCOMITANT" | "TREATMENT" | "SKIP";
export const MEDICINE_ROLES = ["SUSPECTED", "CONCOMITANT", "TREATMENT", "SKIP"] as const;
export const ROLE_LABELS: Record<MedicineRole, string> = {
  SUSPECTED: "Suspected of causing the reaction",
  CONCOMITANT: "Another medicine the patient was taking",
  TREATMENT: "Given to treat the reaction",
  SKIP: "Not relevant to this report",
};
/** Medicines are keyed by ingredient, so "Cap. Amoxycillin 500mg" and "amoxicillin" are one entity. */
export const entityKey = (kind: EntityKind, name: string) =>
  kind === "case"
    ? "case"
    : kind === "medicine"
      ? `medicine:${medicineKey(name)}`
      : `${kind}:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;

export const CASE_FIELDS: Record<string, string> = {
  patientInitials: "Patient initials",
  ageValue: "Age at onset",
  ageUnit: "Age unit",
  dateOfBirth: "Date of birth",
  gender: "Gender",
  weightKg: "Weight (kg)",
  reactionTerms: "Reaction or symptoms",
  reactionStartDate: "Reaction start date",
  reactionStopDate: "Reaction stop date",
  reactionOngoing: "Reaction ongoing",
  reactionDescription: "Reaction description",
  reactionManagement: "Reaction management",
  medicalHistory: "Medical and medication history",
  historyFlags: "Relevant history",
  seriousAnswer: "Is the reaction serious?",
  seriousnessCriteria: "Seriousness criteria",
  deathDate: "Date of death",
  outcome: "Outcome",
  additionalInformation: "Additional information",
};
export const MED_FIELDS: Record<string, string> = {
  name: "Medicine name",
  manufacturer: "Manufacturer",
  batchLot: "Batch or lot",
  expiryDate: "Expiry date",
  dose: "Dose",
  route: "Route",
  frequency: "Frequency",
  startDate: "Date started",
  stopDate: "Date stopped",
  ongoing: "Still being taken",
  indication: "Indication",
  actionTaken: "Action taken",
  rechallenge: "Reaction on reintroduction",
  rechallengeDose: "Reintroduction dose",
  usedToTreatReaction: "Used to treat the reaction",
};
export const TEST_FIELDS: Record<string, string> = {
  testName: "Test name",
  result: "Result and units",
  date: "Test date",
};
export const DATE_FIELDS = new Set([
  "dateOfBirth",
  "reactionStartDate",
  "reactionStopDate",
  "deathDate",
  "expiryDate",
  "startDate",
  "stopDate",
  "date",
]);
export const BOOLEAN_FIELDS = new Set(["reactionOngoing", "ongoing", "usedToTreatReaction"]);
export const ARRAY_FIELDS = new Set(["historyFlags", "seriousnessCriteria"]);
export const FIELD_OPTIONS: Record<string, Record<string, string>> = {
  ageUnit: labels.AGE_UNIT_LABELS,
  gender: labels.GENDER_LABELS,
  seriousAnswer: labels.SERIOUS_ANSWER_LABELS,
  outcome: labels.OUTCOME_LABELS,
  actionTaken: labels.ACTION_TAKEN_LABELS,
  rechallenge: labels.RECHALLENGE_LABELS,
  historyFlags: labels.HISTORY_FLAG_LABELS,
  seriousnessCriteria: labels.SERIOUSNESS_CRITERION_LABELS,
};

export interface ChatFact {
  id: string;
  entity: EntityKind;
  entityKey: string;
  entityName: string;
  field: string;
  value: string;
  quote: string;
  approximate: boolean;
  uncertain: boolean;
  documentId?: string;
  documentName?: string;
  sourcePage?: number;
  itemId?: string;
  messageId?: string;
}
export const NOTE_KINDS = [
  "UNCLEAR",
  "CONFLICT",
  "HELD",
  "INVALID",
  "SIMILAR",
  "INFERRED",
  "MERGED",
  "CHANGED",
] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
/** Kinds the reporter should look at before confirming; the others only explain what the app did. */
export const ATTENTION_KINDS: NoteKind[] = ["UNCLEAR", "CONFLICT", "HELD", "INVALID", "SIMILAR"];

/** Something the app decided while filling the report, shown at the final confirmation. */
export interface ChatNote {
  /** Field path the note is about (as used for provenance), or a document/medicine key. */
  key: string;
  kind: NoteKind;
  label: string;
  /** The raw value the note refers to; the note is hidden once the field holds something else. */
  value: string;
  message: string;
  documentId?: string;
}

export interface ChatState {
  /** USED: filled into the report. SKIPPED: not used. HELD: from a document that may belong to another patient. */
  decisions: Record<string, "USED" | "SKIPPED" | "HELD">;
  roles: Record<string, MedicineRole>;
  entities: Record<string, { rowId: string; list: "suspectedMedicines" | "concomitantProducts" | "investigations" }>;
  deferred: string[];
  identityConfirmed: string[];
  notes: ChatNote[];
  /** Unanswerable attempts per question, so the assistant never repeats a question forever. */
  attempts: Record<string, number>;
  /** The reporter chose to skip optional questions. */
  skipOptional: boolean;
}
const emptyState = (): ChatState => ({
  decisions: {},
  roles: {},
  entities: {},
  deferred: [],
  identityConfirmed: [],
  notes: [],
  attempts: {},
  skipOptional: false,
});
export function chatState(raw: unknown): ChatState {
  // Each part falls back on its own, so one unreadable part never wipes the rest of the conversation state.
  const parsed = z
    .object({
      decisions: z
        .record(z.string(), z.enum(["USED", "SKIPPED", "HELD"]))
        .catch({})
        .default({}),
      roles: z.record(z.string(), z.enum(MEDICINE_ROLES)).catch({}).default({}),
      entities: z
        .record(
          z.string(),
          z.object({
            rowId: z.string(),
            list: z.enum(["suspectedMedicines", "concomitantProducts", "investigations"]),
          }),
        )
        .catch({})
        .default({}),
      deferred: z.array(z.string()).catch([]).default([]),
      identityConfirmed: z.array(z.string()).catch([]).default([]),
      notes: z
        .array(
          z.object({
            key: z.string(),
            kind: z.enum(NOTE_KINDS),
            label: z.string(),
            value: z.string(),
            message: z.string(),
            documentId: z.string().optional(),
          }),
        )
        .catch([])
        .default([]),
      attempts: z.record(z.string(), z.number()).catch({}).default({}),
      skipOptional: z.boolean().catch(false).default(false),
    })
    .safeParse(raw ?? {});
  return parsed.success ? parsed.data : emptyState();
}
/** Adds or replaces the note for a key and kind. */
export function setNote(state: ChatState, note: ChatNote) {
  state.notes = [...state.notes.filter((n) => !(n.key === note.key && n.kind === note.kind)), note].slice(-300);
}
/** A stored value as the reporter should read it: labels instead of codes, dates in words. */
export function displayValue(field: string, raw: string): string {
  if (!raw) return "";
  if (BOOLEAN_FIELDS.has(field)) return raw === "true" ? "Yes" : raw === "false" ? "No" : raw;
  if (ARRAY_FIELDS.has(field)) {
    try {
      const items = JSON.parse(raw);
      if (Array.isArray(items)) return items.map((i) => FIELD_OPTIONS[field]?.[i] ?? String(i)).join(", ");
    } catch {}
  }
  if (FIELD_OPTIONS[field]?.[raw]) return FIELD_OPTIONS[field][raw];
  if (DATE_FIELDS.has(field) && isValidPartialDate(raw)) return formatForDisplay(raw);
  return raw;
}
export function fieldLabel(fact: Pick<ChatFact, "entity" | "field">) {
  return (
    (fact.entity === "case" ? CASE_FIELDS : fact.entity === "medicine" ? MED_FIELDS : TEST_FIELDS)[fact.field] ??
    fact.field
  );
}
export function permittedField(kind: EntityKind, field: string) {
  return Object.hasOwn(kind === "case" ? CASE_FIELDS : kind === "medicine" ? MED_FIELDS : TEST_FIELDS, field);
}
export function factKey(f: Pick<ChatFact, "entityKey" | "field">) {
  return `${f.entityKey}.${f.field}`;
}

/** Conservative quote checks flag transformations; they never certify what an image says. */
export function needsEvidenceCheck(field: string, value: string, quote: string): boolean {
  if (!quote.trim()) return true;
  const numbers = (text: string) => (text.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n)));
  const known = new Set(numbers(quote));
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  if (DATE_FIELDS.has(field)) {
    months.forEach((month, index) => {
      if (new RegExp(`\\b${month}[a-z]*\\b`, "i").test(quote)) known.add(String(index + 1));
    });
    const ambiguous = quote.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}\b/);
    if (ambiguous && Number(ambiguous[1]) <= 12 && Number(ambiguous[2]) <= 12 && ambiguous[1] !== ambiguous[2])
      return true;
    return numbers(value).some((n) => !known.has(n));
  }
  if (numbers(value).some((n) => !known.has(n))) return true;
  if (field === "weightKg" && /\blbs?\b|\bpounds?\b/i.test(quote.replace(/(\d)([a-z])/gi, "$1 $2"))) return true;
  const canonical = (text: string) =>
    text
      .toLowerCase()
      .replace(/\b(?:cap|caps|capsules)\b/g, "capsule")
      .replace(/\b(?:tab|tabs|tablets)\b/g, "tablet")
      .replace(/[^a-z0-9]/g, "");
  if (field === "name") {
    const tokens = (text: string) =>
      (text.toLowerCase().match(/[a-z]+/g) ?? []).map(
        (t) =>
          (
            ({
              cap: "capsule",
              caps: "capsule",
              capsules: "capsule",
              tab: "tablet",
              tabs: "tablet",
              tablets: "tablet",
            }) as Record<string, string>
          )[t] ?? t,
      );
    const sourceTokens = new Set(tokens(quote));
    return tokens(value).some((token) => !sourceTokens.has(token));
  }
  if (canonical(quote).includes(canonical(value))) return false;
  if (field === "ageUnit") {
    const patterns: Record<string, RegExp> = {
      YEARS: /\b(?:y|yr|yrs|years?)\b/i,
      MONTHS: /\b(?:mo|mos|months?)\b/i,
      WEEKS: /\b(?:w|wk|wks|weeks?)\b/i,
      DAYS: /\b(?:d|days?)\b/i,
    };
    return !patterns[value]?.test(quote.replace(/(\d)([a-z])/gi, "$1 $2"));
  }
  if (field === "gender")
    return !(
      {
        MALE: /\b(?:m|male|man|boy|gentleman|mr|he|his|him)\b/i,
        FEMALE: /\b(?:f|female|woman|girl|lady|mrs|ms|miss|she|her)\b/i,
        OTHER: /\bother\b/i,
      } as Record<string, RegExp>
    )[value]?.test(quote);
  return true;
}
export function rowFor(
  values: CaseFormValues,
  state: ChatState,
  fact: Pick<ChatFact, "entity" | "entityKey" | "entityName">,
) {
  const saved = state.entities[fact.entityKey];
  if (saved) {
    const index = values[saved.list].findIndex((r) => r.id === saved.rowId);
    if (index >= 0) return { list: saved.list, index };
  }
  for (const list of fact.entity === "medicine"
    ? (["suspectedMedicines", "concomitantProducts"] as const)
    : (["investigations"] as const)) {
    const index = values[list].findIndex(
      (row) => entityKey(fact.entity, "name" in row ? row.name : row.testName) === fact.entityKey,
    );
    if (index >= 0) return { list, index };
  }
  // A one-letter spelling difference in a long medicine name ("cetrizine") is the same medicine.
  if (fact.entity === "medicine" && fact.entityName)
    for (const list of ["suspectedMedicines", "concomitantProducts"] as const) {
      const index = values[list].findIndex((row) => row.name && sameMedicine(row.name, fact.entityName));
      if (index >= 0) return { list, index };
    }
  return null;
}
export function readFactValue(values: CaseFormValues, state: ChatState, fact: ChatFact): string {
  const row =
    fact.entity === "case"
      ? values
      : (() => {
          const r = rowFor(values, state, fact);
          return r ? values[r.list][r.index] : null;
        })();
  const value = row ? (row as unknown as Record<string, unknown>)[fact.field] : undefined;
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && "value" in value) return String(value.value);
  if (Array.isArray(value)) return value.length ? JSON.stringify(value) : "";
  return typeof value === "boolean" ? String(value) : String(value);
}
export function parsedFactValue(field: string, value: string, approximate = false): unknown {
  if (DATE_FIELDS.has(field)) {
    if (!isValidPartialDate(value)) throw new Error("Enter a valid date, month and year, or year.");
    return { value, approx: approximate };
  }
  if (BOOLEAN_FIELDS.has(field)) {
    if (!/^(true|false)$/.test(value)) throw new Error("Choose yes or no.");
    return value === "true";
  }
  if (ARRAY_FIELDS.has(field)) {
    let a: unknown;
    try {
      a = JSON.parse(value);
    } catch {
      throw new Error("Choose the applicable options.");
    }
    if (!Array.isArray(a) || a.some((v) => typeof v !== "string" || !Object.hasOwn(FIELD_OPTIONS[field], v)))
      throw new Error("Choose the applicable options.");
    return [...new Set(a)];
  }
  if (FIELD_OPTIONS[field] && !Object.hasOwn(FIELD_OPTIONS[field], value))
    throw new Error("Choose one of the listed options.");
  return value.trim();
}
/** Whitelist first, validate the complete form afterwards. No protected properties can be written. */
export function putFact(values: CaseFormValues, state: ChatState, fact: ChatFact, value: string) {
  if (!permittedField(fact.entity, fact.field)) throw new Error("This field cannot be filled here.");
  if (
    fact.entity === "medicine" &&
    [...values.suspectedMedicines, ...values.concomitantProducts].filter(
      (row) => entityKey("medicine", row.name) === fact.entityKey,
    ).length > 1
  )
    throw new Error("More than one existing medicine entry has this name. Check the matching entry in the form.");
  let row: Record<string, unknown>;
  let location: ReturnType<typeof rowFor> = null;
  if (fact.entity === "case") row = values as unknown as Record<string, unknown>;
  else {
    location = rowFor(values, state, fact);
    if (!location) {
      if (fact.entity === "medicine") {
        const role = state.roles[fact.entityKey];
        if (!role || role === "SKIP") throw new Error(`Choose how ${fact.entityName} belongs in this report.`);
        const list = role === "SUSPECTED" ? "suspectedMedicines" : "concomitantProducts";
        if (values[list].length >= (list === "suspectedMedicines" ? 10 : 20))
          throw new Error(
            `A report can include at most ${list === "suspectedMedicines" ? "10 suspected medicines" : "20 concomitant products"}.`,
          );
        values[list].push({
          ...(list === "suspectedMedicines"
            ? emptySuspectedMedicine()
            : { ...emptyConcomitantProduct(), usedToTreatReaction: role === "TREATMENT" }),
          name: fact.entityName,
          id: `chat-new:${fact.entityKey}`,
        } as never);
        location = { list, index: values[list].length - 1 };
      } else {
        if (values.investigations.length >= 20) throw new Error("A report can include at most 20 investigations.");
        values.investigations.push({
          ...emptyInvestigation(),
          testName: fact.entityName,
          id: `chat-new:${fact.entityKey}`,
        });
        location = { list: "investigations", index: values.investigations.length - 1 };
      }
    }
    const rowId = values[location.list][location.index].id;
    if (rowId) state.entities[fact.entityKey] = { list: location.list, rowId };
    row = values[location.list][location.index] as unknown as Record<string, unknown>;
    if (!Object.hasOwn(row, fact.field)) throw new Error("This field does not apply to the selected row type.");
  }
  const parsedValue = parsedFactValue(fact.field, value, fact.approximate);
  // Keep the most informative name for the same medicine ("Amoxicillin 500 mg capsule" over "amoxicillin").
  row[fact.field] =
    fact.entity === "medicine" && fact.field === "name" && typeof row.name === "string" && row.name
      ? bestMedicineName([row.name, String(parsedValue)])
      : fact.field === "route" && typeof parsedValue === "string"
        ? normalizeRoute(parsedValue)
        : parsedValue;
  if (fact.field === "stopDate" && (parsedValue as { value?: string }).value) row.ongoing = false;
  if (fact.field === "reactionStopDate" && (parsedValue as { value?: string }).value) row.reactionOngoing = false;
  if (fact.field === "ongoing" && parsedValue === true) row.stopDate = { value: "", approx: false };
  if (fact.field === "reactionOngoing" && parsedValue === true) row.reactionStopDate = { value: "", approx: false };
  if (Array.isArray(row.unknownFields)) row.unknownFields = row.unknownFields.filter((f) => f !== fact.field);
  const parsed = caseFormSchema.safeParse(values);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return location;
}

export interface FactGroup {
  key: string;
  label: string;
  entityKey: string;
  entityName: string;
  field: string;
  current: string;
  facts: ChatFact[];
  conflict: boolean;
}
export function pendingGroups(facts: ChatFact[], state: ChatState, values: CaseFormValues): FactGroup[] {
  const grouped = new Map<string, FactGroup>();
  for (const f of facts) {
    if (state.decisions[f.id] || state.roles[f.entityKey] === "SKIP") continue;
    const current = readFactValue(values, state, f);
    if (current && current === f.value && !BOOLEAN_FIELDS.has(f.field)) continue;
    const key = factKey(f);
    const group = grouped.get(key) ?? {
      key,
      label: fieldLabel(f),
      entityKey: f.entityKey,
      entityName: f.entityName,
      field: f.field,
      current,
      facts: [],
      conflict: false,
    };
    group.facts.push(f);
    grouped.set(key, group);
  }
  return [...grouped.values()].map((g) => ({
    ...g,
    conflict:
      new Set(g.facts.map((f) => f.value)).size > 1 || Boolean(g.current && g.facts.some((f) => f.value !== g.current)),
  }));
}

export interface ChatQuestion {
  key: string;
  text: string;
  entity: EntityKind;
  entityKey: string;
  entityName: string;
  field: string;
  required: boolean;
  /** Optional details can be skipped together. */
  optional?: boolean;
  /** role: how a medicine belongs; suspect: which medicine is suspected; group: several optional fields at once. */
  kind?: "role" | "suspect" | "group";
  /** The fields a group question covers. */
  fields?: string[];
  options?: Record<string, string>;
}

/** Medicine entities read from documents or answers that are not in the report yet and have no role. */
export function unplacedMedicines(values: CaseFormValues, state: ChatState, facts: ChatFact[]) {
  const seen = new Map<string, string>();
  for (const f of facts) {
    if (f.entity !== "medicine" || state.decisions[f.id] || seen.has(f.entityKey)) continue;
    if (state.roles[f.entityKey] || rowFor(values, state, f)) continue;
    seen.set(f.entityKey, f.entityName);
  }
  return [...seen.entries()].map(([key, name]) => ({ key, name }));
}

/** Moves an existing medicine row to the list its new role needs, keeping the shared details. */
export function moveMedicine(values: CaseFormValues, state: ChatState, key: string, name: string, role: MedicineRole) {
  const location = rowFor(values, state, { entity: "medicine", entityKey: key, entityName: name });
  if (!location || role === "SKIP") return;
  const target = role === "SUSPECTED" ? "suspectedMedicines" : "concomitantProducts";
  if (location.list === target) {
    if (target === "concomitantProducts")
      values.concomitantProducts[location.index].usedToTreatReaction = role === "TREATMENT";
    return;
  }
  if (location.list === "investigations") return;
  const old = values[location.list][location.index] as Record<string, unknown> & { unknownFields: string[] };
  values[location.list].splice(location.index, 1);
  const base: Record<string, unknown> =
    target === "suspectedMedicines"
      ? emptySuspectedMedicine()
      : { ...emptyConcomitantProduct(), usedToTreatReaction: role === "TREATMENT" };
  for (const field of ["name", "dose", "route", "frequency", "startDate", "stopDate", "ongoing", "indication"])
    if (field in old) base[field] = old[field];
  const allowed = target === "suspectedMedicines" ? SUSPECTED_UNKNOWABLE : CONCOMITANT_UNKNOWABLE;
  base.unknownFields = old.unknownFields.filter((f) => (allowed as readonly string[]).includes(f));
  base.id = `chat-new:${key}`;
  (values[target] as unknown[]).push(base);
  delete state.entities[key];
}

const UNKNOWN_ANSWER =
  /^(?:i\s+)?(?:unknown|unk|not known|don'?t know|dont know|do not know|no idea|not sure|unsure|n\/?a|not available|not applicable|can'?t say|cannot say|can'?t remember|cannot remember|don'?t remember|not recorded|not mentioned|not documented|not given on the (?:document|prescription)|skip|pass|-+|\?+)(?:\s+(?:this|that|it))?[.!]*$/i;
/** True when an answer means "I do not know this" in any common phrasing. */
export function isUnknownAnswer(text: string) {
  return UNKNOWN_ANSWER.test(text.trim().toLowerCase());
}
/** "None"/"no" answers that are real values for some fields (no history, no treatment). */
export function noneAnswer(field: string, text: string): string | null {
  if (
    !/^(?:none|no|nil|nothing|not any|no treatment|no history|none known|nka|nkda|no known (?:allergies|history))[.!]*$/i.test(
      text.trim(),
    )
  )
    return null;
  if (field === "medicalHistory") return /nka|nkda|allerg/i.test(text) ? "No known allergies" : "None";
  if (field === "reactionManagement") return "No treatment given";
  return null;
}

/** Puts an answer into the form's own wording: option codes, yes/no, standard routes. Unknown wording is returned unchanged. */
export function normalizeChatValue(field: string, value: string): string {
  const v = value.trim();
  if (BOOLEAN_FIELDS.has(field)) {
    if (/^(?:true|yes|y|ongoing|still|continued|still taking|still present)$/i.test(v)) return "true";
    if (/^(?:false|no|n|stopped|resolved|not ongoing)$/i.test(v)) return "false";
    return v;
  }
  const options = FIELD_OPTIONS[field];
  const match = (text: string) =>
    options &&
    Object.entries(options).find(
      ([key, label]) =>
        key.toLowerCase() === text.toLowerCase() ||
        label.toLowerCase() === text.toLowerCase() ||
        key.toLowerCase().replace(/_/g, " ") === text.toLowerCase(),
    )?.[0];
  if (ARRAY_FIELDS.has(field)) {
    let items: string[];
    try {
      const parsed = JSON.parse(v);
      items = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
    } catch {
      items = v.split(/\s*(?:,|;|\band\b)\s*/).filter(Boolean);
    }
    const mapped = items.map((item) => match(item) ?? item);
    return JSON.stringify([...new Set(mapped)]);
  }
  if (options) {
    if (field === "gender") {
      if (/^(?:m|male|man|boy)$/i.test(v)) return "MALE";
      if (/^(?:f|female|woman|girl|lady)$/i.test(v)) return "FEMALE";
    }
    if (field === "ageUnit") {
      if (/^(?:y|yrs?|years?)$/i.test(v)) return "YEARS";
      if (/^(?:mo|mos|months?)$/i.test(v)) return "MONTHS";
      if (/^(?:w|wks?|weeks?)$/i.test(v)) return "WEEKS";
      if (/^(?:d|days?)$/i.test(v)) return "DAYS";
    }
    return match(v) ?? v;
  }
  if (field === "route") return normalizeRoute(v);
  return v;
}

/** The quote occurs in the message, ignoring case, spacing and quotation marks. */
export function quoteFound(message: string, quote: string) {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[“”"'‘’`]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  return Boolean(quote.trim()) && norm(message).includes(norm(quote));
}

const ask = (
  entity: EntityKind,
  name: string,
  field: string,
  text: string,
  extra: Partial<ChatQuestion> = {},
): ChatQuestion => ({
  key: `${entityKey(entity, name)}.${field}`,
  text,
  entity,
  entityKey: entityKey(entity, name),
  entityName: name,
  field,
  required: false,
  options: FIELD_OPTIONS[field] ?? (BOOLEAN_FIELDS.has(field) ? { true: "Yes", false: "No" } : undefined),
  ...extra,
});

/**
 * The next question, most important first:
 * 1. how each newly found medicine belongs (suspected, other, treatment);
 * 2. the details PvPI requires;
 * 3. the details that make a report usable (outcome, stop dates, action taken, dose...);
 * 4. optional details, grouped, unless the reporter chose to skip them.
 * Nothing already answered, inferred, marked unknown or deferred is asked again.
 */
export function nextQuestion(
  values: CaseFormValues,
  state: ChatState,
  facts: ChatFact[],
  _profile?: ReporterProfile,
): ChatQuestion | null {
  const questions: ChatQuestion[] = [];
  const unknown = new Set(values.unknownFields);
  const empty = (field: keyof CaseFormValues) => {
    const v = values[field] as unknown;
    if (typeof v === "string") return !v.trim();
    if (v && typeof v === "object" && "value" in v) return !(v as { value: string }).value;
    return v === undefined || v === null;
  };

  for (const medicine of unplacedMedicines(values, state, facts))
    questions.push(
      ask("medicine", medicine.name, "role", `How is ${medicine.name} related to this report?`, {
        kind: "role",
        required: true,
        options: ROLE_LABELS,
      }),
    );

  // Required by PvPI.
  if (empty("patientInitials"))
    questions.push(
      ask("case", "", "patientInitials", "What are the patient's initials? Initials only, never the full name.", {
        required: true,
      }),
    );
  if (empty("ageValue") && empty("dateOfBirth"))
    questions.push(
      ask("case", "", "ageValue", "How old was the patient when the reaction began? A date of birth also works.", {
        required: true,
      }),
    );
  if (values.ageValue && !values.ageUnit)
    questions.push(ask("case", "", "ageUnit", "Is that age in years, months, weeks or days?", { required: true }));
  if (empty("reactionTerms"))
    questions.push(
      ask("case", "", "reactionTerms", "What reaction or symptoms did the patient have?", { required: true }),
    );
  if (empty("reactionStartDate"))
    questions.push(
      ask("case", "", "reactionStartDate", "When did the reaction start? A month and year, or just a year, is fine.", {
        required: true,
      }),
    );
  const named = <T extends { name: string }>(rows: T[]) => rows.filter((r) => r.name.trim());
  if (!named(values.suspectedMedicines).length) {
    const others = named(values.concomitantProducts);
    questions.push(
      ask("medicine", "", "name", "Which medicine do you suspect caused the reaction? Give its name and strength.", {
        kind: "suspect",
        required: true,
        options: others.length ? Object.fromEntries(others.map((r) => [r.name, r.name])) : undefined,
      }),
    );
  }
  // Important for a usable report.
  if (empty("outcome") && !unknown.has("outcome"))
    questions.push(ask("case", "", "outcome", "What is the patient's current outcome?"));
  const recovered = ["RECOVERED", "RECOVERED_WITH_SEQUELAE", "FATAL"].includes(values.outcome);
  if (recovered && !values.reactionOngoing && empty("reactionStopDate") && !unknown.has("reactionStopDate"))
    questions.push(ask("case", "", "reactionStopDate", "When did the reaction stop?"));
  if (empty("seriousAnswer") && !values.seriousnessCriteria.length && !unknown.has("seriousAnswer"))
    questions.push(
      ask(
        "case",
        "",
        "seriousAnswer",
        "Was the reaction serious? (death, life-threatening, hospital admission, disability, birth defect or other medically important)",
      ),
    );
  if (values.seriousAnswer === "YES" && !values.seriousnessCriteria.length)
    questions.push(ask("case", "", "seriousnessCriteria", "Which of these applied?"));
  if (values.seriousnessCriteria.includes("DEATH") && empty("deathDate"))
    questions.push(ask("case", "", "deathDate", "What was the date of death?"));
  if (empty("gender") && !unknown.has("gender"))
    questions.push(ask("case", "", "gender", "What is the patient's gender?"));

  const names = [...values.suspectedMedicines, ...values.concomitantProducts]
    .filter((row) => row.name)
    .map((row) => entityKey("medicine", row.name));
  const duplicate = new Set(names.filter((name, index) => names.indexOf(name) !== index));
  for (const m of named(values.suspectedMedicines)) {
    if (duplicate.has(entityKey("medicine", m.name))) continue;
    const u = new Set(m.unknownFields);
    const q = (field: string, text: string, extra: Partial<ChatQuestion> = {}) => {
      const value = (m as unknown as Record<string, unknown>)[field];
      const filled = typeof value === "string" ? value.trim() : (value as { value?: string } | undefined)?.value;
      if (!filled && !u.has(field)) questions.push(ask("medicine", m.name, field, text, extra));
    };
    q("dose", `What dose of ${m.name} was given each time?`);
    q("route", `How was ${m.name} given (for example by mouth, injection, nasal spray)?`);
    q("frequency", `How often was ${m.name} given?`);
    q("startDate", `When was ${m.name} started?`);
    if (!m.ongoing) q("stopDate", `When was ${m.name} stopped? Say "still taking" if it was continued.`);
    if (!m.actionTaken) q("actionTaken", `What was done with ${m.name} after the reaction?`);
    if (!m.rechallenge && ["DRUG_WITHDRAWN", "DOSE_REDUCED"].includes(m.actionTaken))
      q("rechallenge", `Was ${m.name} given again after it was stopped? If so, did the reaction come back?`);
    q("indication", `What was ${m.name} prescribed for?`);
  }
  if (empty("reactionDescription"))
    questions.push(
      ask("case", "", "reactionDescription", "In a few sentences, what happened? Include how it progressed."),
    );
  if (empty("reactionManagement"))
    questions.push(ask("case", "", "reactionManagement", 'How was the reaction treated? Say "no treatment" if none.'));
  if (empty("medicalHistory") && !unknown.has("medicalHistory"))
    questions.push(
      ask(
        "case",
        "",
        "medicalHistory",
        'Any relevant medical history, allergies, pregnancy, or liver or kidney problems? Say "none" if not.',
      ),
    );
  for (const m of named(values.concomitantProducts)) {
    if (duplicate.has(entityKey("medicine", m.name))) continue;
    const u = new Set(m.unknownFields);
    if (!m.dose.trim() && !u.has("dose"))
      questions.push(ask("medicine", m.name, "dose", `What dose of ${m.name} was given?`));
    if (!m.frequency.trim() && !u.has("frequency"))
      questions.push(ask("medicine", m.name, "frequency", `How often was ${m.name} given?`));
  }

  // Optional details: grouped, and skipped altogether when the reporter asks.
  if (!state.skipOptional) {
    if (empty("weightKg") && !unknown.has("weightKg"))
      questions.push(ask("case", "", "weightKg", "What is the patient's weight in kg? (optional)", { optional: true }));
    for (const m of named(values.suspectedMedicines)) {
      const fields = ["manufacturer", "batchLot", "expiryDate"].filter((field) => {
        const value = (m as unknown as Record<string, unknown>)[field];
        const filled = typeof value === "string" ? value.trim() : (value as { value?: string }).value;
        return !filled && !m.unknownFields.includes(field);
      });
      if (fields.length)
        questions.push(
          ask(
            "medicine",
            m.name,
            "optionalDetails",
            `Do you know the manufacturer, batch number or expiry date of ${m.name}? (optional)`,
            { kind: "group", fields, optional: true, options: undefined },
          ),
        );
    }
    for (const m of named(values.concomitantProducts)) {
      if (m.usedToTreatReaction) continue;
      const fields = ["route", "startDate", "indication"].filter((field) => {
        const value = (m as unknown as Record<string, unknown>)[field];
        const filled = typeof value === "string" ? value.trim() : (value as { value?: string }).value;
        return !filled && !m.unknownFields.includes(field);
      });
      if (fields.length)
        questions.push(
          ask(
            "medicine",
            m.name,
            "otherDetails",
            `For ${m.name}: how was it taken, since when, and for what? (optional)`,
            {
              kind: "group",
              fields,
              optional: true,
              options: undefined,
            },
          ),
        );
    }
    for (const row of values.investigations) {
      if (!row.testName) continue;
      const fields = ["result", "date"].filter((field) =>
        field === "result" ? !row.result.trim() : !row.date.value && !row.unknownFields.includes("date"),
      );
      if (fields.length)
        questions.push(
          ask(
            "investigation",
            row.testName,
            "testDetails",
            `What was the result and date of ${row.testName}? (optional)`,
            {
              kind: "group",
              fields,
              optional: true,
              options: undefined,
            },
          ),
        );
    }
  }
  return questions.find((question) => !state.deferred.includes(question.key)) ?? null;
}

/** Records "not known" for a question: never asked again, and marked Unknown on the form where the form allows it. */
export function deferQuestion(values: CaseFormValues, state: ChatState, question: ChatQuestion) {
  if (!state.deferred.includes(question.key)) state.deferred.push(question.key);
  if (question.kind === "role") {
    state.roles[question.entityKey] = "SKIP";
    return;
  }
  const fields = question.kind === "group" ? (question.fields ?? []) : [question.field];
  if (question.entity === "case") {
    for (const field of fields)
      if ((CASE_UNKNOWABLE as readonly string[]).includes(field) && !values.unknownFields.includes(field))
        values.unknownFields.push(field);
  } else {
    const r = rowFor(values, state, question);
    if (!r) return;
    const allowed =
      r.list === "suspectedMedicines"
        ? SUSPECTED_UNKNOWABLE
        : r.list === "concomitantProducts"
          ? CONCOMITANT_UNKNOWABLE
          : INVESTIGATION_UNKNOWABLE;
    const row = values[r.list][r.index];
    for (const field of fields)
      if ((allowed as readonly string[]).includes(field) && !row.unknownFields.includes(field))
        row.unknownFields.push(field);
  }
}

export const chatAnswerSchema = z.object({
  roles: z
    .array(
      z.object({
        entityName: z.string().max(200),
        role: z.enum(["SUSPECTED", "CONCOMITANT", "TREATMENT"]),
        sourceText: z.string().max(4000),
      }),
    )
    .max(40)
    .default([]),
  updates: z
    .array(
      z.object({
        entity: z.enum(["case", "medicine", "investigation"]),
        entityName: z.string().max(200),
        field: z.string().max(60),
        value: z.string().max(4000),
        sourceText: z.string().max(4000),
        approximate: z.boolean().default(false),
        /** Set by the app (never trusted from the AI) for answers taken as written without understanding. */
        uncertain: z.boolean().default(false),
      }),
    )
    .max(100),
});

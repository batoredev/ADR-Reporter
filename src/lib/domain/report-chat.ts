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
import { assessCompleteness, type ReporterProfile } from "./completeness";
import { isValidPartialDate } from "./partial-date";

export const UPLOAD_LIMITS = {
  files: 20,
  fileBytes: 10 * 1024 * 1024,
  batchBytes: 50 * 1024 * 1024,
  pagesPerPdf: 20,
  pagesPerBatch: 100,
};
export type EntityKind = "case" | "medicine" | "investigation";
export type MedicineRole = "SUSPECTED" | "CONCOMITANT" | "SKIP";
export const entityKey = (kind: EntityKind, name: string) =>
  kind === "case" ? "case" : `${kind}:${name.trim().toLowerCase().replace(/\s+/g, " ")}`;

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
export interface ChatState {
  decisions: Record<string, "USED" | "SKIPPED">;
  roles: Record<string, MedicineRole>;
  entities: Record<string, { rowId: string; list: "suspectedMedicines" | "concomitantProducts" | "investigations" }>;
  deferred: string[];
  identityConfirmed: string[];
}
export function chatState(raw: unknown): ChatState {
  const parsed = z
    .object({
      decisions: z.record(z.string(), z.enum(["USED", "SKIPPED"])).default({}),
      roles: z.record(z.string(), z.enum(["SUSPECTED", "CONCOMITANT", "SKIP"])).default({}),
      entities: z
        .record(
          z.string(),
          z.object({
            rowId: z.string(),
            list: z.enum(["suspectedMedicines", "concomitantProducts", "investigations"]),
          }),
        )
        .default({}),
      deferred: z.array(z.string()).default([]),
      identityConfirmed: z.array(z.string()).default([]),
    })
    .safeParse(raw);
  return parsed.success ? parsed.data : { decisions: {}, roles: {}, entities: {}, deferred: [], identityConfirmed: [] };
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
    return !({ MALE: /\b(?:m|male)\b/i, FEMALE: /\b(?:f|female)\b/i, OTHER: /\bother\b/i } as Record<string, RegExp>)[
      value
    ]?.test(quote);
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
          ...(list === "suspectedMedicines" ? emptySuspectedMedicine() : emptyConcomitantProduct()),
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
  row[fact.field] = parsedFactValue(fact.field, value, fact.approximate);
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
  options?: Record<string, string>;
}
export function nextQuestion(
  values: CaseFormValues,
  state: ChatState,
  facts: ChatFact[],
  profile: ReporterProfile,
): ChatQuestion | null {
  if (pendingGroups(facts, state, values).length) return null;
  const q = (entity: EntityKind, name: string, field: string, text: string, required = false): ChatQuestion => ({
    key: `${entityKey(entity, name)}.${field}`,
    text,
    entity,
    entityKey: entityKey(entity, name),
    entityName: name,
    field,
    required,
    options: FIELD_OPTIONS[field] ?? (BOOLEAN_FIELDS.has(field) ? { true: "Yes", false: "No" } : undefined),
  });
  const names = [...values.suspectedMedicines, ...values.concomitantProducts]
    .filter((row) => row.name)
    .map((row) => entityKey("medicine", row.name));
  const duplicateMedicines = new Set(names.filter((name, index) => names.indexOf(name) !== index));
  const questions: ChatQuestion[] = [];
  if (!values.patientInitials)
    questions.push(q("case", "", "patientInitials", "What are the patient's initials? Use initials only.", true));
  if (!values.ageValue && !values.dateOfBirth.value)
    questions.push(
      q(
        "case",
        "",
        "ageValue",
        "How old was the patient when the reaction began? You can also give their date of birth.",
        true,
      ),
    );
  if (values.ageValue && !values.ageUnit)
    questions.push(q("case", "", "ageUnit", "Is that age in years, months, weeks or days?", true));
  if (!values.reactionTerms)
    questions.push(q("case", "", "reactionTerms", "What reaction or symptoms were noticed?", true));
  if (!values.reactionStartDate.value)
    questions.push(
      q(
        "case",
        "",
        "reactionStartDate",
        "When did the reaction begin? Use YYYY-MM-DD, YYYY-MM or YYYY if only partly known.",
        true,
      ),
    );
  if (!values.suspectedMedicines.some((m) => m.name))
    questions.push(
      q("medicine", "", "name", "Which medicine do you suspect? Give its name and strength as written.", true),
    );
  const completeness = assessCompleteness(values, profile);
  for (const f of completeness.gaps) {
    if (f.path.startsWith("suspectedMedicines.")) {
      const [, id, field] = f.path.split(".");
      const row = values.suspectedMedicines.find((m) => m.id === id);
      if (row && !duplicateMedicines.has(entityKey("medicine", row.name)))
        questions.push(
          q("medicine", row.name, field, `For ${row.name}, what is the ${MED_FIELDS[field]?.toLowerCase() ?? field}?`),
        );
    } else if (Object.hasOwn(CASE_FIELDS, f.path))
      questions.push(q("case", "", f.path, `${CASE_FIELDS[f.path]}: what can you tell me?`));
  }
  if (!values.reactionManagement)
    questions.push(q("case", "", "reactionManagement", "How was the reaction managed or treated?"));
  if (!values.medicalHistory && !values.unknownFields.includes("medicalHistory"))
    questions.push(
      q("case", "", "medicalHistory", "Is there relevant medical history, allergies or medication history?"),
    );
  if (values.seriousAnswer === "YES" && !values.seriousnessCriteria.length)
    questions.push(q("case", "", "seriousnessCriteria", "Which seriousness criteria apply?"));
  if (values.seriousnessCriteria.includes("DEATH") && !values.deathDate.value)
    questions.push(q("case", "", "deathDate", "What was the date of death?"));
  for (const list of ["suspectedMedicines", "concomitantProducts", "investigations"] as const) {
    for (const row of values[list]) {
      const name = "name" in row ? row.name : row.testName;
      if (!name) continue;
      const entity = list === "investigations" ? "investigation" : "medicine";
      if (entity === "medicine" && duplicateMedicines.has(entityKey("medicine", name))) continue;
      const fields =
        list === "suspectedMedicines"
          ? [
              "manufacturer",
              "batchLot",
              "expiryDate",
              "rechallenge",
              ...("rechallenge" in row && row.rechallenge === "YES" ? ["rechallengeDose"] : []),
            ]
          : list === "concomitantProducts"
            ? ["dose", "route", "frequency", "startDate", "indication"]
            : ["result", "date"];
      for (const field of fields) {
        const fact = { entity, entityKey: entityKey(entity, name), entityName: name, field } as ChatFact;
        if (!readFactValue(values, state, fact) && !row.unknownFields.includes(field))
          questions.push(q(entity, name, field, `For ${name}, what is the ${fieldLabel(fact).toLowerCase()}?`));
      }
    }
  }
  return questions.find((question) => !state.deferred.includes(question.key)) ?? null;
}

export function deferQuestion(values: CaseFormValues, state: ChatState, question: ChatQuestion) {
  if (!state.deferred.includes(question.key)) state.deferred.push(question.key);
  if (question.entity === "case") {
    if (
      (CASE_UNKNOWABLE as readonly string[]).includes(question.field) &&
      !values.unknownFields.includes(question.field)
    )
      values.unknownFields.push(question.field);
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
    if ((allowed as readonly string[]).includes(question.field) && !row.unknownFields.includes(question.field))
      row.unknownFields.push(question.field);
  }
}

export const chatAnswerSchema = z.object({
  updates: z
    .array(
      z.object({
        entity: z.enum(["case", "medicine", "investigation"]),
        entityName: z.string().max(200),
        field: z.string().max(60),
        value: z.string().max(4000),
        sourceText: z.string().max(4000),
        approximate: z.boolean().default(false),
      }),
    )
    .max(100),
});

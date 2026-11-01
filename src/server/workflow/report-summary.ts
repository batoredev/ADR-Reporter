import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "@/server/auth/current-user";
import type { CaseFormValues } from "@/lib/domain/case-form";
import { AGE_UNIT_LABELS } from "@/lib/domain/labels";
import { formatForDisplay } from "@/lib/domain/partial-date";
import {
  ATTENTION_KINDS,
  CASE_FIELDS,
  chatState,
  MED_FIELDS,
  TEST_FIELDS,
  displayValue,
  type ChatNote,
  type ChatState,
} from "@/lib/domain/report-chat";
import { db } from "@/server/db";

export interface SummaryRow {
  path: string;
  label: string;
  value: string;
  /** Where the value came from, in plain words. */
  source: string;
  notes: ChatNote[];
}
export interface SummarySection {
  title: string;
  rows: SummaryRow[];
}
export interface ReportSummary {
  sections: SummarySection[];
  /** Details worth a second look before confirming. */
  attention: ChatNote[];
  /** What the app filled in or merged by itself. */
  info: ChatNote[];
  /** How many values came from documents or answers. */
  autoFilled: number;
}

type Client = Pick<typeof db, "fieldProvenance">;

const raw = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.length ? JSON.stringify(v) : "";
  if (typeof v === "object" && "value" in v) return String((v as { value: string }).value ?? "");
  return String(v);
};

/**
 * Everything in the report with its source and any notes the app made while
 * filling it. Used for the assistant's "Report so far" panel and for the single
 * confirmation before the report is submitted.
 */
export async function buildReportSummary(
  caseId: string,
  values: CaseFormValues,
  state: ChatState,
  client: Client = db,
): Promise<ReportSummary> {
  const provenance = await client.fieldProvenance.findMany({
    where: { caseId },
    include: {
      document: { select: { originalName: true } },
      extractedItem: { select: { run: { select: { sourcePage: true } } } },
    },
  });
  const byPath = new Map(provenance.map((p) => [p.fieldPath, p]));
  const sourceOf = (path: string, notes: ChatNote[]) => {
    if (notes.some((n) => n.kind === "INFERRED")) return "Filled in from the other details";
    const p = byPath.get(path);
    if (!p) return "Entered in the form";
    if (p.document) {
      const page = p.extractedItem?.run.sourcePage;
      return `${p.document.originalName}${page ? `, page ${page}` : ""}`;
    }
    return "Your answer";
  };

  // A note only applies while the field still holds the value it was made about.
  const rows = new Map<string, string>();
  const used = new Set<ChatNote>();
  const notesFor = (path: string, current: string) =>
    state.notes.filter((n) => {
      if (n.key !== path) return false;
      const keep = n.value === current || (n.kind === "INFERRED" && current === n.value);
      if (keep) used.add(n);
      return keep;
    });

  const sections: SummarySection[] = [];
  const row = (path: string, label: string, field: string, value: unknown, shown?: string): SummaryRow | null => {
    const r = raw(value);
    rows.set(path, r);
    const notes = notesFor(path, r);
    if (!r && !notes.length) return null;
    return { path, label, value: shown ?? displayValue(field, r), source: sourceOf(path, notes), notes };
  };
  const keep = (list: (SummaryRow | null)[]) => list.filter((r): r is SummaryRow => r !== null);

  const age = values.ageValue
    ? `${values.ageValue} ${AGE_UNIT_LABELS[values.ageUnit as keyof typeof AGE_UNIT_LABELS]?.toLowerCase() ?? ""}`.trim()
    : values.dateOfBirth.value
      ? `Born ${formatForDisplay(values.dateOfBirth.value, values.dateOfBirth.approx)}`
      : "";
  sections.push({
    title: "Patient",
    rows: keep([
      row("patientInitials", CASE_FIELDS.patientInitials, "patientInitials", values.patientInitials),
      row("age", "Age", "ageValue", age ? values.ageValue || values.dateOfBirth.value : "", age),
      row("gender", CASE_FIELDS.gender, "gender", values.gender),
      row(
        "weightKg",
        CASE_FIELDS.weightKg,
        "weightKg",
        values.weightKg,
        values.weightKg ? `${values.weightKg} kg` : "",
      ),
    ]),
  });
  const date = (d: { value: string; approx: boolean }) => (d.value ? formatForDisplay(d.value, d.approx) : "");
  sections.push({
    title: "Reaction",
    rows: keep([
      row("reactionTerms", CASE_FIELDS.reactionTerms, "reactionTerms", values.reactionTerms),
      row(
        "reactionStartDate",
        CASE_FIELDS.reactionStartDate,
        "reactionStartDate",
        values.reactionStartDate,
        date(values.reactionStartDate),
      ),
      values.reactionOngoing
        ? row("reactionOngoing", "Reaction stop date", "reactionOngoing", true, "Still ongoing")
        : row(
            "reactionStopDate",
            CASE_FIELDS.reactionStopDate,
            "reactionStopDate",
            values.reactionStopDate,
            date(values.reactionStopDate),
          ),
      row("reactionDescription", CASE_FIELDS.reactionDescription, "reactionDescription", values.reactionDescription),
      row("reactionManagement", CASE_FIELDS.reactionManagement, "reactionManagement", values.reactionManagement),
      row("seriousAnswer", CASE_FIELDS.seriousAnswer, "seriousAnswer", values.seriousAnswer),
      row("seriousnessCriteria", CASE_FIELDS.seriousnessCriteria, "seriousnessCriteria", values.seriousnessCriteria),
      row("deathDate", CASE_FIELDS.deathDate, "deathDate", values.deathDate, date(values.deathDate)),
      row("outcome", CASE_FIELDS.outcome, "outcome", values.outcome),
      row("medicalHistory", CASE_FIELDS.medicalHistory, "medicalHistory", values.medicalHistory),
      row("historyFlags", CASE_FIELDS.historyFlags, "historyFlags", values.historyFlags),
      row(
        "additionalInformation",
        CASE_FIELDS.additionalInformation,
        "additionalInformation",
        values.additionalInformation,
      ),
    ]),
  });
  const medicineRows = (
    list: "suspectedMedicines" | "concomitantProducts",
    r: Record<string, unknown> & { id?: string },
  ) => {
    const base = `${list}.${r.id}`;
    const fields =
      list === "suspectedMedicines"
        ? [
            "name",
            "dose",
            "route",
            "frequency",
            "startDate",
            "stopDate",
            "indication",
            "actionTaken",
            "rechallenge",
            "manufacturer",
            "batchLot",
            "expiryDate",
          ]
        : ["name", "dose", "route", "frequency", "startDate", "stopDate", "indication"];
    const out = fields.map((field) =>
      field === "stopDate" && r.ongoing
        ? row(`${base}.ongoing`, "Date stopped", "ongoing", true, "Still being taken")
        : row(
            `${base}.${field}`,
            MED_FIELDS[field],
            field,
            r[field],
            typeof r[field] === "object" && r[field] ? date(r[field] as { value: string; approx: boolean }) : undefined,
          ),
    );
    if (list === "concomitantProducts" && r.usedToTreatReaction)
      out.push(row(`${base}.usedToTreatReaction`, MED_FIELDS.usedToTreatReaction, "usedToTreatReaction", true));
    return keep(out);
  };
  for (const m of values.suspectedMedicines.filter((m) => m.name))
    sections.push({ title: `Suspected medicine: ${m.name}`, rows: medicineRows("suspectedMedicines", m as never) });
  for (const m of values.concomitantProducts.filter((m) => m.name))
    sections.push({
      title: `${m.usedToTreatReaction ? "Given for the reaction" : "Other medicine"}: ${m.name}`,
      rows: medicineRows("concomitantProducts", m as never),
    });
  for (const t of values.investigations.filter((t) => t.testName || t.result)) {
    const base = `investigations.${t.id}`;
    sections.push({
      title: `Test: ${t.testName || "Investigation"}`,
      rows: keep([
        row(`${base}.testName`, TEST_FIELDS.testName, "testName", t.testName),
        row(`${base}.result`, TEST_FIELDS.result, "result", t.result),
        row(`${base}.date`, TEST_FIELDS.date, "date", t.date, date(t.date)),
      ]),
    });
  }

  // Notes about documents and medicine pairs are not tied to one field.
  const general = state.notes.filter((n) => !rows.has(n.key) && ["HELD", "SIMILAR", "MERGED"].includes(n.kind));
  const current = [...used, ...general];
  return {
    sections: sections.filter((s) => s.rows.length),
    attention: current.filter((n) => ATTENTION_KINDS.includes(n.kind)),
    info: current.filter((n) => !ATTENTION_KINDS.includes(n.kind)),
    autoFilled: provenance.length,
  };
}

/** On submission: everything filled automatically counts as confirmed by the submitting reporter. */
export async function confirmAutoFilledDetails(tx: Prisma.TransactionClient, user: CurrentUser, caseId: string) {
  const chat = await tx.reportChat.findUnique({ where: { caseId } });
  const state = chatState(chat?.state);
  const used = Object.entries(state.decisions)
    .filter(([id, decision]) => decision === "USED" && !id.startsWith("message:"))
    .map(([id]) => id);
  const now = new Date();
  if (used.length)
    await tx.extractedItem.updateMany({
      where: { id: { in: used }, status: "PENDING" },
      data: { status: "ACCEPTED", decidedById: user.id, decidedAt: now },
    });
  const provenance = await tx.fieldProvenance.updateMany({
    where: { caseId, verifiedById: null },
    data: { verifiedById: user.id, verifiedAt: now },
  });
  return { readings: used.length, fields: provenance.count };
}

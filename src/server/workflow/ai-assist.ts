import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { CONSISTENCY_INSTRUCTIONS, consistencySchema, type ConsistencyFinding } from "@/lib/domain/ai-checks";
import { toFormValues, type CaseFormValues } from "@/lib/domain/case-form";
import { assessCompleteness } from "@/lib/domain/completeness";
import { DOCUMENT_TYPE_LABELS, type DocumentExtraction, type ExtractedValue } from "@/lib/domain/extraction";
import {
  ACTION_TAKEN_LABELS,
  AGE_UNIT_LABELS,
  GENDER_LABELS,
  HISTORY_FLAG_LABELS,
  OUTCOME_LABELS,
  RECHALLENGE_LABELS,
  SERIOUS_ANSWER_LABELS,
  SERIOUSNESS_CRITERION_LABELS,
} from "@/lib/domain/labels";
import { NARRATIVE_INSTRUCTIONS, narrativeSchema, unsupportedDetails } from "@/lib/domain/narrative";
import { formatForDisplay } from "@/lib/domain/partial-date";
import { AiError, AiUnavailableError, generateWithFallback, type AiAttempt } from "@/server/ai/provider";
import { writeAudit } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { loadCase } from "./cases";
import { WorkflowError } from "./errors";

const label = <T extends string>(labels: Record<T, string>, v: T | "") => (v ? labels[v] : "");
const date = (d: { value: string; approx: boolean }) => formatForDisplay(d.value, d.approx);

/**
 * The report as plain text for the AI. Patient initials and reporter identity
 * are left out: the model does not need them.
 */
export function describeReport(v: CaseFormValues): string {
  const lines: string[] = [];
  const add = (name: string, value: string | undefined) => {
    if (value && value.trim()) lines.push(`${name}: ${value.trim()}`);
  };
  add("Age at onset", v.ageValue ? `${v.ageValue} ${label(AGE_UNIT_LABELS, v.ageUnit).toLowerCase()}`.trim() : "");
  add("Gender", label(GENDER_LABELS, v.gender));
  add("Weight", v.weightKg ? `${v.weightKg} kg` : "");
  add("Reaction term(s)", v.reactionTerms);
  add("Reaction start date", date(v.reactionStartDate));
  add("Reaction stop date", v.reactionOngoing ? "ongoing" : date(v.reactionStopDate));
  add("Description", v.reactionDescription);
  add("Management", v.reactionManagement);
  add("Medical / medication history", v.medicalHistory);
  add("History flags", v.historyFlags.map((f) => HISTORY_FLAG_LABELS[f]).join(", "));
  add("Serious", label(SERIOUS_ANSWER_LABELS, v.seriousAnswer));
  add("Seriousness criteria", v.seriousnessCriteria.map((c) => SERIOUSNESS_CRITERION_LABELS[c]).join(", "));
  add("Date of death", date(v.deathDate));
  add("Outcome", label(OUTCOME_LABELS, v.outcome));
  v.investigations.forEach((i, n) =>
    add(`Investigation ${n + 1}`, [i.testName, i.result, date(i.date)].filter(Boolean).join(" · ")),
  );
  v.suspectedMedicines.forEach((m, n) =>
    add(
      `Suspected medicine ${n + 1}`,
      [
        m.name,
        m.dose && `dose ${m.dose}`,
        m.route && `route ${m.route}`,
        m.frequency && `frequency ${m.frequency}`,
        date(m.startDate) && `started ${date(m.startDate)}`,
        m.ongoing ? "ongoing" : date(m.stopDate) && `stopped ${date(m.stopDate)}`,
        m.indication && `for ${m.indication}`,
        m.actionTaken && `action taken: ${ACTION_TAKEN_LABELS[m.actionTaken]}`,
        m.rechallenge && `reintroduced: ${RECHALLENGE_LABELS[m.rechallenge]}`,
      ]
        .filter(Boolean)
        .join("; "),
    ),
  );
  v.concomitantProducts.forEach((p, n) =>
    add(
      `Concomitant product ${n + 1}`,
      [
        p.name,
        p.dose && `dose ${p.dose}`,
        p.frequency && `frequency ${p.frequency}`,
        date(p.startDate) && `started ${date(p.startDate)}`,
        p.ongoing ? "ongoing" : date(p.stopDate) && `stopped ${date(p.stopDate)}`,
        p.indication && `for ${p.indication}`,
        p.usedToTreatReaction && "used to treat the reaction",
      ]
        .filter(Boolean)
        .join("; "),
    ),
  );
  add("Additional information", v.additionalInformation);
  return lines.join("\n");
}

/** What earlier extractions read from this case's documents, for the consistency check. */
async function documentFacts(caseId: string): Promise<string> {
  const runs = await db.extractionRun.findMany({
    where: { status: "SUCCEEDED", document: { caseId } },
    orderBy: { startedAt: "desc" },
    include: { document: { select: { id: true, originalName: true } } },
  });
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const run of runs) {
    if (seen.has(run.document.id)) continue;
    seen.add(run.document.id);
    const output = (run.rawResponse as { output?: Partial<DocumentExtraction> } | null)?.output;
    if (!output) continue;
    const v = (x: ExtractedValue | undefined) => x?.value ?? null;
    const facts: string[] = [];
    if (output.patient) {
      const p = output.patient;
      if (v(p.age)) facts.push(`age ${v(p.age)} ${(v(p.ageUnit) ?? "").toLowerCase()}`.trim());
      if (v(p.gender)) facts.push(`gender ${v(p.gender)?.toLowerCase()}`);
      if (v(p.weightKg)) facts.push(`weight ${v(p.weightKg)} kg`);
    }
    if (output.reaction) {
      const r = output.reaction;
      for (const [name, x] of Object.entries({
        reaction: r.terms,
        "reaction started": r.startDate,
        "reaction stopped": r.stopDate,
        description: r.description,
        management: r.management,
      }))
        if (v(x)) facts.push(`${name}: ${v(x)}`);
    }
    if (v(output.medicalHistory)) facts.push(`history: ${v(output.medicalHistory)}`);
    for (const i of output.investigations ?? [])
      facts.push(`test: ${[v(i.testName), v(i.result), v(i.date)].filter(Boolean).join(" · ")}`);
    for (const m of output.medications ?? [])
      facts.push(
        `medicine: ${[v(m.name), v(m.dose), v(m.frequency), v(m.startDate) && `from ${v(m.startDate)}`].filter(Boolean).join(", ")}`,
      );
    if (facts.length) {
      const type = output.documentType ? ` (${DOCUMENT_TYPE_LABELS[output.documentType]})` : "";
      blocks.push(`${run.document.originalName}${type}:\n- ${facts.join("\n- ")}`);
    }
  }
  return blocks.join("\n\n");
}

async function editableCase(user: CurrentUser, caseId: string) {
  const loaded = await loadCase(user, caseId);
  if (!loaded.access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
  return loaded;
}

function aiFailure(error: unknown): never {
  if (error instanceof AiError) throw new WorkflowError(error.message);
  console.error("AI request failed", error);
  throw new WorkflowError("The AI request failed unexpectedly. Nothing was changed.");
}

export interface NarrativeDraft {
  draftId: string;
  narrative: string;
  needsChecking: string[];
  leftOut: string[];
  /** Numbers and months in the draft that appear in neither the notes nor the report. */
  unsupported: string[];
  provider: string;
  model: string;
  attempts: AiAttempt[];
}

export async function draftNarrative(
  user: CurrentUser,
  caseId: string,
  input: { notes: string; useReport: boolean },
): Promise<NarrativeDraft> {
  const { c } = await editableCase(user, caseId);
  const notes = input.notes.trim().slice(0, 4000);
  const report = input.useReport ? describeReport(toFormValues(c)) : "";
  if (!notes && !report) throw new WorkflowError("Write a few notes first, or include the report details.");
  let outcome;
  try {
    outcome = await generateWithFallback({
      task: "narrative",
      system: NARRATIVE_INSTRUCTIONS,
      prompt: [
        notes ? `Reporter's rough notes:\n${notes}` : "",
        report ? `Report details entered so far:\n${report}` : "",
        "Write the narrative.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      schema: narrativeSchema,
      maxOutputTokens: 4000,
    });
  } catch (error) {
    await writeAudit({
      institutionId: user.institutionId,
      actorId: user.id,
      caseId: c.id,
      action: "AI_NARRATIVE_FAILED",
      details: { attempts: error instanceof AiUnavailableError ? error.attempts : [] },
    });
    aiFailure(error);
  }
  const { narrative, needsChecking, leftOut } = outcome.output;
  const unsupported = unsupportedDetails(narrative, [notes, report]);
  const audit = await db.auditLog.create({
    data: {
      institutionId: user.institutionId,
      actorId: user.id,
      caseId: c.id,
      action: "AI_NARRATIVE_DRAFTED",
      details: {
        provider: outcome.provider,
        model: outcome.model,
        notes,
        usedReport: input.useReport,
        narrative,
        unsupported,
        attempts: outcome.attempts,
      } as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return {
    draftId: audit.id,
    narrative,
    needsChecking,
    leftOut,
    unsupported,
    provider: outcome.provider,
    model: outcome.model,
    attempts: outcome.attempts,
  };
}

/** Records that the reporter put an AI draft into item 7, and whether they edited it first. */
export async function recordNarrativeUse(user: CurrentUser, caseId: string, input: { draftId: string; text: string }) {
  const { c } = await editableCase(user, caseId);
  const draft = await db.auditLog.findFirst({
    where: { id: input.draftId, caseId: c.id, action: "AI_NARRATIVE_DRAFTED", actorId: user.id },
  });
  if (!draft) throw new WorkflowError("This draft was not found.", "NOT_FOUND");
  const original = (draft.details as { narrative?: string; provider?: string; model?: string } | null) ?? {};
  await writeAudit({
    institutionId: user.institutionId,
    actorId: user.id,
    caseId: c.id,
    action: "AI_NARRATIVE_USED",
    details: {
      draftId: draft.id,
      provider: original.provider,
      model: original.model,
      edited: input.text.trim() !== (original.narrative ?? "").trim(),
    },
  });
  return null;
}

export interface ConsistencyResult {
  checkId: string;
  findings: ConsistencyFinding[];
  provider: string;
  model: string;
  attempts: AiAttempt[];
  usedDocuments: boolean;
}

export async function checkConsistency(user: CurrentUser, caseId: string): Promise<ConsistencyResult> {
  const { c } = await editableCase(user, caseId);
  const values = toFormValues(c);
  const report = describeReport(values);
  if (!report) throw new WorkflowError("Enter some of the report first.");
  const docs = await documentFacts(c.id);
  const rules = assessCompleteness(values);
  const alreadyChecked = [...rules.missing, ...rules.warnings].map((f) => f.message);
  let outcome;
  try {
    outcome = await generateWithFallback({
      task: "consistency",
      system: CONSISTENCY_INSTRUCTIONS,
      prompt: [
        `The report:\n${report}`,
        docs ? `What was read from the uploaded documents:\n${docs}` : "No documents were uploaded.",
        alreadyChecked.length
          ? `Already pointed out by the app (do not repeat):\n- ${alreadyChecked.join("\n- ")}`
          : "",
        "List what the reporter should check.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      schema: consistencySchema,
      maxOutputTokens: 4000,
    });
  } catch (error) {
    await writeAudit({
      institutionId: user.institutionId,
      actorId: user.id,
      caseId: c.id,
      action: "AI_CHECK_FAILED",
      details: { attempts: error instanceof AiUnavailableError ? error.attempts : [] },
    });
    aiFailure(error);
  }
  const findings = outcome.output.findings.slice(0, 8);
  const audit = await db.auditLog.create({
    data: {
      institutionId: user.institutionId,
      actorId: user.id,
      caseId: c.id,
      action: "AI_CHECK_RUN",
      details: {
        provider: outcome.provider,
        model: outcome.model,
        findings,
        attempts: outcome.attempts,
      } as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return {
    checkId: audit.id,
    findings,
    provider: outcome.provider,
    model: outcome.model,
    attempts: outcome.attempts,
    usedDocuments: Boolean(docs),
  };
}

/** The reporter looked at an AI finding and kept the report as it is, with an optional reason. */
export async function keepFinding(
  user: CurrentUser,
  caseId: string,
  input: { checkId: string; index: number; reason: string },
) {
  const { c } = await editableCase(user, caseId);
  const check = await db.auditLog.findFirst({
    where: { id: input.checkId, caseId: c.id, action: "AI_CHECK_RUN", actorId: user.id },
  });
  const findings = (check?.details as { findings?: ConsistencyFinding[] } | null)?.findings;
  const finding = findings?.[input.index];
  if (!finding) throw new WorkflowError("This finding was not found.", "NOT_FOUND");
  await writeAudit({
    institutionId: user.institutionId,
    actorId: user.id,
    caseId: c.id,
    action: "AI_CHECK_KEPT",
    details: { checkId: check!.id, finding: finding.message, reason: input.reason.trim().slice(0, 500) || null },
  });
  return null;
}

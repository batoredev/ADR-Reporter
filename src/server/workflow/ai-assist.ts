import "server-only";
import { z } from "zod";
import { chatState } from "@/lib/domain/report-chat";
import { aiHistory, type FindingDecision, type SavedNarrative, type SavedCheck } from "@/lib/domain/ai-history";
import type { Prisma } from "@/generated/prisma/client";
import { CONSISTENCY_INSTRUCTIONS, consistencySchema } from "@/lib/domain/ai-checks";
import { toFormValues, type CaseFormValues } from "@/lib/domain/case-form";
import { assessCompleteness } from "@/lib/domain/completeness";
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
import { AiError, AiUnavailableError, generateWithFallback } from "@/server/ai/provider";
import { writeAudit } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { loadCase, lockCase } from "./cases";
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
  add("Date of birth", date(v.dateOfBirth));
  add("Explicitly unknown fields", v.unknownFields.join(", "));
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
        m.manufacturer && `manufacturer ${m.manufacturer}`,
        m.batchLot && `batch ${m.batchLot}`,
        date(m.expiryDate) && `expiry ${date(m.expiryDate)}`,
        m.rechallengeDose && `dose on reintroduction ${m.rechallengeDose}`,
        m.unknownFields.length && `unknown: ${m.unknownFields.join(", ")}`,
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
        p.route && `route ${p.route}`,
        p.unknownFields.length && `unknown: ${p.unknownFields.join(", ")}`,
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
    take: 200,
    include: { document: { select: { id: true, originalName: true } }, items: true },
  });
  const chat = await db.reportChat.findUnique({ where: { caseId }, select: { state: true } });
  const skipped = new Set(
    Object.entries(chatState(chat?.state).decisions)
      .filter(([, value]) => value === "SKIPPED")
      .map(([id]) => id),
  );
  const pagedDocuments = new Set(runs.filter((run) => run.sourcePage !== null).map((run) => run.documentId));
  const seen = new Set<string>();
  const blocks: string[] = [];
  for (const run of runs) {
    if (run.sourcePage === null && pagedDocuments.has(run.documentId)) continue;
    const key = `${run.documentId}:${run.sourcePage ?? "document"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const facts = run.items
      .filter(
        (i) =>
          i.status !== "REJECTED" && !skipped.has(i.id) && i.proposedValue && i.fieldName !== "case:patient.initials",
      )
      .map(
        (i) =>
          `${i.fieldName} [row ${i.medicationIndex + 1}; ${i.status}; ${i.uncertain ? "UNCERTAIN" : "AI reading"}]: ${JSON.stringify(i.finalValue ?? i.proposedValue)}; source text: ${JSON.stringify(i.sourceText)}`,
      );
    if (facts.length)
      blocks.push(
        `Document ${run.document.id} (${run.document.originalName})${run.sourcePage ? `, page ${run.sourcePage}` : ""}, extraction ${run.id}:\n${facts.join("\n")}`,
      );
  }
  const all = blocks.join("\n\n");
  return all.length > 24000
    ? all.slice(0, 24000) + "\n[Document context truncated; not a complete document review.]"
    : all;
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

export type NarrativeDraft = SavedNarrative;

export async function draftNarrative(
  user: CurrentUser,
  caseId: string,
  input: { notes: string; useReport: boolean },
): Promise<NarrativeDraft> {
  const { c } = await editableCase(user, caseId);
  if (input.notes.length > 4000) throw new WorkflowError("Keep rough notes under 4000 characters.");
  const notes = input.notes.trim();
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
        report,
        lockVersion: c.lockVersion,
        needsChecking,
        leftOut,
        meta: outcome.meta,
        narrative,
        unsupported,
        attempts: outcome.attempts,
      } as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return {
    draftId: audit.id,
    notes,
    report,
    lockVersion: c.lockVersion,
    narrative,
    needsChecking,
    leftOut,
    unsupported,
    provider: outcome.provider,
    model: outcome.model,
    attempts: outcome.attempts,
  };
}

/** Apply the verified text and append its complete audit record in one transaction. */
export async function recordNarrativeUse(
  user: CurrentUser,
  caseId: string,
  input: {
    draftId: string;
    text: string;
    mode: "replace" | "append";
    lockVersion: number;
    verified: boolean;
  },
) {
  if (!input.verified) throw new WorkflowError("Verify the narrative against the source before using it.");
  if (!input.text.trim() || input.text.length > 4000) throw new WorkflowError("Enter between 1 and 4000 characters.");
  return db.$transaction(async (tx) => {
    const { c, access } = await lockCase(user, caseId, tx);
    if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
    if (c.lockVersion !== input.lockVersion)
      throw new WorkflowError("This report changed. Reload and review the narrative again.", "CONFLICT");
    const draft = await tx.auditLog.findFirst({
      where: { id: input.draftId, caseId: c.id, action: "AI_NARRATIVE_DRAFTED", actorId: user.id },
    });
    if (!draft) throw new WorkflowError("This draft was not found.", "NOT_FOUND");
    const decisions = await tx.auditLog.findMany({
      where: { caseId, action: { in: ["AI_NARRATIVE_USED", "AI_NARRATIVE_DISCARDED"] } },
    });
    if (decisions.some((d) => (d.details as { draftId?: string })?.draftId === input.draftId))
      throw new WorkflowError("This narrative was already used or discarded.", "CONFLICT");
    const original = draft.details as unknown as SavedNarrative;
    const text = input.text.trim();
    const next = input.mode === "append" && c.reactionDescription ? `${c.reactionDescription}\n\n${text}` : text;
    if (next.length > 4000)
      throw new WorkflowError("The combined narrative exceeds 4000 characters. Shorten it first; nothing was changed.");
    await tx.adrCase.update({
      where: { id: c.id },
      data: { reactionDescription: next, lockVersion: { increment: 1 } },
    });
    await tx.fieldProvenance.deleteMany({ where: { caseId, fieldPath: "reactionDescription" } });
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId,
        action: "AI_NARRATIVE_USED",
        details: {
          draftId: draft.id,
          provider: original.provider,
          model: original.model,
          edited: text !== original.narrative.trim(),
          original: original.narrative,
          text,
          previous: c.reactionDescription,
          finalText: next,
          mode: input.mode,
          verified: true,
          lockVersion: c.lockVersion + 1,
          unsupported: unsupportedDetails(text, [original.notes ?? "", original.report ?? ""]),
        },
      },
      tx,
    );
    return { lockVersion: c.lockVersion + 1 };
  });
}

export type ConsistencyResult = SavedCheck;

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
        docs
          ? `What was read from the uploaded documents:\n${docs}`
          : "No usable extracted document facts are available. Uploaded files were not read in this check.",
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
        report,
        documentFacts: docs,
        usedDocuments: Boolean(docs),
        lockVersion: c.lockVersion,
        meta: outcome.meta,
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
    lockVersion: c.lockVersion,
    decisions: {},
  };
}

export async function getAiHistory(user: CurrentUser, caseId: string) {
  await loadCase(user, caseId);
  const events = await db.auditLog.findMany({
    where: { caseId, action: { startsWith: "AI_" } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const guided = await db.auditLog.findFirst({
    where: { caseId, action: "GUIDED_STEP_SAVED" },
    orderBy: { createdAt: "desc" },
  });
  return aiHistory(guided ? [...events, guided] : events);
}

export async function discardNarrative(user: CurrentUser, caseId: string, draftId: string) {
  await editableCase(user, caseId);
  const draft = await db.auditLog.findFirst({
    where: { id: draftId, caseId, actorId: user.id, action: "AI_NARRATIVE_DRAFTED" },
  });
  if (!draft) throw new WorkflowError("This draft was not found.", "NOT_FOUND");
  await writeAudit({
    institutionId: user.institutionId,
    actorId: user.id,
    caseId,
    action: "AI_NARRATIVE_DISCARDED",
    details: { draftId },
  });
  return null;
}

export async function keepFinding(
  user: CurrentUser,
  caseId: string,
  input: {
    checkId: string;
    index: number;
    reason: string;
    decision?: FindingDecision;
  },
) {
  const parsed = z
    .object({
      checkId: z.string(),
      index: z.number().int().min(0),
      reason: z.string().trim().max(500),
      decision: z.enum(["KEPT", "CORRECTED", "UNSURE"]).default("KEPT"),
    })
    .safeParse(input);
  if (!parsed.success) throw new WorkflowError("Choose a valid finding and decision (reason: at most 500 characters).");
  const d = parsed.data;
  if (d.decision === "KEPT" && !d.reason) throw new WorkflowError("Explain why you are keeping the recorded value.");
  return db.$transaction(async (tx) => {
    const { c, access } = await lockCase(user, caseId, tx);
    if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
    const check = await tx.auditLog.findFirst({
      where: { id: d.checkId, caseId, action: "AI_CHECK_RUN", actorId: user.id },
    });
    const saved = check?.details as unknown as SavedCheck | undefined;
    const finding = saved?.findings?.[d.index];
    if (!finding) throw new WorkflowError("This finding was not found.", "NOT_FOUND");
    if (d.decision === "CORRECTED" && c.lockVersion === saved?.lockVersion)
      throw new WorkflowError("Save your correction to the report first.");
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId,
        action: "AI_FINDING_DECIDED",
        details: { ...d, finding: finding.message, lockVersion: c.lockVersion },
      },
      tx,
    );
    return null;
  });
}

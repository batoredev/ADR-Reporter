import "server-only";
import {
  GUIDED_IDS,
  GUIDED_INSTRUCTIONS,
  GUIDED_STEPS,
  guidedSchema,
  missingGuidedSteps,
  type GuidedId,
} from "@/lib/domain/guided";
import { toFormValues } from "@/lib/domain/case-form";
import { assessCompleteness } from "@/lib/domain/completeness";
import { AiError, AiUnavailableError, generateWithFallback, type AiAttempt } from "@/server/ai/provider";
import { writeAudit } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/current-user";
import { describeReport } from "./ai-assist";
import { loadCase } from "./cases";
import { WorkflowError } from "./errors";

export interface GuidedSuggestions {
  stepIds: GuidedId[];
  provider: string;
  model: string;
  attempts: AiAttempt[];
  reason?: string;
}
export async function guidedFollowups(user: CurrentUser, caseId: string): Promise<GuidedSuggestions> {
  const { c, access } = await loadCase(user, caseId);
  if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
  const values = toFormValues(c);
  const missing = missingGuidedSteps(values);
  let result: GuidedSuggestions;
  try {
    const outcome = await generateWithFallback({
      task: "guided",
      system: GUIDED_INSTRUCTIONS,
      prompt: JSON.stringify({
        report: describeReport(values),
        checks: assessCompleteness(values),
        missingSteps: missing,
        bank: GUIDED_STEPS.map((s) => ({ id: s.id, questions: s.questions.map((q) => q.question) })),
      }),
      schema: guidedSchema,
      maxOutputTokens: 1000,
    });
    result = {
      stepIds: [...new Set(outcome.output.stepIds)],
      provider: outcome.provider,
      model: outcome.model,
      attempts: outcome.attempts,
    };
  } catch (error) {
    result = {
      stepIds: missing.slice(0, 3),
      provider: "rules",
      model: "question-bank-v1",
      attempts: error instanceof AiUnavailableError ? error.attempts : [],
      reason: error instanceof AiError ? error.message : "AI is unavailable. Showing the next unanswered sections.",
    };
  }
  await writeAudit({
    institutionId: user.institutionId,
    actorId: user.id,
    caseId,
    action: "AI_GUIDED_FOLLOWUPS",
    details: { ...result, lockVersion: c.lockVersion },
  });
  return result;
}

export async function saveGuidedStep(user: CurrentUser, caseId: string, stepId: string) {
  const { c, access } = await loadCase(user, caseId);
  if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "FORBIDDEN");
  if (!GUIDED_IDS.includes(stepId as GuidedId)) throw new WorkflowError("Unknown guided question group.");
  await writeAudit({
    institutionId: user.institutionId,
    actorId: user.id,
    caseId,
    action: "GUIDED_STEP_SAVED",
    details: { stepId, lockVersion: c.lockVersion },
  });
  return null;
}

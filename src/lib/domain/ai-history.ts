import type { AiAttempt } from "@/server/ai/provider";
import type { ConsistencyFinding } from "./ai-checks";

export type FindingDecision = "KEPT" | "CORRECTED" | "UNSURE";
export interface SavedNarrative {
  draftId: string;
  narrative: string;
  notes: string;
  report: string;
  needsChecking: string[];
  leftOut: string[];
  unsupported: string[];
  provider: string;
  model: string;
  attempts: AiAttempt[];
  lockVersion: number;
}
export interface SavedCheck {
  checkId: string;
  findings: ConsistencyFinding[];
  provider: string;
  model: string;
  attempts: AiAttempt[];
  usedDocuments: boolean;
  lockVersion: number;
  decisions: Record<number, { decision: FindingDecision; reason: string; at: string }>;
}
export interface AiHistory {
  narrative: SavedNarrative | null;
  check: SavedCheck | null;
  guidedStep: string | null;
}

/** Append-only events are the durable source of assistance state, including reviewer decisions. */
export function aiHistory(
  events: { id: string; action: string; details: unknown; createdAt: Date | string }[],
): AiHistory {
  const state: AiHistory = { narrative: null, check: null, guidedStep: null };
  for (const event of [...events].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id),
  )) {
    const d = (event.details ?? {}) as Record<string, unknown>;
    if (event.action === "AI_NARRATIVE_DRAFTED") {
      state.narrative = {
        notes: "",
        report: "",
        needsChecking: [],
        leftOut: [],
        unsupported: [],
        attempts: [],
        lockVersion: -1,
        ...d,
        draftId: event.id,
      } as unknown as SavedNarrative;
    }
    if (
      ["AI_NARRATIVE_USED", "AI_NARRATIVE_DISCARDED"].includes(event.action) &&
      d.draftId === state.narrative?.draftId
    )
      state.narrative = null;
    if (event.action === "AI_CHECK_RUN") {
      state.check = {
        attempts: [],
        usedDocuments: false,
        lockVersion: -1,
        ...d,
        checkId: event.id,
        decisions: {},
      } as unknown as SavedCheck;
    }
    if (event.action === "AI_FINDING_DECIDED" && d.checkId === state.check?.checkId && Number.isInteger(d.index)) {
      state.check!.decisions[d.index as number] = {
        decision: d.decision as FindingDecision,
        reason: String(d.reason ?? ""),
        at: new Date(event.createdAt).toISOString(),
      };
    }
    if (event.action === "GUIDED_STEP_SAVED" && typeof d.stepId === "string") state.guidedStep = d.stepId;
  }
  return state;
}

"use server";

import { requireUser } from "@/server/auth/current-user";
import { asResult, type ActionResult } from "@/server/workflow/errors";
import {
  addComment,
  approveCase,
  claimCase,
  closeIssue,
  reassignCase,
  recordChecklistItem,
  releaseCase,
  resumeReview,
  returnCase,
} from "@/server/workflow/review";

type Values = Record<string, string>;
const text = (values: Values, key: string) => String(values[key] ?? "");

export async function claimAction(caseId: string): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await claimCase(user, caseId);
    return null;
  });
}

export async function resumeAction(caseId: string): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await resumeReview(user, caseId);
    return null;
  });
}

export async function releaseAction(caseId: string, values: Values): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await releaseCase(user, caseId, text(values, "reason"));
    return null;
  });
}

export async function reassignAction(caseId: string, values: Values): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await reassignCase(user, caseId, text(values, "toUserId"), text(values, "reason"));
    return null;
  });
}

export async function checklistAction(
  caseId: string,
  input: { item: string; outcome: "VERIFIED" | "VERIFIED_WITH_EXCEPTION" | "CLEAR"; exceptionReason?: string },
): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await recordChecklistItem(user, caseId, input);
    return null;
  });
}

export async function commentAction(
  caseId: string,
  input: { kind: "NOTE" | "ISSUE"; body: string; fieldPath?: string },
): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await addComment(user, caseId, {
      kind: input.kind === "ISSUE" ? "ISSUE" : "NOTE",
      body: input.body,
      fieldPath: input.fieldPath,
    });
    return null;
  });
}

export async function closeIssueAction(caseId: string, commentId: string, values: Values): Promise<ActionResult<null>> {
  const user = await requireUser();
  const status = text(values, "status") === "ACKNOWLEDGED_UNAVAILABLE" ? "ACKNOWLEDGED_UNAVAILABLE" : "RESOLVED";
  return asResult(async () => {
    await closeIssue(user, caseId, commentId, { status, note: text(values, "note") });
    return null;
  });
}

export async function approveAction(caseId: string): Promise<ActionResult<{ versionNo: number }>> {
  const user = await requireUser();
  return asResult(() => approveCase(user, caseId));
}

export async function returnAction(caseId: string, values: Values): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await returnCase(user, caseId, text(values, "reason"));
    return null;
  });
}

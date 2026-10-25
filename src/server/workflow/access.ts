import "server-only";
import type { CaseStatus } from "@/generated/prisma/enums";
import { canCoordinate, canReview } from "@/lib/domain/access";
import type { CurrentUser } from "@/server/auth/current-user";

export interface CaseAccessFacts {
  reporterId: string;
  assigneeId: string | null;
  status: CaseStatus;
  isPotentiallySerious: boolean;
  hasEscalation: boolean;
  hasOpenEscalation: boolean;
}

const REVIEWABLE: CaseStatus[] = ["SUBMITTED", "RESUBMITTED"];

/** Everything a user may do with one case. Every server action re-checks this. */
export function caseAccess(user: CurrentUser, c: CaseAccessFacts) {
  const isOwner = c.reporterId === user.id;
  const isAssignee = c.assigneeId !== null && c.assigneeId === user.id;
  const reviewer = canReview(user);
  const view =
    isOwner || ((reviewer || canCoordinate(user)) && c.status !== "DRAFT") || (user.isUrgentContact && c.hasEscalation);
  const activeReview = ["UNDER_REVIEW", "RESUBMITTED", "RETURNED"].includes(c.status);
  return {
    view,
    isOwner,
    isAssignee,
    edit: isOwner && (c.status === "DRAFT" || c.status === "RETURNED"),
    escalate:
      (isOwner || reviewer) &&
      c.isPotentiallySerious &&
      !c.hasOpenEscalation &&
      !["EXTERNALLY_SUBMITTED", "ACKNOWLEDGED"].includes(c.status),
    handleEscalation: user.isUrgentContact && c.hasEscalation,
    claim: reviewer && !isOwner && c.assigneeId === null && REVIEWABLE.includes(c.status),
    resume: isAssignee && c.status === "RESUBMITTED",
    decide: isAssignee && !isOwner && c.status === "UNDER_REVIEW",
    release: (isAssignee || (user.canReassign && reviewer)) && c.assigneeId !== null && activeReview,
    reassign:
      reviewer &&
      ((isAssignee && activeReview) ||
        (user.canReassign && (activeReview || (c.assigneeId === null && REVIEWABLE.includes(c.status))))),
    comment: (reviewer && c.status !== "DRAFT") || isOwner,
    raiseIssue: isAssignee && c.status === "UNDER_REVIEW",
    recordSubmission: canCoordinate(user) && c.status === "APPROVED",
    recordAcknowledgement: canCoordinate(user) && c.status === "EXTERNALLY_SUBMITTED",
  };
}

export type CaseAccess = ReturnType<typeof caseAccess>;

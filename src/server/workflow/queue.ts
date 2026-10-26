import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { CaseStatus } from "@/generated/prisma/enums";
import { canReview } from "@/lib/domain/access";
import { QUEUE_FILTERS, type QueueFilter } from "@/lib/domain/filters";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { WorkflowError } from "./errors";

export { QUEUE_FILTERS, type QueueFilter };

const PENDING: CaseStatus[] = ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"];

export function parseQueueFilter(value: unknown): QueueFilter {
  return typeof value === "string" && value in QUEUE_FILTERS ? (value as QueueFilter) : "pending";
}

function filterWhere(user: CurrentUser, filter: QueueFilter): Prisma.AdrCaseWhereInput {
  switch (filter) {
    case "pending":
      return { status: { in: PENDING } };
    case "unassigned":
      return { status: { in: ["SUBMITTED", "RESUBMITTED"] }, assigneeId: null };
    case "mine":
      return { assigneeId: user.id, status: { in: ["UNDER_REVIEW", "RESUBMITTED", "RETURNED"] } };
    case "serious":
      return { status: { in: PENDING }, isPotentiallySerious: true };
    case "returned":
      return { status: "RETURNED" };
    case "approved":
      return { status: "APPROVED" };
    case "all":
      return { status: { not: "DRAFT" } };
  }
}

/** The shared institutional queue: potentially serious first, then the longest-waiting. */
export async function getReviewQueue(user: CurrentUser, filter: QueueFilter) {
  if (!canReview(user)) throw new WorkflowError("Only reviewers can see the review queue.", "FORBIDDEN");
  const base: Prisma.AdrCaseWhereInput = { institutionId: user.institutionId };
  const [cases, ...counts] = await Promise.all([
    db.adrCase.findMany({
      where: { ...base, ...filterWhere(user, filter) },
      orderBy: [{ isPotentiallySerious: "desc" }, { lastSubmittedAt: { sort: "asc", nulls: "last" } }],
      take: 200,
      select: {
        id: true,
        caseNumber: true,
        status: true,
        patientInitials: true,
        reactionTerms: true,
        isPotentiallySerious: true,
        lastSubmittedAt: true,
        currentVersion: true,
        reporterId: true,
        assigneeId: true,
        reporter: { select: { name: true } },
        assignee: { select: { name: true } },
        suspectedMedicines: { orderBy: { position: "asc" }, take: 1, select: { name: true } },
        escalations: { where: { closedAt: null }, select: { id: true } },
        _count: { select: { comments: { where: { kind: "ISSUE", issueStatus: "OPEN" } } } },
      },
    }),
    ...(Object.keys(QUEUE_FILTERS) as QueueFilter[]).map((f) =>
      db.adrCase.count({ where: { ...base, ...filterWhere(user, f) } }),
    ),
  ]);
  const keys = Object.keys(QUEUE_FILTERS) as QueueFilter[];
  return {
    cases: cases.map((c) => ({
      ...c,
      canClaim:
        c.reporterId !== user.id && c.assigneeId === null && (c.status === "SUBMITTED" || c.status === "RESUBMITTED"),
      canResume: c.assigneeId === user.id && c.status === "RESUBMITTED",
    })),
    counts: Object.fromEntries(keys.map((k, i) => [k, counts[i]])) as Record<QueueFilter, number>,
  };
}

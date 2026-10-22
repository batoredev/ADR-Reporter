import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { CaseStatus } from "@/generated/prisma/enums";
import { canCoordinate, canHandleEscalations, canReport, canReview } from "@/lib/domain/access";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";

/**
 * Cases a user may list: their own reports, plus every non-draft case in
 * their institution if they review or coordinate. Drafts stay private to
 * their reporter.
 */
export function visibleCasesWhere(user: CurrentUser): Prisma.AdrCaseWhereInput {
  const own: Prisma.AdrCaseWhereInput = { reporterId: user.id };
  const scope: Prisma.AdrCaseWhereInput =
    canReview(user) || canCoordinate(user) ? { OR: [own, { status: { not: CaseStatus.DRAFT } }] } : own;
  return { institutionId: user.institutionId, ...scope };
}

export const DASHBOARD_SORTS = {
  activity: "Most recent activity",
  submitted: "Newest submission",
  serious: "Potentially serious first",
} as const;

export type DashboardSort = keyof typeof DASHBOARD_SORTS;

export interface DashboardFilters {
  q?: string;
  status?: CaseStatus;
  sort: DashboardSort;
}

export function parseDashboardFilters(params: Record<string, string | string[] | undefined>): DashboardFilters {
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const status =
    typeof params.status === "string" && params.status in CaseStatus ? (params.status as CaseStatus) : undefined;
  const sort =
    typeof params.sort === "string" && params.sort in DASHBOARD_SORTS ? (params.sort as DashboardSort) : "activity";
  return { q: q || undefined, status, sort };
}

const ORDER_BY: Record<DashboardSort, Prisma.AdrCaseOrderByWithRelationInput[]> = {
  activity: [{ updatedAt: "desc" }],
  submitted: [{ lastSubmittedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  serious: [{ isPotentiallySerious: "desc" }, { lastSubmittedAt: { sort: "desc", nulls: "last" } }],
};

const PENDING: CaseStatus[] = ["SUBMITTED", "RESUBMITTED", "UNDER_REVIEW"];
const EXTERNAL: CaseStatus[] = ["EXTERNALLY_SUBMITTED", "ACKNOWLEDGED"];

export async function getDashboard(user: CurrentUser, filters: DashboardFilters) {
  const visible = visibleCasesWhere(user);

  const [byStatus, potentiallySerious, openEscalations] = await Promise.all([
    db.adrCase.groupBy({ by: ["status"], where: visible, _count: { _all: true } }),
    db.adrCase.count({ where: { ...visible, isPotentiallySerious: true } }),
    canHandleEscalations(user)
      ? db.urgentEscalation.count({ where: { closedAt: null, adrCase: { institutionId: user.institutionId } } })
      : Promise.resolve(null),
  ]);

  const count = (statuses: CaseStatus[]) =>
    byStatus.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);

  const metrics = {
    total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
    drafts: canReport(user) ? count(["DRAFT"]) : null,
    pendingReview: count(PENDING),
    returned: count(["RETURNED"]),
    approved: count(["APPROVED"]),
    externallySubmitted: count(EXTERNAL),
    potentiallySerious,
    openEscalations,
  };

  const search: Prisma.AdrCaseWhereInput[] = filters.q
    ? [
        {
          OR: [
            { caseNumber: { contains: filters.q, mode: "insensitive" } },
            { patientInitials: { contains: filters.q, mode: "insensitive" } },
            { reactionTerms: { contains: filters.q, mode: "insensitive" } },
            { suspectedMedicines: { some: { name: { contains: filters.q, mode: "insensitive" } } } },
            { reporter: { name: { contains: filters.q, mode: "insensitive" } } },
          ],
        },
      ]
    : [];

  const recent = await db.adrCase.findMany({
    where: { AND: [visible, ...(filters.status ? [{ status: filters.status }] : []), ...search] },
    orderBy: ORDER_BY[filters.sort],
    take: 15,
    select: {
      id: true,
      caseNumber: true,
      status: true,
      patientInitials: true,
      reactionTerms: true,
      isPotentiallySerious: true,
      lastSubmittedAt: true,
      reporter: { select: { name: true } },
      assignee: { select: { name: true } },
      suspectedMedicines: { orderBy: { position: "asc" }, take: 1, select: { name: true } },
    },
  });

  return { metrics, recent };
}

export type DashboardCase = Awaited<ReturnType<typeof getDashboard>>["recent"][number];

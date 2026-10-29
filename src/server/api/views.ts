import "server-only";
import { CaseStatus } from "@/generated/prisma/enums";
import { canReport, describeAccess } from "@/lib/domain/access";
import { toFormValues } from "@/lib/domain/case-form";
import { assessCompleteness } from "@/lib/domain/completeness";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemoMode } from "@/lib/demo";
import { todayInAppZone } from "@/lib/format";
import { aiStatus } from "@/server/ai/provider";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { getCaseDetails } from "@/server/workflow/case-details";
import { WorkflowError } from "@/server/workflow/errors";

// Data for the pages that need more than one service call.

export function demoAccounts() {
  if (!isDemoMode()) return { demoPassword: null, accounts: [] };
  return {
    demoPassword: DEMO_PASSWORD,
    accounts: DEMO_ACCOUNTS.map((account) => ({
      email: account.email,
      name: account.name,
      summary: describeAccess({
        roles: account.roles,
        isUrgentContact: account.isUrgentContact ?? false,
        canReassign: account.canReassign ?? false,
      }),
    })),
  };
}

function requireReporter(user: CurrentUser) {
  if (!canReport(user)) throw new WorkflowError("Only reporters can do this.", "FORBIDDEN");
}

export async function myReports(user: CurrentUser, status: string | null) {
  requireReporter(user);
  const filter = status && status in CaseStatus ? (status as CaseStatus) : undefined;
  const cases = await db.adrCase.findMany({
    where: { reporterId: user.id, institutionId: user.institutionId, ...(filter ? { status: filter } : {}) },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      caseNumber: true,
      status: true,
      reactionTerms: true,
      isPotentiallySerious: true,
      updatedAt: true,
      suspectedMedicines: { orderBy: { position: "asc" }, take: 1, select: { name: true } },
      _count: { select: { comments: { where: { kind: "ISSUE", issueStatus: "OPEN" } } } },
    },
  });
  return { filter: filter ?? null, cases };
}

export async function openDrafts(user: CurrentUser) {
  requireReporter(user);
  return db.adrCase.findMany({
    where: { reporterId: user.id, status: { in: ["DRAFT", "RETURNED"] } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { id: true, caseNumber: true, status: true, reactionTerms: true, updatedAt: true },
  });
}

export async function profile(user: CurrentUser) {
  return db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { name: true, email: true, occupation: true, address: true, pin: true, phone: true, designation: true },
  });
}

export interface IssueView {
  id: string;
  body: string;
  author: string;
}

/** The report form: values, open issues by field, and uploaded documents. */
export async function editView(user: CurrentUser, caseId: string) {
  const d = await getCaseDetails(user, caseId);
  if (!d.access.edit) return { editable: false as const, caseNumber: d.c.caseNumber };
  const openIssues = d.comments.filter((c) => c.kind === "ISSUE" && c.issueStatus === "OPEN");
  const issuesByPath: Record<string, IssueView[]> = {};
  for (const issue of openIssues) {
    const key = issue.fieldPath ?? "general";
    (issuesByPath[key] ??= []).push({ id: issue.id, body: issue.body, author: issue.author.name });
  }
  const lastReturn = d.c.status === "RETURNED" ? d.decisions.filter((x) => x.decision === "RETURN").at(-1) : undefined;
  return {
    editable: true as const,
    caseNumber: d.c.caseNumber,
    status: d.c.status,
    lockVersion: d.c.lockVersion,
    values: toFormValues(d.c),
    reporter: {
      name: d.reporter.name,
      email: d.reporter.email,
      phone: d.reporter.phone,
      occupation: d.reporter.occupation,
    },
    issuesByPath,
    openIssues: openIssues.map((i) => ({ id: i.id, body: i.body })),
    lastReturn: lastReturn ? { reviewer: lastReturn.reviewer.name, reason: lastReturn.reason } : null,
    hasOpenEscalation: d.escalations.some((e) => e.closedAt === null),
    documents: d.documents.map((doc) => ({
      id: doc.id,
      name: doc.originalName,
      mimeType: doc.mimeType,
      uploadedAt: doc.createdAt.toISOString(),
    })),
    ai: aiStatus(),
  };
}

/** The review-and-submit page: completeness and the form as it will be submitted. */
export async function submitView(user: CurrentUser, caseId: string) {
  const d = await getCaseDetails(user, caseId);
  if (!d.access.edit) return { editable: false as const, caseNumber: d.c.caseNumber };
  return {
    editable: true as const,
    caseNumber: d.c.caseNumber,
    status: d.c.status,
    lockVersion: d.c.lockVersion,
    resubmission: d.c.status === "RETURNED",
    check: assessCompleteness(toFormValues(d.c), d.reporter),
    aiEvents: d.timeline.filter((e) => e.action.startsWith("AI_")),
    preview: {
      ...d.live,
      reporter: {
        name: d.reporter.name,
        address: d.reporter.address,
        pin: d.reporter.pin,
        email: d.reporter.email,
        phone: d.reporter.phone,
        occupation: d.reporter.occupation,
        reportDate: todayInAppZone(),
      },
    },
  };
}

export type EditView = Awaited<ReturnType<typeof editView>>;
export type SubmitView = Awaited<ReturnType<typeof submitView>>;
export type MyReportsView = Awaited<ReturnType<typeof myReports>>;
export type DraftsView = Awaited<ReturnType<typeof openDrafts>>;
export type ProfileView = Awaited<ReturnType<typeof profile>>;
export type DemoAccountsView = ReturnType<typeof demoAccounts>;

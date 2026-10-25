import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { ChecklistItemKey, type CaseStatus } from "@/generated/prisma/enums";
import { canReview } from "@/lib/domain/access";
import { buildCaseSnapshot, caseSnapshotInclude } from "@/lib/domain/snapshot";
import { isDemoMode } from "@/lib/demo";
import { todayInAppZone } from "@/lib/format";
import { writeAudit } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { ddmmyyyy, generatePvpiPdf } from "@/server/pdf/pvpi-form";
import { saveFile } from "@/server/storage";
import { loadCase } from "./cases";
import { WorkflowError } from "./errors";

const json = (v: unknown) => v as Prisma.InputJsonValue;
const CHECKLIST_KEYS = Object.values(ChecklistItemKey);

/** Takes up an unassigned case. One atomic update, so concurrent clicks have exactly one winner. */
export async function claimCase(user: CurrentUser, caseId: string) {
  if (!canReview(user)) throw new WorkflowError("Only reviewers can take up cases.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const now = new Date();
    const claimed = await tx.adrCase.updateMany({
      where: {
        id: caseId,
        institutionId: user.institutionId,
        assigneeId: null,
        status: { in: ["SUBMITTED", "RESUBMITTED"] },
        reporterId: { not: user.id },
      },
      data: { assigneeId: user.id, claimedAt: now, status: "UNDER_REVIEW", lockVersion: { increment: 1 } },
    });
    if (claimed.count === 0) {
      const current = await tx.adrCase.findFirst({
        where: { id: caseId, institutionId: user.institutionId },
        select: { reporterId: true, assignee: { select: { name: true } }, status: true },
      });
      if (!current || current.status === "DRAFT") throw new WorkflowError("This report was not found.", "NOT_FOUND");
      if (current.reporterId === user.id) throw new WorkflowError("You cannot review a report you wrote.", "FORBIDDEN");
      if (current.assignee) throw new WorkflowError(`Already taken up by ${current.assignee.name}.`, "CONFLICT");
      throw new WorkflowError("This case is not waiting for review any more.", "CONFLICT");
    }
    await tx.caseAssignment.create({
      data: { caseId, action: "CLAIMED", toUserId: user.id, actorId: user.id, createdAt: now },
    });
    await writeAudit({ institutionId: user.institutionId, actorId: user.id, caseId, action: "CASE_CLAIMED" }, tx);
  });
}

/** The assigned reviewer picks a resubmitted case back up. */
export async function resumeReview(user: CurrentUser, caseId: string) {
  return db.$transaction(async (tx) => {
    const resumed = await tx.adrCase.updateMany({
      where: { id: caseId, institutionId: user.institutionId, assigneeId: user.id, status: "RESUBMITTED" },
      data: { status: "UNDER_REVIEW", lockVersion: { increment: 1 } },
    });
    if (resumed.count === 0) throw new WorkflowError("This case is not waiting for you to resume it.", "CONFLICT");
    await writeAudit(
      { institutionId: user.institutionId, actorId: user.id, caseId, action: "CASE_REVIEW_RESUMED" },
      tx,
    );
  });
}

const backToPool = (status: CaseStatus, version: number): CaseStatus =>
  status === "UNDER_REVIEW" ? (version > 1 ? "RESUBMITTED" : "SUBMITTED") : status;

export async function releaseCase(user: CurrentUser, caseId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const { c, access } = await loadCase(user, caseId, tx);
    if (!access.release) throw new WorkflowError("You cannot release this case.", "FORBIDDEN");
    await tx.adrCase.update({
      where: { id: c.id },
      data: {
        assigneeId: null,
        claimedAt: null,
        status: backToPool(c.status, c.currentVersion),
        lockVersion: { increment: 1 },
      },
    });
    await tx.caseAssignment.create({
      data: {
        caseId: c.id,
        action: "RELEASED",
        fromUserId: c.assigneeId,
        actorId: user.id,
        reason: reason.trim() || null,
      },
    });
    await writeAudit(
      { institutionId: user.institutionId, actorId: user.id, caseId: c.id, action: "CASE_RELEASED" },
      tx,
    );
  });
}

export async function reassignCase(user: CurrentUser, caseId: string, toUserId: string, reason: string) {
  if (reason.trim().length < 3) throw new WorkflowError("Give a short reason for the reassignment.");
  return db.$transaction(async (tx) => {
    const { c, access } = await loadCase(user, caseId, tx);
    if (!access.reassign) throw new WorkflowError("You cannot reassign this case.", "FORBIDDEN");
    const target = await tx.user.findFirst({
      where: { id: toUserId, institutionId: user.institutionId, isActive: true, roles: { has: "REVIEWER" } },
      select: { id: true, name: true },
    });
    if (!target) throw new WorkflowError("Choose a reviewer from your institution.");
    if (target.id === c.reporterId) throw new WorkflowError("A report cannot be assigned to the person who wrote it.");
    if (target.id === c.assigneeId) throw new WorkflowError(`${target.name} already holds this case.`);
    const status: CaseStatus =
      c.status === "SUBMITTED" || (c.status === "RESUBMITTED" && !c.assigneeId) ? "UNDER_REVIEW" : c.status;
    await tx.adrCase.update({
      where: { id: c.id },
      data: { assigneeId: target.id, claimedAt: new Date(), status, lockVersion: { increment: 1 } },
    });
    await tx.caseAssignment.create({
      data: {
        caseId: c.id,
        action: "REASSIGNED",
        fromUserId: c.assigneeId,
        toUserId: target.id,
        actorId: user.id,
        reason: reason.trim(),
      },
    });
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: c.id,
        action: "CASE_REASSIGNED",
        details: { to: target.name },
      },
      tx,
    );
  });
}

export async function recordChecklistItem(
  user: CurrentUser,
  caseId: string,
  input: { item: string; outcome: "VERIFIED" | "VERIFIED_WITH_EXCEPTION" | "CLEAR"; exceptionReason?: string },
) {
  if (!CHECKLIST_KEYS.includes(input.item as ChecklistItemKey)) throw new WorkflowError("Unknown checklist item.");
  const item = input.item as ChecklistItemKey;
  const reason = input.exceptionReason?.trim() ?? "";
  if (input.outcome === "VERIFIED_WITH_EXCEPTION" && reason.length < 5)
    throw new WorkflowError("Explain the exception, for example which information is genuinely unavailable.");
  return db.$transaction(async (tx) => {
    const { c, access } = await loadCase(user, caseId, tx);
    if (!access.decide) throw new WorkflowError("Only the assigned reviewer can complete the checklist.", "FORBIDDEN");
    const key = { caseId_versionNo_item: { caseId: c.id, versionNo: c.currentVersion, item } };
    if (input.outcome === "CLEAR") {
      await tx.reviewChecklistItem.deleteMany({ where: { caseId: c.id, versionNo: c.currentVersion, item } });
    } else {
      const data = {
        outcome: input.outcome,
        exceptionReason: input.outcome === "VERIFIED_WITH_EXCEPTION" ? reason : null,
        reviewerId: user.id,
      };
      await tx.reviewChecklistItem.upsert({
        where: key,
        create: { caseId: c.id, versionNo: c.currentVersion, item, ...data },
        update: data,
      });
    }
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: c.id,
        action: "CHECKLIST_RECORDED",
        details: { item, outcome: input.outcome },
      },
      tx,
    );
  });
}

const FIELD_PATH = /^[A-Za-z]+(\.[A-Za-z0-9_-]+\.[A-Za-z]+)?$/;

export async function addComment(
  user: CurrentUser,
  caseId: string,
  input: { kind: "NOTE" | "ISSUE"; body: string; fieldPath?: string },
) {
  const body = input.body.trim();
  if (body.length < 2) throw new WorkflowError("Write the comment first.");
  const fieldPath = input.fieldPath?.trim() || null;
  if (fieldPath && !FIELD_PATH.test(fieldPath)) throw new WorkflowError("Choose a field from the list.");
  return db.$transaction(async (tx) => {
    const { c, access } = await loadCase(user, caseId, tx);
    if (input.kind === "ISSUE" ? !access.raiseIssue : !access.comment)
      throw new WorkflowError(
        input.kind === "ISSUE"
          ? "Only the assigned reviewer can raise issues during review."
          : "You cannot comment on this case.",
        "FORBIDDEN",
      );
    await tx.reviewComment.create({
      data: {
        caseId: c.id,
        versionNo: c.currentVersion,
        authorId: user.id,
        kind: input.kind,
        body: body.slice(0, 4000),
        fieldPath,
        issueStatus: input.kind === "ISSUE" ? "OPEN" : null,
      },
    });
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: c.id,
        action: "COMMENT_ADDED",
        details: { kind: input.kind, fieldPath },
      },
      tx,
    );
  });
}

export async function closeIssue(
  user: CurrentUser,
  caseId: string,
  commentId: string,
  input: { status: "RESOLVED" | "ACKNOWLEDGED_UNAVAILABLE"; note: string },
) {
  const note = input.note.trim();
  if (input.status === "ACKNOWLEDGED_UNAVAILABLE" && note.length < 5)
    throw new WorkflowError("Give the reason the information is unavailable.");
  return db.$transaction(async (tx) => {
    const { c, access } = await loadCase(user, caseId, tx);
    if (!access.decide) throw new WorkflowError("Only the assigned reviewer can close issues.", "FORBIDDEN");
    const updated = await tx.reviewComment.updateMany({
      where: { id: commentId, caseId: c.id, kind: "ISSUE", issueStatus: "OPEN" },
      data: { issueStatus: input.status, resolutionNote: note || null, resolvedById: user.id, resolvedAt: new Date() },
    });
    if (updated.count === 0) throw new WorkflowError("This issue is not open any more.", "CONFLICT");
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: c.id,
        action: input.status === "RESOLVED" ? "ISSUE_RESOLVED" : "ISSUE_ACKNOWLEDGED_UNAVAILABLE",
      },
      tx,
    );
  });
}

/** What still blocks approval of the current version. */
export async function approvalBlockers(
  caseId: string,
  versionNo: number,
  client: Prisma.TransactionClient | typeof db = db,
) {
  // Sequential: inside a transaction both queries share one connection.
  const items = await client.reviewChecklistItem.findMany({ where: { caseId, versionNo }, select: { item: true } });
  const openIssues = await client.reviewComment.count({ where: { caseId, kind: "ISSUE", issueStatus: "OPEN" } });
  const done = new Set(items.map((i) => i.item));
  const missing = CHECKLIST_KEYS.filter((k) => !done.has(k));
  return { missingChecklist: missing, openIssues };
}

export async function approveCase(user: CurrentUser, caseId: string) {
  return db.$transaction(
    async (tx) => {
      const { c, access } = await loadCase(user, caseId, tx);
      if (c.reporterId === user.id) throw new WorkflowError("You cannot approve a report you wrote.", "FORBIDDEN");
      if (!access.decide) throw new WorkflowError("Only the assigned reviewer can approve this case.", "FORBIDDEN");
      const blockers = await approvalBlockers(c.id, c.currentVersion, tx);
      if (blockers.missingChecklist.length)
        throw new WorkflowError(`Complete the checklist first (${blockers.missingChecklist.length} item(s) left).`);
      if (blockers.openIssues)
        throw new WorkflowError(
          "Resolve each open issue, or acknowledge it as unavailable with a reason, before approving.",
        );

      const reviewedVersion = c.currentVersion;
      const versionNo = reviewedVersion + 1;
      const now = new Date();
      await tx.adrCase.update({
        where: { id: c.id },
        data: { status: "APPROVED", approvedAt: now, currentVersion: versionNo, lockVersion: { increment: 1 } },
      });
      const frozen = await tx.adrCase.findUniqueOrThrow({ where: { id: c.id }, include: caseSnapshotInclude });
      const snapshot = buildCaseSnapshot(frozen);
      const pdf = await generatePvpiPdf(snapshot, {
        mode: "approved",
        caseNumber: c.caseNumber,
        versionLabel: `v${versionNo}`,
        generatedOn: ddmmyyyy(todayInAppZone(now)),
        fictional: isDemoMode(),
      });
      const stored = await saveFile("pdfs", "pdf", pdf.bytes);
      await tx.caseVersion.create({
        data: {
          caseId: c.id,
          versionNo,
          reason: "APPROVED",
          snapshot: json(snapshot),
          pdfStorageKey: stored.key,
          pdfSha256: stored.sha256,
          createdById: user.id,
        },
      });
      await tx.reviewDecision.create({
        data: { caseId: c.id, versionNo: reviewedVersion, reviewerId: user.id, decision: "APPROVE" },
      });
      await writeAudit(
        {
          institutionId: user.institutionId,
          actorId: user.id,
          caseId: c.id,
          action: "CASE_APPROVED",
          details: { versionNo },
        },
        tx,
      );
      await writeAudit(
        {
          institutionId: user.institutionId,
          actorId: user.id,
          caseId: c.id,
          action: "PDF_GENERATED",
          details: { versionNo, sha256: stored.sha256 },
        },
        tx,
      );
      return { versionNo };
    },
    { timeout: 20_000 },
  );
}

export async function returnCase(user: CurrentUser, caseId: string, reason: string) {
  const text = reason.trim();
  if (text.length < 5) throw new WorkflowError("Explain what the reporter needs to correct.");
  return db.$transaction(async (tx) => {
    const { c, access } = await loadCase(user, caseId, tx);
    if (!access.decide) throw new WorkflowError("Only the assigned reviewer can return this case.", "FORBIDDEN");
    await tx.adrCase.update({ where: { id: c.id }, data: { status: "RETURNED", lockVersion: { increment: 1 } } });
    await tx.reviewDecision.create({
      data: {
        caseId: c.id,
        versionNo: c.currentVersion,
        reviewerId: user.id,
        decision: "RETURN",
        reason: text.slice(0, 2000),
      },
    });
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: c.id,
        action: "CASE_RETURNED",
        details: { versionNo: c.currentVersion },
      },
      tx,
    );
  });
}

export async function reviewersFor(user: CurrentUser) {
  return db.user.findMany({
    where: { institutionId: user.institutionId, isActive: true, roles: { has: "REVIEWER" } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, designation: true },
  });
}

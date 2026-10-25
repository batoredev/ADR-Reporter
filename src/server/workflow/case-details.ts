import "server-only";
import { buildCaseSnapshot, type CaseSnapshot } from "@/lib/domain/snapshot";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { loadCase } from "./cases";

/** Everything the case page and the reviewer workspace show about one case. */
export async function getCaseDetails(user: CurrentUser, caseId: string) {
  const { c, access } = await loadCase(user, caseId);
  const [
    reporter,
    assignee,
    versions,
    comments,
    decisions,
    checklist,
    escalations,
    submissions,
    documents,
    provenance,
    audit,
    assignments,
  ] = await Promise.all([
    db.user.findUniqueOrThrow({
      where: { id: c.reporterId },
      select: { id: true, name: true, email: true, phone: true, occupation: true, address: true, pin: true },
    }),
    c.assigneeId ? db.user.findUnique({ where: { id: c.assigneeId }, select: { id: true, name: true } }) : null,
    db.caseVersion.findMany({
      where: { caseId },
      orderBy: { versionNo: "asc" },
      select: {
        id: true,
        versionNo: true,
        reason: true,
        snapshot: true,
        createdAt: true,
        pdfStorageKey: true,
        createdBy: { select: { name: true } },
      },
    }),
    db.reviewComment.findMany({
      where: { caseId },
      orderBy: { createdAt: "asc" },
      include: { author: { select: { name: true } }, resolvedBy: { select: { name: true } } },
    }),
    db.reviewDecision.findMany({
      where: { caseId },
      orderBy: { createdAt: "asc" },
      include: { reviewer: { select: { name: true } } },
    }),
    db.reviewChecklistItem.findMany({
      where: { caseId, versionNo: c.currentVersion },
      include: { reviewer: { select: { name: true } } },
    }),
    db.urgentEscalation.findMany({
      where: { caseId },
      orderBy: { raisedAt: "desc" },
      include: {
        raisedBy: { select: { name: true } },
        acknowledgedBy: { select: { name: true } },
        closedBy: { select: { name: true } },
      },
    }),
    db.externalSubmission.findMany({
      where: { caseId },
      orderBy: { submittedAt: "asc" },
      include: { recordedBy: { select: { name: true } }, acknowledgementRecordedBy: { select: { name: true } } },
    }),
    db.uploadedDocument.findMany({
      where: { caseId },
      orderBy: { createdAt: "desc" },
      include: {
        uploadedBy: { select: { name: true } },
        runs: {
          orderBy: { startedAt: "desc" },
          select: { id: true, provider: true, model: true, status: true, errorMessage: true, startedAt: true },
        },
      },
    }),
    db.fieldProvenance.findMany({
      where: { caseId },
      include: {
        document: { select: { id: true, originalName: true } },
        verifiedBy: { select: { name: true } },
        extractedItem: { select: { run: { select: { model: true, provider: true } } } },
      },
    }),
    db.auditLog.findMany({
      where: { caseId },
      orderBy: { createdAt: "desc" },
      include: { actor: { select: { name: true } } },
    }),
    db.caseAssignment.findMany({
      where: { caseId },
      orderBy: { createdAt: "desc" },
      include: {
        actor: { select: { name: true } },
        fromUser: { select: { name: true } },
        toUser: { select: { name: true } },
      },
    }),
  ]);

  const live = buildCaseSnapshot(c);
  const latest = versions.at(-1);
  const previous = versions.length > 1 ? versions.at(-2) : undefined;

  return {
    c,
    access,
    reporter,
    assignee,
    live,
    versions: versions.map((v) => ({ ...v, snapshot: v.snapshot as unknown as CaseSnapshot })),
    latestSnapshot: (latest?.snapshot as unknown as CaseSnapshot | undefined) ?? null,
    previousSnapshot: (previous?.snapshot as unknown as CaseSnapshot | undefined) ?? null,
    comments,
    decisions,
    checklist,
    escalations,
    submissions,
    documents,
    provenance: Object.fromEntries(
      provenance
        .filter((p) => p.document)
        .map((p) => [
          p.fieldPath,
          {
            documentId: p.document!.id,
            documentName: p.document!.originalName,
            caseId,
            verifiedBy: p.verifiedBy?.name ?? null,
            model: p.extractedItem?.run.model ?? null,
          },
        ]),
    ),
    timeline: audit.map((a) => ({
      id: a.id,
      action: a.action,
      createdAt: a.createdAt,
      actorName: a.actor?.name ?? null,
      details: a.details,
    })),
    assignments,
  };
}

export type CaseDetails = Awaited<ReturnType<typeof getCaseDetails>>;

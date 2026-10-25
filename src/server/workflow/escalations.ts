import "server-only";
import type { ExternalSubmissionMethod } from "@/generated/prisma/enums";
import { canHandleEscalations } from "@/lib/domain/access";
import { writeAudit } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { WorkflowError } from "./errors";
import { parseSubmissionInput, type SubmissionInput } from "./submissions";

async function loadEscalation(user: CurrentUser, escalationId: string) {
  if (!canHandleEscalations(user))
    throw new WorkflowError("Only designated urgent contacts can handle escalations.", "FORBIDDEN");
  const escalation = await db.urgentEscalation.findFirst({
    where: { id: escalationId, adrCase: { institutionId: user.institutionId } },
    include: { adrCase: { select: { id: true } } },
  });
  if (!escalation) throw new WorkflowError("Escalation not found.", "NOT_FOUND");
  return escalation;
}

export async function listEscalations(user: CurrentUser) {
  if (!canHandleEscalations(user))
    throw new WorkflowError("Only designated urgent contacts can see escalations.", "FORBIDDEN");
  const [escalations, institution] = await Promise.all([
    db.urgentEscalation.findMany({
      where: { adrCase: { institutionId: user.institutionId } },
      orderBy: [{ closedAt: { sort: "desc", nulls: "first" } }, { raisedAt: "desc" }],
      include: {
        adrCase: {
          select: {
            id: true,
            caseNumber: true,
            status: true,
            reactionTerms: true,
            seriousnessCriteria: true,
            reporter: { select: { name: true, phone: true, email: true } },
            externalSubmissions: { where: { kind: "URGENT_NOTIFICATION" }, orderBy: { submittedAt: "asc" } },
          },
        },
        raisedBy: { select: { name: true } },
        acknowledgedBy: { select: { name: true } },
        closedBy: { select: { name: true } },
      },
    }),
    db.institution.findUniqueOrThrow({ where: { id: user.institutionId }, select: { urgentAckTargetMinutes: true } }),
  ]);
  return { escalations, ackTargetMinutes: institution.urgentAckTargetMinutes };
}

export async function acknowledgeEscalation(user: CurrentUser, escalationId: string) {
  const e = await loadEscalation(user, escalationId);
  if (e.acknowledgedAt) throw new WorkflowError("Already acknowledged.", "CONFLICT");
  await db.urgentEscalation.update({
    where: { id: e.id },
    data: { acknowledgedById: user.id, acknowledgedAt: new Date() },
  });
  await writeAudit({
    institutionId: user.institutionId,
    actorId: user.id,
    caseId: e.adrCase.id,
    action: "ESCALATION_ACKNOWLEDGED",
  });
}

export async function closeEscalation(user: CurrentUser, escalationId: string, note: string) {
  const text = note.trim();
  if (text.length < 5) throw new WorkflowError("Add a closing note describing what was done.");
  const e = await loadEscalation(user, escalationId);
  if (e.closedAt) throw new WorkflowError("Already closed.", "CONFLICT");
  await db.urgentEscalation.update({
    where: { id: e.id },
    data: {
      closedById: user.id,
      closedAt: new Date(),
      closingNote: text.slice(0, 2000),
      ...(e.acknowledgedAt ? {} : { acknowledgedById: user.id, acknowledgedAt: new Date() }),
    },
  });
  await writeAudit({
    institutionId: user.institutionId,
    actorId: user.id,
    caseId: e.adrCase.id,
    action: "ESCALATION_CLOSED",
  });
}

/** Records an urgent notification made outside the app. It does not need, or wait for, approval. */
export async function recordUrgentNotification(user: CurrentUser, escalationId: string, input: SubmissionInput) {
  const e = await loadEscalation(user, escalationId);
  const data = parseSubmissionInput(input);
  await db.externalSubmission.create({
    data: {
      caseId: e.adrCase.id,
      kind: "URGENT_NOTIFICATION",
      ...data,
      method: data.method as ExternalSubmissionMethod,
      recordedById: user.id,
    },
  });
  await writeAudit({
    institutionId: user.institutionId,
    actorId: user.id,
    caseId: e.adrCase.id,
    action: "EXTERNAL_SUBMISSION_RECORDED",
    details: { kind: "URGENT_NOTIFICATION", method: data.method },
  });
}

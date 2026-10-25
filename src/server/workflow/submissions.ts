import "server-only";
import { ExternalSubmissionMethod } from "@/generated/prisma/enums";
import { canCoordinate, canViewSubmissions } from "@/lib/domain/access";
import { writeAudit } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { loadCase } from "./cases";
import { WorkflowError } from "./errors";

export interface SubmissionInput {
  method: string;
  methodOther?: string;
  destination: string;
  submittedAt: string; // datetime-local value, interpreted in IST
  externalReference?: string;
  notes?: string;
}

/** "2026-10-06T11:00" entered in India -> Date. */
export function parseLocalDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseSubmissionInput(input: SubmissionInput) {
  if (!Object.values(ExternalSubmissionMethod).includes(input.method as ExternalSubmissionMethod))
    throw new WorkflowError("Choose how the report was sent.");
  const destination = input.destination.trim();
  if (destination.length < 2) throw new WorkflowError("Say where the report was sent, e.g. the AMC's name.");
  if (input.method === "OTHER" && !input.methodOther?.trim()) throw new WorkflowError("Describe the method.");
  const submittedAt = parseLocalDateTime(input.submittedAt);
  if (!submittedAt) throw new WorkflowError("Enter the date and time it was sent.");
  if (submittedAt.getTime() > Date.now() + 5 * 60 * 1000)
    throw new WorkflowError("The date and time cannot be in the future.");
  return {
    method: input.method as ExternalSubmissionMethod,
    methodOther: input.method === "OTHER" ? input.methodOther!.trim().slice(0, 200) : null,
    destination: destination.slice(0, 300),
    submittedAt,
    externalReference: input.externalReference?.trim().slice(0, 200) || null,
    notes: input.notes?.trim().slice(0, 2000) || null,
  };
}

export async function recordSubmission(user: CurrentUser, caseId: string, input: SubmissionInput) {
  const data = parseSubmissionInput(input);
  return db.$transaction(async (tx) => {
    const { c, access } = await loadCase(user, caseId, tx);
    if (!access.recordSubmission)
      throw new WorkflowError("Only coordinators can record the submission of approved reports.", "FORBIDDEN");
    await tx.externalSubmission.create({ data: { caseId: c.id, kind: "ROUTINE", ...data, recordedById: user.id } });
    await tx.adrCase.update({
      where: { id: c.id },
      data: { status: "EXTERNALLY_SUBMITTED", lockVersion: { increment: 1 } },
    });
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: c.id,
        action: "EXTERNAL_SUBMISSION_RECORDED",
        details: { kind: "ROUTINE", method: data.method },
      },
      tx,
    );
  });
}

export async function recordAcknowledgement(
  user: CurrentUser,
  submissionId: string,
  input: { acknowledgedAt: string; reference?: string; notes?: string },
) {
  if (!canCoordinate(user)) throw new WorkflowError("Only coordinators can record acknowledgements.", "FORBIDDEN");
  const acknowledgedAt = parseLocalDateTime(input.acknowledgedAt);
  if (!acknowledgedAt) throw new WorkflowError("Enter the date and time of the acknowledgement.");
  if (acknowledgedAt.getTime() > Date.now() + 5 * 60 * 1000)
    throw new WorkflowError("The date and time cannot be in the future.");
  return db.$transaction(async (tx) => {
    const submission = await tx.externalSubmission.findFirst({
      where: { id: submissionId, adrCase: { institutionId: user.institutionId } },
      include: { adrCase: { select: { id: true, status: true } } },
    });
    if (!submission) throw new WorkflowError("Submission not found.", "NOT_FOUND");
    if (submission.acknowledgedAt) throw new WorkflowError("An acknowledgement is already recorded.", "CONFLICT");
    if (acknowledgedAt < submission.submittedAt)
      throw new WorkflowError("The acknowledgement cannot be earlier than the submission.");
    await tx.externalSubmission.update({
      where: { id: submission.id },
      data: {
        acknowledgedAt,
        acknowledgementReference: input.reference?.trim().slice(0, 200) || null,
        acknowledgementNotes: input.notes?.trim().slice(0, 2000) || null,
        acknowledgementRecordedById: user.id,
      },
    });
    if (submission.kind === "ROUTINE" && submission.adrCase.status === "EXTERNALLY_SUBMITTED") {
      await tx.adrCase.update({
        where: { id: submission.adrCase.id },
        data: { status: "ACKNOWLEDGED", lockVersion: { increment: 1 } },
      });
    }
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: submission.adrCase.id,
        action: "EXTERNAL_ACKNOWLEDGEMENT_RECORDED",
      },
      tx,
    );
  });
}

export async function listSubmissionWork(user: CurrentUser) {
  if (!canViewSubmissions(user)) throw new WorkflowError("You cannot view external submissions.", "FORBIDDEN");
  const select = {
    id: true,
    caseNumber: true,
    status: true,
    reactionTerms: true,
    isPotentiallySerious: true,
    approvedAt: true,
    reporter: { select: { name: true } },
    suspectedMedicines: { orderBy: { position: "asc" as const }, take: 1, select: { name: true } },
    versions: {
      where: { reason: "APPROVED" as const },
      orderBy: { versionNo: "desc" as const },
      take: 1,
      select: { versionNo: true },
    },
    externalSubmissions: {
      orderBy: { submittedAt: "desc" as const },
      include: { recordedBy: { select: { name: true } } },
    },
  };
  const [awaiting, submitted, acknowledged] = await Promise.all([
    db.adrCase.findMany({
      where: { institutionId: user.institutionId, status: "APPROVED" },
      orderBy: { approvedAt: "asc" },
      select,
    }),
    db.adrCase.findMany({
      where: { institutionId: user.institutionId, status: "EXTERNALLY_SUBMITTED" },
      orderBy: { updatedAt: "desc" },
      select,
    }),
    db.adrCase.findMany({
      where: { institutionId: user.institutionId, status: "ACKNOWLEDGED" },
      orderBy: { updatedAt: "desc" },
      take: 30,
      select,
    }),
  ]);
  return { awaiting, submitted, acknowledged };
}

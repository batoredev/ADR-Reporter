import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

type AuditClient = Pick<typeof db, "auditLog">;

export interface AuditEntry {
  institutionId: string;
  actorId?: string | null;
  caseId?: string | null;
  action: string;
  details?: Record<string, unknown>;
}

/** Appends an audit entry. Pass a transaction client to record it atomically with the change. */
export async function writeAudit(entry: AuditEntry, client: AuditClient = db): Promise<void> {
  await client.auditLog.create({
    data: {
      institutionId: entry.institutionId,
      actorId: entry.actorId ?? null,
      caseId: entry.caseId ?? null,
      action: entry.action,
      details: entry.details as Prisma.InputJsonValue | undefined,
    },
  });
}

import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import {
  caseFieldsFromForm,
  caseFormSchema,
  concomitantFieldsFromForm,
  investigationFieldsFromForm,
  suspectedFieldsFromForm,
  toFormValues,
  type CaseFormValues,
} from "@/lib/domain/case-form";
import { changedPaths } from "@/lib/domain/case-fields";
import { assessCompleteness } from "@/lib/domain/completeness";
import { canReport } from "@/lib/domain/access";
import { formatCaseNumber } from "@/lib/domain/labels";
import { buildCaseSnapshot, caseSnapshotInclude } from "@/lib/domain/snapshot";
import { todayInAppZone } from "@/lib/format";
import { writeAudit } from "@/server/audit";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { caseAccess } from "./access";
import { WorkflowError } from "./errors";

type Tx = Prisma.TransactionClient;
const json = (v: unknown) => v as Prisma.InputJsonValue;

const withFacts = {
  ...caseSnapshotInclude,
  escalations: { select: { closedAt: true } },
} satisfies Prisma.AdrCaseInclude;

export function accessFacts(c: {
  reporterId: string;
  assigneeId: string | null;
  status: Prisma.AdrCaseGetPayload<object>["status"];
  isPotentiallySerious: boolean;
  escalations: { closedAt: Date | null }[];
}) {
  return {
    reporterId: c.reporterId,
    assigneeId: c.assigneeId,
    status: c.status,
    isPotentiallySerious: c.isPotentiallySerious,
    hasEscalation: c.escalations.length > 0,
    hasOpenEscalation: c.escalations.some((e) => e.closedAt === null),
  };
}

/** Loads a case the user may see, with its rows; otherwise "not found" (existence is not revealed). */
export async function loadCase(user: CurrentUser, caseId: string, client: Tx | typeof db = db) {
  const c = await client.adrCase.findFirst({
    where: { id: caseId, institutionId: user.institutionId },
    include: withFacts,
  });
  if (!c) throw new WorkflowError("This report was not found.", "NOT_FOUND");
  const access = caseAccess(user, accessFacts(c));
  if (!access.view) throw new WorkflowError("This report was not found.", "NOT_FOUND");
  return { c, access };
}

export async function createDraft(user: CurrentUser): Promise<{ id: string }> {
  if (!canReport(user)) throw new WorkflowError("Only reporters can create reports.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const inst = await tx.institution.update({
      where: { id: user.institutionId },
      data: { nextCaseNumber: { increment: 1 } },
      select: { nextCaseNumber: true },
    });
    const created = await tx.adrCase.create({
      data: {
        institutionId: user.institutionId,
        caseNumber: formatCaseNumber(inst.nextCaseNumber - 1),
        reporterId: user.id,
      },
      select: { id: true, caseNumber: true },
    });
    await writeAudit(
      { institutionId: user.institutionId, actorId: user.id, caseId: created.id, action: "CASE_CREATED" },
      tx,
    );
    return { id: created.id };
  });
}

async function syncRows(tx: Tx, caseId: string, values: CaseFormValues) {
  const sync = async <Row extends { id?: string }>(
    list: "suspectedMedicines" | "concomitantProducts" | "investigations",
    rows: Row[],
    toData: (row: Row, position: number) => Record<string, unknown>,
  ) => {
    const delegate = {
      suspectedMedicines: tx.suspectedMedicine,
      concomitantProducts: tx.concomitantProduct,
      investigations: tx.investigation,
    }[list] as unknown as {
      findMany(args: object): Promise<{ id: string }[]>;
      update(args: object): Promise<{ id: string }>;
      create(args: object): Promise<{ id: string }>;
      deleteMany(args: object): Promise<unknown>;
    };
    const existing = new Set((await delegate.findMany({ where: { caseId }, select: { id: true } })).map((r) => r.id));
    const ids: string[] = [];
    for (const [position, row] of rows.entries()) {
      const data = toData(row, position);
      if (row.id && existing.has(row.id)) {
        await delegate.update({ where: { id: row.id }, data });
        ids.push(row.id);
      } else {
        ids.push((await delegate.create({ data: { ...data, caseId }, select: { id: true } })).id);
      }
    }
    const removed = [...existing].filter((id) => !ids.includes(id));
    if (removed.length) {
      await delegate.deleteMany({ where: { id: { in: removed } } });
      await tx.fieldProvenance.deleteMany({
        where: { caseId, OR: removed.map((id) => ({ fieldPath: { startsWith: `${list}.${id}.` } })) },
      });
    }
    return ids;
  };
  return {
    suspected: await sync("suspectedMedicines", values.suspectedMedicines, suspectedFieldsFromForm),
    concomitant: await sync("concomitantProducts", values.concomitantProducts, concomitantFieldsFromForm),
    investigations: await sync("investigations", values.investigations, investigationFieldsFromForm),
  };
}

export interface SaveResult {
  lockVersion: number;
  savedAt: string;
  rowIds: { suspected: string[]; concomitant: string[]; investigations: string[] };
}

export async function saveDraft(
  user: CurrentUser,
  caseId: string,
  lockVersion: number,
  input: unknown,
): Promise<SaveResult> {
  const parsed = caseFormSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new WorkflowError(`Please check "${first.path.join(".")}": ${first.message}`);
  }
  const values = parsed.data;
  return db.$transaction(async (tx) => {
    const { c, access } = await loadCase(user, caseId, tx);
    if (!access.edit) throw new WorkflowError("This report can no longer be edited.", "CONFLICT");
    if (c.lockVersion !== lockVersion)
      throw new WorkflowError(
        "This report was changed in another window. Reload the page to continue with the latest version.",
        "CONFLICT",
      );
    const before = buildCaseSnapshot(c);
    const updated = await tx.adrCase.update({
      where: { id: c.id },
      data: { ...caseFieldsFromForm(values), lockVersion: { increment: 1 } },
      select: { lockVersion: true, updatedAt: true },
    });
    const rowIds = await syncRows(tx, c.id, values);
    const after = await tx.adrCase.findUniqueOrThrow({ where: { id: c.id }, include: caseSnapshotInclude });
    const changed = [...changedPaths(before, buildCaseSnapshot(after))];
    // Values that came from a document stop counting as extracted once the reporter changes them.
    if (changed.length) {
      await tx.fieldProvenance.deleteMany({ where: { caseId: c.id, fieldPath: { in: changed } } });
      await writeAudit(
        {
          institutionId: user.institutionId,
          actorId: user.id,
          caseId: c.id,
          action: "CASE_EDITED",
          details: { changed },
        },
        tx,
      );
    }
    return { lockVersion: updated.lockVersion, savedAt: updated.updatedAt.toISOString(), rowIds };
  });
}

export async function submitCase(
  user: CurrentUser,
  caseId: string,
  input: { lockVersion: number; declaration: boolean; responseNote?: string },
) {
  if (!input.declaration) throw new WorkflowError("Please confirm the declaration before submitting.");
  return db.$transaction(async (tx) => {
    const { c, access } = await loadCase(user, caseId, tx);
    if (!access.edit) throw new WorkflowError("This report cannot be submitted in its current state.", "CONFLICT");
    if (c.lockVersion !== input.lockVersion)
      throw new WorkflowError("This report changed after you opened this page. Reload and check it again.", "CONFLICT");
    const profile = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    const check = assessCompleteness(toFormValues(c), profile);
    if (!check.ready)
      throw new WorkflowError(`Mandatory information is missing: ${check.missing.map((m) => m.message).join("; ")}.`);

    const resubmission = c.status === "RETURNED";
    const versionNo = c.currentVersion + 1;
    const now = new Date();
    await tx.adrCase.update({
      where: { id: c.id },
      data: {
        status: resubmission ? "RESUBMITTED" : "SUBMITTED",
        firstSubmittedAt: c.firstSubmittedAt ?? now,
        lastSubmittedAt: now,
        currentVersion: versionNo,
        lockVersion: { increment: 1 },
        reporterName: profile.name,
        reporterAddress: profile.address,
        reporterPin: profile.pin,
        reporterEmail: profile.email,
        reporterPhone: profile.phone,
        reporterOccupation: profile.occupation,
        reportDate: todayInAppZone(),
        declarationAcceptedAt: now,
      },
    });
    const frozen = await tx.adrCase.findUniqueOrThrow({ where: { id: c.id }, include: caseSnapshotInclude });
    await tx.caseVersion.create({
      data: {
        caseId: c.id,
        versionNo,
        reason: resubmission ? "RESUBMITTED" : "SUBMITTED",
        snapshot: json(buildCaseSnapshot(frozen)),
        createdById: user.id,
      },
    });
    const note = input.responseNote?.trim();
    if (note) {
      await tx.reviewComment.create({
        data: { caseId: c.id, versionNo, authorId: user.id, kind: "NOTE", body: note.slice(0, 4000) },
      });
    }
    await writeAudit(
      {
        institutionId: user.institutionId,
        actorId: user.id,
        caseId: c.id,
        action: resubmission ? "CASE_RESUBMITTED" : "CASE_SUBMITTED",
        details: { versionNo, declaration: true, warnings: check.warnings.map((w) => w.message) },
      },
      tx,
    );
    return { versionNo, caseNumber: c.caseNumber };
  });
}

export async function escalateCase(user: CurrentUser, caseId: string, note: string) {
  const text = note.trim();
  if (text.length < 5) throw new WorkflowError("Add a short urgency note so the urgent contacts know what happened.");
  return db.$transaction(async (tx) => {
    const { c, access } = await loadCase(user, caseId, tx);
    if (!c.isPotentiallySerious)
      throw new WorkflowError("Only potentially serious reports can be escalated. Tick a seriousness criterion first.");
    if (!access.escalate) throw new WorkflowError("This report already has an open escalation or cannot be escalated.");
    const escalation = await tx.urgentEscalation.create({
      data: { caseId: c.id, raisedById: user.id, note: text.slice(0, 2000), snapshot: json(buildCaseSnapshot(c)) },
      select: { id: true },
    });
    await writeAudit(
      { institutionId: user.institutionId, actorId: user.id, caseId: c.id, action: "ESCALATION_RAISED" },
      tx,
    );
    return escalation;
  });
}

export async function updateProfile(
  user: CurrentUser,
  input: { name: string; occupation: string; address: string; pin: string; phone: string },
) {
  const clean = (v: string, max: number) => v.trim().slice(0, max) || null;
  const name = input.name.trim();
  if (name.length < 2) throw new WorkflowError("Enter your name.");
  if (input.pin.trim() && !/^\d{6}$/.test(input.pin.trim())) throw new WorkflowError("PIN code must be 6 digits.");
  await db.user.update({
    where: { id: user.id },
    data: {
      name: name.slice(0, 120),
      occupation: clean(input.occupation, 120),
      address: clean(input.address, 300),
      pin: clean(input.pin, 6),
      phone: clean(input.phone, 30),
    },
  });
  await writeAudit({ institutionId: user.institutionId, actorId: user.id, action: "PROFILE_UPDATED" });
}

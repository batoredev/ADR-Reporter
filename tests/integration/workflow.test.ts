// Review, escalation and submission rules against the test database (TEST_DATABASE_URL).
// Each test creates its own fictional cases and leaves the seeded ones alone.
import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { ChecklistItemKey } from "@/generated/prisma/enums";
import type { CaseFormValues } from "@/lib/domain/case-form";
import { nowAsLocalInput } from "@/lib/format";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { readStoredFile } from "@/server/storage";
import { createDraft, escalateCase, saveDraft, submitCase } from "@/server/workflow/cases";
import { WorkflowError } from "@/server/workflow/errors";
import {
  acknowledgeEscalation,
  closeEscalation,
  listEscalations,
  recordUrgentNotification,
} from "@/server/workflow/escalations";
import {
  addComment,
  approvalBlockers,
  approveCase,
  claimCase,
  closeIssue,
  reassignCase,
  recordChecklistItem,
  releaseCase,
  resumeReview,
  returnCase,
} from "@/server/workflow/review";
import { recordAcknowledgement, recordSubmission } from "@/server/workflow/submissions";
import { date, form } from "../fixtures/form";
import { hasTestDb, userFor } from "./helpers";

const users = async () => ({
  pharmacist: await userFor("pharmacist@demo.test"),
  physician: await userFor("physician@demo.test"),
  hod: await userFor("hod@demo.test"),
  chief: await userFor("chief.pharmacist@demo.test"),
  amc: await userFor("amc.coordinator@demo.test"),
  pharmacologist: await userFor("pharmacologist@demo.test"),
  senior: await userFor("senior.pharmacist@demo.test"),
  consultant: await userFor("consultant@demo.test"),
});

const lockOf = async (id: string) =>
  (await db.adrCase.findUniqueOrThrow({ where: { id }, select: { lockVersion: true } })).lockVersion;

async function save(user: CurrentUser, id: string, values: CaseFormValues) {
  return saveDraft(user, id, await lockOf(id), values);
}

async function submittedCase(reporter: CurrentUser, values = form()) {
  const { id } = await createDraft(reporter);
  await save(reporter, id, values);
  await submitCase(reporter, id, { lockVersion: await lockOf(id), declaration: true });
  return id;
}

async function verifyChecklist(reviewer: CurrentUser, id: string) {
  for (const item of Object.values(ChecklistItemKey))
    await recordChecklistItem(reviewer, id, { item, outcome: "VERIFIED" });
}

async function approvedCase(reporter: CurrentUser, reviewer: CurrentUser) {
  const id = await submittedCase(reporter);
  await claimCase(reviewer, id);
  await verifyChecklist(reviewer, id);
  await approveCase(reviewer, id);
  return id;
}

const statusOf = async (id: string) =>
  db.adrCase.findUniqueOrThrow({ where: { id }, select: { status: true, assigneeId: true, currentVersion: true } });

const hoursAgo = (h: number) => nowAsLocalInput(new Date(Date.now() - h * 3600_000));

describe.skipIf(!hasTestDb)("review workflow (test database)", () => {
  afterAll(() => db.$disconnect());

  it("gives a case to exactly one of two reviewers who take it up at the same moment", async () => {
    const u = await users();
    const id = await submittedCase(u.pharmacist);
    const results = await Promise.allSettled([claimCase(u.hod, id), claimCase(u.pharmacologist, id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(WorkflowError);
    expect(loser.reason.message).toMatch(/Already taken up by/);
    const c = await statusOf(id);
    expect(c.status).toBe("UNDER_REVIEW");
    expect([u.hod.id, u.pharmacologist.id]).toContain(c.assigneeId);
    expect(await db.caseAssignment.count({ where: { caseId: id, action: "CLAIMED" } })).toBe(1);
  });

  it("keeps drafts out of the review queue", async () => {
    const u = await users();
    const { id } = await createDraft(u.pharmacist);
    await expect(claimCase(u.hod, id)).rejects.toThrow(/not found/i);
  });

  it("blocks approval until the checklist is complete and every issue is closed, and returns to the same reviewer", async () => {
    const u = await users();
    const id = await submittedCase(u.pharmacist);
    await claimCase(u.hod, id);
    const medId = (await db.suspectedMedicine.findFirstOrThrow({ where: { caseId: id } })).id;

    await expect(approveCase(u.hod, id)).rejects.toThrow(/checklist/);
    await addComment(u.hod, id, {
      kind: "ISSUE",
      body: "Add the batch number.",
      fieldPath: `suspectedMedicines.${medId}.batchLot`,
    });
    await expect(
      recordChecklistItem(u.pharmacologist, id, { item: "PATIENT_DATA", outcome: "VERIFIED" }),
    ).rejects.toThrow(/assigned reviewer/);
    await expect(
      recordChecklistItem(u.hod, id, { item: "PATIENT_DATA", outcome: "VERIFIED_WITH_EXCEPTION", exceptionReason: "" }),
    ).rejects.toThrow(/Explain the exception/);
    await verifyChecklist(u.hod, id);
    await expect(approveCase(u.hod, id)).rejects.toThrow(/open issue/);

    await returnCase(u.hod, id, "Please add the batch number, or tell us it is unavailable.");
    expect(await statusOf(id)).toMatchObject({ status: "RETURNED", assigneeId: u.hod.id });

    const values = form();
    values.suspectedMedicines[0] = { ...values.suspectedMedicines[0], id: medId, batchLot: "AMX2610B" };
    await save(u.pharmacist, id, values);
    await submitCase(u.pharmacist, id, {
      lockVersion: await lockOf(id),
      declaration: true,
      responseNote: "Batch added.",
    });
    expect(await statusOf(id)).toMatchObject({ status: "RESUBMITTED", assigneeId: u.hod.id, currentVersion: 2 });
    await expect(claimCase(u.pharmacologist, id)).rejects.toThrow(/Already taken up by/);

    await resumeReview(u.hod, id);
    // The corrected version is verified afresh.
    expect(await approvalBlockers(id, 2)).toEqual({ missingChecklist: Object.values(ChecklistItemKey), openIssues: 1 });
    const issue = await db.reviewComment.findFirstOrThrow({ where: { caseId: id, kind: "ISSUE" } });
    await expect(closeIssue(u.hod, id, issue.id, { status: "ACKNOWLEDGED_UNAVAILABLE", note: "" })).rejects.toThrow(
      /reason/,
    );
    await closeIssue(u.hod, id, issue.id, { status: "RESOLVED", note: "Batch number now provided." });
    await verifyChecklist(u.hod, id);
    expect(await approveCase(u.hod, id)).toEqual({ versionNo: 3 });

    const final = await db.caseVersion.findUniqueOrThrow({ where: { caseId_versionNo: { caseId: id, versionNo: 3 } } });
    expect(final.reason).toBe("APPROVED");
    const pdf = await readStoredFile(final.pdfStorageKey!);
    expect(Buffer.from(pdf.subarray(0, 4)).toString()).toBe("%PDF");
    expect(createHash("sha256").update(pdf).digest("hex")).toBe(final.pdfSha256);
    await expect(db.caseVersion.update({ where: { id: final.id }, data: { reason: "SUBMITTED" } })).rejects.toThrow();
  });

  it("accepts an issue acknowledged as genuinely unavailable, with a reason", async () => {
    const u = await users();
    const id = await submittedCase(u.pharmacist);
    await claimCase(u.senior, id);
    await addComment(u.senior, id, { kind: "ISSUE", body: "Expiry date missing." });
    const issue = await db.reviewComment.findFirstOrThrow({ where: { caseId: id, kind: "ISSUE" } });
    await closeIssue(u.senior, id, issue.id, {
      status: "ACKNOWLEDGED_UNAVAILABLE",
      note: "Strip discarded; expiry genuinely unavailable.",
    });
    await verifyChecklist(u.senior, id);
    await approveCase(u.senior, id);
    expect((await statusOf(id)).status).toBe("APPROVED");
  });

  it("releases a case to the pool and requires a reason to reassign it", async () => {
    const u = await users();
    const id = await submittedCase(u.pharmacist);
    await claimCase(u.hod, id);
    await releaseCase(u.hod, id, "");
    expect(await statusOf(id)).toMatchObject({ status: "SUBMITTED", assigneeId: null });

    await claimCase(u.pharmacologist, id);
    await expect(reassignCase(u.pharmacologist, id, u.senior.id, "")).rejects.toThrow(/reason/);
    await expect(reassignCase(u.pharmacologist, id, u.pharmacist.id, "Needs a pharmacist")).rejects.toThrow(
      /Choose a reviewer/,
    );
    await reassignCase(u.pharmacologist, id, u.senior.id, "Specialist input needed");
    expect((await statusOf(id)).assigneeId).toBe(u.senior.id);
    await expect(releaseCase(u.consultant, id, "")).rejects.toThrow(/cannot release/);
  });
});

describe.skipIf(!hasTestDb)("external submission tracking (test database)", () => {
  it("lets only coordinators record submissions and acknowledgements", async () => {
    const u = await users();
    const id = await approvedCase(u.pharmacist, u.hod);
    const input = {
      method: "AMC_EMAIL",
      destination: "AMC, Demo Medical College (fictional)",
      submittedAt: hoursAgo(2),
    };

    await expect(recordSubmission(u.hod, id, input)).rejects.toThrow(/coordinators/);
    await expect(recordSubmission(u.amc, id, { ...input, submittedAt: hoursAgo(-3) })).rejects.toThrow(/future/);
    await expect(recordSubmission(u.amc, id, { ...input, method: "OTHER" })).rejects.toThrow(/Describe the method/);
    await recordSubmission(u.amc, id, input);
    expect((await statusOf(id)).status).toBe("EXTERNALLY_SUBMITTED");

    const submission = await db.externalSubmission.findFirstOrThrow({ where: { caseId: id, kind: "ROUTINE" } });
    await expect(recordAcknowledgement(u.amc, submission.id, { acknowledgedAt: hoursAgo(5) })).rejects.toThrow(
      /earlier than the submission/,
    );
    await expect(
      recordAcknowledgement(u.pharmacologist, submission.id, { acknowledgedAt: hoursAgo(1) }),
    ).rejects.toThrow(/coordinators/);
    await recordAcknowledgement(u.amc, submission.id, { acknowledgedAt: hoursAgo(1), reference: "AMC-ACK-FICT-1" });
    expect((await statusOf(id)).status).toBe("ACKNOWLEDGED");
    await expect(recordAcknowledgement(u.amc, submission.id, { acknowledgedAt: hoursAgo(1) })).rejects.toThrow(
      /already recorded/,
    );
  });
});

describe.skipIf(!hasTestDb)("urgent escalation (test database)", () => {
  it("lets an incomplete, potentially serious draft reach the urgent contacts without approval", async () => {
    const u = await users();
    const { id } = await createDraft(u.physician);
    await save(
      u.physician,
      id,
      form({
        patientInitials: "A.M.",
        suspectedMedicines: [],
        reactionTerms: "Stevens-Johnson syndrome suspected",
        reactionStartDate: date("2026-10", true),
        seriousAnswer: "YES",
        seriousnessCriteria: ["HOSPITALISATION", "OTHER_MEDICALLY_IMPORTANT"],
      }),
    );
    await expect(escalateCase(u.physician, id, "")).rejects.toThrow(/urgency note/);
    const { id: escalationId } = await escalateCase(u.physician, id, "Admitted with blistering; details to follow.");
    await expect(escalateCase(u.physician, id, "Second escalation attempt")).rejects.toThrow(/open escalation/);
    expect((await statusOf(id)).status).toBe("DRAFT");

    await expect(listEscalations(u.consultant)).rejects.toThrow(/urgent contacts/);
    expect((await listEscalations(u.chief)).escalations.some((e) => e.id === escalationId)).toBe(true);

    await acknowledgeEscalation(u.chief, escalationId);
    await expect(acknowledgeEscalation(u.hod, escalationId)).rejects.toThrow(/Already acknowledged/);
    await recordUrgentNotification(u.chief, escalationId, {
      method: "PVPI_HELPLINE",
      destination: "PvPI helpline",
      submittedAt: hoursAgo(0),
    });
    expect(await db.externalSubmission.count({ where: { caseId: id, kind: "URGENT_NOTIFICATION" } })).toBe(1);
    expect((await statusOf(id)).status).toBe("DRAFT");

    await expect(closeEscalation(u.chief, escalationId, "")).rejects.toThrow(/closing note/);
    await closeEscalation(u.chief, escalationId, "AMC informed by phone; report to follow.");
    expect((await db.urgentEscalation.findUniqueOrThrow({ where: { id: escalationId } })).closedAt).not.toBeNull();
  });

  it("refuses to escalate a report that is not potentially serious", async () => {
    const u = await users();
    const { id } = await createDraft(u.pharmacist);
    await save(u.pharmacist, id, form());
    await expect(escalateCase(u.pharmacist, id, "Please look at this soon")).rejects.toThrow(/potentially serious/);
  });
});

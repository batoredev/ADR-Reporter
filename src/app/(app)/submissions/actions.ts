"use server";

import { requireUser } from "@/server/auth/current-user";
import { asResult, type ActionResult } from "@/server/workflow/errors";
import { recordAcknowledgement, recordSubmission } from "@/server/workflow/submissions";

type Values = Record<string, string>;

export async function recordSubmissionAction(caseId: string, values: Values): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await recordSubmission(user, caseId, {
      method: String(values.method ?? ""),
      methodOther: values.methodOther,
      destination: String(values.destination ?? ""),
      submittedAt: String(values.submittedAt ?? ""),
      externalReference: values.externalReference,
      notes: values.notes,
    });
    return null;
  });
}

export async function recordAcknowledgementAction(submissionId: string, values: Values): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await recordAcknowledgement(user, submissionId, {
      acknowledgedAt: String(values.acknowledgedAt ?? ""),
      reference: values.reference,
      notes: values.notes,
    });
    return null;
  });
}

"use server";

import { requireUser } from "@/server/auth/current-user";
import { asResult, type ActionResult } from "@/server/workflow/errors";
import { acknowledgeEscalation, closeEscalation, recordUrgentNotification } from "@/server/workflow/escalations";

type Values = Record<string, string>;

export async function acknowledgeEscalationAction(escalationId: string): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await acknowledgeEscalation(user, escalationId);
    return null;
  });
}

export async function closeEscalationAction(escalationId: string, values: Values): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await closeEscalation(user, escalationId, String(values.note ?? ""));
    return null;
  });
}

export async function urgentNotificationAction(escalationId: string, values: Values): Promise<ActionResult<null>> {
  const user = await requireUser();
  return asResult(async () => {
    await recordUrgentNotification(user, escalationId, {
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

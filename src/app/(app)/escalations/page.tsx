import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "cn";
import { CheckCheck, Clock, Megaphone, Siren, XCircle } from "lucide-react";
import { ActionButton } from "@/components/actions/action-button";
import { ActionDialog } from "@/components/actions/action-dialog";
import { submissionFields } from "@/components/actions/submission-fields";
import { StatusBadge } from "@/components/case-badges";
import { canHandleEscalations } from "@/lib/domain/access";
import { SERIOUSNESS_CRITERION_LABELS, SUBMISSION_METHOD_LABELS } from "@/lib/domain/labels";
import { formatDateTime, formatElapsed, nowAsLocalInput } from "@/lib/format";
import { requireAccess } from "@/server/auth/current-user";
import { listEscalations } from "@/server/workflow/escalations";
import { acknowledgeEscalationAction, closeEscalationAction, urgentNotificationAction } from "./actions";

export const metadata: Metadata = { title: "Urgent escalations" };

export default async function EscalationsPage() {
  const user = await requireAccess(canHandleEscalations);
  const { escalations, ackTargetMinutes } = await listEscalations(user);
  const open = escalations.filter((e) => !e.closedAt);
  const closed = escalations.filter((e) => e.closedAt);
  const now = new Date();
  const nowInput = nowAsLocalInput(now);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Urgent escalations</h1>
        <p className="text-muted-foreground">
          Potentially serious reports escalated to designated personnel. This pathway runs alongside the routine review
          and does not wait for approval.
          {ackTargetMinutes ? ` Target for acknowledgement: ${ackTargetMinutes} minutes.` : ""}
        </p>
      </div>

      <section aria-labelledby="open-escalations" className="space-y-3">
        <h2 id="open-escalations" className="text-base font-semibold">
          Open ({open.length})
        </h2>
        {open.length === 0 ? <p className="text-sm text-muted-foreground">No open escalations.</p> : null}
        {open.map((e) => {
          const overdue =
            ackTargetMinutes !== null &&
            !e.acknowledgedAt &&
            now.getTime() - e.raisedAt.getTime() > ackTargetMinutes * 60000;
          const c = e.adrCase;
          return (
            <article
              key={e.id}
              className={cn(
                "space-y-3 rounded-lg border bg-card p-4",
                overdue ? "border-serious/50" : "border-serious/25",
              )}
              aria-label={`Escalation for ${c.caseNumber}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Siren className="size-4 text-serious" aria-hidden />
                    <Link
                      href={`/reports/${c.id}`}
                      className="font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      {c.caseNumber}
                    </Link>
                    <StatusBadge status={c.status} />
                  </p>
                  <p className="text-sm">{c.reactionTerms ?? "Reaction not entered"}</p>
                  {c.seriousnessCriteria.length ? (
                    <p className="text-[13px] text-serious">
                      {c.seriousnessCriteria.map((s) => SERIOUSNESS_CRITERION_LABELS[s]).join(", ")}
                    </p>
                  ) : null}
                </div>
                <p
                  className={cn(
                    "inline-flex items-center gap-1 text-[13px]",
                    overdue ? "font-medium text-serious" : "text-muted-foreground",
                  )}
                >
                  <Clock className="size-3.5" aria-hidden />
                  {e.acknowledgedAt
                    ? `Acknowledged by ${e.acknowledgedBy?.name} after ${formatElapsed(e.raisedAt, e.acknowledgedAt)}`
                    : `Waiting ${formatElapsed(e.raisedAt, now)}${overdue ? " (past target)" : ""}`}
                </p>
              </div>
              <div className="rounded-md bg-serious-soft px-3 py-2 text-sm">
                <p className="text-xs text-muted-foreground">
                  Raised by {e.raisedBy.name} · {formatDateTime(e.raisedAt)}
                </p>
                <p className="mt-0.5 whitespace-pre-line">{e.note}</p>
              </div>
              <p className="text-[13px] text-muted-foreground">
                Reporter: {c.reporter.name}
                {c.reporter.phone ? ` · ${c.reporter.phone}` : ""} · {c.reporter.email}
              </p>
              {c.externalSubmissions.length ? (
                <ul className="space-y-1 text-[13px]">
                  {c.externalSubmissions.map((s) => (
                    <li key={s.id}>
                      <Megaphone className="mr-1 inline size-3.5" aria-hidden />
                      Urgent notification:{" "}
                      {s.method === "OTHER" && s.methodOther
                        ? s.methodOther
                        : SUBMISSION_METHOD_LABELS[s.method]} to {s.destination} · {formatDateTime(s.submittedAt)}
                      {s.externalReference ? ` · ref. ${s.externalReference}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {!e.acknowledgedAt ? (
                  <ActionButton action={acknowledgeEscalationAction.bind(null, e.id)}>
                    <CheckCheck aria-hidden /> Acknowledge
                  </ActionButton>
                ) : null}
                <ActionDialog
                  trigger={
                    <>
                      <Megaphone aria-hidden /> Record urgent notification
                    </>
                  }
                  title="Record an urgent notification"
                  description="Record a notification you made outside the app, for example a phone call to the AMC. The app does not send anything."
                  fields={submissionFields(nowInput, "e.g. AMC, Demo Medical College (fictional)")}
                  submitLabel="Record notification"
                  action={urgentNotificationAction.bind(null, e.id)}
                />
                <ActionDialog
                  trigger={
                    <>
                      <XCircle aria-hidden /> Close
                    </>
                  }
                  triggerVariant="ghost"
                  title="Close this escalation"
                  description="Closing does not affect the routine review of the report."
                  fields={[{ name: "note", label: "What was done", type: "textarea" }]}
                  submitLabel="Close escalation"
                  action={closeEscalationAction.bind(null, e.id)}
                />
              </div>
            </article>
          );
        })}
      </section>

      <section aria-labelledby="closed-escalations" className="space-y-2">
        <h2 id="closed-escalations" className="text-base font-semibold">
          Closed ({closed.length})
        </h2>
        {closed.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
        <ul className="space-y-2">
          {closed.map((e) => (
            <li key={e.id} className="rounded-lg border px-4 py-3 text-sm">
              <Link
                href={`/reports/${e.adrCase.id}`}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                {e.adrCase.caseNumber}
              </Link>{" "}
              · raised {formatDateTime(e.raisedAt)} by {e.raisedBy.name} · closed {formatDateTime(e.closedAt)} by{" "}
              {e.closedBy?.name}
              {e.closingNote ? <p className="mt-1 text-muted-foreground">{e.closingNote}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

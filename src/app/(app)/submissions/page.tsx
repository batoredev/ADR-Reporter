import type { Metadata } from "next";
import Link from "next/link";
import { FileText, Inbox, Send } from "lucide-react";
import { ActionDialog } from "@/components/actions/action-dialog";
import { submissionFields } from "@/components/actions/submission-fields";
import { SeriousBadge } from "@/components/case-badges";
import { canCoordinate, canViewSubmissions } from "@/lib/domain/access";
import { SUBMISSION_KIND_LABELS, SUBMISSION_METHOD_LABELS } from "@/lib/domain/labels";
import { formatDateTime, formatElapsed, nowAsLocalInput } from "@/lib/format";
import { requireAccess } from "@/server/auth/current-user";
import { listSubmissionWork } from "@/server/workflow/submissions";
import { recordAcknowledgementAction, recordSubmissionAction } from "./actions";

export const metadata: Metadata = { title: "External submissions" };

type WorkCase = Awaited<ReturnType<typeof listSubmissionWork>>["awaiting"][number];

function CaseLine({ c }: { c: WorkCase }) {
  const approved = c.versions[0];
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <Link href={`/reports/${c.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">
            {c.caseNumber}
          </Link>
          {c.isPotentiallySerious ? <SeriousBadge /> : null}
        </p>
        <p className="text-sm">
          {c.suspectedMedicines[0]?.name ?? "-"} · {c.reactionTerms ?? "-"}
        </p>
        <p className="text-[13px] text-muted-foreground">
          Reporter {c.reporter.name}
          {c.approvedAt ? ` · approved ${formatDateTime(c.approvedAt)}` : ""}
        </p>
      </div>
      {approved ? (
        <a
          href={`/reports/${c.id}/pdf?version=${approved.versionNo}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[13px] text-primary underline-offset-2 hover:underline"
        >
          <FileText className="size-3.5" aria-hidden /> Final PDF (v{approved.versionNo})
        </a>
      ) : null}
    </div>
  );
}

export default async function SubmissionsPage() {
  const user = await requireAccess(canViewSubmissions);
  const coordinator = canCoordinate(user);
  const { awaiting, submitted, acknowledged } = await listSubmissionWork(user);
  const now = nowAsLocalInput();

  const submissionsOf = (c: WorkCase, ackAction: boolean) =>
    c.externalSubmissions.length ? (
      <ul className="mt-2 space-y-1.5 border-t pt-2 text-[13px]">
        {c.externalSubmissions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-start justify-between gap-2">
            <span>
              {SUBMISSION_KIND_LABELS[s.kind]}:{" "}
              {s.method === "OTHER" && s.methodOther ? s.methodOther : SUBMISSION_METHOD_LABELS[s.method]} to{" "}
              {s.destination} · {formatDateTime(s.submittedAt)} · recorded by {s.recordedBy.name}
              {s.externalReference ? ` · ref. ${s.externalReference}` : ""}
              <span className="block text-muted-foreground">
                {s.acknowledgedAt
                  ? `Acknowledged ${formatDateTime(s.acknowledgedAt)}${s.acknowledgementReference ? ` (ref. ${s.acknowledgementReference})` : ""}`
                  : `No acknowledgement yet · ${formatElapsed(s.submittedAt)} since sent`}
              </span>
            </span>
            {ackAction && coordinator && s.kind === "ROUTINE" && !s.acknowledgedAt ? (
              <ActionDialog
                trigger="Record acknowledgement"
                triggerSize="sm"
                title="Record acknowledgement"
                description="Record the acknowledgement received from the recipient outside the app."
                fields={[
                  {
                    name: "acknowledgedAt",
                    label: "Date and time received (IST)",
                    type: "datetime-local",
                    defaultValue: now,
                  },
                  {
                    name: "reference",
                    label: "Reference given by the recipient",
                    type: "text",
                    optional: true,
                    hint: "Copy it exactly. The app never creates official numbers.",
                  },
                  { name: "notes", label: "Notes", type: "textarea", optional: true },
                ]}
                submitLabel="Record acknowledgement"
                action={recordAcknowledgementAction.bind(null, s.id)}
              />
            ) : null}
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">External submissions</h1>
        <p className="text-muted-foreground">
          Tracking only. Approved reports are sent to the AMC or NCC outside this app; coordinators record what was sent
          and any acknowledgement.{coordinator ? "" : " You can view this list; coordinators record submissions."}
        </p>
      </div>

      <section aria-labelledby="awaiting" className="space-y-2">
        <h2 id="awaiting" className="flex items-center gap-1.5 text-base font-semibold">
          <Inbox className="size-4" aria-hidden /> Approved, awaiting submission ({awaiting.length})
        </h2>
        {awaiting.length === 0 ? <p className="text-sm text-muted-foreground">Nothing waiting.</p> : null}
        <ul className="space-y-2">
          {awaiting.map((c) => (
            <li key={c.id} className="rounded-lg border bg-card px-4 py-3">
              <CaseLine c={c} />
              {submissionsOf(c, false)}
              {coordinator ? (
                <div className="mt-2">
                  <ActionDialog
                    trigger={
                      <>
                        <Send aria-hidden /> Record submission
                      </>
                    }
                    triggerVariant="default"
                    triggerSize="sm"
                    title={`Record submission of ${c.caseNumber}`}
                    description="Record how the approved PDF was sent. The app does not send it."
                    fields={submissionFields(now, "e.g. AMC, Demo Medical College (fictional)")}
                    submitLabel="Record submission"
                    action={recordSubmissionAction.bind(null, c.id)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="submitted" className="space-y-2">
        <h2 id="submitted" className="text-base font-semibold">
          Submitted, awaiting acknowledgement ({submitted.length})
        </h2>
        {submitted.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : null}
        <ul className="space-y-2">
          {submitted.map((c) => (
            <li key={c.id} className="rounded-lg border bg-card px-4 py-3">
              <CaseLine c={c} />
              {submissionsOf(c, true)}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="acknowledged" className="space-y-2">
        <h2 id="acknowledged" className="text-base font-semibold">
          Acknowledged ({acknowledged.length})
        </h2>
        {acknowledged.length === 0 ? <p className="text-sm text-muted-foreground">None yet.</p> : null}
        <ul className="space-y-2">
          {acknowledged.map((c) => (
            <li key={c.id} className="rounded-lg border bg-card px-4 py-3">
              <CaseLine c={c} />
              {submissionsOf(c, false)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

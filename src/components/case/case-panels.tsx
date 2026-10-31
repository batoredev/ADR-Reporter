import type { ReactNode } from "react";
import { FileText, MessageSquare, MessageSquareWarning, Send, Siren } from "lucide-react";
import { cn } from "cn";
import { FileLink } from "@/components/data/protected-file";
import { files } from "@/lib/routes";
import type { CaseDetails } from "@/server/workflow/case-details";
import { fieldLabel, rowOrder } from "@/lib/domain/case-fields";
import { ISSUE_STATUS_LABELS, SUBMISSION_KIND_LABELS, SUBMISSION_METHOD_LABELS } from "@/lib/domain/labels";
import { formatDateTime, formatElapsed } from "@/lib/format";

export function Panel({
  title,
  icon,
  children,
  action,
}: {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          {icon}
          {title}
        </h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function CommentList({
  details,
  renderActions,
}: {
  details: CaseDetails;
  renderActions?: (comment: CaseDetails["comments"][number]) => ReactNode;
}) {
  const rows = rowOrder(details.latestSnapshot ?? details.live);
  if (!details.comments.length) return <p className="text-sm text-muted-foreground">No comments yet.</p>;
  return (
    <ul className="space-y-3">
      {details.comments.map((c) => {
        const issue = c.kind === "ISSUE";
        return (
          <li
            key={c.id}
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              issue && c.issueStatus === "OPEN" && "border-warning/40 bg-warning-soft",
            )}
          >
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {issue ? (
                <MessageSquareWarning className="size-3.5 text-warning" aria-hidden />
              ) : (
                <MessageSquare className="size-3.5" aria-hidden />
              )}
              <span className="font-medium text-foreground">{c.author.name}</span>
              <span>{issue ? "raised an issue" : "added a note"}</span>
              <span>
                · v{c.versionNo} · {formatDateTime(c.createdAt)}
              </span>
              {issue && c.issueStatus ? (
                <span className={cn("font-medium", c.issueStatus === "OPEN" ? "text-warning" : "text-success")}>
                  · {ISSUE_STATUS_LABELS[c.issueStatus]}
                </span>
              ) : null}
            </p>
            {c.fieldPath ? <p className="mt-0.5 text-xs font-medium">On: {fieldLabel(c.fieldPath, rows)}</p> : null}
            <p className="mt-1 whitespace-pre-line">{c.body}</p>
            {c.resolutionNote ? (
              <p className="mt-1 text-[13px] text-muted-foreground">
                {c.resolvedBy?.name}: {c.resolutionNote}
              </p>
            ) : null}
            {renderActions ? renderActions(c) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function EscalationList({
  details,
  renderActions,
}: {
  details: CaseDetails;
  renderActions?: (e: CaseDetails["escalations"][number]) => ReactNode;
}) {
  if (!details.escalations.length) return null;
  return (
    <Panel title="Urgent escalations" icon={<Siren className="size-4 text-serious" aria-hidden />}>
      <ul className="space-y-3">
        {details.escalations.map((e) => (
          <li
            key={e.id}
            className={cn("rounded-md border px-3 py-2 text-sm", !e.closedAt && "border-serious/30 bg-serious-soft")}
          >
            <p className="text-xs text-muted-foreground">
              Raised by <span className="font-medium text-foreground">{e.raisedBy.name}</span> ·{" "}
              {formatDateTime(e.raisedAt)} · {e.closedAt ? "closed" : `open for ${formatElapsed(e.raisedAt)}`}
            </p>
            <p className="mt-1 whitespace-pre-line">{e.note}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {e.acknowledgedAt
                ? `Acknowledged by ${e.acknowledgedBy?.name} · ${formatDateTime(e.acknowledgedAt)}`
                : "Not yet acknowledged"}
              {e.closedAt
                ? ` · Closed by ${e.closedBy?.name} · ${formatDateTime(e.closedAt)}${e.closingNote ? `: ${e.closingNote}` : ""}`
                : ""}
            </p>
            {renderActions ? renderActions(e) : null}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function SubmissionList({ details, action }: { details: CaseDetails; action?: ReactNode }) {
  if (!details.submissions.length && !action) return null;
  return (
    <Panel title="External submissions" icon={<Send className="size-4" aria-hidden />} action={action}>
      {details.submissions.length ? (
        <ul className="space-y-3">
          {details.submissions.map((s) => (
            <li key={s.id} className="rounded-md border px-3 py-2 text-sm">
              <p className="font-medium">
                {SUBMISSION_KIND_LABELS[s.kind]}:{" "}
                {s.method === "OTHER" && s.methodOther ? s.methodOther : SUBMISSION_METHOD_LABELS[s.method]}
              </p>
              <p className="text-[13px] text-muted-foreground">
                To {s.destination} · {formatDateTime(s.submittedAt)} · recorded by {s.recordedBy.name}
              </p>
              {s.externalReference ? (
                <p className="text-[13px]">Reference given by recipient: {s.externalReference}</p>
              ) : null}
              {s.notes ? <p className="text-[13px]">{s.notes}</p> : null}
              <p className="mt-1 text-[13px]">
                {s.acknowledgedAt
                  ? `Acknowledged ${formatDateTime(s.acknowledgedAt)}${s.acknowledgementReference ? ` (ref. ${s.acknowledgementReference})` : ""}`
                  : "No acknowledgement recorded yet"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        These are records of actions taken outside the app. The app never sends reports itself.
      </p>
    </Panel>
  );
}

export function VersionList({ details }: { details: CaseDetails }) {
  if (!details.versions.length) return <p className="text-sm text-muted-foreground">Not submitted yet.</p>;
  const reason = { SUBMITTED: "Submitted", RESUBMITTED: "Resubmitted", APPROVED: "Approved (final)" } as const;
  return (
    <ul className="space-y-1.5 text-sm">
      {[...details.versions].reverse().map((v) => (
        <li key={v.id} className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <span className="font-medium">v{v.versionNo}</span> · {reason[v.reason]} by {v.createdBy.name}
            <span className="block text-xs text-muted-foreground">{formatDateTime(v.createdAt)}</span>
          </span>
          <FileLink path={files.casePdf(details.c.id, v.versionNo)} className="text-[13px]">
            <FileText className="size-3.5" aria-hidden /> PDF
          </FileLink>
        </li>
      ))}
    </ul>
  );
}

export function DocumentList({ details }: { details: CaseDetails }) {
  if (!details.documents.length) return <p className="text-sm text-muted-foreground">No documents uploaded.</p>;
  return (
    <ul className="space-y-2 text-sm">
      {details.documents.map((doc) => (
        <li key={doc.id}>
          <FileLink path={files.document(details.c.id, doc.id)} className="font-medium">
            <FileText className="size-3.5" aria-hidden /> {doc.originalName}
          </FileLink>
          <span className="block text-xs text-muted-foreground">
            Uploaded by {doc.uploadedBy.name} · {formatDateTime(doc.createdAt)}
            {doc.runs[0] ? ` · document reading: ${doc.runs[0].status.toLowerCase()}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

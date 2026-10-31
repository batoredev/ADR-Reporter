"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  CheckCircle2,
  ClipboardCheck,
  CornerUpLeft,
  Eye,
  FileText,
  History,
  ListChecks,
  MessageSquare,
  Paperclip,
  PlayCircle,
  Undo2,
  UserCheck,
  Users,
} from "lucide-react";
import { ActionButton } from "@/components/actions/action-button";
import { ActionDialog } from "@/components/actions/action-dialog";
import { CaseHeader } from "@/components/case/case-header";
import {
  CommentList,
  DocumentList,
  EscalationList,
  Panel,
  SubmissionList,
  VersionList,
} from "@/components/case/case-panels";
import { AiReviewSummary } from "@/components/ai/ai-review-summary";
import { CaseSummary } from "@/components/case/case-summary";
import { EscalateButton } from "@/components/case/escalate-button";
import { Timeline } from "@/components/case/timeline";
import { Checklist } from "@/components/review/checklist";
import { CommentForm } from "@/components/review/comment-form";
import { Button } from "@/components/ui/button";
import { WorkspaceTabs, WorkspaceTabPanel } from "@/components/ui/workspace-tabs";
import { ChecklistItemKey } from "@/generated/prisma/enums";
import { canReview } from "@/lib/domain/access";
import { changedPaths, commentTargets } from "@/lib/domain/case-fields";
import { ASSIGNMENT_ACTION_LABELS, CHECKLIST_LABELS } from "@/lib/domain/labels";
import { formatDateTime } from "@/lib/format";
import { Loaded, PageError } from "@/components/data/page-state";
import { useRequireAccess, useUser } from "@/components/data/session";
import { actions } from "@/lib/api/actions";
import { ApiError, openFile } from "@/lib/api/client";
import { useApi } from "@/lib/api/use-api";
import { files } from "@/lib/routes";
import type { CaseDetails } from "@/server/workflow/case-details";
import type { reviewersFor } from "@/server/workflow/review";

type Reviewer = Awaited<ReturnType<typeof reviewersFor>>[number];

function Banner({ tone, children }: { tone: "info" | "warning" | "success"; children: React.ReactNode }) {
  const styles = {
    info: "border-primary/20 bg-info-soft text-foreground",
    warning: "border-warning/30 bg-warning-soft text-warning",
    success: "border-success/30 bg-success-soft text-success",
  };
  return (
    <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${styles[tone]}`}>
      {children}
    </div>
  );
}

export function ReviewWorkspaceView() {
  const user = useUser();
  const allowed = useRequireAccess(canReview);
  const id = useSearchParams().get("id") ?? "";
  const state = useApi<CaseDetails>(allowed && id ? `/cases/${encodeURIComponent(id)}` : null);
  const reviewerList = useApi<Reviewer[]>(state.data?.access.reassign ? "/reviewers" : null);
  if (!allowed) return null;
  if (!id) return <PageError error={new ApiError("No report was chosen.", 404)} />;
  return (
    <Loaded state={state}>
      {(d) =>
        d.c.status === "DRAFT" ? (
          <PageError error={new ApiError("This report has not been submitted yet.", 404)} />
        ) : (
          <Workspace d={d} id={id} userId={user.id} allReviewers={reviewerList.data ?? []} />
        )
      }
    </Loaded>
  );
}

function Workspace({
  d,
  id,
  userId,
  allReviewers,
}: {
  d: CaseDetails;
  id: string;
  userId: string;
  allReviewers: Reviewer[];
}) {
  const { access } = d;

  const snapshot = d.latestSnapshot ?? d.live;
  const changed =
    d.previousSnapshot && d.latestSnapshot ? changedPaths(d.previousSnapshot, d.latestSnapshot) : undefined;
  const openIssues = d.comments.filter((c) => c.kind === "ISSUE" && c.issueStatus === "OPEN");
  const issueCounts: Record<string, number> = {};
  for (const c of openIssues) if (c.fieldPath) issueCounts[c.fieldPath] = (issueCounts[c.fieldPath] ?? 0) + 1;

  const recorded = new Map(d.checklist.map((i) => [i.item, i]));
  const checklistRows = Object.values(ChecklistItemKey).map((key) => {
    const item = recorded.get(key);
    return {
      key,
      ...CHECKLIST_LABELS[key],
      outcome: item?.outcome ?? null,
      exceptionReason: item?.exceptionReason ?? null,
      reviewerName: item?.reviewer.name ?? null,
    };
  });
  const missingChecklist = checklistRows.filter((r) => !r.outcome);
  const canApprove = access.decide && missingChecklist.length === 0 && openIssues.length === 0;

  const reviewers = allReviewers.filter((r) => r.id !== d.c.reporterId && r.id !== d.c.assigneeId);
  const lastReturn = d.decisions.filter((x) => x.decision === "RETURN").at(-1);
  const approvedVersion = d.versions.filter((v) => v.reason === "APPROVED").at(-1);
  const isMine = d.c.assigneeId === userId;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/review" className="text-[13px] text-primary underline-offset-2 hover:underline">
        ← Review queue
      </Link>
      <CaseHeader
        caseNumber={d.c.caseNumber}
        status={d.c.status}
        reactionTerms={d.c.reactionTerms}
        reporterName={d.reporter.name}
        submittedAt={d.c.lastSubmittedAt}
        assigneeName={d.assignee?.name ?? null}
        isPotentiallySerious={d.c.isPotentiallySerious}
        criteria={d.c.seriousnessCriteria}
        openEscalation={d.escalations.some((e) => !e.closedAt)}
        actions={
          <>
            {access.claim ? (
              <ActionButton action={() => actions.claim(id)}>
                <UserCheck aria-hidden /> Take up
              </ActionButton>
            ) : null}
            {access.resume ? (
              <ActionButton action={() => actions.resume(id)}>
                <PlayCircle aria-hidden /> Resume review
              </ActionButton>
            ) : null}
            {access.decide ? (
              <>
                <ActionButton
                  action={() => actions.approve(id)}
                  disabled={!canApprove}
                  confirm="Approve this report? A final PDF is generated and the case version is frozen."
                >
                  <CheckCircle2 aria-hidden /> Approve
                </ActionButton>
                <ActionDialog
                  trigger={
                    <>
                      <CornerUpLeft aria-hidden /> Return for correction
                    </>
                  }
                  title="Return for correction"
                  description="The report goes back to the reporter with your open issues. When they resubmit, it comes back to you."
                  fields={[
                    {
                      name: "reason",
                      label: "Message to the reporter",
                      type: "textarea",
                      placeholder: "Summarise what needs correcting",
                    },
                  ]}
                  submitLabel="Return to reporter"
                  action={(values) => actions.returnCase(id, values)}
                />
              </>
            ) : null}
            {access.release || (access.reassign && reviewers.length > 0) ? (
              <details className="relative">
                <summary className="flex min-h-10 items-center rounded-md border bg-card px-4 text-sm font-medium">
                  More actions
                </summary>
                <div className="absolute right-0 z-20 mt-2 flex w-56 flex-col gap-1 rounded-xl border bg-card p-2 shadow-md">
                  {access.release ? (
                    <ActionDialog
                      trigger={
                        <>
                          <Undo2 aria-hidden /> Release
                        </>
                      }
                      triggerVariant="ghost"
                      title="Release to the pool"
                      description="Any reviewer can then take the case up. Comments and checklist progress are kept."
                      fields={[{ name: "reason", label: "Reason", type: "textarea", optional: true }]}
                      submitLabel="Release"
                      action={(values) => actions.release(id, values)}
                    />
                  ) : null}
                  {access.reassign && reviewers.length ? (
                    <ActionDialog
                      trigger={
                        <>
                          <ArrowLeftRight aria-hidden /> Reassign
                        </>
                      }
                      triggerVariant="ghost"
                      title="Reassign to another reviewer"
                      fields={[
                        {
                          name: "toUserId",
                          label: "Reviewer",
                          type: "select",
                          options: reviewers.map((r) => ({
                            value: r.id,
                            label: r.designation ? `${r.name}, ${r.designation}` : r.name,
                          })),
                        },
                        {
                          name: "reason",
                          label: "Reason",
                          type: "textarea",
                          placeholder: "e.g. Specialist input needed",
                        },
                      ]}
                      submitLabel="Reassign"
                      action={(values) => actions.reassign(id, values)}
                    />
                  ) : null}
                </div>
              </details>
            ) : null}
            {access.escalate ? <EscalateButton caseId={id} /> : null}
            <Button variant="outline" onClick={() => void openFile(files.casePdf(id, approvedVersion?.versionNo))}>
              <FileText aria-hidden /> {approvedVersion ? "Final PDF" : "PDF preview"}
            </Button>
          </>
        }
      />

      {d.c.status === "SUBMITTED" || (d.c.status === "RESUBMITTED" && !d.c.assigneeId) ? (
        <Banner tone="info">Waiting in the shared queue. Take it up to verify it.</Banner>
      ) : null}
      {d.c.status === "UNDER_REVIEW" && !isMine ? (
        <Banner tone="info">
          Under review by {d.assignee?.name}
          {d.c.claimedAt ? ` since ${formatDateTime(d.c.claimedAt)}` : ""}. You can read the case and add notes.
        </Banner>
      ) : null}
      {d.c.status === "RETURNED" && lastReturn ? (
        <Banner tone="warning">
          Returned to the reporter by {lastReturn.reviewer.name} on {formatDateTime(lastReturn.createdAt)}:{" "}
          {lastReturn.reason}
        </Banner>
      ) : null}
      {d.c.status === "RESUBMITTED" && d.c.assigneeId ? (
        <Banner tone="info">
          Corrected and resubmitted as v{d.c.currentVersion}.{" "}
          {isMine ? "Resume the review to continue." : `Assigned to ${d.assignee?.name}.`} Changed fields are
          highlighted.
        </Banner>
      ) : null}
      {approvedVersion ? (
        <Banner tone="success">
          Institutionally approved as v{approvedVersion.versionNo} on {formatDateTime(approvedVersion.createdAt)}. The
          final PDF is frozen.
        </Banner>
      ) : null}
      {access.decide && !canApprove ? (
        <div className="rounded-lg border px-4 py-3 text-sm">
          <p className="font-medium">Before you can approve</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {missingChecklist.length ? (
              <li>Complete the checklist: {missingChecklist.map((r) => r.title).join(", ")}.</li>
            ) : null}
            {openIssues.length ? (
              <li>
                {openIssues.length} open issue{openIssues.length === 1 ? "" : "s"}: resolve each one, or acknowledge it
                as genuinely unavailable with a reason. You can also return the report to the reporter.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <WorkspaceTabs
        label="Review sections"
        tabs={[
          { value: "report", label: "Report and evidence" },
          {
            value: "checklist",
            label: `Checklist (${checklistRows.length - missingChecklist.length}/${checklistRows.length})`,
          },
          { value: "comments", label: `Comments and issues (${openIssues.length} open)` },
          { value: "history", label: "History" },
        ]}
      >
        <WorkspaceTabPanel value="report" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-3">
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Eye className="size-3.5" aria-hidden />
              Version {d.versions.at(-1)?.versionNo}
              {changed?.size
                ? ` · ${changed.size} field${changed.size === 1 ? "" : "s"} changed since v${d.versions.at(-2)?.versionNo}`
                : ""}
              {Object.keys(d.provenance).length
                ? " · purple marks values read from an uploaded document and verified"
                : ""}
            </p>
            <AiReviewSummary events={d.timeline} />
            <CaseSummary snapshot={snapshot} changed={changed} provenance={d.provenance} issueCounts={issueCounts} />
          </div>
          <aside className="space-y-4">
            <Panel title="Source documents" icon={<Paperclip className="size-4" aria-hidden />}>
              <DocumentList details={d} />
            </Panel>
            <EscalationList details={d} />
            <SubmissionList details={d} />
          </aside>
        </WorkspaceTabPanel>
        <WorkspaceTabPanel value="checklist">
          <Panel title="Verification checklist" icon={<ListChecks className="size-4" aria-hidden />}>
            <Checklist rows={checklistRows} editable={access.decide} action={(input) => actions.checklist(id, input)} />
          </Panel>
        </WorkspaceTabPanel>
        <WorkspaceTabPanel value="comments">
          <Panel title="Comments and issues" icon={<MessageSquare className="size-4" aria-hidden />}>
            <div className="space-y-3">
              <CommentList
                details={d}
                renderActions={(c) =>
                  access.decide && c.kind === "ISSUE" && c.issueStatus === "OPEN" ? (
                    <div className="mt-2">
                      <ActionDialog
                        trigger="Close issue"
                        triggerSize="sm"
                        title="Close this issue"
                        description={c.body}
                        fields={[
                          {
                            name: "status",
                            label: "Outcome",
                            type: "radio",
                            defaultValue: "RESOLVED",
                            options: [
                              { value: "RESOLVED", label: "Resolved", hint: "The report now has the information." },
                              {
                                value: "ACKNOWLEDGED_UNAVAILABLE",
                                label: "Information genuinely unavailable",
                                hint: "Approval can proceed; the reason is kept in the record.",
                              },
                            ],
                          },
                          { name: "note", label: "Note or reason", type: "textarea" },
                        ]}
                        submitLabel="Close issue"
                        action={(values) => actions.closeIssue(id, c.id, values)}
                      />
                    </div>
                  ) : null
                }
              />
              {access.comment ? (
                <CommentForm
                  canRaiseIssue={access.raiseIssue}
                  targets={commentTargets(snapshot)}
                  action={(input) => actions.comment(id, input)}
                />
              ) : null}
            </div>
          </Panel>
        </WorkspaceTabPanel>
        <WorkspaceTabPanel value="history" className="grid gap-5 lg:grid-cols-2">
          <Panel title="Versions" icon={<History className="size-4" aria-hidden />}>
            <VersionList details={d} />
          </Panel>
          <Panel title="Assignment history" icon={<Users className="size-4" aria-hidden />}>
            {d.assignments.length ? (
              <ul className="space-y-1.5 text-sm">
                {d.assignments.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium">{a.actor.name}</span> {ASSIGNMENT_ACTION_LABELS[a.action]}
                    {a.action === "REASSIGNED" && a.toUser ? ` to ${a.toUser.name}` : ""}
                    {a.reason ? `: ${a.reason}` : ""}
                    <span className="block text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Not taken up yet.</p>
            )}
          </Panel>
          <Panel title="Timeline" icon={<ClipboardCheck className="size-4" aria-hidden />}>
            <Timeline entries={d.timeline} />
          </Panel>
        </WorkspaceTabPanel>
      </WorkspaceTabs>
    </div>
  );
}

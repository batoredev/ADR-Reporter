"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ClipboardCheck,
  FileText,
  History,
  MessageSquare,
  Paperclip,
  PencilLine,
  Send,
} from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { WorkspaceTabs, WorkspaceTabPanel } from "@/components/ui/workspace-tabs";
import { canReview } from "@/lib/domain/access";
import { changedPaths } from "@/lib/domain/case-fields";
import { Loaded, PageError } from "@/components/data/page-state";
import { useUser } from "@/components/data/session";
import { ApiError, openFile } from "@/lib/api/client";
import { useApi } from "@/lib/api/use-api";
import { files, pages } from "@/lib/routes";
import type { CaseDetails } from "@/server/workflow/case-details";

export function CasePageView() {
  const user = useUser();
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const submitted = params.get("submitted");
  const state = useApi<CaseDetails>(id ? `/cases/${encodeURIComponent(id)}` : null);
  if (!id) return <PageError error={new ApiError("No report was chosen.", 404)} />;
  return (
    <Loaded state={state}>
      {(d) => <CaseView d={d} id={id} submitted={submitted} canReviewCases={canReview(user)} />}
    </Loaded>
  );
}

function CaseView({
  d,
  id,
  submitted,
  canReviewCases,
}: {
  d: CaseDetails;
  id: string;
  submitted: string | null;
  canReviewCases: boolean;
}) {
  const snapshot = d.access.edit ? d.live : (d.latestSnapshot ?? d.live);
  const changed =
    !d.access.edit && d.previousSnapshot && d.latestSnapshot
      ? changedPaths(d.previousSnapshot, d.latestSnapshot)
      : undefined;
  const openIssues: Record<string, number> = {};
  for (const c of d.comments)
    if (c.kind === "ISSUE" && c.issueStatus === "OPEN" && c.fieldPath)
      openIssues[c.fieldPath] = (openIssues[c.fieldPath] ?? 0) + 1;
  const lastReturn = d.c.status === "RETURNED" ? d.decisions.filter((x) => x.decision === "RETURN").at(-1) : undefined;
  const approvedVersion = d.versions.filter((v) => v.reason === "APPROVED").at(-1);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
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
            {d.access.edit ? (
              <>
                <Button asChild variant="outline">
                  <Link href={pages.caseEdit(id)}>
                    <PencilLine aria-hidden /> Continue editing
                  </Link>
                </Button>
                <Button asChild>
                  <Link href={pages.caseSubmit(id)}>
                    <Send aria-hidden /> Review and submit
                  </Link>
                </Button>
              </>
            ) : null}
            {d.access.escalate ? <EscalateButton caseId={id} /> : null}
            {canReviewCases && d.c.status !== "DRAFT" ? (
              <Button asChild variant={d.access.edit ? "outline" : "default"}>
                <Link href={pages.reviewCase(id)}>
                  <ClipboardCheck aria-hidden /> Review workspace
                </Link>
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => void openFile(files.casePdf(id, approvedVersion?.versionNo))}>
              <FileText aria-hidden /> {approvedVersion ? "Final PDF" : "Draft PDF"}
            </Button>
          </>
        }
      />

      {submitted ? (
        <div
          className="flex gap-2 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success"
          role="status"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          Submitted as version {submitted}. It is now in the institutional review queue; nothing has been sent outside
          the hospital.
        </div>
      ) : null}
      {lastReturn && d.access.isOwner ? (
        <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          Returned for correction by {lastReturn.reviewer.name}: {lastReturn.reason}
        </div>
      ) : null}

      <WorkspaceTabs
        label="Report sections"
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "documents", label: `Documents (${d.documents.length})` },
          { value: "comments", label: `Comments (${d.comments.length})` },
          { value: "history", label: "Versions and history" },
        ]}
      >
        <WorkspaceTabPanel value="overview">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0 space-y-4">
              <p className="text-sm text-muted-foreground">
                {d.access.edit
                  ? "Showing your current draft."
                  : d.latestSnapshot
                    ? `Showing version ${d.versions.at(-1)?.versionNo}, as submitted.${changed?.size ? " Highlighted fields changed since the previous version." : ""}`
                    : "Showing the current draft."}
              </p>
              <AiReviewSummary events={d.timeline} />
              <CaseSummary snapshot={snapshot} changed={changed} provenance={d.provenance} issueCounts={openIssues} />
            </div>
            <aside className="space-y-4">
              <EscalationList details={d} />
              <SubmissionList details={d} />
            </aside>
          </div>
        </WorkspaceTabPanel>
        <WorkspaceTabPanel value="documents">
          <Panel title="Documents" icon={<Paperclip className="size-4" aria-hidden />}>
            <DocumentList details={d} />
          </Panel>
        </WorkspaceTabPanel>
        <WorkspaceTabPanel value="comments">
          <Panel title="Comments" icon={<MessageSquare className="size-4" aria-hidden />}>
            <CommentList details={d} />
          </Panel>
        </WorkspaceTabPanel>
        <WorkspaceTabPanel value="history" className="grid gap-5 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <Panel title="Versions" icon={<History className="size-4" aria-hidden />}>
            <VersionList details={d} />
          </Panel>
          <Panel title="Timeline">
            <Timeline entries={d.timeline} />
          </Panel>
        </WorkspaceTabPanel>
      </WorkspaceTabs>
    </div>
  );
}

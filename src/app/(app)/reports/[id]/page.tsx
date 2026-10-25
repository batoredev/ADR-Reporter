import type { Metadata } from "next";
import Link from "next/link";
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
import { CaseSummary } from "@/components/case/case-summary";
import { EscalateButton } from "@/components/case/escalate-button";
import { Timeline } from "@/components/case/timeline";
import { Button } from "@/components/ui/button";
import { canReview } from "@/lib/domain/access";
import { changedPaths } from "@/lib/domain/case-fields";
import { requireUser } from "@/server/auth/current-user";
import { getCaseDetails } from "@/server/workflow/case-details";
import { orNotFound } from "@/server/workflow/page-helpers";

export const metadata: Metadata = { title: "Case" };

export default async function CasePage({ params, searchParams }: PageProps<"/reports/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const { submitted } = await searchParams;
  const d = await orNotFound(getCaseDetails(user, id));
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
                  <Link href={`/reports/${id}/edit`}>
                    <PencilLine aria-hidden /> Continue editing
                  </Link>
                </Button>
                <Button asChild>
                  <Link href={`/reports/${id}/submit`}>
                    <Send aria-hidden /> Review and submit
                  </Link>
                </Button>
              </>
            ) : null}
            {d.access.escalate ? <EscalateButton caseId={id} /> : null}
            {canReview(user) && d.c.status !== "DRAFT" ? (
              <Button asChild variant={d.access.edit ? "outline" : "default"}>
                <Link href={`/review/${id}`}>
                  <ClipboardCheck aria-hidden /> Review workspace
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline">
              <a
                href={`/reports/${id}/pdf${approvedVersion ? `?version=${approvedVersion.versionNo}` : ""}`}
                target="_blank"
                rel="noreferrer"
              >
                <FileText aria-hidden /> {approvedVersion ? "Final PDF" : "Draft PDF"}
              </a>
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-3">
          <p className="text-[13px] text-muted-foreground">
            {d.access.edit
              ? "Showing your current draft."
              : d.latestSnapshot
                ? `Showing version ${d.versions.at(-1)?.versionNo}, as submitted.${changed?.size ? " Highlighted fields changed since the previous version." : ""}`
                : "Showing the current draft."}
          </p>
          <CaseSummary snapshot={snapshot} changed={changed} provenance={d.provenance} issueCounts={openIssues} />
        </div>
        <div className="space-y-4">
          <EscalationList details={d} />
          <SubmissionList details={d} />
          <Panel title="Comments" icon={<MessageSquare className="size-4" aria-hidden />}>
            <CommentList details={d} />
          </Panel>
          <Panel title="Versions" icon={<History className="size-4" aria-hidden />}>
            <VersionList details={d} />
          </Panel>
          <Panel title="Documents" icon={<Paperclip className="size-4" aria-hidden />}>
            <DocumentList details={d} />
          </Panel>
          <Panel title="Timeline">
            <Timeline entries={d.timeline} />
          </Panel>
        </div>
      </div>
    </div>
  );
}

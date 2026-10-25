import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquareWarning } from "lucide-react";
import { StatusBadge } from "@/components/case-badges";
import { CaseForm } from "@/components/report-form/case-form";
import type { IssueView } from "@/components/report-form/fields";
import { toFormValues } from "@/lib/domain/case-form";
import { requireUser } from "@/server/auth/current-user";
import { getCaseDetails } from "@/server/workflow/case-details";
import { orNotFound } from "@/server/workflow/page-helpers";
import { ExtractionPanel } from "@/components/extraction/extraction-panel";
import { aiStatus } from "@/server/ai/provider";

export const metadata: Metadata = { title: "Edit report" };

export default async function EditReportPage({ params }: PageProps<"/reports/[id]/edit">) {
  const user = await requireUser();
  const { id } = await params;
  const d = await orNotFound(getCaseDetails(user, id));
  if (!d.access.edit) redirect(`/reports/${id}`);

  const openIssues = d.comments.filter((c) => c.kind === "ISSUE" && c.issueStatus === "OPEN");
  const issuesByPath: Record<string, IssueView[]> = {};
  for (const issue of openIssues) {
    const key = issue.fieldPath ?? "general";
    (issuesByPath[key] ??= []).push({ id: issue.id, body: issue.body, author: issue.author.name });
  }
  const lastReturn = d.c.status === "RETURNED" ? d.decisions.filter((x) => x.decision === "RETURN").at(-1) : undefined;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{d.c.caseNumber}</h1>
        <StatusBadge status={d.c.status} />
        <Link href={`/reports/${id}`} className="ml-auto text-sm text-primary underline-offset-2 hover:underline">
          View case page
        </Link>
      </div>

      {lastReturn ? (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-warning">
          <p className="flex gap-2 text-sm font-medium">
            <MessageSquareWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
            Returned for correction by {lastReturn.reviewer.name}: {lastReturn.reason}
          </p>
          {openIssues.length ? (
            <ul className="ml-6 list-disc text-[13px]">
              {openIssues.map((i) => (
                <li key={i.id}>{i.body}</li>
              ))}
            </ul>
          ) : null}
          <p className="ml-6 text-xs">
            Correct the report below, then use Review and submit to send the corrected version back to the reviewer.
          </p>
        </div>
      ) : null}

      <CaseForm
        key={d.c.lockVersion}
        caseId={id}
        caseNumber={d.c.caseNumber}
        initialValues={toFormValues(d.c)}
        lockVersion={d.c.lockVersion}
        reporter={{
          name: d.reporter.name,
          email: d.reporter.email,
          phone: d.reporter.phone,
          occupation: d.reporter.occupation,
        }}
        issuesByPath={issuesByPath}
        hasOpenEscalation={d.escalations.some((e) => e.closedAt === null)}
        extractionSlot={
          <ExtractionPanel
            caseId={id}
            ai={aiStatus()}
            documents={d.documents.map((doc) => ({
              id: doc.id,
              name: doc.originalName,
              mimeType: doc.mimeType,
              uploadedAt: doc.createdAt.toISOString(),
            }))}
          />
        }
      />
    </div>
  );
}

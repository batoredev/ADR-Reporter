"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MessageSquareWarning } from "lucide-react";
import { StatusBadge } from "@/components/case-badges";
import { Loaded, PageError, PageLoading } from "@/components/data/page-state";
import { ExtractionPanel } from "@/components/extraction/extraction-panel";
import { CaseForm } from "@/components/report-form/case-form";
import { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/use-api";
import { pages } from "@/lib/routes";
import type { EditView } from "@/server/api/views";

export function EditReportView() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const state = useApi<EditView>(id ? `/cases/${encodeURIComponent(id)}/edit` : null);
  const notEditable = state.data?.editable === false;

  useEffect(() => {
    if (notEditable) router.replace(pages.caseView(id));
  }, [notEditable, id, router]);

  if (!id) return <PageError error={new ApiError("No report was chosen.", 404)} />;
  if (state.error) return <PageError error={state.error} retry={state.reload} />;
  return (
    <Loaded state={state}>
      {(d) => {
        if (!d.editable) return <PageLoading />;
        return (
          <div className="mx-auto max-w-6xl space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{d.caseNumber}</h1>
              <StatusBadge status={d.status} />
              <Link
                href={pages.caseView(id)}
                className="ml-auto text-sm text-primary underline-offset-2 hover:underline"
              >
                View case page
              </Link>
            </div>

            {d.lastReturn ? (
              <div className="space-y-2 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-warning">
                <p className="flex gap-2 text-sm font-medium">
                  <MessageSquareWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Returned for correction by {d.lastReturn.reviewer}: {d.lastReturn.reason}
                </p>
                {d.openIssues.length ? (
                  <ul className="ml-6 list-disc text-[13px]">
                    {d.openIssues.map((i) => (
                      <li key={i.id}>{i.body}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="ml-6 text-xs">
                  Correct the report below, then use Review and submit to send the corrected version back to the
                  reviewer.
                </p>
              </div>
            ) : null}

            <CaseForm
              key={d.lockVersion}
              initialGuided={params.get("mode") === "guided"}
              caseId={id}
              caseNumber={d.caseNumber}
              initialValues={d.values}
              lockVersion={d.lockVersion}
              reporter={d.reporter}
              issuesByPath={d.issuesByPath}
              hasOpenEscalation={d.hasOpenEscalation}
              ai={d.ai}
              extractionSlot={<ExtractionPanel caseId={id} ai={d.ai} documents={d.documents} />}
            />
          </div>
        );
      }}
    </Loaded>
  );
}

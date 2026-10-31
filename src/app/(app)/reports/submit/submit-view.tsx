"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { AiReviewSummary } from "@/components/ai/ai-review-summary";
import { CaseSummary } from "@/components/case/case-summary";
import { StatusBadge } from "@/components/case-badges";
import { Button } from "@/components/ui/button";
import { WorkspaceTabs, WorkspaceTabPanel } from "@/components/ui/workspace-tabs";
import { Loaded, PageError, PageLoading } from "@/components/data/page-state";
import { FileLink, ProtectedFrame } from "@/components/data/protected-file";
import { ApiError } from "@/lib/api/client";
import { useApi } from "@/lib/api/use-api";
import { files, pages } from "@/lib/routes";
import type { SubmitView } from "@/server/api/views";
import { SubmitForm } from "./submit-form";

export function SubmitReportView() {
  const router = useRouter();
  const id = useSearchParams().get("id") ?? "";
  const state = useApi<SubmitView>(id ? `/cases/${encodeURIComponent(id)}/submit` : null);
  const notEditable = state.data?.editable === false;

  useEffect(() => {
    if (notEditable) router.replace(pages.caseView(id));
  }, [notEditable, id, router]);

  if (!id) return <PageError error={new ApiError("No report was chosen.", 404)} />;
  return (
    <Loaded state={state}>
      {(d) => {
        if (!d.editable) return <PageLoading />;
        const { check, preview, resubmission } = d;
        return (
          <div className="mx-auto max-w-6xl space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-semibold tracking-tight">Review and submit {d.caseNumber}</h1>
              <StatusBadge status={d.status} />
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-w-0">
                <WorkspaceTabs
                  label="Report preview"
                  tabs={[
                    { value: "summary", label: "Report summary" },
                    { value: "pdf", label: "PDF preview" },
                  ]}
                >
                  <WorkspaceTabPanel value="summary" className="space-y-4">
                    <AiReviewSummary events={d.aiEvents} />
                    <CaseSummary snapshot={preview} />
                  </WorkspaceTabPanel>
                  <WorkspaceTabPanel value="pdf">
                    <div className="overflow-hidden rounded-lg border bg-card">
                      <div className="flex items-center justify-between border-b px-4 py-2">
                        <h2 className="text-sm font-semibold">PvPI form preview (draft)</h2>
                        <FileLink path={files.casePdf(id)} className="text-sm">
                          Open PDF
                        </FileLink>
                      </div>
                      <ProtectedFrame
                        path={files.casePdf(id)}
                        title="PvPI form preview"
                        className="h-[70vh] w-full bg-secondary"
                      />
                    </div>
                  </WorkspaceTabPanel>
                </WorkspaceTabs>
              </div>

              <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
                <div className="space-y-3 rounded-lg border bg-card p-4">
                  <h2 className="text-base font-semibold">Before you submit</h2>
                  {check.ready ? (
                    <p className="flex items-center gap-1.5 text-sm text-success">
                      <CheckCircle2 className="size-4" aria-hidden /> All mandatory fields are complete.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-destructive">Mandatory information is missing:</p>
                      <ul className="list-disc pl-5 text-[13px]">
                        {check.missing.map((m, i) => (
                          <li key={i}>{m.message}</li>
                        ))}
                      </ul>
                      <Button asChild variant="outline">
                        <Link href={pages.caseEdit(id)}>Back to the form</Link>
                      </Button>
                    </div>
                  )}
                  {check.warnings.length ? (
                    <div className="rounded-md bg-warning-soft p-2 text-[13px] text-warning">
                      <p className="flex items-center gap-1 font-medium">
                        <AlertTriangle className="size-3.5" aria-hidden /> Please check
                      </p>
                      <ul className="mt-1 list-disc pl-5">
                        {check.warnings.map((w, i) => (
                          <li key={i}>{w.message}</li>
                        ))}
                      </ul>
                      <p className="mt-1">
                        You can still submit if these are recorded correctly; the reviewer will see them.
                      </p>
                    </div>
                  ) : null}
                </div>
                {check.ready ? (
                  <SubmitForm caseId={id} lockVersion={d.lockVersion} resubmission={resubmission} />
                ) : null}
                <Button asChild variant="ghost" className="w-full">
                  <Link href={pages.caseEdit(id)}>Keep editing</Link>
                </Button>
              </aside>
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}

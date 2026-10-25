import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { CaseSummary } from "@/components/case/case-summary";
import { StatusBadge } from "@/components/case-badges";
import { Button } from "@/components/ui/button";
import { toFormValues } from "@/lib/domain/case-form";
import { assessCompleteness } from "@/lib/domain/completeness";
import { todayInAppZone } from "@/lib/format";
import { requireUser } from "@/server/auth/current-user";
import { getCaseDetails } from "@/server/workflow/case-details";
import { orNotFound } from "@/server/workflow/page-helpers";
import { SubmitForm } from "./submit-form";

export const metadata: Metadata = { title: "Review and submit" };

export default async function SubmitPage({ params }: PageProps<"/reports/[id]/submit">) {
  const user = await requireUser();
  const { id } = await params;
  const d = await orNotFound(getCaseDetails(user, id));
  if (!d.access.edit) redirect(`/reports/${id}`);

  const check = assessCompleteness(toFormValues(d.c), d.reporter);
  const preview = {
    ...d.live,
    reporter: {
      name: d.reporter.name,
      address: d.reporter.address,
      pin: d.reporter.pin,
      email: d.reporter.email,
      phone: d.reporter.phone,
      occupation: d.reporter.occupation,
      reportDate: todayInAppZone(),
    },
  };
  const resubmission = d.c.status === "RETURNED";

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Review and submit {d.c.caseNumber}</h1>
        <StatusBadge status={d.c.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-2">
              <h2 className="text-sm font-semibold">PvPI form preview (draft)</h2>
              <a
                href={`/reports/${id}/pdf`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary underline-offset-2 hover:underline"
              >
                Open PDF
              </a>
            </div>
            <iframe
              title="PvPI form preview"
              src={`/reports/${id}/pdf#view=FitH`}
              className="h-[70vh] w-full bg-secondary"
            />
          </div>
          <CaseSummary snapshot={preview} />
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
                  <Link href={`/reports/${id}/edit`}>Back to the form</Link>
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
          {check.ready ? <SubmitForm caseId={id} lockVersion={d.c.lockVersion} resubmission={resubmission} /> : null}
          <Button asChild variant="ghost" className="w-full">
            <Link href={`/reports/${id}/edit`}>Keep editing</Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, MessagesSquare } from "lucide-react";
import { StatusBadge } from "@/components/case-badges";
import { useRequireAccess } from "@/components/data/session";
import { Button } from "@/components/ui/button";
import { actions } from "@/lib/api/actions";
import { useApi } from "@/lib/api/use-api";
import { canReport } from "@/lib/domain/access";
import { formatDateTime } from "@/lib/format";
import { pages } from "@/lib/routes";
import type { DraftsView } from "@/server/api/views";

export function NewReportView() {
  const allowed = useRequireAccess(canReport);
  const router = useRouter();
  const drafts = useApi<DraftsView>(allowed ? "/drafts" : null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!allowed) return null;

  async function start() {
    setPending(true);
    setError(null);
    const result = await actions.createDraft();
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.push(pages.caseEdit(result.data.id));
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New ADR report</h1>
        <p className="text-muted-foreground">Choose how you would like to report. Both lead to the same PvPI form.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col rounded-lg border bg-card p-5">
          <ClipboardList className="size-6 text-primary" aria-hidden />
          <h2 className="mt-3 text-base font-semibold">Structured reporting</h2>
          <p className="mt-1 flex-1 text-[13px] text-muted-foreground">
            Fill in the PvPI form sections A to D directly. You can upload a prescription to suggest medicine details,
            and you verify every value.
          </p>
          <div className="mt-4 space-y-2">
            <Button type="button" onClick={() => void start()} disabled={pending}>
              Start a structured report
            </Button>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col rounded-lg border border-dashed bg-secondary p-5">
          <MessagesSquare className="size-6 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-base font-semibold text-muted-foreground">Guided reporting</h2>
          <p className="mt-1 flex-1 text-[13px] text-muted-foreground">
            Step-by-step questions in plain language. Not part of this prototype.
          </p>
          <Button className="mt-4 self-start" variant="outline" disabled>
            Not available
          </Button>
        </div>
      </div>

      {drafts.data?.length ? (
        <section aria-labelledby="drafts" className="space-y-2">
          <h2 id="drafts" className="text-base font-semibold">
            Continue where you left off
          </h2>
          <ul className="divide-y rounded-lg border bg-card">
            {drafts.data.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {d.caseNumber} <StatusBadge status={d.status} />
                  </p>
                  <p className="truncate text-[13px] text-muted-foreground">
                    {d.reactionTerms ?? "Reaction not entered"} · last saved {formatDateTime(d.updatedAt)}
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link href={pages.caseEdit(d.id)}>Continue</Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, MessagesSquare, FileUp } from "lucide-react";
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
  const health = useApi<{ features?: { reportChat?: boolean } }>(allowed ? "/health" : null);
  const assistantReady = health.data?.features?.reportChat === true;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!allowed) return null;

  async function start(guided = false, documents = false) {
    setPending(true);
    setError(null);
    const result = await actions.createDraft();
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.push(
      documents ? pages.caseChat(result.data.id) : `${pages.caseEdit(result.data.id)}${guided ? "&mode=guided" : ""}`,
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">How would you like to start?</h1>
        <p className="mt-2 text-muted-foreground">
          Choose the approach that works for you. All modes use the same report.
        </p>
      </div>

      <section className="rounded-xl border border-primary/25 bg-info-soft/50 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <FileUp className="mt-1 size-8 shrink-0 text-primary" aria-hidden />
          <div>
            <h2 className="text-xl font-semibold">Create a report with the assistant</h2>
            <p className="mt-2 max-w-2xl leading-relaxed text-muted-foreground">
              Upload related files together, check the suggested details, then answer questions for what is still
              missing.
            </p>
          </div>
        </div>
        <div className="mt-6 rounded-xl border border-dashed border-primary/30 bg-card/80 p-6 text-center">
          <FileUp className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 text-sm text-muted-foreground">Photos, prescriptions and PDFs · up to 10 MB per file</p>
          <Button
            className="mt-4"
            type="button"
            onClick={() => void start(false, true)}
            disabled={pending || !assistantReady}
          >
            Start a conversation
          </Button>
          {!assistantReady && !health.loading ? (
            <p className="mt-3 text-sm text-muted-foreground">
              You can use the form or guided reporting while the assistant is being prepared.
            </p>
          ) : null}
        </div>
      </section>

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
        <div className="flex flex-col rounded-lg border bg-card p-5">
          <MessagesSquare className="size-6 text-muted-foreground" aria-hidden />
          <h2 className="mt-3 text-base font-semibold">Guided reporting</h2>
          <p className="mt-1 flex-1 text-[13px] text-muted-foreground">
            Answer a few questions at a time, with suggested follow-ups. Switch to the structured form at any time
            without losing answers.
          </p>
          <Button className="mt-4 self-start" variant="outline" disabled={pending} onClick={() => void start(true)}>
            Start a guided report
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

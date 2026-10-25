import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, MessagesSquare } from "lucide-react";
import { StatusBadge } from "@/components/case-badges";
import { Button } from "@/components/ui/button";
import { canReport } from "@/lib/domain/access";
import { formatDateTime } from "@/lib/format";
import { requireAccess } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { createDraftAction } from "../actions";

export const metadata: Metadata = { title: "New ADR report" };

export default async function NewReportPage() {
  const user = await requireAccess(canReport);
  const drafts = await db.adrCase.findMany({
    where: { reporterId: user.id, status: { in: ["DRAFT", "RETURNED"] } },
    orderBy: { updatedAt: "desc" },
    take: 5,
    select: { id: true, caseNumber: true, status: true, reactionTerms: true, updatedAt: true },
  });

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
          <form action={createDraftAction} className="mt-4">
            <Button type="submit">Start a structured report</Button>
          </form>
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

      {drafts.length ? (
        <section aria-labelledby="drafts" className="space-y-2">
          <h2 id="drafts" className="text-base font-semibold">
            Continue where you left off
          </h2>
          <ul className="divide-y rounded-lg border bg-card">
            {drafts.map((d) => (
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
                  <Link href={`/reports/${d.id}/edit`}>Continue</Link>
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

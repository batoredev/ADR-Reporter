import type { Metadata } from "next";
import Link from "next/link";
import { cn } from "cn";
import { Siren } from "lucide-react";
import { ActionButton } from "@/components/actions/action-button";
import { SeriousBadge, StatusBadge } from "@/components/case-badges";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canReview } from "@/lib/domain/access";
import { formatDateTime, formatElapsed } from "@/lib/format";
import { requireAccess } from "@/server/auth/current-user";
import { getReviewQueue, parseQueueFilter, QUEUE_FILTERS, type QueueFilter } from "@/server/workflow/queue";
import { claimAction, resumeAction } from "./actions";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewQueuePage({ searchParams }: PageProps<"/review">) {
  const user = await requireAccess(canReview);
  const filter = parseQueueFilter((await searchParams).filter);
  const { cases, counts } = await getReviewQueue(user, filter);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-muted-foreground">
          Shared by all reviewers in the institution. Potentially serious reports come first, then the longest waiting.
        </p>
      </div>

      <nav aria-label="Filter the queue" className="flex flex-wrap gap-1.5 text-[13px]">
        {(Object.entries(QUEUE_FILTERS) as [QueueFilter, string][]).map(([key, label]) => (
          <Link
            key={key}
            href={key === "pending" ? "/review" : `/review?filter=${key}`}
            aria-current={filter === key ? "page" : undefined}
            className={cn(
              "rounded-md border px-2.5 py-1",
              filter === key ? "bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {label} <span className={filter === key ? "opacity-80" : "text-muted-foreground"}>{counts[key]}</span>
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-secondary">
            <TableRow>
              <TableHead>Report ID</TableHead>
              <TableHead>Suspected medicine / reaction</TableHead>
              <TableHead>Reporter</TableHead>
              <TableHead>Waiting</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Seriousness</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Nothing here right now.
                </TableCell>
              </TableRow>
            ) : (
              cases.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link href={`/review/${c.id}`} className="text-primary underline-offset-2 hover:underline">
                      {c.caseNumber}
                    </Link>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {c.patientInitials ?? "-"} · v{c.currentVersion}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-64">
                    <span className="block truncate">{c.suspectedMedicines[0]?.name ?? "-"}</span>
                    <span className="block truncate text-xs text-muted-foreground">{c.reactionTerms ?? "-"}</span>
                  </TableCell>
                  <TableCell className="min-w-32 whitespace-normal">{c.reporter.name}</TableCell>
                  <TableCell>
                    {c.lastSubmittedAt ? (
                      <>
                        <span className="block">{formatElapsed(c.lastSubmittedAt)}</span>
                        <span className="block text-xs text-muted-foreground">{formatDateTime(c.lastSubmittedAt)}</span>
                      </>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="min-w-36 whitespace-normal">
                    <StatusBadge status={c.status} />
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {c.assignee ? (c.assigneeId === user.id ? "You" : c.assignee.name) : "Not taken up"}
                    </span>
                    {c._count.comments ? (
                      <span className="block text-xs text-warning">
                        {c._count.comments} open issue{c._count.comments === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      {c.isPotentiallySerious ? <SeriousBadge /> : <span className="text-muted-foreground">-</span>}
                      {c.escalations.length ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-serious">
                          <Siren className="size-3" aria-hidden /> Escalated
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.canClaim ? (
                      <ActionButton size="sm" action={claimAction.bind(null, c.id)} redirectTo={`/review/${c.id}`}>
                        Take up
                      </ActionButton>
                    ) : c.canResume ? (
                      <ActionButton size="sm" action={resumeAction.bind(null, c.id)} redirectTo={`/review/${c.id}`}>
                        Resume
                      </ActionButton>
                    ) : (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/review/${c.id}`}>Open</Link>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

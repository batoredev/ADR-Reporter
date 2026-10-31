"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cn } from "cn";
import { Siren } from "lucide-react";
import { ActionButton } from "@/components/actions/action-button";
import { SeriousBadge, StatusBadge } from "@/components/case-badges";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canReview } from "@/lib/domain/access";
import { formatDateTime, formatElapsed } from "@/lib/format";
import { Loaded } from "@/components/data/page-state";
import { useRequireAccess, useUser } from "@/components/data/session";
import { actions } from "@/lib/api/actions";
import { useApi } from "@/lib/api/use-api";
import { QUEUE_FILTERS, type QueueFilter } from "@/lib/domain/filters";
import { pages } from "@/lib/routes";
import type { getReviewQueue } from "@/server/workflow/queue";

type Queue = Awaited<ReturnType<typeof getReviewQueue>> & { filter: QueueFilter };

export function ReviewQueueView() {
  const user = useUser();
  const allowed = useRequireAccess(canReview);
  const filterParam = useSearchParams().get("filter");
  const state = useApi<Queue>(
    allowed ? `/review${filterParam ? `?filter=${encodeURIComponent(filterParam)}` : ""}` : null,
  );
  if (!allowed) return null;

  return (
    <Loaded state={state}>
      {({ filter, cases, counts }) => (
        <div className="mx-auto max-w-6xl space-y-5">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Review queue</h1>
            <p className="text-muted-foreground">
              Shared by all reviewers in the institution. Potentially serious reports come first, then the longest
              waiting.
            </p>
          </div>

          <nav aria-label="Filter the queue" className="flex gap-1 overflow-x-auto border-b text-sm">
            {(Object.entries(QUEUE_FILTERS) as [QueueFilter, string][]).map(([key, label]) => (
              <Link
                key={key}
                href={key === "pending" ? "/review" : `/review?filter=${key}`}
                aria-current={filter === key ? "page" : undefined}
                className={cn(
                  "flex min-h-12 shrink-0 items-center gap-2 border-b-2 border-transparent px-4 py-3 font-medium",
                  filter === key ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label} <span className={filter === key ? "opacity-80" : "text-muted-foreground"}>{counts[key]}</span>
              </Link>
            ))}
          </nav>

          <div className="overflow-x-auto rounded-xl border bg-card">
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
                        <Link href={pages.reviewCase(c.id)} className="text-primary underline-offset-2 hover:underline">
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
                            <span className="block text-xs text-muted-foreground">
                              {formatDateTime(c.lastSubmittedAt)}
                            </span>
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
                          <ActionButton
                            size="sm"
                            action={() => actions.claim(c.id)}
                            redirectTo={pages.reviewCase(c.id)}
                          >
                            Take up
                          </ActionButton>
                        ) : c.canResume ? (
                          <ActionButton
                            size="sm"
                            action={() => actions.resume(c.id)}
                            redirectTo={pages.reviewCase(c.id)}
                          >
                            Resume
                          </ActionButton>
                        ) : (
                          <Button asChild size="sm" variant="outline">
                            <Link href={pages.reviewCase(c.id)}>Open</Link>
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
      )}
    </Loaded>
  );
}

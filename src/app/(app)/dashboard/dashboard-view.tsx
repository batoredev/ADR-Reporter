"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ClipboardCheck, FilePlus2, Files, Search, Siren } from "lucide-react";
import { SeriousBadge, StatusBadge } from "@/components/case-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CaseStatus } from "@/generated/prisma/enums";
import { canHandleEscalations, canReport, canReview } from "@/lib/domain/access";
import { CASE_STATUS_LABELS } from "@/lib/domain/labels";
import { formatDate, formatTime } from "@/lib/format";
import { Loaded } from "@/components/data/page-state";
import { useUser } from "@/components/data/session";
import { useApi } from "@/lib/api/use-api";
import { DASHBOARD_SORTS, type DashboardSort } from "@/lib/domain/filters";
import { pages } from "@/lib/routes";
import type { getDashboard } from "@/server/dashboard";

type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

function filtersFrom(params: URLSearchParams) {
  const q = params.get("q")?.trim().slice(0, 100) || undefined;
  const statusParam = params.get("status") ?? "";
  const sortParam = params.get("sort") ?? "";
  return {
    q,
    status: statusParam in CaseStatus ? (statusParam as CaseStatus) : undefined,
    sort: (sortParam in DASHBOARD_SORTS ? sortParam : "activity") as DashboardSort,
  };
}

const selectClass =
  "h-8 rounded-lg border border-input bg-background px-2 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

function NotEntered() {
  return <span className="text-muted-foreground">Not entered</span>;
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "serious" }) {
  return (
    <div className="rounded-xl border bg-card px-5 py-5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p
        className={
          tone === "serious" && value > 0 ? "mt-2 text-3xl font-semibold text-serious" : "mt-2 text-3xl font-semibold"
        }
      >
        {value}
      </p>
    </div>
  );
}

export function DashboardView() {
  const user = useUser();
  const params = useSearchParams();
  const filters = filtersFrom(params);
  const query = new URLSearchParams(
    Object.entries({ q: filters.q ?? "", status: filters.status ?? "", sort: filters.sort }).filter(([, v]) => v),
  ).toString();
  const state = useApi<Dashboard>(`/dashboard?${query}`);
  const statusOptions = Object.values(CaseStatus).filter((s) => canReport(user) || s !== "DRAFT");
  const filtered = Boolean(filters.q || filters.status || filters.sort !== "activity");

  return (
    <Loaded state={state}>
      {({ metrics, recent }) => (
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {canReview(user) ? "Review overview" : "Overview"}
              </h1>
              <p className="mt-2 text-muted-foreground">
                {canReview(user) ? "Focus on cases that need your attention." : "Your reporting workspace."}
                <span className="sr-only"> Signed in as {user.name}</span>
              </p>
            </div>
            <Button asChild>
              <Link href={canReport(user) ? "/reports/new" : "/review"}>
                {canReport(user) ? <FilePlus2 aria-hidden /> : <ClipboardCheck aria-hidden />}
                {canReport(user) ? "New ADR report" : "Open review queue"}
              </Link>
            </Button>
          </div>

          {metrics.openEscalations ? (
            <Alert className="border-serious/30 bg-serious-soft text-serious">
              <Siren aria-hidden />
              <AlertTitle>
                {metrics.openEscalations} open urgent escalation{metrics.openEscalations === 1 ? "" : "s"}
              </AlertTitle>
              <AlertDescription className="text-serious/90">
                Potentially serious reports have been escalated to designated personnel and are waiting for
                acknowledgement.{" "}
                <Link href="/escalations" className="font-medium underline underline-offset-2">
                  View urgent escalations
                </Link>
              </AlertDescription>
            </Alert>
          ) : null}

          <section aria-label="Case counts" className="grid gap-4 sm:grid-cols-3">
            {metrics.drafts !== null ? (
              <Metric label="Drafts" value={metrics.drafts} />
            ) : (
              <Metric label="Potentially serious" value={metrics.potentiallySerious} tone="serious" />
            )}
            {canReport(user) ? (
              <Metric label="Needs correction" value={metrics.returned} />
            ) : (
              <Metric label="Open escalations" value={metrics.openEscalations ?? 0} tone="serious" />
            )}
            <Metric label="Pending review" value={metrics.pendingReview} />
          </section>

          {canReport(user) &&
          !canReview(user) &&
          recent.some((c) => c.status === "RETURNED" || c.status === "DRAFT") ? (
            <section className="rounded-xl border bg-card p-5" aria-label="Reports needing your attention">
              <h2 className="text-lg font-semibold">Needs your attention</h2>
              <div className="mt-4 divide-y">
                {recent
                  .filter((c) => c.status === "RETURNED" || c.status === "DRAFT")
                  .sort((a, b) => Number(b.status === "RETURNED") - Number(a.status === "RETURNED"))
                  .slice(0, 3)
                  .map((c) => (
                    <div
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                    >
                      <div>
                        <p className="font-semibold">
                          {c.caseNumber} · {c.reactionTerms ?? "New draft"}
                        </p>
                        <p className="mt-1">
                          <StatusBadge status={c.status} />
                        </p>
                      </div>
                      <Button asChild variant={c.status === "RETURNED" ? "outline" : "default"}>
                        <Link href={pages.caseEdit(c.id)}>
                          {c.status === "RETURNED" ? "Review feedback" : "Continue"}
                        </Link>
                      </Button>
                    </div>
                  ))}
              </div>
            </section>
          ) : null}

          <details className="rounded-xl border bg-card px-5 py-3">
            <summary className="text-sm font-medium">Workspace shortcuts and counts</summary>
            <section aria-labelledby="quick-actions" className="mt-4 space-y-3">
              <h2 id="quick-actions" className="text-base font-semibold">
                Quick actions
              </h2>
              <div className="flex flex-wrap gap-2">
                {canReport(user) ? (
                  <>
                    <Button asChild>
                      <Link href="/reports/new">
                        <FilePlus2 aria-hidden />
                        New ADR report
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href="/my-reports">
                        <Files aria-hidden />
                        My reports
                      </Link>
                    </Button>
                  </>
                ) : null}
                {canReview(user) ? (
                  <Button asChild variant={canReport(user) ? "outline" : "default"}>
                    <Link href="/review">
                      <ClipboardCheck aria-hidden />
                      Review queue
                    </Link>
                  </Button>
                ) : null}
                {canHandleEscalations(user) ? (
                  <Button asChild variant="outline">
                    <Link href="/escalations">
                      <Siren aria-hidden />
                      Urgent escalations
                    </Link>
                  </Button>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {metrics.total} total · {metrics.approved} approved · {metrics.externallySubmitted} externally submitted
              </p>
            </section>
          </details>

          <section aria-labelledby="recent-cases" className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
            <div className="space-y-3">
              <div>
                <h2 id="recent-cases" className="text-base font-semibold">
                  Recent cases
                </h2>
                <p className="text-[13px] text-muted-foreground">
                  {canReview(user)
                    ? "All submitted cases in your institution, plus your own drafts."
                    : "Reports you have created."}
                </p>
              </div>
              <form method="get" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" role="search">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    name="q"
                    defaultValue={filters.q}
                    placeholder="Case, initials, medicine, reaction"
                    aria-label="Search cases"
                    className="pl-8 sm:w-64"
                  />
                </div>
                <select
                  name="status"
                  defaultValue={filters.status ?? ""}
                  aria-label="Filter by status"
                  className={selectClass}
                >
                  <option value="">All statuses</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>
                      {CASE_STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
                <select name="sort" defaultValue={filters.sort} aria-label="Sort cases" className={selectClass}>
                  {Object.entries(DASHBOARD_SORTS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <Button type="submit" variant="outline">
                  Apply
                </Button>
                {filtered ? (
                  <Button asChild variant="ghost">
                    <Link href="/dashboard">Clear</Link>
                  </Button>
                ) : null}
              </form>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader className="bg-secondary">
                  <TableRow>
                    <TableHead>Report</TableHead>
                    <TableHead>Suspected medicine / reaction</TableHead>
                    {canReview(user) ? <TableHead>Reporter</TableHead> : null}
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={canReview(user) ? 5 : 4} className="py-10 text-center text-muted-foreground">
                        {filtered ? "No cases match these filters." : "No cases yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    recent.slice(0, 8).map((c) => {
                      const medicine = c.suspectedMedicines[0]?.name;
                      return (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">
                            <Link
                              href={pages.caseView(c.id)}
                              className="text-primary underline-offset-2 hover:underline"
                            >
                              {c.caseNumber}
                            </Link>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {c.patientInitials ?? "Initials not entered"}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-64">
                            <span className="block truncate" title={medicine ?? undefined}>
                              {medicine ?? <NotEntered />}
                            </span>
                            <span
                              className="block truncate text-xs text-muted-foreground"
                              title={c.reactionTerms ?? undefined}
                            >
                              {c.reactionTerms ?? "Reaction not entered"}
                            </span>
                          </TableCell>
                          {canReview(user) ? (
                            <TableCell className="min-w-32 whitespace-normal">{c.reporter.name}</TableCell>
                          ) : null}
                          <TableCell>
                            {c.lastSubmittedAt ? (
                              <>
                                <span className="block">{formatDate(c.lastSubmittedAt)}</span>
                                <span className="block text-xs text-muted-foreground">
                                  {formatTime(c.lastSubmittedAt)}
                                </span>
                              </>
                            ) : (
                              <span className="text-muted-foreground">Not submitted</span>
                            )}
                          </TableCell>
                          <TableCell className="min-w-36 whitespace-normal">
                            <StatusBadge status={c.status} />
                            {c.assignee ? (
                              <span className="mt-0.5 block text-xs text-muted-foreground">{c.assignee.name}</span>
                            ) : null}
                            {c.isPotentiallySerious ? (
                              <span className="mt-1 block">
                                <SeriousBadge />
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            <Link
              href={canReview(user) ? "/review" : "/my-reports"}
              className="inline-flex min-h-10 items-center text-sm font-medium text-primary hover:underline"
            >
              {canReview(user) ? "View review queue" : "View all reports"}
            </Link>
          </section>
        </div>
      )}
    </Loaded>
  );
}

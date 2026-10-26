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
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={tone === "serious" && value > 0 ? "text-2xl font-semibold text-serious" : "text-2xl font-semibold"}>
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
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">
              Signed in as {user.name}
              {user.designation ? ` · ${user.designation}` : ""}
            </p>
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

          <section aria-label="Case counts" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <Metric label="Total" value={metrics.total} />
            {metrics.drafts !== null ? <Metric label="Drafts" value={metrics.drafts} /> : null}
            <Metric label="Pending review" value={metrics.pendingReview} />
            <Metric label="Returned" value={metrics.returned} />
            <Metric label="Approved" value={metrics.approved} />
            <Metric label="Externally submitted" value={metrics.externallySubmitted} />
            <Metric label="Potentially serious" value={metrics.potentiallySerious} tone="serious" />
          </section>

          <section aria-labelledby="quick-actions" className="space-y-2">
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
          </section>

          <section aria-labelledby="recent-cases" className="space-y-3">
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
                    <TableHead>Report ID</TableHead>
                    <TableHead>Patient</TableHead>
                    <TableHead>Suspected medicine / reaction</TableHead>
                    <TableHead>Reporter</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Seriousness</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                        {filtered ? "No cases match these filters." : "No cases yet."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    recent.map((c) => {
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
                          </TableCell>
                          <TableCell>{c.patientInitials ?? <NotEntered />}</TableCell>
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
                          <TableCell className="min-w-32 whitespace-normal">{c.reporter.name}</TableCell>
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
                          </TableCell>
                          <TableCell>
                            {c.isPotentiallySerious ? (
                              <SeriousBadge />
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
        </div>
      )}
    </Loaded>
  );
}

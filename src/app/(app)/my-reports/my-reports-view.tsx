"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FilePlus2 } from "lucide-react";
import { SeriousBadge, StatusBadge } from "@/components/case-badges";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CaseStatus } from "@/generated/prisma/enums";
import { canReport } from "@/lib/domain/access";
import { CASE_STATUS_LABELS } from "@/lib/domain/labels";
import { formatDateTime } from "@/lib/format";
import { Loaded } from "@/components/data/page-state";
import { useRequireAccess } from "@/components/data/session";
import { useApi } from "@/lib/api/use-api";
import { pages } from "@/lib/routes";
import type { MyReportsView } from "@/server/api/views";

export function MyReportsView() {
  const allowed = useRequireAccess(canReport);
  const status = useSearchParams().get("status");
  const state = useApi<MyReportsView>(
    allowed ? `/my-reports${status ? `?status=${encodeURIComponent(status)}` : ""}` : null,
  );
  if (!allowed) return null;

  return (
    <Loaded state={state}>
      {({ filter, cases }) => (
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">My reports</h1>
              <p className="text-muted-foreground">Your drafts and submitted reports.</p>
            </div>
            <Button asChild>
              <Link href="/reports/new">
                <FilePlus2 aria-hidden /> New ADR report
              </Link>
            </Button>
          </div>
          <nav aria-label="Filter by status" className="flex gap-1 overflow-x-auto border-b text-sm">
            <Link
              href="/my-reports"
              className={`flex min-h-12 shrink-0 items-center border-b-2 border-transparent px-4 py-3 font-medium ${!filter ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              All
            </Link>
            {(
              [
                "DRAFT",
                "SUBMITTED",
                "UNDER_REVIEW",
                "RETURNED",
                "RESUBMITTED",
                "APPROVED",
                "EXTERNALLY_SUBMITTED",
                "ACKNOWLEDGED",
              ] as CaseStatus[]
            ).map((s) => (
              <Link
                key={s}
                href={`/my-reports?status=${s}`}
                className={`flex min-h-12 shrink-0 items-center border-b-2 border-transparent px-4 py-3 font-medium ${filter === s ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground"}`}
              >
                {CASE_STATUS_LABELS[s]}
              </Link>
            ))}
          </nav>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <Table>
              <TableHeader className="bg-secondary">
                <TableRow>
                  <TableHead>Report ID</TableHead>
                  <TableHead>Suspected medicine / reaction</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last change</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                      {filter ? "No reports with this status." : "You have not created any reports yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  cases.map((c) => {
                    const editable = c.status === "DRAFT" || c.status === "RETURNED";
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          <Link href={pages.caseView(c.id)} className="text-primary underline-offset-2 hover:underline">
                            {c.caseNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-72">
                          <span className="block truncate">
                            {c.suspectedMedicines[0]?.name ?? "Medicine not entered"}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {c.reactionTerms ?? "Reaction not entered"}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-normal">
                          <span className="flex flex-wrap gap-1">
                            <StatusBadge status={c.status} />
                            {c.isPotentiallySerious ? <SeriousBadge /> : null}
                          </span>
                          {c._count.comments ? (
                            <span className="text-xs text-warning">{c._count.comments} open issue(s)</span>
                          ) : null}
                        </TableCell>
                        <TableCell>{formatDateTime(c.updatedAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button asChild size="sm" variant={editable ? "default" : "outline"}>
                            <Link href={editable ? pages.caseEdit(c.id) : pages.caseView(c.id)}>
                              {editable ? (c.status === "RETURNED" ? "Correct" : "Continue") : "View"}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </Loaded>
  );
}

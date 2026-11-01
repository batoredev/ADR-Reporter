"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { ChatNote } from "@/lib/domain/report-chat";
import type { ReportSummary } from "@/server/workflow/report-summary";

const KIND_TITLES: Record<ChatNote["kind"], string> = {
  UNCLEAR: "Unclear reading",
  CONFLICT: "Sources differ",
  HELD: "Not added: different patient?",
  INVALID: "Could not be used",
  SIMILAR: "Similar medicine names",
  INFERRED: "Filled in by the app",
  MERGED: "Duplicates merged",
  CHANGED: "Changed by your answer",
};

/**
 * Details to look at before the single confirmation, and what the app filled
 * in by itself. Nothing here needs a separate approval; the reporter confirms
 * the whole report once.
 */
export function ReviewNotes({
  review,
  busy = false,
  onBelongs,
}: {
  review: ReportSummary;
  busy?: boolean;
  /** Offered for documents held back because their patient initials differ. */
  onBelongs?: (documentId: string) => void;
}) {
  if (!review.attention.length && !review.info.length) return null;
  return (
    <div className="space-y-3">
      {review.attention.length ? (
        <section className="space-y-2 rounded-xl border border-warning/30 bg-warning-soft p-4">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-warning">
            <AlertTriangle className="size-4" aria-hidden /> Please take a quick look ({review.attention.length})
          </h2>
          <ul className="space-y-2">
            {review.attention.map((n, i) => (
              <li key={`${n.key}-${n.kind}-${i}`} className="rounded-lg bg-card p-3 text-sm">
                <p className="text-xs font-semibold text-warning">{KIND_TITLES[n.kind]}</p>
                <p className="font-medium">{n.label}</p>
                <p className="text-muted-foreground">{n.message}</p>
                {n.kind === "HELD" && n.documentId && onBelongs ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={busy}
                    onClick={() => onBelongs(n.documentId!)}
                  >
                    It belongs to this patient: add its details
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-warning">Correct anything wrong in the form. Otherwise nothing else is needed.</p>
        </section>
      ) : null}
      {review.info.length ? (
        <details className="rounded-xl border bg-card p-4 text-sm">
          <summary className="flex cursor-pointer items-center gap-1.5 font-medium">
            <Info className="size-4 text-primary" aria-hidden /> Filled in or merged by the app ({review.info.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {review.info.map((n, i) => (
              <li key={`${n.key}-${n.kind}-${i}`}>
                <span className="font-medium">{n.label}:</span>{" "}
                <span className="text-muted-foreground">{n.message}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** The report as filled so far, section by section, with where each value came from. */
export function ReportSoFar({ review }: { review: ReportSummary }) {
  if (!review.sections.length)
    return (
      <div className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        Nothing filled in yet. Add documents or describe what happened.
      </div>
    );
  return (
    <div className="space-y-3" aria-label="Report details so far">
      {review.sections.map((section) => (
        <section key={section.title} className="overflow-hidden rounded-xl border bg-card">
          <h3 className="border-b bg-secondary/60 px-4 py-2 text-sm font-semibold">{section.title}</h3>
          <dl className="divide-y">
            {section.rows.map((row) => {
              const attention = row.notes.some((n) => ["UNCLEAR", "CONFLICT", "INVALID"].includes(n.kind));
              return (
                <div key={row.path} className={cn("px-4 py-2 text-sm", attention && "bg-warning-soft")}>
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd className="font-medium break-words whitespace-pre-line">{row.value || "—"}</dd>
                  <dd className="text-xs text-muted-foreground">
                    {attention ? (
                      <AlertTriangle className="mr-1 inline size-3 text-warning" aria-hidden />
                    ) : (
                      <CheckCircle2 className="mr-1 inline size-3 text-success" aria-hidden />
                    )}
                    {row.source}
                    {row.notes.length ? ` · ${row.notes.map((n) => n.message).join(" ")}` : ""}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/server/workflow/errors";

export interface ChecklistRow {
  key: string;
  title: string;
  hint: string;
  outcome: "VERIFIED" | "VERIFIED_WITH_EXCEPTION" | null;
  exceptionReason: string | null;
  reviewerName: string | null;
}

type Outcome = "VERIFIED" | "VERIFIED_WITH_EXCEPTION" | "CLEAR";

interface ChecklistProps {
  rows: ChecklistRow[];
  editable: boolean;
  action: (input: { item: string; outcome: Outcome; exceptionReason?: string }) => Promise<ActionResult<unknown>>;
}

/** The six verification items. Each must be verified, or verified with a stated exception, before approval. */
export function Checklist({ rows, editable, action }: ChecklistProps) {
  const done = rows.filter((r) => r.outcome).length;
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-muted-foreground">
        {done} of {rows.length} verified
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <ChecklistItem key={row.key} row={row} editable={editable} action={action} />
        ))}
      </ul>
    </div>
  );
}

function ChecklistItem({ row, editable, action }: { row: ChecklistRow } & Omit<ChecklistProps, "rows">) {
  const router = useRouter();
  const [exception, setException] = useState(false);
  const [reason, setReason] = useState(row.exceptionReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function record(outcome: Outcome) {
    setError(null);
    startTransition(async () => {
      const result = await action({ item: row.key, outcome, exceptionReason: reason });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setException(false);
      router.refresh();
    });
  }

  const Icon = row.outcome === "VERIFIED" ? CheckCircle2 : row.outcome ? CircleAlert : Circle;
  return (
    <li className="rounded-md border px-3 py-2 text-sm" data-checklist-item={row.key}>
      <div className="flex items-start gap-2">
        <Icon
          className={`mt-0.5 size-4 shrink-0 ${row.outcome === "VERIFIED" ? "text-success" : row.outcome ? "text-warning" : "text-muted-foreground"}`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{row.title}</p>
          <p className="text-xs text-muted-foreground">{row.hint}</p>
          {row.outcome ? (
            <p className="mt-1 text-xs">
              {row.outcome === "VERIFIED" ? "Verified" : "Verified with exception"}
              {row.reviewerName ? ` by ${row.reviewerName}` : ""}
              {row.exceptionReason ? `: ${row.exceptionReason}` : ""}
            </p>
          ) : null}
        </div>
      </div>
      {editable ? (
        <div className="mt-2 space-y-2 pl-6">
          <div className="flex flex-wrap gap-1.5">
            {row.outcome !== "VERIFIED" ? (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => record("VERIFIED")}>
                Verified
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setException((v) => !v)}
            >
              {row.outcome === "VERIFIED_WITH_EXCEPTION" ? "Edit exception" : "With exception…"}
            </Button>
            {row.outcome ? (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => record("CLEAR")}>
                Clear
              </Button>
            ) : null}
          </div>
          {exception ? (
            <div className="space-y-1.5">
              <label htmlFor={`exception-${row.key}`} className="text-xs font-medium">
                Exception reason
              </label>
              <textarea
                id={`exception-${row.key}`}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Batch number genuinely unavailable: the strip was discarded"
                className="w-full rounded-lg border border-input px-2.5 py-1.5 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              />
              <Button type="button" size="sm" disabled={pending} onClick={() => record("VERIFIED_WITH_EXCEPTION")}>
                Save exception
              </Button>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

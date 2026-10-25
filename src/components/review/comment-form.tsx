"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/server/workflow/errors";

const control =
  "w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

interface CommentFormProps {
  canRaiseIssue: boolean;
  targets: { path: string; label: string }[];
  action: (input: { kind: "NOTE" | "ISSUE"; body: string; fieldPath?: string }) => Promise<ActionResult<unknown>>;
}

export function CommentForm({ canRaiseIssue, targets, action }: CommentFormProps) {
  const router = useRouter();
  const [kind, setKind] = useState<"NOTE" | "ISSUE">(canRaiseIssue ? "ISSUE" : "NOTE");
  const [fieldPath, setFieldPath] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await action({ kind, body, fieldPath: fieldPath || undefined });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody("");
      setFieldPath("");
      router.refresh();
    });
  }

  return (
    <form
      className="space-y-2 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {canRaiseIssue ? (
        <fieldset className="flex flex-wrap gap-3 text-sm">
          <legend className="sr-only">Comment type</legend>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={kind === "ISSUE"}
              onChange={() => setKind("ISSUE")}
              className="accent-primary"
            />
            Issue for the reporter
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={kind === "NOTE"} onChange={() => setKind("NOTE")} className="accent-primary" />
            Note
          </label>
        </fieldset>
      ) : null}
      <div className="space-y-1">
        <label htmlFor="comment-field" className="text-[13px] font-medium">
          Field <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <select
          id="comment-field"
          value={fieldPath}
          onChange={(e) => setFieldPath(e.target.value)}
          className={`${control} h-8`}
        >
          <option value="">Whole report</option>
          {targets.map((t) => (
            <option key={t.path} value={t.path}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="comment-body" className="text-[13px] font-medium">
          {kind === "ISSUE" ? "What needs correcting or adding" : "Note"}
        </label>
        <textarea
          id="comment-body"
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className={`${control} py-1.5`}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={pending}>
        {kind === "ISSUE" ? "Raise issue" : "Add note"}
      </Button>
    </form>
  );
}

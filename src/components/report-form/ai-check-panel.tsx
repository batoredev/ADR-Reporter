"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, SearchCheck } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { AiChain, AiSource } from "@/components/ai/ai-source";
import { actions } from "@/lib/api/actions";
import { CHECK_KIND_LABELS, type CheckTarget } from "@/lib/domain/ai-checks";
import type { ConsistencyResult } from "@/server/workflow/ai-assist";
import type { AiStatus } from "@/server/ai/provider";
import { fieldId, inputClass } from "./fields";
import { useSaveDraft } from "./form-context";

const ANCHOR: Partial<Record<CheckTarget, string>> = {
  suspectedMedicines: "section-c",
  concomitantProducts: "field-concomitantProducts",
  investigations: "field-investigations",
};

/**
 * "Check with AI": reads the whole saved report and what was read from its
 * documents, and lists what to look at again. It never changes the report;
 * the reporter corrects a field or keeps it as recorded (with a reason).
 */
export function AiCheckPanel({ caseId, ai }: { caseId: string; ai: AiStatus }) {
  const saveDraft = useSaveDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConsistencyResult | null>(null);
  const [kept, setKept] = useState<Record<number, boolean>>({});
  const [keeping, setKeeping] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  async function run() {
    setBusy(true);
    setError(null);
    if (saveDraft && !(await saveDraft())) {
      setBusy(false);
      setError("Save the draft first (see the message at the bottom of the form).");
      return;
    }
    const r = await actions.checkWithAi(caseId);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setResult(r.data);
    setKept({});
  }

  async function keep(index: number) {
    if (!result) return;
    const r = await actions.keepFinding(caseId, result.checkId, index, reason);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setKept((k) => ({ ...k, [index]: true }));
    setKeeping(null);
    setReason("");
  }

  return (
    <div className="space-y-3 rounded-lg border border-ai/25 bg-ai-soft/60 p-4">
      <div>
        <h2 className="flex items-center gap-1.5 text-base font-semibold">
          <SearchCheck className="size-4 text-ai" aria-hidden /> Check with AI
        </h2>
        <p className="text-[13px] text-muted-foreground">
          Looks for contradictions and gaps across the report and your uploaded documents. It never changes anything.
        </p>
      </div>
      <Button type="button" size="sm" onClick={() => void run()} disabled={busy || !ai.available}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <SearchCheck aria-hidden />}{" "}
        {result ? "Check again" : "Check with AI"}
      </Button>
      <p className="text-xs text-muted-foreground">
        <AiChain ai={ai} />
      </p>
      {busy ? (
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          Checking… this can take up to a minute.
        </p>
      ) : null}
      {error ? (
        <p className="flex items-start gap-1.5 text-[13px] text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}
      {result ? (
        <div className="space-y-2 border-t border-ai/20 pt-2">
          {result.findings.length === 0 ? (
            <p className="flex items-center gap-1.5 text-[13px] text-success">
              <CheckCircle2 className="size-4" aria-hidden /> Nothing to check.
            </p>
          ) : (
            <ul className="space-y-2">
              {result.findings.map((f, i) => (
                <li key={i} className={cn("rounded-md border bg-background p-2 text-[13px]", kept[i] && "opacity-60")}>
                  <p className="text-[11px] font-semibold tracking-wide text-warning uppercase">
                    {CHECK_KIND_LABELS[f.kind]}
                  </p>
                  <p>{f.message}</p>
                  {f.evidence ? <p className="text-xs text-muted-foreground">&ldquo;{f.evidence}&rdquo;</p> : null}
                  {kept[i] ? (
                    <p className="mt-1 text-xs text-muted-foreground">Kept as recorded.</p>
                  ) : keeping === i ? (
                    <div className="mt-1.5 space-y-1.5">
                      <input
                        className={inputClass}
                        placeholder="Why it is correct as recorded (optional)"
                        value={reason}
                        maxLength={500}
                        onChange={(e) => setReason(e.target.value)}
                        aria-label="Reason for keeping it"
                      />
                      <div className="flex gap-1.5">
                        <Button type="button" size="sm" onClick={() => void keep(i)}>
                          Keep as recorded
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setKeeping(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 flex flex-wrap gap-3 text-xs">
                      {f.field ? (
                        <a
                          href={`#${ANCHOR[f.field] ?? fieldId(f.field)}`}
                          className="text-primary underline underline-offset-2"
                        >
                          Go to the field
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className="text-muted-foreground underline underline-offset-2"
                        onClick={() => {
                          setKeeping(i);
                          setReason("");
                        }}
                      >
                        It is correct, keep it
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            By <AiSource provider={result.provider} model={result.model} attempts={result.attempts} />
            {result.usedDocuments ? ", using what was read from your documents" : ""}. Run it again after changes.
          </p>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { AiChain } from "@/components/ai/ai-source";
import { actions } from "@/lib/api/actions";
import { toolError } from "@/lib/api/tool-error";
import { CHECK_KIND_LABELS, type CheckTarget } from "@/lib/domain/ai-checks";
import type { FindingDecision, SavedCheck } from "@/lib/domain/ai-history";
import type { AiStatus } from "@/server/ai/provider";
import { fieldId, inputClass } from "./fields";
import { useDraftVersion, useSaveDraft } from "./form-context";

const ANCHOR: Partial<Record<CheckTarget, string>> = {
  age: "field-age",
  suspectedMedicines: "section-c",
  concomitantProducts: "field-concomitantProducts",
  investigations: "field-investigations",
};
const DECISIONS: Record<FindingDecision, string> = {
  KEPT: "Kept with explanation",
  CORRECTED: "Reporter marked corrected",
  UNSURE: "Unsure: reviewer attention needed",
};

export function AiCheckPanel({ caseId, ai }: { caseId: string; ai: AiStatus }) {
  const save = useSaveDraft();
  const version = useDraftVersion();
  useWatch(); // Re-evaluate the stale marker when form values change.
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SavedCheck | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [dirtySinceCheck, setDirtySinceCheck] = useState(false);
  useEffect(() => {
    let active = true;
    void actions.aiHistory(caseId).then((r) => {
      if (!active) return;
      if (r.ok) setResult(r.data.check);
      else setError(r.error);
      setBusy(false);
    });
    return () => {
      active = false;
    };
  }, [caseId]);
  async function run() {
    setBusy(true);
    setError(null);
    if (save && !(await save())) {
      setBusy(false);
      setError("Save the report first.");
      return;
    }
    const r = await actions.checkWithAi(caseId);
    if (r.ok) {
      setResult(r.data);
      setReasons({});
      setDirtySinceCheck(false);
    } else setError(r.error);
    setBusy(false);
  }
  async function decide(index: number, decision: FindingDecision) {
    if (!result) return;
    setBusy(true);
    setError(null);
    if (save && !(await save())) {
      setBusy(false);
      setError("Save the report first.");
      return;
    }
    const reason = reasons[index] ?? "";
    const r = await actions.keepFinding(caseId, result.checkId, index, reason, decision);
    if (r.ok) {
      setResult({
        ...result,
        decisions: { ...result.decisions, [index]: { decision, reason, at: new Date().toISOString() } },
      });
      setDirtySinceCheck(version?.() !== result.lockVersion);
    } else setError(r.error);
    setBusy(false);
  }
  return (
    <div className="space-y-3 rounded-lg border border-ai/25 bg-ai-soft/60 p-4">
      <h2 className="text-base font-semibold">Check report</h2>
      <p className="text-[13px] text-muted-foreground">
        Looks for contradictions and gaps in the saved report and available document extractions. It never changes your
        answers.
      </p>
      <Button type="button" size="sm" disabled={busy || !ai.available} onClick={() => void run()}>
        {busy ? "Please wait..." : result ? "Check again" : "Check report"}
      </Button>
      <p className="text-xs text-muted-foreground">
        <AiChain ai={ai} />
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {toolError(error)}
        </p>
      ) : null}
      {result ? (
        <div className="space-y-3 border-t pt-3">
          {dirtySinceCheck || version?.() !== result.lockVersion ? (
            <p className="text-xs text-warning">
              This check used an earlier saved version. Run it again after your changes.
            </p>
          ) : null}
          {!result.findings.length ? (
            <p className="text-sm">
              No issues were suggested. Review completeness and verify the report before submitting.
            </p>
          ) : null}
          <ul className="space-y-3">
            {result.findings.map((f, i) => {
              const decision = result.decisions[i];
              return (
                <li key={i} className="space-y-2 rounded border bg-background p-2 text-sm">
                  <p className="text-xs font-semibold text-warning">{CHECK_KIND_LABELS[f.kind]}</p>
                  <p>{f.message}</p>
                  {f.evidence ? (
                    <blockquote className="border-l-2 pl-2 text-xs text-muted-foreground">{f.evidence}</blockquote>
                  ) : null}
                  {f.field ? (
                    <a className="text-xs text-primary underline" href={`#${ANCHOR[f.field] ?? fieldId(f.field)}`}>
                      Go to the field
                    </a>
                  ) : null}
                  {decision ? (
                    <p className="text-xs">
                      {DECISIONS[decision.decision]}
                      {decision.reason ? `: ${decision.reason}` : ""}
                    </p>
                  ) : (
                    <p className="text-xs text-warning">Unresolved</p>
                  )}
                  <label className="block text-xs">
                    Explanation for finding {i + 1}
                    <input
                      className={inputClass}
                      maxLength={500}
                      value={reasons[i] ?? ""}
                      disabled={busy}
                      onChange={(e) => setReasons((r) => ({ ...r, [i]: e.target.value }))}
                    />
                  </label>
                  <div className="flex flex-wrap gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void decide(i, "CORRECTED")}
                    >
                      I corrected it
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !reasons[i]?.trim()}
                      onClick={() => void decide(i, "KEPT")}
                    >
                      Keep with explanation
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void decide(i, "UNSURE")}
                    >
                      I am unsure
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            {result.usedDocuments
              ? "Used recorded document readings, including readings not yet verified; these are not document truth."
              : "No document readings were available."}{" "}
            Decisions are saved for the reviewer.
          </p>
        </div>
      ) : null}
    </div>
  );
}

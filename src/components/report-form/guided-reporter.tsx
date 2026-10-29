"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { AiSource } from "@/components/ai/ai-source";
import { actions } from "@/lib/api/actions";
import { GUIDED_STEPS, type GuidedId, type RowList } from "@/lib/domain/guided";
import type { CaseFormValues } from "@/lib/domain/case-form";
import type { GuidedSuggestions } from "@/server/workflow/guided";
import type { AiStatus } from "@/server/ai/provider";
import { TextField, PartialDateField, SelectField, CheckboxGroup, inputClass, type FormPath } from "./fields";
import { useSaveDraft } from "./form-context";
import { NarrativeHelper } from "./narrative-helper";

export interface GuidedRows {
  count: number;
  add: () => void;
  remove: (index: number) => void;
}

export function GuidedReporter({
  caseId,
  ai,
  rows,
  extractionSlot,
  onStructured,
}: {
  caseId: string;
  ai: AiStatus;
  rows: Record<RowList, GuidedRows>;
  extractionSlot?: ReactNode;
  onStructured: () => void;
}) {
  const form = useFormContext<CaseFormValues>();
  const values = useWatch({ control: form.control }) as CaseFormValues;
  const save = useSaveDraft();
  const [stepId, setStepId] = useState<GuidedId>("patient");
  const [rowIndex, setRowIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<GuidedSuggestions | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    void actions.aiHistory(caseId).then((r) => {
      if (!active) return;
      if (r.ok && GUIDED_STEPS.some((s) => s.id === r.data.guidedStep)) setStepId(r.data.guidedStep as GuidedId);
      if (!r.ok) setError(r.error);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [caseId]);
  const step = GUIDED_STEPS.find((s) => s.id === stepId)!;
  const position = GUIDED_STEPS.indexOf(step);
  const list = step.list;
  const manager = list ? rows[list] : null;
  const index = manager ? Math.min(rowIndex, Math.max(0, manager.count - 1)) : 0;
  const prefix = list ? `${list}.${index}.` : "";
  const row = list ? values[list]?.[index] : null;

  async function go(id: GuidedId) {
    setBusy(true);
    setError(null);
    if (save && !(await save())) {
      setError("Fix the highlighted fields before continuing.");
      setBusy(false);
      return;
    }
    const result = await actions.saveGuidedStep(caseId, id);
    if (result.ok) setStepId(id);
    else setError(result.error);
    setBusy(false);
  }
  async function followups() {
    setBusy(true);
    setError(null);
    if (save && !(await save())) {
      setError("Save the report first.");
      setBusy(false);
      return;
    }
    const result = await actions.guidedFollowups(caseId);
    if (result.ok) setSuggestions(result.data);
    else setError(result.error);
    setBusy(false);
  }
  return (
    <section aria-label="Guided reporting" className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Guided reporting</h2>
        <Button type="button" variant="outline" onClick={onStructured} disabled={busy}>
          Switch to structured form
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Your answers save into the same PvPI form. Leave unavailable mandatory details blank; mark optional details
        Unknown. You can enter partial or approximate dates.
      </p>
      <label className="block text-sm">
        Question group
        <select
          aria-label="Question group"
          className={inputClass}
          value={stepId}
          disabled={busy || !ready}
          onChange={(e) => void go(e.target.value as GuidedId)}
        >
          {GUIDED_STEPS.map((s, i) => (
            <option key={s.id} value={s.id}>
              {i + 1}. {s.title}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Group {position + 1} of {GUIDED_STEPS.length} · PvPI {step.pvpi}
      </p>
      <h3 className="font-semibold">{step.title}</h3>
      {manager ? (
        <div className="flex flex-wrap items-center gap-2">
          {manager.count ? (
            <select
              aria-label="Choose row"
              value={index}
              className={inputClass + " max-w-xs"}
              onChange={(e) => setRowIndex(Number(e.target.value))}
            >
              {Array.from({ length: manager.count }, (_, i) => (
                <option key={i} value={i}>
                  {list === "investigations" ? "Test" : "Medicine"} {i + 1}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-sm">None added. Add a row if applicable, or continue.</p>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={manager.count >= (list === "suspectedMedicines" ? 10 : 20)}
            onClick={() => {
              manager.add();
              setRowIndex(manager.count);
            }}
          >
            Add {list === "investigations" ? "test" : "medicine"}
          </Button>
          {manager.count ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => manager.remove(index)}>
              Remove this row
            </Button>
          ) : null}
        </div>
      ) : null}
      <fieldset disabled={busy || !ready} className="space-y-5">
        {!manager || manager.count
          ? step.questions.map((q) => {
              const name = `${prefix}${q.field}` as FormPath;
              if (q.field === "deathDate" && !values.seriousnessCriteria?.includes("DEATH")) return null;
              if (q.field === "rechallengeDose" && (row as { rechallenge?: string })?.rechallenge !== "YES")
                return null;
              const stopped =
                q.field === "reactionStopDate"
                  ? values.reactionOngoing
                  : q.field === "stopDate" && (row as { ongoing?: boolean })?.ongoing;
              const props = {
                name,
                label: q.question,
                hint: q.hint,
                required: q.required,
                unknown: q.unknown ? { listPath: `${prefix}unknownFields` as FormPath, field: q.field } : undefined,
              };
              const options = Object.entries(q.options ?? {}).map(([value, label]) => ({ value, label }));
              return (
                <div key={name}>
                  {q.kind === "date" ? (
                    <PartialDateField {...props} disabled={Boolean(stopped)} />
                  ) : q.kind === "select" ? (
                    <SelectField {...props} options={options} />
                  ) : q.kind === "checks" ? (
                    <CheckboxGroup {...props} options={options} />
                  ) : q.kind === "boolean" ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4" {...form.register(name)} />
                      {q.question}
                    </label>
                  ) : (
                    <TextField {...props} multiline={q.kind === "long"} />
                  )}
                  {list === "concomitantProducts" && q.field === "stopDate" ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" {...form.register(`${prefix}ongoing` as FormPath)} />
                      Still being taken
                    </label>
                  ) : null}
                </div>
              );
            })
          : null}
      </fieldset>
      {stepId === "reaction" ? <NarrativeHelper caseId={caseId} ai={ai} /> : null}
      {stepId === "medicine-identity" || stepId === "tests" ? extractionSlot : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy || !ready || position === 0}
          onClick={() => void go(GUIDED_STEPS[position - 1].id)}
        >
          Previous
        </Button>
        {position < GUIDED_STEPS.length - 1 ? (
          <Button type="button" disabled={busy || !ready} onClick={() => void go(GUIDED_STEPS[position + 1].id)}>
            Save and continue
          </Button>
        ) : (
          <Button type="button" onClick={onStructured}>
            Review the complete form
          </Button>
        )}
        <Button type="button" variant="outline" disabled={busy || !ready} onClick={() => void followups()}>
          Suggest follow-up questions
        </Button>
      </div>
      {suggestions ? (
        <div className="space-y-2 border-t pt-3 text-sm" aria-live="polite">
          <p>{suggestions.reason ?? "Suggested question groups to revisit:"}</p>
          {suggestions.stepIds.map((id) => (
            <Button key={id} type="button" size="sm" variant="outline" disabled={busy} onClick={() => void go(id)}>
              {GUIDED_STEPS.find((s) => s.id === id)!.title}
            </Button>
          ))}
          {!suggestions.stepIds.length ? (
            <p>No additional groups suggested. Review completeness before submitting.</p>
          ) : null}
          {suggestions.provider !== "rules" ? (
            <p className="text-xs">
              <AiSource {...suggestions} />
            </p>
          ) : (
            <p className="text-xs">Using the fixed question bank; no AI answer was used.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

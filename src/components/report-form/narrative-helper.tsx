"use client";

import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";
import { AlertTriangle, Loader2, Sparkles, WandSparkles } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { AiChain, AiSource } from "@/components/ai/ai-source";
import { actions } from "@/lib/api/actions";
import type { CaseFormValues } from "@/lib/domain/case-form";
import type { NarrativeDraft } from "@/server/workflow/ai-assist";
import type { AiStatus } from "@/server/ai/provider";
import { unsupportedDetails } from "@/lib/domain/narrative";
import { inputClass } from "./fields";
import { useServerChange, useSaveDraft } from "./form-context";

/**
 * Item 7 helper: turns rough notes (and what is already entered) into a short
 * factual narrative. The reporter edits it and decides whether to use it;
 * numbers and dates the AI added are flagged first.
 */
export function NarrativeHelper({ caseId, ai }: { caseId: string; ai: AiStatus }) {
  const { getValues } = useFormContext<CaseFormValues>();
  const saveDraft = useSaveDraft();
  const serverChange = useServerChange();
  const [verified, setVerified] = useState(false);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [useReport, setUseReport] = useState(true);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NarrativeDraft | null>(null);
  const [text, setText] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void actions.aiHistory(caseId).then((r) => {
      if (!active) return;
      setBusy(false);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (r.data.narrative) {
        setDraft(r.data.narrative);
        setText(r.data.narrative.narrative);
        setNotes(r.data.narrative.notes);
        setOpen(true);
      }
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  async function generate() {
    setBusy(true);
    setError(null);
    setDone(null);
    // The server reads the saved report, so pending edits are saved first.
    if (saveDraft && !(await saveDraft())) {
      setBusy(false);
      setError("Save the draft first (see the message at the bottom of the form).");
      return;
    }
    const result = await actions.draftNarrative(caseId, notes, useReport);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setVerified(false);
    setDraft(result.data);
    setText(result.data.narrative);
  }

  async function use(mode: "replace" | "append") {
    if (!draft || !verified || !serverChange) return;
    setBusy(true);
    setError(null);
    const r = await serverChange((lockVersion) =>
      actions.useNarrative(caseId, draft.draftId, { text, mode, lockVersion, verified }),
    );
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setDraft(null);
    setDone("Verified narrative saved in item 7.");
  }
  async function discard() {
    if (!draft) return;
    setBusy(true);
    const r = await actions.discardNarrative(caseId, draft.draftId);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else setDraft(null);
  }
  const unsupported = draft ? unsupportedDetails(text, [draft.notes, draft.report]) : [];

  if (!open)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-ai/40 text-ai"
          onClick={() => setOpen(true)}
          disabled={busy || !ai.available}
        >
          <WandSparkles aria-hidden /> Write item 7 from notes with AI
        </Button>
        {done ? <span className="text-[13px] text-success">{done}</span> : null}
        {!ai.available ? <span className="text-xs text-muted-foreground">{ai.reason}</span> : null}
      </div>
    );

  const current = getValues("reactionDescription").trim();
  return (
    <div className="space-y-3 rounded-lg border border-ai/25 bg-ai-soft/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <WandSparkles className="size-4 text-ai" aria-hidden /> Draft the narrative with AI
          </h3>
          <p className="text-[13px] text-muted-foreground">
            Jot down what happened in any order. The AI proposes an account in time order. Check the wording and every
            fact before using it.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          <AiChain ai={ai} />
        </p>
      </div>
      <label htmlFor="narrative-notes" className="text-[13px] font-medium">
        Rough notes
      </label>
      <textarea
        id="narrative-notes"
        rows={4}
        maxLength={4000}
        className={cn(inputClass, "h-auto py-1.5")}
        placeholder="e.g. started amox 500 TID 12 Oct for sinusitis; itchy rash both arms 14 Oct; stopped 15 Oct; cetirizine given; better by 17 Oct"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={useReport}
          onChange={(e) => setUseReport(e.target.checked)}
        />
        Also use what is already entered in the report (dates, medicines, outcome)
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void generate()} disabled={busy || !ai.available}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />} Draft narrative
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Close
        </Button>
      </div>
      {busy ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Writing… free services are tried first; this can take up to three minutes.
        </p>
      ) : null}
      {error ? (
        <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}

      {draft ? (
        <div className="space-y-2 border-t border-ai/20 pt-3">
          <p className="text-[13px]">
            <span className="font-medium">Draft, edit freely.</span> Written by{" "}
            <AiSource provider={draft.provider} model={draft.model} attempts={draft.attempts} />.
          </p>
          <details className="rounded border bg-background p-2 text-xs">
            <summary>Compare with source notes and saved report</summary>
            <div className="grid gap-3 pt-2 sm:grid-cols-2">
              <div>
                <strong>Source</strong>
                <pre className="whitespace-pre-wrap font-sans">
                  {[draft.notes, draft.report].filter(Boolean).join("\n\n")}
                </pre>
              </div>
              <div>
                <strong>Original AI draft</strong>
                <p className="whitespace-pre-wrap">{draft.narrative}</p>
              </div>
            </div>
          </details>
          <details className="rounded border bg-background p-2 text-xs">
            <summary>Changes to the current item 7</summary>
            <NarrativeChanges before={current} after={text} />
          </details>
          {text !== draft.narrative ? (
            <p className="text-xs">You have edited the AI draft. Both versions will be recorded when saved.</p>
          ) : null}
          <textarea
            rows={6}
            aria-label="AI-drafted narrative"
            className={cn(inputClass, "h-auto bg-background py-1.5")}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setVerified(false);
            }}
            maxLength={4000}
            disabled={busy}
          />
          {unsupported.length ? (
            <p className="flex gap-1.5 rounded-md border border-warning/30 bg-warning-soft px-2 py-1.5 text-[13px] text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Not found in your notes or the report: <strong>{unsupported.join(", ")}</strong>. Check these before
                using the text, and correct or remove them if they are wrong.
              </span>
            </p>
          ) : (
            <p className="text-xs text-success">
              No extra numbers were flagged. Please still verify dates, medicines and clinical statements.
            </p>
          )}
          {draft.needsChecking.length ? (
            <div className="text-[13px]">
              <p className="font-medium">The AI was unsure about:</p>
              <ul className="ml-5 list-disc">
                {draft.needsChecking.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {draft.leftOut.length ? (
            <p className="text-xs text-muted-foreground">Left out: {draft.leftOut.join("; ")}</p>
          ) : null}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} disabled={busy} />
            I checked the narrative, dates, doses and clinical statements against the source.
          </label>
          <div className="flex flex-wrap gap-2">
            {current ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void use("append")}
                  disabled={busy || !verified || !text.trim()}
                >
                  Add to the end of item 7
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void use("replace")}
                  disabled={busy || !verified || !text.trim()}
                >
                  Replace item 7
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => void use("replace")}
                disabled={busy || !verified || !text.trim()}
              >
                Put into item 7
              </Button>
            )}
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void discard()}>
              Discard draft
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Show changed wording together so dates, doses and omissions can be compared before applying. */
function NarrativeChanges({ before, after }: { before: string; after: string }) {
  const oldWords = before.split(/(\s+)/);
  const newWords = after.split(/(\s+)/);
  let start = 0;
  let end = 0;
  while (start < oldWords.length && start < newWords.length && oldWords[start] === newWords[start]) start++;
  while (
    end < oldWords.length - start &&
    end < newWords.length - start &&
    oldWords[oldWords.length - end - 1] === newWords[newWords.length - end - 1]
  )
    end++;
  const removed = oldWords.slice(start, oldWords.length - end).join("");
  const added = newWords.slice(start, newWords.length - end).join("");
  return (
    <p className="mt-2 whitespace-pre-wrap">
      {oldWords.slice(0, start).join("")}
      {removed ? <del className="bg-destructive/10 text-destructive">{removed}</del> : null}{" "}
      {added ? <ins className="bg-success/10 text-success">{added}</ins> : null}
      {end ? oldWords.slice(-end).join("") : ""}
    </p>
  );
}

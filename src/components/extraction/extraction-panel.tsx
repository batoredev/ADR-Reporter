"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, Loader2, ScanText, Sparkles, Upload } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { useSaveDraft } from "@/components/report-form/form-context";
import { inputClass } from "@/components/report-form/fields";
import { DATE_FIELDS, EXTRACTED_FIELD_LABELS, FILLABLE, type ExtractedField } from "@/lib/domain/extraction";
import {
  applyExtractionAction,
  runExtractionAction,
  uploadDocumentAction,
  type UploadedDocumentView,
} from "@/app/(app)/reports/extraction-actions";
import type { ExtractionView } from "@/server/workflow/extraction";
import type { AiStatus } from "@/server/ai/provider";

type Target = "SUSPECTED" | "CONCOMITANT" | "SKIP";
interface FieldChoice {
  use: boolean;
  value: string;
  confirmedUncertain: boolean;
}

const FIELD_ORDER = Object.keys(EXTRACTED_FIELD_LABELS) as ExtractedField[];

function initialChoices(run: ExtractionView) {
  return run.medications.map((m) => ({
    target: "SKIP" as Target,
    fields: Object.fromEntries(
      FIELD_ORDER.map((f) => {
        const p = m.fields[f];
        return [
          f,
          {
            use: Boolean(p?.value) && !p?.uncertain && f !== "duration",
            value: p?.value ?? "",
            confirmedUncertain: false,
          },
        ];
      }),
    ) as Record<ExtractedField, FieldChoice>,
  }));
}

export function ExtractionPanel({
  caseId,
  ai,
  documents: initialDocuments,
}: {
  caseId: string;
  ai: AiStatus;
  documents: UploadedDocumentView[];
}) {
  const router = useRouter();
  const saveDraft = useSaveDraft();
  const fileRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState(initialDocuments);
  const [busy, setBusy] = useState<"upload" | "extract" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [run, setRun] = useState<ExtractionView | null>(null);
  const [choices, setChoices] = useState<ReturnType<typeof initialChoices>>([]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a JPG, PNG or PDF file first.");
      return;
    }
    setBusy("upload");
    setError(null);
    setMessage(null);
    const data = new FormData();
    data.set("file", file);
    const result = await uploadDocumentAction(caseId, data);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDocuments((docs) => [result.data, ...docs]);
    if (fileRef.current) fileRef.current.value = "";
    setMessage(`${result.data.name} uploaded.${ai.available ? " You can now extract the medicines." : ""}`);
  }

  async function extract(documentId: string) {
    setBusy("extract");
    setError(null);
    setMessage(null);
    setRun(null);
    const result = await runExtractionAction(caseId, documentId);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRun(result.data);
    setChoices(initialChoices(result.data));
  }

  function update(index: number, field: ExtractedField, patch: Partial<FieldChoice>) {
    setChoices((all) =>
      all.map((m, i) =>
        i === index ? { ...m, fields: { ...m.fields, [field]: { ...m.fields[field], ...patch } } } : m,
      ),
    );
  }

  async function apply() {
    if (!run) return;
    setBusy("apply");
    setError(null);
    if (saveDraft && !(await saveDraft())) {
      setBusy(null);
      setError("Save the draft first (see the message at the bottom of the form).");
      return;
    }
    const payload = {
      medications: run.medications.map((m, i) => ({
        index: m.index,
        target: choices[i].target,
        fields: FIELD_ORDER.filter((f) => m.fields[f]).map((f) => ({
          itemId: m.fields[f]!.itemId,
          use:
            choices[i].target !== "SKIP" &&
            FILLABLE[choices[i].target as "SUSPECTED" | "CONCOMITANT"].includes(f) &&
            choices[i].fields[f].use,
          value: choices[i].fields[f].value,
          confirmedUncertain: choices[i].fields[f].confirmedUncertain,
        })),
      })),
    };
    const result = await applyExtractionAction(caseId, run.runId, payload);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRun(null);
    setMessage(
      result.data.added
        ? `${result.data.added} medicine${result.data.added === 1 ? "" : "s"} added below. Each value is marked as coming from the document.`
        : "Nothing was added.",
    );
    router.refresh();
  }

  const doc = run ? documents.find((d) => d.id === run.documentId) : null;
  const chosen = choices.filter((c) => c.target !== "SKIP").length;

  return (
    <div className="space-y-3 rounded-lg border border-ai/25 bg-ai-soft/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <ScanText className="size-4 text-ai" aria-hidden /> Extract from a prescription (optional)
          </h3>
          <p className="text-[13px] text-muted-foreground">
            Upload a photo or PDF of a fictional prescription. Suggestions are only added after you check each value.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {ai.available ? (
            <>
              <Sparkles className="mr-1 inline size-3 text-ai" aria-hidden />
              {ai.provider === "fixture"
                ? "Test mode: saved example data, no AI service"
                : `AI: ${ai.provider} / ${ai.model}`}
            </>
          ) : (
            <>AI extraction unavailable: enter details manually. ({ai.reason})</>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          aria-label="Prescription file"
          className="text-sm file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-sm"
        />
        <Button type="button" variant="outline" size="sm" onClick={() => void upload()} disabled={busy !== null}>
          {busy === "upload" ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />} Upload
        </Button>
        <span className="text-xs text-muted-foreground">JPG, PNG or PDF, up to 10 MB. Fictional documents only.</span>
      </div>

      {documents.length ? (
        <ul className="space-y-1.5">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5 text-sm"
            >
              <a
                href={`/api/cases/${caseId}/documents/${d.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                <FileText className="size-3.5" aria-hidden /> {d.name}
              </a>
              <Button
                type="button"
                size="sm"
                onClick={() => void extract(d.id)}
                disabled={!ai.available || busy !== null}
              >
                {busy === "extract" ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}{" "}
                Extract medicines
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {busy === "extract" ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Reading the document…
        </p>
      ) : null}
      {error ? (
        <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-success" role="status">
          {message}
        </p>
      ) : null}

      {run ? (
        <div className="space-y-3 border-t border-ai/20 pt-3">
          <p className="text-[13px]">
            <span className="font-medium">Check every suggestion against the document.</span> Suggested by{" "}
            {run.provider === "fixture" ? "saved test data (not AI)" : `${run.provider} / ${run.model}`}. Choose where
            each medicine goes; the AI never decides which medicine is suspected.
            {run.notes ? <span className="block text-muted-foreground">Note: {run.notes}</span> : null}
          </p>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            {doc ? (
              <div className="overflow-hidden rounded-md border bg-background xl:sticky xl:top-4 xl:self-start">
                {doc.mimeType === "application/pdf" ? (
                  <iframe title={doc.name} src={`/api/cases/${caseId}/documents/${doc.id}`} className="h-96 w-full" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/cases/${caseId}/documents/${doc.id}`}
                    alt={`Uploaded document ${doc.name}`}
                    className="w-full"
                  />
                )}
              </div>
            ) : null}
            <div className="space-y-3">
              {run.medications.length === 0 ? (
                <p className="text-sm text-muted-foreground">No medicines were found on this document.</p>
              ) : null}
              {run.medications.map((m, i) => {
                const choice = choices[i];
                const allowed = choice.target === "SKIP" ? [] : FILLABLE[choice.target];
                return (
                  <fieldset key={m.index} className="space-y-2 rounded-md border bg-background p-3">
                    <legend className="px-1 text-sm font-semibold">
                      Medicine {i + 1}: {m.fields.name?.value ?? "name not read"}
                    </legend>
                    <div
                      className="flex flex-wrap gap-3 text-sm"
                      role="radiogroup"
                      aria-label={`Where should medicine ${i + 1} go?`}
                    >
                      {(
                        [
                          ["SUSPECTED", "Add as suspected medicine"],
                          ["CONCOMITANT", "Add as concomitant product"],
                          ["SKIP", "Do not add"],
                        ] as [Target, string][]
                      ).map(([value, label]) => (
                        <label key={value} className="flex items-center gap-1.5">
                          <input
                            type="radio"
                            name={`target-${m.index}`}
                            className="size-4 accent-primary"
                            checked={choice.target === value}
                            onChange={() =>
                              setChoices((all) => all.map((c, j) => (j === i ? { ...c, target: value } : c)))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="divide-y rounded-md border">
                      {FIELD_ORDER.map((f) => {
                        const p = m.fields[f];
                        if (!p) return null;
                        const fc = choice.fields[f];
                        const usable = allowed.includes(f) && Boolean(p.value || fc.value);
                        return (
                          <div
                            key={f}
                            className={cn(
                              "grid gap-1 px-2 py-1.5 sm:grid-cols-[8.5rem_1fr]",
                              !allowed.includes(f) && "opacity-60",
                            )}
                          >
                            <label className="flex items-center gap-1.5 text-[13px]">
                              <input
                                type="checkbox"
                                className="size-4 accent-primary"
                                checked={usable && fc.use}
                                disabled={!usable}
                                onChange={(e) => update(i, f, { use: e.target.checked })}
                                aria-label={`Use ${EXTRACTED_FIELD_LABELS[f]}`}
                              />
                              {EXTRACTED_FIELD_LABELS[f]}
                            </label>
                            <div className="min-w-0 space-y-1">
                              {p.value || fc.value ? (
                                <input
                                  className={inputClass}
                                  value={fc.value}
                                  aria-label={`${EXTRACTED_FIELD_LABELS[f]} value`}
                                  placeholder={DATE_FIELDS.includes(f) ? "YYYY-MM-DD" : undefined}
                                  onChange={(e) => update(i, f, { value: e.target.value })}
                                  disabled={!allowed.includes(f)}
                                />
                              ) : (
                                <p className="text-[13px] text-muted-foreground">Not on the document</p>
                              )}
                              {p.sourceText ? (
                                <p className="text-xs text-muted-foreground">Read as: &ldquo;{p.sourceText}&rdquo;</p>
                              ) : null}
                              {p.uncertain ? (
                                <label className="flex items-center gap-1.5 text-xs text-warning">
                                  <input
                                    type="checkbox"
                                    className="size-3.5 accent-primary"
                                    checked={fc.confirmedUncertain}
                                    onChange={(e) =>
                                      update(i, f, {
                                        confirmedUncertain: e.target.checked,
                                        use: e.target.checked || fc.use,
                                      })
                                    }
                                  />
                                  Unclear on the document. I have checked this value myself.
                                </label>
                              ) : null}
                              {f === "duration" && p.value ? (
                                <p className="text-xs text-muted-foreground">Not used to work out any dates.</p>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void apply()} disabled={busy !== null || chosen === 0}>
                  {busy === "apply" ? <Loader2 className="animate-spin" aria-hidden /> : null} Add to report
                </Button>
                <Button type="button" variant="ghost" onClick={() => setRun(null)} disabled={busy !== null}>
                  Discard suggestions
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

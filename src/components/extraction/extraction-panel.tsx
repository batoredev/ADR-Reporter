"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, FileText, Loader2, ScanText, FilePenLine, Upload } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { AiChain } from "@/components/ai/ai-source";
import { useServerChange, useSaveDraft } from "@/components/report-form/form-context";
import { inputClass } from "@/components/report-form/fields";
import {
  DATE_FIELDS,
  DOCUMENT_TYPE_LABELS,
  EXTRACTED_FIELD_LABELS,
  FILLABLE,
  INVESTIGATION_FIELD_LABELS,
  SINGLE_FIELDS,
  type ExtractedField,
  type InvestigationField,
  type SingleField,
} from "@/lib/domain/extraction";
import { AGE_UNIT_LABELS, GENDER_LABELS } from "@/lib/domain/labels";
import { formatForDisplay } from "@/lib/domain/partial-date";
import { FileLink, ProtectedFrame, useFileUrl } from "@/components/data/protected-file";
import { actions, type UploadedDocumentView } from "@/lib/api/actions";
import { toolError } from "@/lib/api/tool-error";
import { files } from "@/lib/routes";
import type { ExtractionView, ProposedValue } from "@/server/workflow/extraction";
import type { AiStatus } from "@/server/ai/provider";

type Target = "SUSPECTED" | "CONCOMITANT" | "SKIP";
interface FieldChoice {
  use: boolean;
  value: string;
  confirmedUncertain: boolean;
  approximate: boolean;
}
interface SingleChoice extends FieldChoice {
  mode: "replace" | "append";
}

const MED_FIELDS = Object.keys(EXTRACTED_FIELD_LABELS) as ExtractedField[];
const INV_FIELDS = Object.keys(INVESTIGATION_FIELD_LABELS) as InvestigationField[];

const ENUM_OPTIONS: Partial<Record<string, Record<string, string>>> = {
  ageUnit: AGE_UNIT_LABELS,
  gender: GENDER_LABELS,
};

function shown(field: SingleField, value: string | null): string {
  if (!value) return "";
  const kind = SINGLE_FIELDS[field].kind;
  if (kind === "date") return formatForDisplay(value);
  return ENUM_OPTIONS[kind]?.[value] ?? value;
}

const fresh = (p: ProposedValue | undefined, extra = true): FieldChoice => ({
  use: Boolean(p?.value) && !p?.uncertain && extra,
  value: p?.value ?? "",
  confirmedUncertain: false,
  approximate: p?.approximate ?? false,
});

function initialChoices(run: ExtractionView) {
  return {
    singles: Object.fromEntries(
      run.singles.map((s) => {
        const long = SINGLE_FIELDS[s.field].kind === "long";
        // Never pre-tick a value that would change what the reporter already entered.
        return [
          s.proposal.itemId,
          { ...fresh(s.proposal, !s.current), mode: long && s.current ? "append" : "replace" },
        ];
      }),
    ) as Record<string, SingleChoice>,
    investigations: run.investigations.map((inv) => ({
      add: Boolean(inv.fields.testName?.value || inv.fields.result?.value),
      fields: Object.fromEntries(INV_FIELDS.map((f) => [f, fresh(inv.fields[f])])) as Record<
        InvestigationField,
        FieldChoice
      >,
    })),
    medications: run.medications.map((m) => ({
      target: "SKIP" as Target,
      fields: Object.fromEntries(MED_FIELDS.map((f) => [f, fresh(m.fields[f], f !== "duration")])) as Record<
        ExtractedField,
        FieldChoice
      >,
    })),
  };
}

type Choices = ReturnType<typeof initialChoices>;

export function ExtractionPanel({
  caseId,
  ai,
  documents: initialDocuments,
}: {
  caseId: string;
  ai: AiStatus;
  documents: UploadedDocumentView[];
}) {
  const saveDraft = useSaveDraft();
  const serverChange = useServerChange();
  const fileRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState(initialDocuments);
  const [busy, setBusy] = useState<"upload" | "extract" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [run, setRun] = useState<ExtractionView | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [verifiedAgainstSource, setVerifiedAgainstSource] = useState(false);
  const [confirmedPatientMatch, setConfirmedPatientMatch] = useState(false);
  function updateChoices(update: Parameters<typeof setChoices>[0]) {
    setVerifiedAgainstSource(false);
    setChoices(update);
  }

  const [pending, setPending] = useState<{ id: string; document: { originalName: string } }[]>([]);
  useEffect(() => {
    let active = true;
    void actions.pendingExtractions(caseId).then((r) => {
      if (active && r.ok) setPending(r.data);
    });
    return () => {
      active = false;
    };
  }, [caseId]);
  async function resume(runId: string) {
    setBusy("extract");
    setError(null);
    if (saveDraft && !(await saveDraft())) {
      setBusy(null);
      setError("Save the report first.");
      return;
    }
    const r = await actions.extraction(caseId, runId);
    if (r.ok) {
      setVerifiedAgainstSource(false);
      setConfirmedPatientMatch(false);
      setRun(r.data);
      setChoices(initialChoices(r.data));
    } else setError(r.error);
    setBusy(null);
  }
  async function discard() {
    if (!run) return;
    setBusy("apply");
    const r = await actions.discardExtraction(caseId, run.runId);
    if (!r.ok) setError(r.error);
    else {
      setPending((p) => p.filter((x) => x.id !== run.runId));
      setRun(null);
    }
    setBusy(null);
  }

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
    const result = await actions.uploadDocument(caseId, data);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDocuments((docs) => [result.data, ...docs]);
    if (fileRef.current) fileRef.current.value = "";
    setMessage(`${result.data.name} uploaded.${ai.available ? " You can now read the document." : ""}`);
  }

  async function extract(documentId: string) {
    setBusy("extract");
    setError(null);
    setMessage(null);
    setRun(null);
    if (saveDraft && !(await saveDraft())) {
      setBusy(null);
      setError("Save the report first.");
      return;
    }
    const result = await actions.runExtraction(caseId, documentId);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setVerifiedAgainstSource(false);
    setConfirmedPatientMatch(false);
    setRun(result.data);
    setChoices(initialChoices(result.data));
  }

  const setSingle = (itemId: string, patch: Partial<SingleChoice>) =>
    updateChoices(
      (c) =>
        c && {
          ...c,
          singles: {
            ...c.singles,
            [itemId]: {
              ...c.singles[itemId],
              ...patch,
              ...(patch.value !== undefined ? { confirmedUncertain: false } : {}),
            },
          },
        },
    );
  const setInvestigation = (
    i: number,
    patch: { add?: boolean; field?: InvestigationField; choice?: Partial<FieldChoice> },
  ) =>
    updateChoices(
      (c) =>
        c && {
          ...c,
          investigations: c.investigations.map((inv, j) =>
            j !== i
              ? inv
              : {
                  add: patch.add ?? inv.add,
                  fields: patch.field
                    ? {
                        ...inv.fields,
                        [patch.field]: {
                          ...inv.fields[patch.field],
                          ...patch.choice,
                          ...(patch.choice?.value !== undefined ? { confirmedUncertain: false } : {}),
                        },
                      }
                    : inv.fields,
                },
          ),
        },
    );
  const setMedication = (
    i: number,
    patch: { target?: Target; field?: ExtractedField; choice?: Partial<FieldChoice> },
  ) =>
    updateChoices(
      (c) =>
        c && {
          ...c,
          medications: c.medications.map((m, j) =>
            j !== i
              ? m
              : {
                  target: patch.target ?? m.target,
                  fields: patch.field
                    ? {
                        ...m.fields,
                        [patch.field]: {
                          ...m.fields[patch.field],
                          ...patch.choice,
                          ...(patch.choice?.value !== undefined ? { confirmedUncertain: false } : {}),
                        },
                      }
                    : m.fields,
                },
          ),
        },
    );

  async function apply() {
    if (!run || !choices || !serverChange) return;
    setBusy("apply");
    setError(null);
    if (saveDraft && !(await saveDraft())) {
      setBusy(null);
      setError("Save the draft first (see the message at the bottom of the form).");
      return;
    }
    const payload = {
      lockVersion: run.lockVersion,
      verifiedAgainstSource,
      confirmedPatientMatch,
      singles: run.singles.map((s) => {
        const c = choices.singles[s.proposal.itemId];
        return { itemId: s.proposal.itemId, ...c };
      }),
      investigations: run.investigations.map((inv, i) => ({
        index: inv.index,
        add: choices.investigations[i].add,
        fields: INV_FIELDS.filter((f) => inv.fields[f]).map((f) => ({
          itemId: inv.fields[f].itemId,
          ...choices.investigations[i].fields[f],
          use: choices.investigations[i].add && choices.investigations[i].fields[f].use,
        })),
      })),
      medications: run.medications.map((m, i) => ({
        index: m.index,
        target: choices.medications[i].target,
        fields: MED_FIELDS.filter((f) => m.fields[f]).map((f) => ({
          itemId: m.fields[f]!.itemId,
          ...choices.medications[i].fields[f],
          use:
            choices.medications[i].target !== "SKIP" &&
            FILLABLE[choices.medications[i].target as "SUSPECTED" | "CONCOMITANT"].includes(f) &&
            choices.medications[i].fields[f].use,
        })),
      })),
    };
    const result = await serverChange(() => actions.applyExtraction(caseId, run.runId, payload));
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRun(null);
    const { filled, investigationsAdded, added } = result.data;
    const parts = [
      filled && `${filled} detail${filled === 1 ? "" : "s"} filled in`,
      investigationsAdded && `${investigationsAdded} test${investigationsAdded === 1 ? "" : "s"} added`,
      added && `${added} medicine${added === 1 ? "" : "s"} added`,
    ].filter(Boolean);
    setMessage(
      parts.length ? `${parts.join(", ")}. Each value is marked as coming from the document.` : "Nothing was added.",
    );
  }

  const doc = run ? documents.find((d) => d.id === run.documentId) : null;
  const chosen = choices
    ? Object.values(choices.singles).filter((s) => s.use).length +
      choices.investigations.filter((i) => i.add && Object.values(i.fields).some((f) => f.use)).length +
      choices.medications.filter((m) => m.target !== "SKIP").length
    : 0;

  return (
    <div className="space-y-3 rounded-lg border border-ai/25 bg-ai-soft/60 p-3 sm:p-4">
      {pending.length ? (
        <div className="space-y-1 text-sm">
          <p>Saved suggestions awaiting your review:</p>
          {pending.map((p) => (
            <Button
              key={p.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => void resume(p.id)}
            >
              Review saved suggestions: {p.document.originalName}
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <ScanText className="size-4 text-ai" aria-hidden /> Read a document
          </h3>
          <p className="text-[13px] text-muted-foreground">
            Upload a photo or PDF of a fictional prescription, lab report, discharge summary or clinical note. Review
            the suggested details before adding them to your report.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          <AiChain ai={ai} />
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,application/pdf"
          aria-label="Document file"
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
              <FileLink path={files.document(caseId, d.id)}>
                <FileText className="size-3.5" aria-hidden /> {d.name}
              </FileLink>
              <Button
                type="button"
                size="sm"
                onClick={() => void extract(d.id)}
                disabled={!ai.available || busy !== null}
              >
                {busy === "extract" ? <Loader2 className="animate-spin" aria-hidden /> : <FilePenLine aria-hidden />}{" "}
                Read document
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {busy === "extract" ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground" aria-live="polite">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Reading the document. This may take a few minutes.
        </p>
      ) : null}
      {error ? (
        <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {toolError(error)}
        </p>
      ) : null}
      {message ? (
        <p className="text-sm text-success" role="status">
          {message}
        </p>
      ) : null}

      {run && choices ? (
        <div className="space-y-3 border-t border-ai/20 pt-3">
          <p className="text-[13px]">
            <span className="font-medium">
              {DOCUMENT_TYPE_LABELS[run.documentType]}. Check every suggestion against the document.
            </span>{" "}
            Choose which medicines are suspected and which are concomitant.
            {run.notes ? <span className="block text-muted-foreground">Note: {run.notes}</span> : null}
          </p>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            {doc ? (
              <div className="overflow-hidden rounded-md border bg-background xl:sticky xl:top-4 xl:self-start">
                {doc.mimeType === "application/pdf" ? (
                  <ProtectedFrame path={files.document(caseId, doc.id)} title={doc.name} className="h-96 w-full" />
                ) : (
                  <DocumentImage path={files.document(caseId, doc.id)} name={doc.name} />
                )}
              </div>
            ) : null}
            <div className="space-y-3">
              {run.singles.length ? (
                <fieldset className="space-y-2 rounded-md border bg-background p-3">
                  <legend className="px-1 text-sm font-semibold">Patient, reaction and history</legend>
                  <div className="divide-y rounded-md border">
                    {run.singles.map((s) => {
                      const c = choices.singles[s.proposal.itemId];
                      const kind = SINGLE_FIELDS[s.field].kind;
                      const options = ENUM_OPTIONS[kind];
                      return (
                        <ProposalRow
                          key={s.proposal.itemId}
                          isDate={kind === "date"}
                          label={SINGLE_FIELDS[s.field].label}
                          proposal={s.proposal}
                          choice={c}
                          onChange={(patch) => setSingle(s.proposal.itemId, patch)}
                          input={
                            options ? (
                              <select
                                className={inputClass}
                                value={c.value}
                                aria-label={`${SINGLE_FIELDS[s.field].label} value`}
                                onChange={(e) => setSingle(s.proposal.itemId, { value: e.target.value })}
                              >
                                {!(c.value in options) ? <option value={c.value}>{c.value}</option> : null}
                                {Object.entries(options).map(([v, l]) => (
                                  <option key={v} value={v}>
                                    {l}
                                  </option>
                                ))}
                              </select>
                            ) : kind === "long" ? (
                              <textarea
                                rows={3}
                                className={cn(inputClass, "h-auto py-1.5")}
                                value={c.value}
                                aria-label={`${SINGLE_FIELDS[s.field].label} value`}
                                onChange={(e) => setSingle(s.proposal.itemId, { value: e.target.value })}
                              />
                            ) : (
                              <input
                                className={inputClass}
                                value={c.value}
                                aria-label={`${SINGLE_FIELDS[s.field].label} value`}
                                placeholder={kind === "date" ? "YYYY-MM-DD" : undefined}
                                onChange={(e) => setSingle(s.proposal.itemId, { value: e.target.value })}
                              />
                            )
                          }
                        >
                          {s.current ? (
                            <div className="space-y-1 text-xs text-warning">
                              <p>
                                The report already has: &ldquo;{shown(s.field, s.current).slice(0, 160)}
                                {s.current.length > 160 ? "…" : ""}&rdquo;
                              </p>
                              {kind === "long" ? (
                                <div className="flex gap-3 text-foreground">
                                  {(["append", "replace"] as const).map((mode) => (
                                    <label key={mode} className="flex items-center gap-1">
                                      <input
                                        type="radio"
                                        name={`mode-${s.proposal.itemId}`}
                                        className="size-3.5 accent-primary"
                                        checked={c.mode === mode}
                                        onChange={() => setSingle(s.proposal.itemId, { mode })}
                                      />
                                      {mode === "append" ? "Add to the end" : "Replace it"}
                                    </label>
                                  ))}
                                </div>
                              ) : (
                                <p>Ticking this replaces it.</p>
                              )}
                            </div>
                          ) : null}
                        </ProposalRow>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              {run.investigations.map((inv, i) => {
                const c = choices.investigations[i];
                return (
                  <fieldset key={`inv-${inv.index}`} className="space-y-2 rounded-md border bg-background p-3">
                    <legend className="px-1 text-sm font-semibold">
                      Test {i + 1}: {inv.fields.testName?.value ?? "name not read"}
                    </legend>
                    <label className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={c.add}
                        onChange={(e) => setInvestigation(i, { add: e.target.checked })}
                      />
                      Add this test to item 12 (investigations)
                    </label>
                    <div className={cn("divide-y rounded-md border", !c.add && "opacity-60")}>
                      {INV_FIELDS.map((f) => (
                        <ProposalRow
                          key={f}
                          isDate={f === "date"}
                          label={INVESTIGATION_FIELD_LABELS[f]}
                          proposal={inv.fields[f]}
                          choice={c.fields[f]}
                          disabled={!c.add}
                          onChange={(patch) => setInvestigation(i, { field: f, choice: patch })}
                          input={
                            <input
                              className={inputClass}
                              value={c.fields[f].value}
                              aria-label={`Test ${i + 1} ${INVESTIGATION_FIELD_LABELS[f]} value`}
                              placeholder={f === "date" ? "YYYY-MM-DD" : undefined}
                              disabled={!c.add}
                              onChange={(e) => setInvestigation(i, { field: f, choice: { value: e.target.value } })}
                            />
                          }
                        />
                      ))}
                    </div>
                  </fieldset>
                );
              })}

              {run.medications.map((m, i) => {
                const choice = choices.medications[i];
                const allowed = choice.target === "SKIP" ? [] : FILLABLE[choice.target];
                return (
                  <fieldset key={`med-${m.index}`} className="space-y-2 rounded-md border bg-background p-3">
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
                            onChange={() => setMedication(i, { target: value })}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="divide-y rounded-md border">
                      {MED_FIELDS.map((f) => {
                        const p = m.fields[f];
                        if (!p) return null;
                        const fc = choice.fields[f];
                        return (
                          <ProposalRow
                            key={f}
                            isDate={DATE_FIELDS.includes(f)}
                            label={EXTRACTED_FIELD_LABELS[f]}
                            proposal={p}
                            choice={fc}
                            disabled={!allowed.includes(f)}
                            onChange={(patch) => setMedication(i, { field: f, choice: patch })}
                            input={
                              <input
                                className={inputClass}
                                value={fc.value}
                                aria-label={`${EXTRACTED_FIELD_LABELS[f]} value`}
                                placeholder={DATE_FIELDS.includes(f) ? "YYYY-MM-DD" : undefined}
                                onChange={(e) => setMedication(i, { field: f, choice: { value: e.target.value } })}
                                disabled={!allowed.includes(f)}
                              />
                            }
                          >
                            {f === "duration" && p.value ? (
                              <p className="text-xs text-muted-foreground">Not used to work out any dates.</p>
                            ) : null}
                          </ProposalRow>
                        );
                      })}
                    </div>
                  </fieldset>
                );
              })}

              {!run.singles.length && !run.investigations.length && !run.medications.length ? (
                <p className="text-sm text-muted-foreground">Nothing usable was found on this document.</p>
              ) : null}

              {run.readability !== "CLEAR" ? (
                <p className="rounded border border-warning/30 p-2 text-sm text-warning">
                  Parts of this document may be difficult to read. Check every selected value against the original.
                </p>
              ) : null}
              {run.patientMatch === "DIFFERENT" ? (
                <div className="rounded border border-warning/30 p-3 text-sm">
                  <p className="font-medium text-warning">
                    Different patient initials: report {run.reportInitials}, document {run.documentInitials}.
                  </p>
                  <label className="mt-2 flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={confirmedPatientMatch}
                      onChange={(e) => setConfirmedPatientMatch(e.target.checked)}
                    />
                    I verified that this document belongs to this report despite the different initials.
                  </label>
                </div>
              ) : null}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={verifiedAgainstSource}
                  onChange={(e) => setVerifiedAgainstSource(e.target.checked)}
                />
                I checked the selected values, dates, doses and units against the source document.
              </label>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void resume(run.runId)}>
                  Reload saved suggestions
                </Button>
                <Button
                  type="button"
                  onClick={() => void apply()}
                  disabled={
                    busy !== null ||
                    chosen === 0 ||
                    !verifiedAgainstSource ||
                    (run.patientMatch === "DIFFERENT" && !confirmedPatientMatch)
                  }
                >
                  {busy === "apply" ? <Loader2 className="animate-spin" aria-hidden /> : null} Add to report
                </Button>
                <Button type="button" variant="ghost" onClick={() => void discard()} disabled={busy !== null}>
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

/** One proposed value: tick to use, the editable value, what was read, and the unclear-reading check. */
function ProposalRow({
  label,
  proposal,
  choice,
  disabled = false,
  isDate = false,
  input,
  onChange,
  children,
}: {
  label: string;
  proposal: ProposedValue;
  choice: FieldChoice;
  disabled?: boolean;
  isDate?: boolean;
  input: ReactNode;
  onChange: (patch: Partial<FieldChoice>) => void;
  children?: ReactNode;
}) {
  const usable = !disabled && Boolean(proposal.value || choice.value);
  return (
    <div className={cn("grid gap-1 px-2 py-1.5 sm:grid-cols-[9.5rem_1fr]", disabled && "opacity-60")}>
      <label className="flex items-center gap-1.5 text-[13px]">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={usable && choice.use}
          disabled={!usable}
          onChange={(e) => onChange({ use: e.target.checked })}
          aria-label={`Use ${label}`}
        />
        {label}
      </label>
      <div className="min-w-0 space-y-1">
        {proposal.value || choice.value ? (
          input
        ) : (
          <p className="text-[13px] text-muted-foreground">Not on the document</p>
        )}
        {proposal.sourceText ? (
          <p className="text-xs text-muted-foreground">Read as: &ldquo;{proposal.sourceText}&rdquo;</p>
        ) : null}
        {proposal.sourcePage ? (
          <p className="text-xs text-muted-foreground">Source page {proposal.sourcePage}</p>
        ) : null}
        {proposal.warnings?.length ? (
          <ul className="list-disc pl-4 text-xs text-warning">
            {proposal.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        ) : null}
        {isDate && choice.value ? (
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={choice.approximate}
              disabled={disabled}
              onChange={(e) => onChange({ approximate: e.target.checked })}
            />
            Approximate date
          </label>
        ) : null}
        {proposal.uncertain ? (
          <label className="flex items-center gap-1.5 text-xs text-warning">
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={choice.confirmedUncertain}
              disabled={disabled}
              onChange={(e) => onChange({ confirmedUncertain: e.target.checked, use: e.target.checked || choice.use })}
            />
            Unclear on the document. I have checked this value myself.
          </label>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function DocumentImage({ path, name }: { path: string; name: string }) {
  const { url, failed } = useFileUrl(path);
  if (failed) return <p className="p-4 text-sm text-destructive">The document could not be loaded.</p>;
  if (!url) return <div className="h-96 animate-pulse bg-secondary" aria-label="Loading document" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={`Uploaded document ${name}`} className="w-full" />;
}

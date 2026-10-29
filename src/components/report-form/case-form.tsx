"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FormProvider, useFieldArray, useForm, useWatch, type FieldPath } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  FileText,
  Loader2,
  Plus,
  Save,
  Send,
  Siren,
  Trash2,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  caseFormSchema,
  emptyConcomitantProduct,
  emptyInvestigation,
  emptySuspectedMedicine,
  FREQUENCY_SUGGESTIONS,
  ROUTE_SUGGESTIONS,
  type CaseFormValues,
} from "@/lib/domain/case-form";
import { assessCompleteness, type ReporterProfile } from "@/lib/domain/completeness";
import {
  ACTION_TAKEN_LABELS,
  AGE_UNIT_LABELS,
  GENDER_LABELS,
  HISTORY_FLAG_LABELS,
  OUTCOME_LABELS,
  RECHALLENGE_LABELS,
  SERIOUS_ANSWER_LABELS,
  SERIOUSNESS_CRITERION_LABELS,
} from "@/lib/domain/labels";
import { isPotentiallySerious } from "@/lib/domain/seriousness";
import { actions } from "@/lib/api/actions";
import { openFile } from "@/lib/api/client";
import { refreshData } from "@/lib/api/use-api";
import { files, pages } from "@/lib/routes";
import type { AiStatus } from "@/server/ai/provider";
import { AiCheckPanel } from "./ai-check-panel";
import {
  CheckboxGroup,
  fieldId,
  inputClass,
  PartialDateField,
  RadioField,
  SelectField,
  TextField,
  type FormPath,
  type IssueView,
} from "./fields";
import { SaveDraftContext } from "./form-context";
import { NarrativeHelper } from "./narrative-helper";

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

type SaveState =
  { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string };

export interface CaseFormProps {
  caseId: string;
  caseNumber: string;
  initialValues: CaseFormValues;
  lockVersion: number;
  reporter: ReporterProfile;
  issuesByPath: Record<string, IssueView[]>;
  hasOpenEscalation: boolean;
  ai: AiStatus;
  /** Rendered at the top of section C (document extraction). */
  extractionSlot?: ReactNode;
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 rounded-lg border bg-card">
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {title}
        </h2>
        {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-5 px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

export function CaseForm({
  caseId,
  caseNumber,
  initialValues,
  lockVersion,
  reporter,
  issuesByPath,
  hasOpenEscalation,
  ai,
  extractionSlot,
}: CaseFormProps) {
  const router = useRouter();
  const form = useForm<CaseFormValues>({
    defaultValues: initialValues,
    resolver: zodResolver(caseFormSchema),
    mode: "onBlur",
  });
  const { control, getValues, setValue, trigger } = form;
  const suspected = useFieldArray({ control, name: "suspectedMedicines", keyName: "key" });
  const concomitant = useFieldArray({ control, name: "concomitantProducts", keyName: "key" });
  const investigations = useFieldArray({ control, name: "investigations", keyName: "key" });

  const values = useWatch({ control }) as CaseFormValues;
  const lockRef = useRef(lockVersion);
  const savedJson = useRef(JSON.stringify(initialValues));
  // Mirrors savedJson for rendering; the ref serves the async save and unload checks.
  const [savedText, setSavedText] = useState(() => JSON.stringify(initialValues));
  const inFlight = useRef<Promise<boolean> | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateNote, setEscalateNote] = useState("");
  const [escalateError, setEscalateError] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(hasOpenEscalation);
  const [navigating, setNavigating] = useState(false);

  const json = JSON.stringify(values);
  const dirty = json !== savedText;

  const save = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) await inFlight.current;
    const snapshot = getValues();
    const text = JSON.stringify(snapshot);
    if (text === savedJson.current) return true;
    if (!(await trigger())) {
      setSaveState({ kind: "error", message: "Some fields need fixing before the draft can be saved." });
      return false;
    }
    const run = (async () => {
      setSaveState({ kind: "saving" });
      const result = await actions.saveDraft(caseId, lockRef.current, snapshot);
      if (!result.ok) {
        setSaveState({ kind: "error", message: result.error });
        return false;
      }
      lockRef.current = result.data.lockVersion;
      const { rowIds } = result.data;
      rowIds.suspected.forEach((id, i) => setValue(`suspectedMedicines.${i}.id`, id));
      rowIds.concomitant.forEach((id, i) => setValue(`concomitantProducts.${i}.id`, id));
      rowIds.investigations.forEach((id, i) => setValue(`investigations.${i}.id`, id));
      savedJson.current = JSON.stringify({
        ...snapshot,
        suspectedMedicines: snapshot.suspectedMedicines.map((r, i) => ({ ...r, id: rowIds.suspected[i] })),
        concomitantProducts: snapshot.concomitantProducts.map((r, i) => ({ ...r, id: rowIds.concomitant[i] })),
        investigations: snapshot.investigations.map((r, i) => ({ ...r, id: rowIds.investigations[i] })),
      });
      setSavedText(savedJson.current);
      setSaveState({ kind: "saved", at: result.data.savedAt });
      return true;
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, [caseId, getValues, setValue, trigger]);

  // Autosave 1.5 s after the last change.
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => void save(), 1500);
    return () => clearTimeout(timer);
  }, [json, dirty, save]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (JSON.stringify(getValues()) !== savedJson.current || inFlight.current) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [getValues]);

  const completeness = useMemo(() => assessCompleteness(values, reporter), [values, reporter]);
  const serious = isPotentiallySerious(values.seriousAnswer || null, values.seriousnessCriteria);
  const criteria = values.seriousnessCriteria ?? [];
  const issues = (path: string) => issuesByPath[path];

  async function goToSubmit() {
    setNavigating(true);
    if (await save()) router.push(pages.caseSubmit(caseId));
    else setNavigating(false);
  }

  async function escalate() {
    setEscalateError(null);
    if (!(await save())) {
      setEscalateError("Save the draft first (see the message at the bottom of the form).");
      return;
    }
    const result = await actions.escalate(caseId, escalateNote);
    if (!result.ok) {
      setEscalateError(result.error);
      return;
    }
    setEscalated(true);
    setEscalateOpen(false);
    refreshData();
  }

  const unknownCase = (field: string) => ({ listPath: "unknownFields" as FormPath, field });

  return (
    <FormProvider {...form}>
      <SaveDraftContext value={save}>
        <datalist id="frequency-options">
          {FREQUENCY_SUGGESTIONS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <datalist id="route-options">
          {ROUTE_SUGGESTIONS.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <form className="min-w-0 space-y-5" onSubmit={(e) => e.preventDefault()} noValidate>
            {serious ? (
              <div className="flex flex-col gap-3 rounded-lg border border-serious/30 bg-serious-soft px-4 py-3 text-serious sm:flex-row sm:items-center sm:justify-between">
                <p className="flex gap-2 text-sm">
                  <Siren className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>
                    <span className="font-medium">Potentially serious.</span> This report will be flagged and
                    prioritised for review.{" "}
                    {escalated
                      ? "An urgent escalation is open: the designated urgent contacts have been alerted."
                      : "If it is urgent, escalate it now; you can finish the report afterwards."}
                  </span>
                </p>
                {!escalated ? (
                  <Button type="button" variant="destructive" onClick={() => setEscalateOpen(true)}>
                    <Siren aria-hidden />
                    Escalate urgently
                  </Button>
                ) : null}
              </div>
            ) : null}

            <Section
              id="section-a"
              title="A. Patient information"
              description="Use initials only. Never enter a name or hospital number."
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField
                  name="patientInitials"
                  label="1. Patient initials"
                  required
                  placeholder="e.g. R.K."
                  issues={issues("patientInitials")}
                />
                <TextField
                  name="ageValue"
                  label="2. Age at onset"
                  inputMode="numeric"
                  placeholder="e.g. 34"
                  issues={issues("age")}
                  issuePath="age"
                />
                <SelectField name="ageUnit" label="Age unit" options={options(AGE_UNIT_LABELS)} />
              </div>
              <PartialDateField
                name="dateOfBirth"
                label="Or date of birth"
                hint="Age at onset or date of birth is mandatory; one is enough."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <RadioField
                  name="gender"
                  label="3. Gender"
                  options={options(GENDER_LABELS)}
                  unknown={unknownCase("gender")}
                  issues={issues("gender")}
                />
                <TextField
                  name="weightKg"
                  label="4. Weight (kg)"
                  inputMode="decimal"
                  placeholder="e.g. 58"
                  unknown={unknownCase("weightKg")}
                  issues={issues("weightKg")}
                />
              </div>
            </Section>

            <Section id="section-b" title="B. Suspected adverse reaction">
              <TextField
                name="reactionTerms"
                label="Reaction term(s)"
                required
                placeholder="e.g. Maculopapular rash"
                hint="Printed first in item 7 of the form."
                issues={issues("reactionTerms")}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <PartialDateField
                  name="reactionStartDate"
                  label="5. Reaction start date"
                  required
                  issues={issues("reactionStartDate")}
                />
                <div className="space-y-2">
                  <PartialDateField
                    name="reactionStopDate"
                    label="6. Reaction stop date"
                    disabled={values.reactionOngoing}
                    unknown={unknownCase("reactionStopDate")}
                    issues={issues("reactionStopDate")}
                  />
                  <label className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" className="size-4 accent-primary" {...form.register("reactionOngoing")} />
                    Reaction is ongoing
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <TextField
                  name="reactionDescription"
                  label="7. Describe the reaction"
                  multiline
                  issues={issues("reactionDescription")}
                />
                <NarrativeHelper caseId={caseId} ai={ai} />
              </div>
              <TextField
                name="reactionManagement"
                label="7. Management of the reaction"
                multiline
                hint="Medicines given to treat the reaction are added in section C as concomitant products with 'Used to treat the reaction' ticked."
                issues={issues("reactionManagement")}
              />
              <TextField
                name="medicalHistory"
                label="13. Relevant medical and medication history"
                multiline
                unknown={unknownCase("medicalHistory")}
                issues={issues("medicalHistory")}
              />
              <CheckboxGroup
                name="historyFlags"
                label="Relevant to this report"
                options={options(HISTORY_FLAG_LABELS)}
              />
              <div className="space-y-3 rounded-lg border bg-secondary/60 p-3">
                <RadioField
                  name="seriousAnswer"
                  label="14. Is the reaction serious?"
                  options={options(SERIOUS_ANSWER_LABELS)}
                  unknown={unknownCase("seriousAnswer")}
                  issues={issues("seriousAnswer")}
                />
                <CheckboxGroup
                  name="seriousnessCriteria"
                  label="Seriousness criteria (tick all that apply)"
                  options={options(SERIOUSNESS_CRITERION_LABELS)}
                  hint="Any criterion marks the report as potentially serious."
                  issues={issues("seriousnessCriteria")}
                />
                {criteria.includes("DEATH") ? (
                  <PartialDateField name="deathDate" label="Date of death" issues={issues("deathDate")} />
                ) : null}
              </div>
              <RadioField
                name="outcome"
                label="15. Outcome"
                options={options(OUTCOME_LABELS)}
                unknown={unknownCase("outcome")}
                issues={issues("outcome")}
              />
              <div className="space-y-3" id={fieldId("investigations")}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">12. Relevant investigations</h3>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => investigations.append(emptyInvestigation())}
                  >
                    <Plus aria-hidden /> Add investigation
                  </Button>
                </div>
                {investigations.fields.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No investigations added.</p>
                ) : null}
                {investigations.fields.map((row, i) => {
                  const base = `investigations.${row.id ?? "new"}`;
                  return (
                    <div key={row.key} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]">
                      <TextField
                        name={`investigations.${i}.testName`}
                        label="Test"
                        issues={issues(`${base}.testName`)}
                        issuePath={`${base}.testName`}
                      />
                      <TextField
                        name={`investigations.${i}.result`}
                        label="Result"
                        issues={issues(`${base}.result`)}
                        issuePath={`${base}.result`}
                      />
                      <div className="flex items-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => investigations.remove(i)}
                          aria-label={`Remove investigation ${i + 1}`}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </div>
                      <PartialDateField
                        className="sm:col-span-3"
                        name={`investigations.${i}.date`}
                        label="Date"
                        unknown={{ listPath: `investigations.${i}.unknownFields`, field: "date" }}
                        issues={issues(`${base}.date`)}
                        issuePath={`${base}.date`}
                      />
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section
              id="section-c"
              title="C. Suspected medication(s)"
              description="Add each medicine you suspect. Use the full name as written; anything too long for the official box goes on a continuation sheet."
            >
              {extractionSlot}
              {issues("suspectedMedicines") ? (
                <div className="text-[13px] text-warning">
                  {issues("suspectedMedicines")
                    ?.map((x) => x.body)
                    .join(" ")}
                </div>
              ) : null}
              {suspected.fields.map((row, i) => {
                const base = `suspectedMedicines.${row.id ?? "new"}`;
                const unknownRow = (field: string) => ({
                  listPath: `suspectedMedicines.${i}.unknownFields` as FormPath,
                  field,
                });
                const p = (f: string) => `suspectedMedicines.${i}.${f}` as FieldPath<CaseFormValues>;
                const rechallenge = values.suspectedMedicines?.[i]?.rechallenge;
                return (
                  <div key={row.key} className="space-y-4 rounded-lg border p-3 sm:p-4" id={fieldId(base)}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold">Suspected medicine {i + 1}</h3>
                      <Button type="button" variant="ghost" size="sm" onClick={() => suspected.remove(i)}>
                        <Trash2 aria-hidden /> Remove
                      </Button>
                    </div>
                    <TextField
                      name={p("name")}
                      label="8. Name (brand or generic)"
                      required={i === 0}
                      issues={issues(`${base}.name`)}
                      issuePath={`${base}.name`}
                    />
                    <div className="grid gap-4 sm:grid-cols-3">
                      <TextField
                        name={p("manufacturer")}
                        label="Manufacturer"
                        unknown={unknownRow("manufacturer")}
                        issues={issues(`${base}.manufacturer`)}
                        issuePath={`${base}.manufacturer`}
                      />
                      <TextField
                        name={p("batchLot")}
                        label="Batch / lot no."
                        unknown={unknownRow("batchLot")}
                        issues={issues(`${base}.batchLot`)}
                        issuePath={`${base}.batchLot`}
                      />
                      <PartialDateField
                        name={p("expiryDate")}
                        label="Expiry date"
                        unknown={unknownRow("expiryDate")}
                        issues={issues(`${base}.expiryDate`)}
                        issuePath={`${base}.expiryDate`}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <TextField
                        name={p("dose")}
                        label="Dose"
                        placeholder="e.g. 500 mg"
                        unknown={unknownRow("dose")}
                        issues={issues(`${base}.dose`)}
                        issuePath={`${base}.dose`}
                      />
                      <TextField
                        name={p("route")}
                        label="Route"
                        list="route-options"
                        unknown={unknownRow("route")}
                        issues={issues(`${base}.route`)}
                        issuePath={`${base}.route`}
                      />
                      <TextField
                        name={p("frequency")}
                        label="Frequency"
                        list="frequency-options"
                        placeholder="e.g. TID"
                        unknown={unknownRow("frequency")}
                        issues={issues(`${base}.frequency`)}
                        issuePath={`${base}.frequency`}
                      />
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <PartialDateField
                        name={p("startDate")}
                        label="Date started"
                        unknown={unknownRow("startDate")}
                        issues={issues(`${base}.startDate`)}
                        issuePath={`${base}.startDate`}
                      />
                      <div className="space-y-2">
                        <PartialDateField
                          name={p("stopDate")}
                          label="Date stopped"
                          disabled={values.suspectedMedicines?.[i]?.ongoing}
                          unknown={unknownRow("stopDate")}
                          issues={issues(`${base}.stopDate`)}
                          issuePath={`${base}.stopDate`}
                        />
                        <label className="flex items-center gap-1.5 text-sm">
                          <input type="checkbox" className="size-4 accent-primary" {...form.register(p("ongoing"))} />
                          Still being taken
                        </label>
                      </div>
                    </div>
                    <TextField
                      name={p("indication")}
                      label="Indication"
                      unknown={unknownRow("indication")}
                      issues={issues(`${base}.indication`)}
                      issuePath={`${base}.indication`}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <SelectField
                        name={p("actionTaken")}
                        label="9. Action taken after the reaction"
                        options={options(ACTION_TAKEN_LABELS)}
                        issues={issues(`${base}.actionTaken`)}
                        issuePath={`${base}.actionTaken`}
                      />
                      <SelectField
                        name={p("rechallenge")}
                        label="10. Was the medicine reintroduced?"
                        options={options(RECHALLENGE_LABELS)}
                        hint="Record only what happened; never reintroduce a medicine to find out."
                        issues={issues(`${base}.rechallenge`)}
                        issuePath={`${base}.rechallenge`}
                      />
                    </div>
                    {rechallenge === "YES" ? (
                      <TextField name={p("rechallengeDose")} label="Dose on reintroduction" />
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      Causality is assessed at the AMC; this app never fills it.
                    </p>
                  </div>
                );
              })}
              <Button type="button" variant="outline" onClick={() => suspected.append(emptySuspectedMedicine())}>
                <Plus aria-hidden /> Add suspected medicine
              </Button>

              <div className="space-y-3 border-t pt-4" id={fieldId("concomitantProducts")}>
                <div>
                  <h3 className="text-sm font-semibold">11. Concomitant products</h3>
                  <p className="text-[13px] text-muted-foreground">
                    Other medicines, self-medication or herbal products. Tick &quot;used to treat the reaction&quot; for
                    products given because of it; those print under item 7 instead of item 11.
                  </p>
                </div>
                {concomitant.fields.map((row, i) => {
                  const base = `concomitantProducts.${row.id ?? "new"}`;
                  const unknownRow = (field: string) => ({
                    listPath: `concomitantProducts.${i}.unknownFields` as FormPath,
                    field,
                  });
                  const p = (f: string) => `concomitantProducts.${i}.${f}` as FieldPath<CaseFormValues>;
                  return (
                    <div key={row.key} className="space-y-4 rounded-lg border p-3 sm:p-4">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold">Concomitant product {i + 1}</h4>
                        <Button type="button" variant="ghost" size="sm" onClick={() => concomitant.remove(i)}>
                          <Trash2 aria-hidden /> Remove
                        </Button>
                      </div>
                      <TextField
                        name={p("name")}
                        label="Name (brand or generic)"
                        issues={issues(`${base}.name`)}
                        issuePath={`${base}.name`}
                      />
                      <div className="grid gap-4 sm:grid-cols-3">
                        <TextField name={p("dose")} label="Dose" unknown={unknownRow("dose")} />
                        <TextField name={p("route")} label="Route" list="route-options" unknown={unknownRow("route")} />
                        <TextField
                          name={p("frequency")}
                          label="Frequency"
                          list="frequency-options"
                          unknown={unknownRow("frequency")}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <PartialDateField
                          name={p("startDate")}
                          label="Date started"
                          unknown={unknownRow("startDate")}
                        />
                        <div className="space-y-2">
                          <PartialDateField
                            name={p("stopDate")}
                            label="Date stopped"
                            disabled={values.concomitantProducts?.[i]?.ongoing}
                            unknown={unknownRow("stopDate")}
                          />
                          <label className="flex items-center gap-1.5 text-sm">
                            <input type="checkbox" className="size-4 accent-primary" {...form.register(p("ongoing"))} />
                            Still being taken
                          </label>
                        </div>
                      </div>
                      <TextField name={p("indication")} label="Indication" unknown={unknownRow("indication")} />
                      <label className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          {...form.register(p("usedToTreatReaction"))}
                        />
                        Used to treat the reaction
                      </label>
                    </div>
                  );
                })}
                <Button type="button" variant="outline" onClick={() => concomitant.append(emptyConcomitantProduct())}>
                  <Plus aria-hidden /> Add concomitant product
                </Button>
              </div>
            </Section>

            <Section id="section-d" title="D. Reporter details and additional information">
              <div className="rounded-lg border bg-secondary/60 p-3 text-sm">
                <p className="font-medium">{reporter.name ?? "Name missing"}</p>
                <p className="text-muted-foreground">
                  {[reporter.occupation, reporter.email, reporter.phone].filter(Boolean).join(" · ") ||
                    "No contact details"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Section 16 is taken from your profile when you submit.{" "}
                  <a href="/profile" className="text-primary underline underline-offset-2">
                    Edit profile
                  </a>
                </p>
              </div>
              <TextField
                name="additionalInformation"
                label="Additional information"
                multiline
                issues={issues("additionalInformation")}
              />
            </Section>

            <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:mx-0 lg:rounded-lg lg:border lg:px-4">
              <SaveIndicator state={saveState} dirty={dirty} />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void save()}
                  disabled={saveState.kind === "saving"}
                >
                  <Save aria-hidden /> Save draft
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void openFile(files.casePdf(caseId), save)}
                  title="The official PvPI form v1.4 filled with this draft"
                >
                  <FileText aria-hidden /> PvPI PDF
                </Button>
                <Button type="button" onClick={() => void goToSubmit()} disabled={navigating}>
                  <Send aria-hidden /> Review and submit
                </Button>
              </div>
            </div>
          </form>

          <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto">
            <CompletenessPanel completeness={completeness} caseNumber={caseNumber} />
            <AiCheckPanel caseId={caseId} ai={ai} />
          </aside>
        </div>

        <Dialog open={escalateOpen} onOpenChange={setEscalateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Escalate urgently</DialogTitle>
              <DialogDescription>
                The designated urgent contacts will be alerted straight away, even though the report is not complete. A
                copy of what you have entered so far is kept with the alert.
              </DialogDescription>
            </DialogHeader>
            <label htmlFor="escalate-note" className="text-[13px] font-medium">
              Urgency note
            </label>
            <textarea
              id="escalate-note"
              rows={4}
              className={cn(inputClass, "h-auto py-1.5")}
              placeholder="e.g. Patient admitted to ICU; full details to follow."
              value={escalateNote}
              onChange={(e) => setEscalateNote(e.target.value)}
            />
            {escalateError ? <p className="text-sm text-destructive">{escalateError}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEscalateOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={() => void escalate()}>
                <Siren aria-hidden /> Escalate now
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SaveDraftContext>
    </FormProvider>
  );
}

function SaveIndicator({ state, dirty }: { state: SaveState; dirty: boolean }) {
  if (state.kind === "saving")
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving…
      </p>
    );
  if (state.kind === "error")
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-destructive" role="alert">
        <AlertTriangle className="size-3.5" aria-hidden /> Not saved: {state.message}
      </p>
    );
  if (dirty)
    return (
      <p className="text-[13px] text-muted-foreground" aria-live="polite">
        Unsaved changes
      </p>
    );
  if (state.kind === "saved")
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-success" aria-live="polite">
        <CheckCircle2 className="size-3.5" aria-hidden /> Saved at{" "}
        {new Date(state.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}
      </p>
    );
  return <p className="text-[13px] text-muted-foreground">All changes saved · saves automatically</p>;
}

function CompletenessPanel({
  completeness,
  caseNumber,
}: {
  completeness: ReturnType<typeof assessCompleteness>;
  caseNumber: string;
}) {
  const link = (path: string) =>
    `#${fieldId(path.split(".").length === 3 && path.includes(".new.") ? path.split(".")[0] : path)}`;
  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div>
        <p className="text-xs text-muted-foreground">{caseNumber}</p>
        <h2 className="text-base font-semibold">Completeness</h2>
        <nav aria-label="Form sections" className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {[
            ["#section-a", "A Patient"],
            ["#section-b", "B Reaction"],
            ["#section-c", "C Medicines"],
            ["#section-d", "D Reporter"],
          ].map(([href, label]) => (
            <a key={href} href={href} className="rounded-md border px-2 py-0.5 hover:bg-accent">
              {label}
            </a>
          ))}
        </nav>
      </div>
      {completeness.ready ? (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden /> Mandatory fields complete
        </p>
      ) : (
        <div>
          <p className="text-sm font-medium text-destructive">Mandatory, still missing</p>
          <ul className="mt-1 space-y-0.5 text-[13px]">
            {completeness.missing.map((m, i) => (
              <li key={i}>
                <a href={link(m.path)} className="underline-offset-2 hover:underline">
                  {m.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {completeness.warnings.length ? (
        <div>
          <p className="text-sm font-medium text-warning">Please check</p>
          <ul className="mt-1 space-y-1 text-[13px]">
            {completeness.warnings.map((w, i) => (
              <li key={i}>
                <a href={link(w.path)} className="underline-offset-2 hover:underline">
                  {w.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {completeness.gaps.length ? (
        <div>
          <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            <CircleDashed className="size-3.5" aria-hidden /> Optional details not entered
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">{completeness.gaps.map((g) => g.message).join(", ")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Mark a detail &quot;Unknown&quot; if it is not available.
          </p>
        </div>
      ) : null}
      <p className="border-t pt-3 text-xs text-muted-foreground">
        Completeness is not clinical validity. A reviewer verifies every report.
      </p>
    </div>
  );
}

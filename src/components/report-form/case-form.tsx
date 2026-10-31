"use client";

import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { DraftVersionContext, SaveDraftContext, ServerChangeContext, type ServerChange } from "./form-context";
import { GuidedReporter } from "./guided-reporter";
import { NarrativeHelper } from "./narrative-helper";

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

type SaveState =
  { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: string } | { kind: "error"; message: string };

const SECTIONS = [
  { id: "section-a", label: "Patient" },
  { id: "section-b", label: "Reaction" },
  { id: "section-c", label: "Medicines" },
  { id: "section-d", label: "Reporter" },
];
const SectionContext = createContext("section-a");
function sectionForTarget(target: string) {
  if (SECTIONS.some((section) => section.id === target)) return target;
  if (/^field-(?:patient|age|dateOfBirth|gender|weight)/.test(target)) return "section-a";
  if (/^field-(?:suspectedMedicines|concomitantProducts)/.test(target)) return "section-c";
  if (/^field-(?:reporter|additionalInformation)/.test(target)) return "section-d";
  return "section-b";
}

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
  initialGuided?: boolean;
  chatAvailable?: boolean;
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
  const active = useContext(SectionContext);
  return (
    <section
      id={id}
      hidden={active !== id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20 rounded-xl border bg-card"
    >
      <div className="border-b px-4 py-3 sm:px-5">
        <h2 id={`${id}-title`} className="text-base font-semibold">
          {title}
        </h2>
        {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="space-y-6 px-4 py-5 sm:px-6 sm:py-6">{children}</div>
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
  initialGuided = false,
  chatAvailable = false,
}: CaseFormProps) {
  const router = useRouter();
  const [guided, setGuided] = useState(initialGuided);
  const [activeSection, setActiveSection] = useState("section-a");
  useEffect(() => {
    const navigate = () => {
      const target = window.location.hash.slice(1);
      if (!target) return;
      setActiveSection(sectionForTarget(target));
      setTimeout(() => document.getElementById(target)?.scrollIntoView({ block: "start" }), 0);
    };
    navigate();
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);
  function selectSection(id: string) {
    setActiveSection(id);
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${id}`);
  }
  function changeMode(next: boolean) {
    setGuided(next);
    router.replace(`${pages.caseEdit(caseId)}${next ? "&mode=guided" : ""}`, { scroll: false });
  }
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
  const mutation = useRef<"saving" | "applying" | null>(null);
  const [serverChanging, setServerChanging] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateNote, setEscalateNote] = useState("");
  const [escalateError, setEscalateError] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(hasOpenEscalation);
  const [navigating, setNavigating] = useState(false);

  const json = JSON.stringify(values);
  const dirty = json !== savedText;

  const save = useCallback(
    async function saveCurrentDraft(): Promise<boolean> {
      if (mutation.current === "applying") return false;
      if (inFlight.current) {
        await inFlight.current;
        return saveCurrentDraft();
      }
      const snapshot = structuredClone(getValues());
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
    },
    [caseId, getValues, setValue, trigger],
  );

  const serverChange: ServerChange = useCallback(
    async (change) => {
      if (mutation.current) return { ok: false, error: "A report change is already in progress." };
      mutation.current = "saving";
      setServerChanging(true);
      let applied = false;
      try {
        if (!(await save())) return { ok: false, error: "Save the report first. Check the form for errors." };
        // Flush any input made before the fieldset became disabled.
        if (JSON.stringify(getValues()) !== savedJson.current && !(await save()))
          return { ok: false, error: "Save the latest changes first." };
        mutation.current = "applying";
        const result = await change(lockRef.current);
        if (result.ok) {
          applied = true;
          refreshData();
        }
        return result;
      } finally {
        // Successful changes remount this form with the new server version.
        if (!applied) {
          mutation.current = null;
          setServerChanging(false);
        }
      }
    },
    [save, getValues],
  );

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
      <SectionContext value={activeSection}>
        <DraftVersionContext value={() => lockRef.current}>
          <ServerChangeContext value={serverChange}>
            <SaveDraftContext value={save}>
              <fieldset disabled={serverChanging} className="contents" aria-busy={serverChanging}>
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

                    {chatAvailable ? (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            void (async () => {
                              if (await save()) router.push(pages.caseChat(caseId));
                            })()
                          }
                        >
                          Continue with report assistant
                        </Button>
                      </div>
                    ) : null}
                    {guided ? (
                      <GuidedReporter
                        caseId={caseId}
                        ai={ai}
                        extractionSlot={extractionSlot}
                        onStructured={() => changeMode(false)}
                        rows={{
                          suspectedMedicines: {
                            count: suspected.fields.length,
                            add: () => suspected.append(emptySuspectedMedicine()),
                            remove: suspected.remove,
                          },
                          concomitantProducts: {
                            count: concomitant.fields.length,
                            add: () => concomitant.append(emptyConcomitantProduct()),
                            remove: concomitant.remove,
                          },
                          investigations: {
                            count: investigations.fields.length,
                            add: () => investigations.append(emptyInvestigation()),
                            remove: investigations.remove,
                          },
                        }}
                      />
                    ) : (
                      <>
                        <Button type="button" variant="outline" onClick={() => changeMode(true)}>
                          Switch to guided reporting
                        </Button>
                        <nav aria-label="Report sections" className="flex gap-1 overflow-x-auto border-b">
                          {SECTIONS.map((section, index) => (
                            <button
                              type="button"
                              key={section.id}
                              aria-current={activeSection === section.id ? "step" : undefined}
                              onClick={() => selectSection(section.id)}
                              className={`flex min-h-12 shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium ${activeSection === section.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                            >
                              <span
                                className={`grid size-6 place-items-center rounded-full text-xs ${activeSection === section.id ? "bg-primary text-white" : "bg-secondary"}`}
                              >
                                {index + 1}
                              </span>
                              {section.label}
                            </button>
                          ))}
                        </nav>
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
                                <input
                                  type="checkbox"
                                  className="size-4 accent-primary"
                                  {...form.register("reactionOngoing")}
                                />
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
                                <div
                                  key={row.key}
                                  className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_1fr_auto]"
                                >
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
                                      <input
                                        type="checkbox"
                                        className="size-4 accent-primary"
                                        {...form.register(p("ongoing"))}
                                      />
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
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => suspected.append(emptySuspectedMedicine())}
                          >
                            <Plus aria-hidden /> Add suspected medicine
                          </Button>

                          <div className="space-y-3 border-t pt-4" id={fieldId("concomitantProducts")}>
                            <div>
                              <h3 className="text-sm font-semibold">11. Concomitant products</h3>
                              <p className="text-[13px] text-muted-foreground">
                                Other medicines, self-medication or herbal products. Tick &quot;used to treat the
                                reaction&quot; for products given because of it; those print under item 7 instead of
                                item 11.
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
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => concomitant.remove(i)}
                                    >
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
                                    <TextField
                                      name={p("route")}
                                      label="Route"
                                      list="route-options"
                                      unknown={unknownRow("route")}
                                    />
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
                                        <input
                                          type="checkbox"
                                          className="size-4 accent-primary"
                                          {...form.register(p("ongoing"))}
                                        />
                                        Still being taken
                                      </label>
                                    </div>
                                  </div>
                                  <TextField
                                    name={p("indication")}
                                    label="Indication"
                                    unknown={unknownRow("indication")}
                                  />
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
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => concomitant.append(emptyConcomitantProduct())}
                            >
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
                      </>
                    )}

                    <div className="sticky bottom-0 z-10 flex min-w-0 flex-col gap-3 rounded-xl border bg-card/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:p-4">
                      <SaveIndicator state={saveState} dirty={dirty} />
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                          className="hidden sm:inline-flex"
                          title="The official PvPI form v1.4 filled with this draft"
                        >
                          <FileText aria-hidden /> PvPI PDF
                        </Button>
                        <details className="relative sm:hidden">
                          <summary className="flex min-h-10 items-center rounded-md border px-3 text-sm font-medium">
                            More
                          </summary>
                          <div className="absolute bottom-full left-0 z-20 mb-2 flex w-52 flex-col gap-1 rounded-xl border bg-card p-2 shadow-md">
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => void openFile(files.casePdf(caseId), save)}
                            >
                              <FileText aria-hidden /> PvPI PDF
                            </Button>
                            {!guided && activeSection !== "section-d" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                disabled={navigating}
                                onClick={() => void goToSubmit()}
                              >
                                <Send aria-hidden /> Review and submit
                              </Button>
                            ) : null}
                          </div>
                        </details>
                        {!guided && activeSection !== "section-d" ? (
                          <Button
                            type="button"
                            className="ml-auto"
                            onClick={() =>
                              selectSection(
                                SECTIONS[SECTIONS.findIndex((section) => section.id === activeSection) + 1].id,
                              )
                            }
                          >
                            Continue
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant={!guided && activeSection !== "section-d" ? "ghost" : "default"}
                          onClick={() => void goToSubmit()}
                          disabled={navigating}
                          className={cn(
                            "min-w-0 whitespace-normal",
                            !guided && activeSection !== "section-d" && "hidden sm:inline-flex",
                          )}
                        >
                          <Send aria-hidden /> Review and submit
                        </Button>
                      </div>
                    </div>
                  </form>

                  <aside
                    onClick={(event) => {
                      const anchor = (event.target as HTMLElement).closest('a[href^="#"]');
                      if (guided && anchor) {
                        event.preventDefault();
                        changeMode(false);
                        const target = anchor.getAttribute("href")!.slice(1);
                        setActiveSection(sectionForTarget(target));
                        setTimeout(() => document.getElementById(target)?.scrollIntoView({ behavior: "smooth" }), 50);
                      }
                    }}
                    className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto"
                  >
                    <CompletenessPanel completeness={completeness} caseNumber={caseNumber} />
                    <details className="rounded-xl border bg-card p-4">
                      <summary className="text-sm font-semibold">Check report</summary>
                      <div className="mt-4">
                        <AiCheckPanel caseId={caseId} ai={ai} />
                      </div>
                    </details>
                  </aside>
                </div>

                <Dialog open={escalateOpen} onOpenChange={setEscalateOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Escalate urgently</DialogTitle>
                      <DialogDescription>
                        The designated urgent contacts will be alerted straight away, even though the report is not
                        complete. A copy of what you have entered so far is kept with the alert.
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
              </fieldset>
            </SaveDraftContext>
          </ServerChangeContext>
        </DraftVersionContext>
      </SectionContext>
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
        <details>
          <summary className="text-sm font-medium text-muted-foreground">
            Optional details ({completeness.gaps.length})
          </summary>
          <p className="flex items-center gap-1 text-sm font-medium text-muted-foreground">
            <CircleDashed className="size-3.5" aria-hidden /> Optional details not entered
          </p>
          <p className="mt-1 text-[13px] text-muted-foreground">{completeness.gaps.map((g) => g.message).join(", ")}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Mark a detail &quot;Unknown&quot; if it is not available.
          </p>
        </details>
      ) : null}
      <p className="border-t pt-3 text-xs text-muted-foreground">
        Completeness is not clinical validity. A reviewer verifies every report.
      </p>
    </div>
  );
}

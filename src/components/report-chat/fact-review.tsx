"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FileLink } from "@/components/data/protected-file";
import { inputClass } from "@/components/report-form/fields";
import { patientInitialsMatch } from "@/lib/domain/extraction-quality";
import { files } from "@/lib/routes";
import {
  entityKey,
  ARRAY_FIELDS,
  BOOLEAN_FIELDS,
  DATE_FIELDS,
  FIELD_OPTIONS,
  type FactGroup,
  type MedicineRole,
} from "@/lib/domain/report-chat";
import type { ReportChatView } from "@/server/workflow/report-chat";

interface Selection {
  id: string;
  value: string;
  decision: "use" | "skip" | "pending";
  confirmed: boolean;
  approximate: boolean;
}
function initial(group: FactGroup): Selection {
  const fact = group.facts.find((f) => !f.uncertain) ?? group.facts[0];
  return {
    id: fact.id,
    value: fact.value,
    decision: group.conflict || fact.uncertain ? "pending" : "use",
    confirmed: false,
    approximate: fact.approximate,
  };
}
const concomitantFields = new Set([
  "name",
  "dose",
  "route",
  "frequency",
  "startDate",
  "stopDate",
  "ongoing",
  "indication",
  "usedToTreatReaction",
]);

export function FactReview({
  data,
  busy,
  onApply,
}: {
  data: ReportChatView;
  busy: boolean;
  onApply: (input: unknown) => Promise<boolean>;
}) {
  const groups = data.groups.slice(0, 50);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [roles, setRoles] = useState<Record<string, MedicineRole>>({});
  const [identities, setIdentities] = useState<string[]>([]);
  const verificationKey = `${data.revision}:${data.lockVersion}:${groups.flatMap((g) => g.facts.map((f) => f.id)).join(",")}`;
  const [checkedVersion, setCheckedVersion] = useState("");
  const verified = checkedVersion === verificationKey;
  function setVerified(value: boolean) {
    setCheckedVersion(value ? verificationKey : "");
  }
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const choose = (key: string, selection: Selection) => {
    setSelections((s) => ({ ...s, [key]: selection }));
    setVerified(false);
    setRequestId(crypto.randomUUID());
  };
  const grouped = [...new Set(groups.map((g) => g.entityKey))].map((key) => ({
    key,
    groups: groups.filter((g) => g.entityKey === key),
  }));
  const roleFor = (key: string) => roles[key] ?? data.state.roles[key];
  const selectionFor = (group: FactGroup) =>
    selections[group.key] && group.facts.some((f) => f.id === selections[group.key].id)
      ? selections[group.key]
      : initial(group);
  const ambiguous = (key: string) =>
    [...data.values.suspectedMedicines, ...data.values.concomitantProducts].filter(
      (row) => entityKey("medicine", row.name) === key,
    ).length > 1;
  const isInapplicable = (group: FactGroup) =>
    group.facts[0].entity === "medicine" &&
    (ambiguous(group.entityKey) ||
      roleFor(group.entityKey) === "SKIP" ||
      (roleFor(group.entityKey) === "CONCOMITANT" && !concomitantFields.has(group.field)));
  const unresolvedRoles = groups.some(
    (g) => g.facts[0].entity === "medicine" && selectionFor(g).decision === "use" && !roleFor(g.entityKey),
  );
  const selectedCount = groups.filter((g) => !isInapplicable(g) && selectionFor(g).decision === "use").length;
  const hasDecision = groups.some((g) => isInapplicable(g) || selectionFor(g).decision !== "pending");
  async function save() {
    const choices = data.groups
      .filter((g) => !isInapplicable(g) && selectionFor(g).decision === "use")
      .map((g) => {
        const s = selectionFor(g);
        return { id: s.id, value: s.value, confirmedUncertain: s.confirmed, approximate: s.approximate };
      });
    const skipIds = data.groups
      .filter((g) => isInapplicable(g) || selectionFor(g).decision === "skip")
      .flatMap((g) => g.facts.map((f) => f.id));
    if (
      await onApply({
        requestId,
        revision: data.revision,
        lockVersion: data.lockVersion,
        verified,
        choices,
        skipIds,
        roles: Object.fromEntries(
          grouped
            .filter((e) => e.groups[0].facts[0].entity === "medicine" && roleFor(e.key))
            .map((e) => [e.key, roleFor(e.key)]),
        ),
        identityConfirmed: identities,
      })
    ) {
      setSelections({});
      setVerified(false);
      setRequestId(crypto.randomUUID());
    }
  }
  if (!groups.length)
    return (
      <div className="rounded-xl border bg-card p-5">
        <CheckCircle2 className="mb-3 size-6 text-success" aria-hidden />
        <h2 className="font-semibold">No suggestions waiting</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your checked details are saved in the report. Continue the conversation or review the form.
        </p>
      </div>
    );
  return (
    <div className="space-y-4" aria-label="Suggested report details">
      {data.groups.length > 50 ? (
        <p className="text-sm text-muted-foreground">
          Showing the first 50 of {data.groups.length} details. Save checked values to continue.
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Check the suggestions against their sources. Differing readings stay separate until you choose one.
      </p>
      {grouped.map((entity) => (
        <section key={entity.key} className="overflow-hidden rounded-xl border bg-card">
          <div className="space-y-3 border-b bg-secondary/60 p-4">
            {entity.groups[0].facts[0].entity === "medicine" &&
            [...data.values.suspectedMedicines, ...data.values.concomitantProducts].some(
              (row) =>
                row.name &&
                row.name
                  .toLowerCase()
                  .split(/[^a-z]+/)
                  .filter(Boolean)[0] ===
                  entity.groups[0].entityName
                    .toLowerCase()
                    .split(/[^a-z]+/)
                    .filter(Boolean)[0] &&
                entityKey("medicine", row.name) !== entity.key,
            ) ? (
              <p className="text-xs text-warning">
                A similarly named medicine is already in the report. Check that this is a separate entry before adding
                it, or match the details in the form.
              </p>
            ) : null}
            <h3 className="font-semibold">
              {entity.key === "case" ? "Patient and reaction" : entity.groups[0].entityName || "Investigation"}
            </h3>
            {entity.groups[0].facts[0].entity === "medicine" ? (
              <label className="block text-sm">
                Medicine role
                <select
                  aria-label={`Role for ${entity.groups[0].entityName}`}
                  className={inputClass}
                  value={roleFor(entity.key) ?? ""}
                  disabled={busy || Boolean(data.state.entities[entity.key])}
                  onChange={(e) => {
                    setRoles((r) => ({ ...r, [entity.key]: e.target.value as MedicineRole }));
                    setVerified(false);
                    setRequestId(crypto.randomUUID());
                  }}
                >
                  <option value="">Choose how this medicine belongs</option>
                  <option value="SUSPECTED">Suspected medicine</option>
                  <option value="CONCOMITANT">Concomitant product</option>
                  <option value="SKIP">Leave this medicine out</option>
                </select>
              </label>
            ) : null}
          </div>
          <div className="divide-y">
            {entity.groups.map((group) => {
              const selection = selectionFor(group),
                fact = group.facts.find((f) => f.id === selection.id) ?? group.facts[0],
                inactive = isInapplicable(group);
              return (
                <div key={group.key} className="space-y-3 p-4">
                  <p className="text-sm font-semibold">
                    {group.label}
                    {group.conflict ? (
                      <span className="ml-2 text-xs font-medium text-warning">Choose a value</span>
                    ) : null}
                  </p>
                  {group.current ? (
                    <p className="text-xs text-muted-foreground">Currently recorded: {group.current}</p>
                  ) : null}
                  {inactive ? (
                    <p className="text-sm text-muted-foreground">
                      {ambiguous(group.entityKey)
                        ? "Several existing entries have this medicine name. Check the matching entry in the form; these suggestions will be left out of this save."
                        : roleFor(group.entityKey) === "SKIP"
                          ? "This medicine will be left out."
                          : "This detail does not apply to a concomitant product."}
                    </p>
                  ) : (
                    <>
                      {group.facts.length > 1 ? (
                        <label className="block text-xs">
                          Source reading
                          <select
                            className={inputClass}
                            value={selection.id}
                            disabled={busy}
                            onChange={(e) => {
                              const next = group.facts.find((f) => f.id === e.target.value)!;
                              choose(group.key, {
                                id: next.id,
                                value: next.value,
                                approximate: next.approximate,
                                confirmed: false,
                                decision: "use",
                              });
                            }}
                          >
                            {group.facts.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.value} · {f.documentName ?? "Your answer"}
                                {f.sourcePage ? ` p.${f.sourcePage}` : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {ARRAY_FIELDS.has(group.field) ? (
                        <fieldset className="space-y-2">
                          <legend className="sr-only">{group.label} value</legend>
                          {Object.entries(FIELD_OPTIONS[group.field]).map(([key, label]) => {
                            let values: string[] = [];
                            try {
                              values = JSON.parse(selection.value);
                            } catch {}
                            return (
                              <label key={key} className="flex items-start gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={Array.isArray(values) && values.includes(key)}
                                  disabled={busy}
                                  onChange={(e) =>
                                    choose(group.key, {
                                      ...selection,
                                      value: JSON.stringify(
                                        e.target.checked ? [...values, key] : values.filter((v) => v !== key),
                                      ),
                                      decision: "use",
                                    })
                                  }
                                  className="mt-1 size-4"
                                />
                                {label}
                              </label>
                            );
                          })}
                        </fieldset>
                      ) : FIELD_OPTIONS[group.field] || BOOLEAN_FIELDS.has(group.field) ? (
                        <select
                          aria-label={`${group.label} value`}
                          className={inputClass}
                          value={selection.value}
                          disabled={busy}
                          onChange={(e) => choose(group.key, { ...selection, value: e.target.value, decision: "use" })}
                        >
                          {!Object.hasOwn(
                            FIELD_OPTIONS[group.field] ?? { true: "Yes", false: "No" },
                            selection.value,
                          ) ? (
                            <option value={selection.value}>{selection.value}</option>
                          ) : null}
                          {Object.entries(FIELD_OPTIONS[group.field] ?? { true: "Yes", false: "No" }).map(
                            ([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      ) : (
                        <textarea
                          aria-label={`${group.label} value`}
                          className={inputClass + " h-auto min-h-11 py-2"}
                          rows={selection.value.length > 100 ? 3 : 1}
                          value={selection.value}
                          maxLength={4000}
                          disabled={busy}
                          onChange={(e) => choose(group.key, { ...selection, value: e.target.value, decision: "use" })}
                        />
                      )}
                      {DATE_FIELDS.has(group.field) ? (
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={selection.approximate}
                            disabled={busy}
                            onChange={(e) =>
                              choose(group.key, { ...selection, approximate: e.target.checked, decision: "use" })
                            }
                          />
                          Approximate date
                        </label>
                      ) : null}
                      {fact.quote ? (
                        <blockquote className="border-l-2 pl-3 text-xs leading-relaxed text-muted-foreground">
                          {fact.quote}
                        </blockquote>
                      ) : null}
                      <p className="text-xs">
                        {fact.documentId ? (
                          <FileLink path={files.document(data.caseId, fact.documentId)}>
                            {fact.documentName}
                            {fact.sourcePage ? ` · page ${fact.sourcePage}` : ""}
                          </FileLink>
                        ) : (
                          "From your conversation answer"
                        )}
                      </p>
                      {fact.uncertain ? (
                        <label className="flex items-start gap-2 rounded-md bg-warning-soft p-2 text-xs text-warning">
                          <input
                            type="checkbox"
                            className="mt-0.5 size-4 shrink-0"
                            checked={selection.confirmed}
                            disabled={busy}
                            onChange={(e) =>
                              choose(group.key, {
                                ...selection,
                                confirmed: e.target.checked,
                                decision: e.target.checked ? "use" : "pending",
                              })
                            }
                          />
                          <span>
                            <AlertTriangle className="mr-1 inline size-3.5" aria-hidden />
                            The reading is unclear. I checked this value directly against the source.
                          </span>
                        </label>
                      ) : null}
                      <div className="flex flex-wrap gap-4 text-xs">
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`decision-${group.key}`}
                            checked={selection.decision === "use"}
                            disabled={busy}
                            onChange={() => choose(group.key, { ...selection, decision: "use" })}
                          />
                          Use this value
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={`decision-${group.key}`}
                            checked={selection.decision === "skip"}
                            disabled={busy}
                            onChange={() => choose(group.key, { ...selection, decision: "skip" })}
                          />
                          {group.current ? "Keep current value" : "Leave out"}
                        </label>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {data.documents
        .filter(
          (d) =>
            d.patientMatch === "DIFFERENT" ||
            patientInitialsMatch(
              (() => {
                const group = groups.find((g) => g.field === "patientInitials");
                return group && selectionFor(group).decision === "use"
                  ? selectionFor(group).value
                  : data.values.patientInitials;
              })(),
              d.initials,
            ) === "DIFFERENT",
        )
        .map((doc) => (
          <label
            key={doc.id}
            className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm text-warning"
          >
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0"
              checked={identities.includes(doc.id) || data.state.identityConfirmed.includes(doc.id)}
              onChange={(e) => {
                setIdentities((v) => (e.target.checked ? [...v, doc.id] : v.filter((id) => id !== doc.id)));
                setVerified(false);
              }}
              disabled={busy || data.state.identityConfirmed.includes(doc.id)}
            />
            <span>The initials differ on {doc.name}. I checked that this document belongs to this report.</span>
          </label>
        ))}
      <div className="space-y-3 rounded-xl border bg-card p-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0"
            checked={verified}
            disabled={busy}
            onChange={(e) => setVerified(e.target.checked)}
          />
          <span>I checked the selected details against their sources and confirmed they belong to this report.</span>
        </label>
        {unresolvedRoles ? <p className="text-xs text-warning">Choose a role for each selected medicine.</p> : null}
        <Button
          type="button"
          className="w-full"
          disabled={busy || !verified || !hasDecision || unresolvedRoles}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : `Save checked details (${selectedCount})`}
        </Button>
      </div>
    </div>
  );
}

import { FileLink } from "@/components/data/protected-file";
import { files } from "@/lib/routes";
import type { ReactNode } from "react";
import { FileText, PencilLine } from "lucide-react";
import { cn } from "cn";
import type { CaseSnapshot } from "@/lib/domain/snapshot";
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
import { formatForDisplay } from "@/lib/domain/partial-date";

export interface ProvenanceView {
  documentName: string;
  documentId: string;
  caseId: string;
  verifiedBy: string | null;
  model: string | null;
  uncertainReading?: boolean;
}

interface CaseSummaryProps {
  snapshot: CaseSnapshot;
  /** Field paths changed since the previous version (highlighted). */
  changed?: Set<string>;
  /** Field paths filled from a document, with their source. */
  provenance?: Record<string, ProvenanceView>;
  /** Open issues per field path (shown as markers). */
  issueCounts?: Record<string, number>;
}

const unknownText = <span className="text-muted-foreground italic">Unknown</span>;
const notEntered = <span className="text-muted-foreground">Not entered</span>;

function value(v: unknown, unknown: boolean): ReactNode {
  if (unknown) return unknownText;
  if (v === null || v === undefined || v === "") return notEntered;
  return String(v);
}

function dateValue(v: string | null | undefined, approx: boolean | null | undefined, unknown: boolean) {
  if (unknown) return unknownText;
  return v ? formatForDisplay(v, Boolean(approx)) : notEntered;
}

function Row({
  ctx: { changed, provenance, issueCounts },
  label,
  path,
  children,
}: {
  ctx: Pick<CaseSummaryProps, "changed" | "provenance" | "issueCounts">;
  label: string;
  path: string;
  children: ReactNode;
}) {
  const isChanged = changed?.has(path);
  const source = provenance?.[path];
  const issues = issueCounts?.[path];
  return (
    <div
      className={cn(
        "grid gap-1 px-3 py-2 sm:grid-cols-[13rem_1fr] sm:gap-3",
        isChanged && "border-l-4 border-l-warning bg-warning-soft",
      )}
      data-path={path}
    >
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words whitespace-pre-line">
        {children}
        <span className="mt-0.5 flex flex-wrap gap-1.5">
          {isChanged ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
              <PencilLine className="size-3" aria-hidden /> Changed in this version
            </span>
          ) : null}
          {source ? (
            <FileLink
              path={files.document(source.caseId, source.documentId)}
              className="text-xs text-ai underline underline-offset-2"
            >
              <FileText className="size-3" aria-hidden />
              From {source.documentName}
              {source.model ? ` · AI-suggested (${source.model})` : ""}
              {source.verifiedBy ? ` · verified by ${source.verifiedBy}` : ""}
              {source.uncertainReading ? " · unclear reading checked by reporter" : ""}
            </FileLink>
          ) : null}
          {issues ? (
            <span className="text-xs font-medium text-warning">
              {issues} open issue{issues === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
      </dd>
    </div>
  );
}

export function CaseSummary({ snapshot: s, changed, provenance, issueCounts }: CaseSummaryProps) {
  const u = new Set(s.unknownFields ?? []);
  const ctx = { changed, provenance, issueCounts };

  const age = s.patient.ageValue
    ? `${s.patient.ageValue} ${s.patient.ageUnit ? AGE_UNIT_LABELS[s.patient.ageUnit] : ""}`
    : s.patient.dateOfBirth
      ? `Born ${formatForDisplay(s.patient.dateOfBirth, s.patient.dateOfBirthApprox)}`
      : null;
  const treated = s.concomitantProducts.filter((p) => p.usedToTreatReaction);
  const others = s.concomitantProducts.filter((p) => !p.usedToTreatReaction);

  return (
    <div className="space-y-4">
      <SummarySection title="A. Patient">
        <Row ctx={ctx} label="1. Initials" path="patientInitials">
          {value(s.patient.initials, false)}
        </Row>
        <Row ctx={ctx} label="2. Age at onset / DOB" path="age">
          {value(age, false)}
        </Row>
        <Row ctx={ctx} label="3. Gender" path="gender">
          {value(s.patient.gender ? GENDER_LABELS[s.patient.gender] : null, u.has("gender"))}
        </Row>
        <Row ctx={ctx} label="4. Weight" path="weightKg">
          {value(s.patient.weightKg ? `${s.patient.weightKg} kg` : null, u.has("weightKg"))}
        </Row>
      </SummarySection>

      <SummarySection title="B. Reaction">
        <Row ctx={ctx} label="Reaction term(s)" path="reactionTerms">
          {value(s.reaction.terms, false)}
        </Row>
        <Row ctx={ctx} label="5. Start date" path="reactionStartDate">
          {dateValue(s.reaction.startDate, s.reaction.startDateApprox, false)}
        </Row>
        <Row ctx={ctx} label="6. Stop date" path="reactionStopDate">
          {s.reaction.ongoing
            ? "Ongoing"
            : dateValue(s.reaction.stopDate, s.reaction.stopDateApprox, u.has("reactionStopDate"))}
        </Row>
        <Row ctx={ctx} label="7. Description" path="reactionDescription">
          {value(s.reaction.description, false)}
        </Row>
        <Row ctx={ctx} label="7. Management" path="reactionManagement">
          {value(s.reaction.management, false)}
        </Row>
        {s.investigations.length ? (
          s.investigations.map((i, n) => (
            <div key={i.id} className="border-t">
              <Row ctx={ctx} label={`12. Test ${n + 1}`} path={`investigations.${i.id}.testName`}>
                {value(i.testName, false)}
              </Row>
              <Row ctx={ctx} label="Result" path={`investigations.${i.id}.result`}>
                {value(i.result, false)}
              </Row>
              <Row ctx={ctx} label="Date" path={`investigations.${i.id}.date`}>
                {dateValue(i.date, i.dateApprox, i.unknownFields?.includes("date") ?? false)}
              </Row>
            </div>
          ))
        ) : (
          <Row ctx={ctx} label="12. Investigations" path="investigations">
            {notEntered}
          </Row>
        )}
        <Row ctx={ctx} label="13. History" path="medicalHistory">
          {u.has("medicalHistory") ? (
            unknownText
          ) : s.history.text || s.history.flags?.length ? (
            <>
              {s.history.text}
              {s.history.flags?.length ? (
                <span className="block text-[13px] text-muted-foreground">
                  Relevant: {s.history.flags.map((f) => HISTORY_FLAG_LABELS[f]).join(", ")}
                </span>
              ) : null}
            </>
          ) : (
            notEntered
          )}
        </Row>
        <Row ctx={ctx} label="14. Serious?" path="seriousAnswer">
          {value(s.seriousness.answer ? SERIOUS_ANSWER_LABELS[s.seriousness.answer] : null, u.has("seriousAnswer"))}
        </Row>
        <Row ctx={ctx} label="14. Criteria" path="seriousnessCriteria">
          {s.seriousness.criteria?.length
            ? s.seriousness.criteria.map((c) => SERIOUSNESS_CRITERION_LABELS[c]).join(", ")
            : "None ticked"}
          {s.seriousness.deathDate
            ? ` (death: ${formatForDisplay(s.seriousness.deathDate, s.seriousness.deathDateApprox)})`
            : ""}
        </Row>
        <Row ctx={ctx} label="15. Outcome" path="outcome">
          {value(s.outcome ? OUTCOME_LABELS[s.outcome] : null, u.has("outcome"))}
        </Row>
      </SummarySection>

      <SummarySection title="C. Suspected medicines">
        {s.suspectedMedicines.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">None entered.</p>
        ) : null}
        {s.suspectedMedicines.map((m, i) => {
          const mu = new Set(m.unknownFields ?? []);
          const base = `suspectedMedicines.${m.id}`;
          return (
            <div key={m.id} className="border-t first:border-t-0">
              <p className="bg-secondary px-3 py-1.5 text-[13px] font-medium">Suspected medicine {i + 1}</p>
              <Row ctx={ctx} label="8. Name" path={`${base}.name`}>
                {value(m.name, false)}
              </Row>
              <Row ctx={ctx} label="Manufacturer" path={`${base}.manufacturer`}>
                {value(m.manufacturer, mu.has("manufacturer"))}
              </Row>
              <Row ctx={ctx} label="Batch / lot" path={`${base}.batchLot`}>
                {value(m.batchLot, mu.has("batchLot"))}
              </Row>
              <Row ctx={ctx} label="Expiry" path={`${base}.expiryDate`}>
                {dateValue(m.expiryDate, m.expiryDateApprox, mu.has("expiryDate"))}
              </Row>
              <Row ctx={ctx} label="Dose" path={`${base}.dose`}>
                {value(m.dose, mu.has("dose"))}
              </Row>
              <Row ctx={ctx} label="Route" path={`${base}.route`}>
                {value(m.route, mu.has("route"))}
              </Row>
              <Row ctx={ctx} label="Frequency" path={`${base}.frequency`}>
                {value(m.frequency, mu.has("frequency"))}
              </Row>
              <Row ctx={ctx} label="Date started" path={`${base}.startDate`}>
                {dateValue(m.startDate, m.startDateApprox, mu.has("startDate"))}
              </Row>
              <Row ctx={ctx} label="Date stopped" path={`${base}.stopDate`}>
                {m.ongoing ? "Still being taken" : dateValue(m.stopDate, m.stopDateApprox, mu.has("stopDate"))}
              </Row>
              <Row ctx={ctx} label="Indication" path={`${base}.indication`}>
                {value(m.indication, mu.has("indication"))}
              </Row>
              <Row ctx={ctx} label="9. Action taken" path={`${base}.actionTaken`}>
                {value(m.actionTaken ? ACTION_TAKEN_LABELS[m.actionTaken] : null, false)}
              </Row>
              <Row ctx={ctx} label="10. Reintroduction" path={`${base}.rechallenge`}>
                {value(m.rechallenge ? RECHALLENGE_LABELS[m.rechallenge] : null, false)}
                {m.rechallengeDose ? ` (dose ${m.rechallengeDose})` : ""}
              </Row>
            </div>
          );
        })}
      </SummarySection>

      <SummarySection title="11. Concomitant products">
        {others.length === 0 && treated.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">None entered.</p>
        ) : null}
        {[...others, ...treated].map((p) => {
          const pu = new Set(p.unknownFields ?? []);
          const base = `concomitantProducts.${p.id}`;
          const details = [
            p.dose ?? (pu.has("dose") ? "dose unknown" : null),
            p.route,
            p.frequency,
            p.startDate ? `from ${formatForDisplay(p.startDate, p.startDateApprox)}` : null,
            p.ongoing ? "ongoing" : p.stopDate ? `to ${formatForDisplay(p.stopDate, p.stopDateApprox)}` : null,
            p.indication ? `for ${p.indication}` : null,
          ].filter(Boolean);
          return (
            <Row
              ctx={ctx}
              key={p.id}
              label={p.usedToTreatReaction ? "Given for the reaction" : "Concomitant"}
              path={`${base}.name`}
            >
              <span className="font-medium">{p.name ?? "Unnamed product"}</span>
              {details.length ? (
                <span className="block text-[13px] text-muted-foreground">{details.join(", ")}</span>
              ) : null}
            </Row>
          );
        })}
      </SummarySection>

      <SummarySection title="D. Reporter and additional information">
        <Row ctx={ctx} label="16. Reporter" path="reporter">
          {s.reporter.name ? (
            <>
              {s.reporter.name}
              <span className="block text-[13px] text-muted-foreground">
                {[s.reporter.occupation, s.reporter.address, s.reporter.pin, s.reporter.email, s.reporter.phone]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">Taken from the reporter&apos;s profile at submission</span>
          )}
        </Row>
        <Row ctx={ctx} label="17. Date of report" path="reportDate">
          {s.reporter.reportDate ? formatForDisplay(s.reporter.reportDate) : notEntered}
        </Row>
        <Row ctx={ctx} label="Additional information" path="additionalInformation">
          {value(s.additionalInformation, false)}
        </Row>
      </SummarySection>
    </div>
  );
}

function SummarySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <h3 className="border-b bg-secondary px-3 py-2 text-sm font-semibold">{title}</h3>
      <dl className="divide-y">{children}</dl>
    </section>
  );
}

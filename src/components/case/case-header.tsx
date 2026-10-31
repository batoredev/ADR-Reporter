import type { ReactNode } from "react";
import { Siren } from "lucide-react";
import { SeriousBadge, StatusBadge } from "@/components/case-badges";
import type { CaseStatus, SeriousnessCriterion } from "@/generated/prisma/enums";
import { SERIOUSNESS_CRITERION_LABELS } from "@/lib/domain/labels";
import { formatDateTime } from "@/lib/format";

interface CaseHeaderProps {
  caseNumber: string;
  status: CaseStatus;
  reactionTerms: string | null;
  reporterName: string;
  submittedAt: Date | null;
  assigneeName: string | null;
  isPotentiallySerious: boolean;
  criteria: SeriousnessCriterion[];
  openEscalation: boolean;
  actions?: ReactNode;
}

export function CaseHeader(p: CaseHeaderProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4 border-b pb-5 xl:flex-row xl:items-start xl:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">{p.caseNumber}</h1>
          <StatusBadge status={p.status} />
          {p.isPotentiallySerious ? <SeriousBadge /> : null}
          {p.openEscalation ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-serious px-1.5 py-0.5 text-xs font-medium text-white">
              <Siren className="size-3" aria-hidden /> Urgent escalation open
            </span>
          ) : null}
        </div>
        <p className="text-sm">
          {p.reactionTerms ?? <span className="text-muted-foreground">Reaction not entered</span>}
        </p>
        <p className="text-[13px] text-muted-foreground">
          Reporter {p.reporterName}
          {p.submittedAt ? ` · submitted ${formatDateTime(p.submittedAt)}` : " · not yet submitted"}
          {p.assigneeName ? ` · reviewer ${p.assigneeName}` : p.status !== "DRAFT" ? " · not yet assigned" : ""}
        </p>
        {p.criteria.length ? (
          <p className="text-[13px] text-serious">
            Seriousness: {p.criteria.map((c) => SERIOUSNESS_CRITERION_LABELS[c]).join(", ")}
          </p>
        ) : null}
      </div>
      {p.actions ? <div className="flex min-w-0 flex-wrap gap-2 xl:max-w-[55%] xl:justify-end">{p.actions}</div> : null}
    </div>
  );
}

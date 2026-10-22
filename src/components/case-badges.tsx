import { AlertTriangle } from "lucide-react";
import { cn } from "cn";
import type { CaseStatus } from "@/generated/prisma/enums";
import { CASE_STATUS_LABELS } from "@/lib/domain/labels";

const STATUS_STYLES: Record<CaseStatus, string> = {
  DRAFT: "border-border bg-secondary text-muted-foreground",
  SUBMITTED: "border-primary/25 bg-info-soft text-primary",
  RESUBMITTED: "border-primary/25 bg-info-soft text-primary",
  UNDER_REVIEW: "border-primary/25 bg-info-soft text-primary",
  RETURNED: "border-warning/30 bg-warning-soft text-warning",
  APPROVED: "border-success/30 bg-success-soft text-success",
  EXTERNALLY_SUBMITTED: "border-success/30 bg-success-soft text-success",
  ACKNOWLEDGED: "border-success/30 bg-success-soft text-success",
};

const pill = "inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-medium";

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <span className={cn(pill, STATUS_STYLES[status])}>{CASE_STATUS_LABELS[status]}</span>;
}

export function SeriousBadge() {
  return (
    <span className={cn(pill, "border-serious/30 bg-serious-soft text-serious")}>
      <AlertTriangle className="size-3" aria-hidden />
      Potentially serious
    </span>
  );
}

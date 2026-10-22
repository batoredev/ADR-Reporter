// Display labels for stored enum values. Kept free of server or React imports
// so the seed script, server code and client components can all use them.
import type { CaseStatus, Role, SeriousnessCriterion } from "@/generated/prisma/enums";

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  RETURNED: "Returned for correction",
  RESUBMITTED: "Resubmitted",
  APPROVED: "Approved",
  EXTERNALLY_SUBMITTED: "Externally submitted",
  ACKNOWLEDGED: "Acknowledged",
};

export const ROLE_LABELS: Record<Role, string> = {
  REPORTER: "Reporter",
  REVIEWER: "Reviewer",
  COORDINATOR: "Coordinator",
};

export const SERIOUSNESS_CRITERION_LABELS: Record<SeriousnessCriterion, string> = {
  DEATH: "Death",
  LIFE_THREATENING: "Life threatening",
  HOSPITALISATION: "Hospitalisation (initial or prolonged)",
  CONGENITAL_ANOMALY: "Congenital anomaly",
  DISABILITY: "Disability",
  OTHER_MEDICALLY_IMPORTANT: "Other medically important",
};

export function formatCaseNumber(sequence: number): string {
  return `ADR-${String(sequence).padStart(3, "0")}`;
}

// Display labels for stored enum values. Kept free of server or React imports
// so the seed script, server code and client components can all use them.
import type {
  ActionTaken,
  AgeUnit,
  AssignmentAction,
  CaseStatus,
  ChecklistItemKey,
  ExternalSubmissionKind,
  ExternalSubmissionMethod,
  Gender,
  HistoryFlag,
  IssueStatus,
  Outcome,
  Rechallenge,
  Role,
  SeriousAnswer,
  SeriousnessCriterion,
} from "@/generated/prisma/enums";

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

export const AGE_UNIT_LABELS: Record<AgeUnit, string> = {
  YEARS: "years",
  MONTHS: "months",
  WEEKS: "weeks",
  DAYS: "days",
};

export const GENDER_LABELS: Record<Gender, string> = { MALE: "Male", FEMALE: "Female", OTHER: "Other" };

export const HISTORY_FLAG_LABELS: Record<HistoryFlag, string> = {
  ALLERGY: "Allergies",
  PREGNANCY: "Pregnancy",
  ADDICTION: "Addiction",
  HEPATIC_DYSFUNCTION: "Hepatic dysfunction",
  RENAL_DYSFUNCTION: "Renal dysfunction",
};

export const SERIOUS_ANSWER_LABELS: Record<SeriousAnswer, string> = { YES: "Yes", NO: "No", UNKNOWN: "Not known" };

export const OUTCOME_LABELS: Record<Outcome, string> = {
  RECOVERED: "Recovered",
  RECOVERING: "Recovering",
  NOT_RECOVERED: "Not recovered",
  FATAL: "Fatal",
  RECOVERED_WITH_SEQUELAE: "Recovered with sequelae",
  UNKNOWN: "Unknown",
};

export const ACTION_TAKEN_LABELS: Record<ActionTaken, string> = {
  DRUG_WITHDRAWN: "Drug withdrawn",
  DOSE_INCREASED: "Dose increased",
  DOSE_REDUCED: "Dose reduced",
  DOSE_NOT_CHANGED: "Dose not changed",
  NOT_APPLICABLE: "Not applicable",
  UNKNOWN: "Unknown",
};

export const RECHALLENGE_LABELS: Record<Rechallenge, string> = {
  YES: "Yes, the reaction reappeared",
  NO: "No, it did not reappear",
  EFFECT_UNKNOWN: "Reintroduced, effect unknown",
  NOT_REINTRODUCED: "Not reintroduced",
};

export const CHECKLIST_LABELS: Record<ChecklistItemKey, { title: string; hint: string }> = {
  PATIENT_DATA: { title: "Patient data", hint: "Initials, age or date of birth, gender, weight" },
  REACTION_CHRONOLOGY: { title: "Reaction chronology", hint: "Start and stop dates agree with the medicine dates" },
  SUSPECTED_MEDICATION: { title: "Suspected medication", hint: "Name, dose, route, frequency, dates, action taken" },
  CLINICAL_EVIDENCE: { title: "Clinical evidence", hint: "Investigations, history and any uploaded documents" },
  SERIOUSNESS_OUTCOME: { title: "Seriousness and outcome", hint: "Seriousness criteria and outcome are consistent" },
  REPORTER_COMPLETENESS: { title: "Reporter and mandatory fields", hint: "Reporter details and all mandatory fields" },
};

export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = {
  OPEN: "Open",
  RESOLVED: "Resolved",
  ACKNOWLEDGED_UNAVAILABLE: "Acknowledged: information unavailable",
};

export const SUBMISSION_METHOD_LABELS: Record<ExternalSubmissionMethod, string> = {
  AMC_EMAIL: "AMC by email",
  AMC_HAND_DELIVERY: "AMC by hand delivery",
  NCC_EMAIL: "NCC by email (pvpi.ipc@gov.in)",
  PVPI_HELPLINE: "PvPI helpline (1800-180-3024)",
  ADRPVPI_APP: "ADRPvPI mobile app",
  OTHER: "Other",
};

export const SUBMISSION_KIND_LABELS: Record<ExternalSubmissionKind, string> = {
  ROUTINE: "Routine submission",
  URGENT_NOTIFICATION: "Urgent notification",
};

export const ASSIGNMENT_ACTION_LABELS: Record<AssignmentAction, string> = {
  CLAIMED: "took up the case",
  RELEASED: "released the case to the pool",
  REASSIGNED: "reassigned the case",
};

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  CASE_CREATED: "Report created",
  CASE_EDITED: "Draft saved",
  CASE_SUBMITTED: "Submitted for institutional review",
  CASE_RESUBMITTED: "Corrected and resubmitted",
  CASE_CLAIMED: "Taken up for review",
  CASE_RELEASED: "Released to the review pool",
  CASE_REASSIGNED: "Reassigned",
  CASE_REVIEW_RESUMED: "Review resumed",
  CHECKLIST_RECORDED: "Checklist updated",
  COMMENT_ADDED: "Comment added",
  ISSUE_RESOLVED: "Issue resolved",
  ISSUE_ACKNOWLEDGED_UNAVAILABLE: "Issue acknowledged as unavailable",
  CASE_RETURNED: "Returned for correction",
  CASE_APPROVED: "Institutionally approved",
  ESCALATION_RAISED: "Urgent escalation raised",
  ESCALATION_ACKNOWLEDGED: "Urgent escalation acknowledged",
  ESCALATION_CLOSED: "Urgent escalation closed",
  EXTERNAL_SUBMISSION_RECORDED: "External submission recorded",
  EXTERNAL_ACKNOWLEDGEMENT_RECORDED: "External acknowledgement recorded",
  DOCUMENT_UPLOADED: "Document uploaded",
  EXTRACTION_RUN: "Document read",
  EXTRACTION_APPLIED: "Extracted values verified and added",
  AI_NARRATIVE_DISCARDED: "Description suggestion discarded",
  AI_FINDING_DECIDED: "Finding reviewed by reporter",
  AI_GUIDED_FOLLOWUPS: "Guided follow-up questions suggested",
  GUIDED_STEP_SAVED: "Guided question group saved",
  EXTRACTION_DISCARDED: "Document suggestions discarded",
  AI_NARRATIVE_DRAFTED: "Description drafted",
  AI_NARRATIVE_USED: "Suggested description saved in item 7",
  AI_NARRATIVE_FAILED: "Description could not be drafted",
  AI_CHECK_RUN: "Report checked",
  AI_CHECK_KEPT: "Finding checked and kept as recorded",
  AI_CHECK_FAILED: "Report check could not run",
  PDF_GENERATED: "PDF generated",
  USER_SIGNED_IN: "Signed in",
  USER_SIGNED_OUT: "Signed out",
  PROFILE_UPDATED: "Profile updated",
};

export function formatCaseNumber(sequence: number): string {
  return `ADR-${String(sequence).padStart(3, "0")}`;
}

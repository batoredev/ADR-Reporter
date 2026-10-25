import { ExternalSubmissionMethod } from "@/generated/prisma/enums";
import { SUBMISSION_METHOD_LABELS } from "@/lib/domain/labels";
import type { DialogField, DialogFieldCondition } from "./action-dialog";

/** Inputs for recording a submission or notification made outside the app. */
export function submissionFields(
  now: string,
  destinationHint: string,
): (DialogField & { showWhen?: DialogFieldCondition })[] {
  return [
    {
      name: "method",
      label: "How it was sent",
      type: "select",
      options: Object.values(ExternalSubmissionMethod).map((m) => ({ value: m, label: SUBMISSION_METHOD_LABELS[m] })),
    },
    {
      name: "methodOther",
      label: "Describe the method",
      type: "text",
      showWhen: { field: "method", equals: "OTHER" },
    },
    { name: "destination", label: "Sent to", type: "text", placeholder: destinationHint },
    { name: "submittedAt", label: "Date and time sent (IST)", type: "datetime-local", defaultValue: now },
    {
      name: "externalReference",
      label: "Reference given by the recipient",
      type: "text",
      optional: true,
      hint: "Only if the recipient provided one. The app never creates official numbers.",
    },
    { name: "notes", label: "Notes", type: "textarea", optional: true },
  ];
}

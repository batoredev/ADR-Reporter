// The actions users take, as API calls. Each returns an ActionResult so forms can
// show a refusal (for example "Already taken up by ...") instead of failing.
import type { ActionResult } from "@/lib/action-result";
import type { CaseFormValues } from "@/lib/domain/case-form";
import type { SaveResult } from "@/server/workflow/cases";
import type { ExtractionView } from "@/server/workflow/extraction";
import type { ConsistencyResult, NarrativeDraft } from "@/server/workflow/ai-assist";
import type { AiHistory, FindingDecision } from "@/lib/domain/ai-history";
import type { GuidedSuggestions } from "@/server/workflow/guided";
import { ApiError, apiGet, apiSend } from "./client";

async function result<T>(call: Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await call };
  } catch (error) {
    return { ok: false, error: error instanceof ApiError ? error.message : "Something went wrong. Please try again." };
  }
}

type Values = Record<string, string>;
const id = (value: string) => encodeURIComponent(value);
const post = <T = null>(path: string, body?: unknown) => result(apiSend<T>("POST", path, body ?? {}));

export interface UploadedDocumentView {
  id: string;
  name: string;
  mimeType: string;
  uploadedAt: string;
}

export const actions = {
  login: (email: string, password: string) =>
    result(apiSend<{ token: string; expiresAt: Date }>("POST", "/auth/login", { email, password })),
  logout: () => post("/auth/logout"),
  updateProfile: (values: Values) => result(apiSend<null>("PUT", "/profile", values)),

  createDraft: () => post<{ id: string }>("/cases"),
  saveDraft: (caseId: string, lockVersion: number, values: CaseFormValues) =>
    result(apiSend<SaveResult>("PUT", `/cases/${id(caseId)}/draft`, { lockVersion, values })),
  submit: (caseId: string, input: { lockVersion: number; declaration: boolean; responseNote: string }) =>
    post<{ versionNo: number }>(`/cases/${id(caseId)}/submit`, input),
  escalate: (caseId: string, note: string) => post<{ id: string }>(`/cases/${id(caseId)}/escalate`, { note }),

  uploadDocument: (caseId: string, form: FormData) =>
    result(apiSend<UploadedDocumentView>("POST", `/cases/${id(caseId)}/documents`, form)),
  runExtraction: (caseId: string, documentId: string) =>
    post<ExtractionView>(`/cases/${id(caseId)}/documents/${id(documentId)}/extract`),
  pendingExtractions: (caseId: string) =>
    result(apiGet<{ id: string; document: { originalName: string } }[]>(`/cases/${id(caseId)}/extractions`)),
  extraction: (caseId: string, runId: string) =>
    result(apiGet<ExtractionView>(`/cases/${id(caseId)}/extractions/${id(runId)}`)),
  discardExtraction: (caseId: string, runId: string) => post(`/cases/${id(caseId)}/extractions/${id(runId)}/discard`),
  applyExtraction: (caseId: string, runId: string, input: unknown) =>
    post<{ added: number; filled: number; investigationsAdded: number }>(
      `/cases/${id(caseId)}/extractions/${id(runId)}/apply`,
      input,
    ),
  draftNarrative: (caseId: string, notes: string, useReport: boolean) =>
    post<NarrativeDraft>(`/cases/${id(caseId)}/narrative`, { notes, useReport }),
  aiHistory: (caseId: string) => result(apiGet<AiHistory>(`/cases/${id(caseId)}/ai-history`)),
  guidedFollowups: (caseId: string) => post<GuidedSuggestions>(`/cases/${id(caseId)}/guided/followups`),
  saveGuidedStep: (caseId: string, stepId: string) => post(`/cases/${id(caseId)}/guided/step`, { stepId }),
  discardNarrative: (caseId: string, draftId: string) => post(`/cases/${id(caseId)}/narrative/${id(draftId)}/discard`),
  useNarrative: (
    caseId: string,
    draftId: string,
    input: { text: string; mode: "replace" | "append"; lockVersion: number; verified: boolean },
  ) => post<{ lockVersion: number }>(`/cases/${id(caseId)}/narrative/${id(draftId)}/use`, input),
  checkWithAi: (caseId: string) => post<ConsistencyResult>(`/cases/${id(caseId)}/ai-check`),
  keepFinding: (caseId: string, checkId: string, index: number, reason: string, decision: FindingDecision = "KEPT") =>
    post<null>(`/cases/${id(caseId)}/ai-check/${id(checkId)}/keep`, { index, reason, decision }),

  claim: (caseId: string) => post(`/cases/${id(caseId)}/claim`),
  resume: (caseId: string) => post(`/cases/${id(caseId)}/resume`),
  release: (caseId: string, values: Values) => post(`/cases/${id(caseId)}/release`, values),
  reassign: (caseId: string, values: Values) => post(`/cases/${id(caseId)}/reassign`, values),
  checklist: (
    caseId: string,
    input: { item: string; outcome: "VERIFIED" | "VERIFIED_WITH_EXCEPTION" | "CLEAR"; exceptionReason?: string },
  ) => post(`/cases/${id(caseId)}/checklist`, input),
  comment: (caseId: string, input: { kind: "NOTE" | "ISSUE"; body: string; fieldPath?: string }) =>
    post(`/cases/${id(caseId)}/comments`, input),
  closeIssue: (caseId: string, commentId: string, values: Values) =>
    post(`/cases/${id(caseId)}/comments/${id(commentId)}/close`, values),
  approve: (caseId: string) => post<{ versionNo: number }>(`/cases/${id(caseId)}/approve`),
  returnCase: (caseId: string, values: Values) => post(`/cases/${id(caseId)}/return`, values),

  acknowledgeEscalation: (escalationId: string) => post(`/escalations/${id(escalationId)}/acknowledge`),
  closeEscalation: (escalationId: string, values: Values) => post(`/escalations/${id(escalationId)}/close`, values),
  urgentNotification: (escalationId: string, values: Values) => post(`/escalations/${id(escalationId)}/notify`, values),

  recordSubmission: (caseId: string, values: Values) => post(`/cases/${id(caseId)}/submissions`, values),
  recordAcknowledgement: (submissionId: string, values: Values) =>
    post(`/submissions/${id(submissionId)}/acknowledge`, values),
};

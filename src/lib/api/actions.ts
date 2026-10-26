// The actions users take, as API calls. Each returns an ActionResult so forms can
// show a refusal (for example "Already taken up by ...") instead of failing.
import type { ActionResult } from "@/lib/action-result";
import type { CaseFormValues } from "@/lib/domain/case-form";
import type { SaveResult } from "@/server/workflow/cases";
import type { ExtractionView } from "@/server/workflow/extraction";
import { ApiError, apiSend } from "./client";

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
  applyExtraction: (caseId: string, runId: string, input: unknown) =>
    post<{ added: number }>(`/cases/${id(caseId)}/extractions/${id(runId)}/apply`, input),

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

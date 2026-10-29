import "server-only";
import { canReview } from "@/lib/domain/access";
import { login, logout } from "@/server/auth/login";
import { getDashboard, parseDashboardFilters } from "@/server/dashboard";
import { getCaseDetails } from "@/server/workflow/case-details";
import { createDraft, escalateCase, saveDraft, submitCase, updateProfile } from "@/server/workflow/cases";
import { WorkflowError } from "@/server/workflow/errors";
import {
  acknowledgeEscalation,
  closeEscalation,
  listEscalations,
  recordUrgentNotification,
} from "@/server/workflow/escalations";
import { applyExtraction, runExtraction, uploadDocument } from "@/server/workflow/extraction";
import { checkConsistency, draftNarrative, keepFinding, recordNarrativeUse } from "@/server/workflow/ai-assist";
import { getReviewQueue, parseQueueFilter } from "@/server/workflow/queue";
import {
  addComment,
  approveCase,
  claimCase,
  closeIssue,
  reassignCase,
  recordChecklistItem,
  releaseCase,
  resumeReview,
  returnCase,
  reviewersFor,
} from "@/server/workflow/review";
import { listSubmissionWork, recordAcknowledgement, recordSubmission } from "@/server/workflow/submissions";
import { caseDocument, casePdf } from "./files";
import { readJson, text, type Route } from "./http";
import { demoAccounts, editView, myReports, openDrafts, profile, submitView } from "./views";

const submissionInput = (body: Record<string, unknown>) => ({
  method: text(body, "method"),
  methodOther: text(body, "methodOther"),
  destination: text(body, "destination"),
  submittedAt: text(body, "submittedAt"),
  externalReference: text(body, "externalReference"),
  notes: text(body, "notes"),
});

const clientAddress = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";

/** Every endpoint of the API. Access rules live in the services each one calls. */
export const routes: Route[] = [
  { method: "GET", path: "/health", auth: false, handler: async () => ({ ok: true }) },
  { method: "GET", path: "/auth/demo", auth: false, handler: async () => demoAccounts() },
  {
    method: "POST",
    path: "/auth/login",
    auth: false,
    handler: async ({ request }) => login(await readJson(request), clientAddress(request)),
  },
  { method: "GET", path: "/auth/me", auth: true, handler: async ({ user }) => user },
  { method: "POST", path: "/auth/logout", auth: true, handler: ({ user, token }) => logout(user, token) },

  {
    method: "GET",
    path: "/dashboard",
    auth: true,
    handler: ({ user, query }) => getDashboard(user, parseDashboardFilters(Object.fromEntries(query))),
  },
  {
    method: "GET",
    path: "/my-reports",
    auth: true,
    handler: ({ user, query }) => myReports(user, query.get("status")),
  },
  { method: "GET", path: "/drafts", auth: true, handler: ({ user }) => openDrafts(user) },
  { method: "GET", path: "/profile", auth: true, handler: ({ user }) => profile(user) },
  {
    method: "PUT",
    path: "/profile",
    auth: true,
    handler: async ({ user, request }) => {
      const body = await readJson(request);
      await updateProfile(user, {
        name: text(body, "name"),
        occupation: text(body, "occupation"),
        address: text(body, "address"),
        pin: text(body, "pin"),
        phone: text(body, "phone"),
      });
      return null;
    },
  },

  // Reports
  { method: "POST", path: "/cases", auth: true, handler: ({ user }) => createDraft(user) },
  { method: "GET", path: "/cases/:id", auth: true, handler: ({ user, params }) => getCaseDetails(user, params.id) },
  { method: "GET", path: "/cases/:id/edit", auth: true, handler: ({ user, params }) => editView(user, params.id) },
  { method: "GET", path: "/cases/:id/submit", auth: true, handler: ({ user, params }) => submitView(user, params.id) },
  {
    method: "PUT",
    path: "/cases/:id/draft",
    auth: true,
    handler: async ({ user, params, request }) => {
      const body = await readJson(request);
      return saveDraft(user, params.id, Number(body.lockVersion), body.values);
    },
  },
  {
    method: "POST",
    path: "/cases/:id/submit",
    auth: true,
    handler: async ({ user, params, request }) => {
      const body = await readJson(request);
      return submitCase(user, params.id, {
        lockVersion: Number(body.lockVersion),
        declaration: body.declaration === true,
        responseNote: text(body, "responseNote"),
      });
    },
  },
  {
    method: "POST",
    path: "/cases/:id/escalate",
    auth: true,
    handler: async ({ user, params, request }) => escalateCase(user, params.id, text(await readJson(request), "note")),
  },
  {
    method: "GET",
    path: "/cases/:id/pdf",
    auth: true,
    handler: ({ user, params, query }) => casePdf(user, params.id, query.get("version")),
  },

  // Documents and AI extraction
  {
    method: "POST",
    path: "/cases/:id/documents",
    auth: true,
    handler: async ({ user, params, request }) => {
      const form = await request.formData().catch(() => null);
      const upload = form?.get("file");
      return uploadDocument(user, params.id, upload instanceof File ? upload : null);
    },
  },
  {
    method: "GET",
    path: "/cases/:id/documents/:documentId",
    auth: true,
    handler: ({ user, params }) => caseDocument(user, params.id, params.documentId),
  },
  {
    method: "POST",
    path: "/cases/:id/documents/:documentId/extract",
    auth: true,
    handler: ({ user, params }) => runExtraction(user, params.id, params.documentId),
  },
  {
    method: "POST",
    path: "/cases/:id/extractions/:runId/apply",
    auth: true,
    handler: async ({ user, params, request }) =>
      applyExtraction(user, params.id, params.runId, await readJson(request)),
  },

  // AI help while writing the report
  {
    method: "POST",
    path: "/cases/:id/narrative",
    auth: true,
    handler: async ({ user, params, request }) => {
      const body = await readJson(request);
      return draftNarrative(user, params.id, { notes: text(body, "notes"), useReport: body.useReport !== false });
    },
  },
  {
    method: "POST",
    path: "/cases/:id/narrative/:draftId/use",
    auth: true,
    handler: async ({ user, params, request }) =>
      recordNarrativeUse(user, params.id, { draftId: params.draftId, text: text(await readJson(request), "text") }),
  },
  {
    method: "POST",
    path: "/cases/:id/ai-check",
    auth: true,
    handler: ({ user, params }) => checkConsistency(user, params.id),
  },
  {
    method: "POST",
    path: "/cases/:id/ai-check/:checkId/keep",
    auth: true,
    handler: async ({ user, params, request }) => {
      const body = await readJson(request);
      return keepFinding(user, params.id, {
        checkId: params.checkId,
        index: Number(body.index),
        reason: text(body, "reason"),
      });
    },
  },

  // Review
  {
    method: "GET",
    path: "/review",
    auth: true,
    handler: async ({ user, query }) => {
      const filter = parseQueueFilter(query.get("filter"));
      return { filter, ...(await getReviewQueue(user, filter)) };
    },
  },
  {
    method: "GET",
    path: "/reviewers",
    auth: true,
    handler: async ({ user }) => {
      if (!canReview(user)) throw new WorkflowError("Only reviewers can see this.", "FORBIDDEN");
      return reviewersFor(user);
    },
  },
  { method: "POST", path: "/cases/:id/claim", auth: true, handler: ({ user, params }) => claimCase(user, params.id) },
  {
    method: "POST",
    path: "/cases/:id/resume",
    auth: true,
    handler: ({ user, params }) => resumeReview(user, params.id),
  },
  {
    method: "POST",
    path: "/cases/:id/release",
    auth: true,
    handler: async ({ user, params, request }) => releaseCase(user, params.id, text(await readJson(request), "reason")),
  },
  {
    method: "POST",
    path: "/cases/:id/reassign",
    auth: true,
    handler: async ({ user, params, request }) => {
      const body = await readJson(request);
      return reassignCase(user, params.id, text(body, "toUserId"), text(body, "reason"));
    },
  },
  {
    method: "POST",
    path: "/cases/:id/checklist",
    auth: true,
    handler: async ({ user, params, request }) => {
      const body = await readJson(request);
      const outcome = text(body, "outcome");
      if (outcome !== "VERIFIED" && outcome !== "VERIFIED_WITH_EXCEPTION" && outcome !== "CLEAR")
        throw new WorkflowError("Choose an outcome.");
      return recordChecklistItem(user, params.id, {
        item: text(body, "item"),
        outcome,
        exceptionReason: text(body, "exceptionReason"),
      });
    },
  },
  {
    method: "POST",
    path: "/cases/:id/comments",
    auth: true,
    handler: async ({ user, params, request }) => {
      const body = await readJson(request);
      return addComment(user, params.id, {
        kind: text(body, "kind") === "ISSUE" ? "ISSUE" : "NOTE",
        body: text(body, "body"),
        fieldPath: text(body, "fieldPath") || undefined,
      });
    },
  },
  {
    method: "POST",
    path: "/cases/:id/comments/:commentId/close",
    auth: true,
    handler: async ({ user, params, request }) => {
      const body = await readJson(request);
      const status = text(body, "status") === "ACKNOWLEDGED_UNAVAILABLE" ? "ACKNOWLEDGED_UNAVAILABLE" : "RESOLVED";
      return closeIssue(user, params.id, params.commentId, { status, note: text(body, "note") });
    },
  },
  {
    method: "POST",
    path: "/cases/:id/approve",
    auth: true,
    handler: ({ user, params }) => approveCase(user, params.id),
  },
  {
    method: "POST",
    path: "/cases/:id/return",
    auth: true,
    handler: async ({ user, params, request }) => returnCase(user, params.id, text(await readJson(request), "reason")),
  },

  // Urgent escalations
  { method: "GET", path: "/escalations", auth: true, handler: ({ user }) => listEscalations(user) },
  {
    method: "POST",
    path: "/escalations/:id/acknowledge",
    auth: true,
    handler: ({ user, params }) => acknowledgeEscalation(user, params.id),
  },
  {
    method: "POST",
    path: "/escalations/:id/close",
    auth: true,
    handler: async ({ user, params, request }) =>
      closeEscalation(user, params.id, text(await readJson(request), "note")),
  },
  {
    method: "POST",
    path: "/escalations/:id/notify",
    auth: true,
    handler: async ({ user, params, request }) =>
      recordUrgentNotification(user, params.id, submissionInput(await readJson(request))),
  },

  // External submissions
  { method: "GET", path: "/submissions", auth: true, handler: ({ user }) => listSubmissionWork(user) },
  {
    method: "POST",
    path: "/cases/:id/submissions",
    auth: true,
    handler: async ({ user, params, request }) =>
      recordSubmission(user, params.id, submissionInput(await readJson(request))),
  },
  {
    method: "POST",
    path: "/submissions/:id/acknowledge",
    auth: true,
    handler: async ({ user, params, request }) => {
      const body = await readJson(request);
      return recordAcknowledgement(user, params.id, {
        acknowledgedAt: text(body, "acknowledgedAt"),
        reference: text(body, "reference"),
        notes: text(body, "notes"),
      });
    },
  },
];

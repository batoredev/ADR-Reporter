"use server";

import { requireUser } from "@/server/auth/current-user";
import { asResult, type ActionResult } from "@/server/workflow/errors";
import { applyExtraction, runExtraction, uploadDocument, type ExtractionView } from "@/server/workflow/extraction";

export interface UploadedDocumentView {
  id: string;
  name: string;
  mimeType: string;
  uploadedAt: string;
}

export async function uploadDocumentAction(
  caseId: string,
  formData: FormData,
): Promise<ActionResult<UploadedDocumentView>> {
  const user = await requireUser();
  const file = formData.get("file");
  return asResult(() => uploadDocument(user, caseId, file instanceof File ? file : null));
}

export async function runExtractionAction(caseId: string, documentId: string): Promise<ActionResult<ExtractionView>> {
  const user = await requireUser();
  return asResult(() => runExtraction(user, caseId, documentId));
}

export async function applyExtractionAction(
  caseId: string,
  runId: string,
  input: unknown,
): Promise<ActionResult<{ added: number }>> {
  const user = await requireUser();
  return asResult(() => applyExtraction(user, caseId, runId, input));
}

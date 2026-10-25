import { getCurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { readStoredFile } from "@/server/storage";
import { loadCase } from "@/server/workflow/cases";
import { WorkflowError } from "@/server/workflow/errors";

/** Serves an uploaded document to users who may see its case. */
export async function GET(_request: Request, context: RouteContext<"/api/cases/[id]/documents/[docId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const { id, docId } = await context.params;
  try {
    await loadCase(user, id);
  } catch (error) {
    if (error instanceof WorkflowError) return new Response("Not found", { status: 404 });
    throw error;
  }
  const doc = await db.uploadedDocument.findFirst({ where: { id: docId, caseId: id } });
  if (!doc) return new Response("Not found", { status: 404 });
  const bytes = await readStoredFile(doc.storageKey);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${doc.originalName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
    },
  });
}

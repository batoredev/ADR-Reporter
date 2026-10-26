import "server-only";
import { buildCaseSnapshot, type CaseSnapshot } from "@/lib/domain/snapshot";
import { isDemoMode } from "@/lib/demo";
import { todayInAppZone } from "@/lib/format";
import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { ddmmyyyy, generatePvpiPdf } from "@/server/pdf/pvpi-form";
import { readStoredFile } from "@/server/storage";
import { loadCase } from "@/server/workflow/cases";
import { WorkflowError } from "@/server/workflow/errors";
import { file } from "./http";

/**
 * The PvPI form for a case.
 * - version  that version: the frozen approved PDF if approved, otherwise generated from its snapshot (draft)
 * - none     the reporter's live draft while editing, otherwise the latest version
 */
export async function casePdf(user: CurrentUser, caseId: string, requested: string | null) {
  const { c, access } = await loadCase(user, caseId);
  const today = todayInAppZone();
  const common = { caseNumber: c.caseNumber, generatedOn: ddmmyyyy(today), fictional: isDemoMode() };
  const pdf = (bytes: Uint8Array, name: string) => file(bytes, "application/pdf", name);

  if (!requested && access.edit) {
    const profile = await db.user.findUniqueOrThrow({ where: { id: c.reporterId } });
    const live = buildCaseSnapshot(c);
    const preview: CaseSnapshot = {
      ...live,
      reporter: {
        name: profile.name,
        address: profile.address,
        pin: profile.pin,
        email: profile.email,
        phone: profile.phone,
        occupation: profile.occupation,
        reportDate: today,
      },
    };
    const result = await generatePvpiPdf(preview, { ...common, mode: "draft", versionLabel: "draft preview" });
    return pdf(result.bytes, `${c.caseNumber}-draft-preview.pdf`);
  }

  const version = requested
    ? await db.caseVersion.findUnique({
        where: { caseId_versionNo: { caseId: c.id, versionNo: Number(requested) || -1 } },
      })
    : await db.caseVersion.findFirst({ where: { caseId: c.id }, orderBy: { versionNo: "desc" } });
  if (!version) {
    if (requested) throw new WorkflowError("Version not found.", "NOT_FOUND");
    const result = await generatePvpiPdf(buildCaseSnapshot(c), { ...common, mode: "draft", versionLabel: "draft" });
    return pdf(result.bytes, `${c.caseNumber}-draft.pdf`);
  }
  if (version.pdfStorageKey) {
    return pdf(await readStoredFile(version.pdfStorageKey), `${c.caseNumber}-v${version.versionNo}-approved.pdf`);
  }
  // Approved versions without a stored file (seeded demo data) are rebuilt from their frozen snapshot.
  const approved = version.reason === "APPROVED";
  const result = await generatePvpiPdf(version.snapshot as unknown as CaseSnapshot, {
    ...common,
    mode: approved ? "approved" : "draft",
    versionLabel: `v${version.versionNo}`,
  });
  return pdf(result.bytes, `${c.caseNumber}-v${version.versionNo}-${approved ? "approved" : "draft"}.pdf`);
}

/** An uploaded document, served only to people who may view the case. */
export async function caseDocument(user: CurrentUser, caseId: string, documentId: string) {
  await loadCase(user, caseId);
  const doc = await db.uploadedDocument.findFirst({ where: { id: documentId, caseId } });
  if (!doc) throw new WorkflowError("Document not found.", "NOT_FOUND");
  return file(await readStoredFile(doc.storageKey), doc.mimeType, doc.originalName, {
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'",
  });
}

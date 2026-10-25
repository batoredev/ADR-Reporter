import { buildCaseSnapshot, type CaseSnapshot } from "@/lib/domain/snapshot";
import { isDemoMode } from "@/lib/demo";
import { todayInAppZone } from "@/lib/format";
import { getCurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { ddmmyyyy, generatePvpiPdf } from "@/server/pdf/pvpi-form";
import { readStoredFile } from "@/server/storage";
import { loadCase } from "@/server/workflow/cases";
import { WorkflowError } from "@/server/workflow/errors";

const pdfResponse = (bytes: Uint8Array, filename: string) =>
  new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

/**
 * The PvPI form for a case.
 * - ?version=n  that version: the frozen approved PDF if approved, otherwise generated from its snapshot (draft)
 * - no version  the reporter's live draft while editing, otherwise the latest version
 */
export async function GET(request: Request, context: RouteContext<"/reports/[id]/pdf">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const { id } = await context.params;
  let loaded;
  try {
    loaded = await loadCase(user, id);
  } catch (error) {
    if (error instanceof WorkflowError) return new Response("Not found", { status: 404 });
    throw error;
  }
  const { c, access } = loaded;
  const requested = new URL(request.url).searchParams.get("version");
  const today = todayInAppZone();
  const common = { caseNumber: c.caseNumber, generatedOn: ddmmyyyy(today), fictional: isDemoMode() };

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
    return pdfResponse(result.bytes, `${c.caseNumber}-draft-preview.pdf`);
  }

  const version = requested
    ? await db.caseVersion.findUnique({
        where: { caseId_versionNo: { caseId: c.id, versionNo: Number(requested) || -1 } },
      })
    : await db.caseVersion.findFirst({ where: { caseId: c.id }, orderBy: { versionNo: "desc" } });
  if (!version) {
    if (requested) return new Response("Version not found", { status: 404 });
    const result = await generatePvpiPdf(buildCaseSnapshot(c), { ...common, mode: "draft", versionLabel: "draft" });
    return pdfResponse(result.bytes, `${c.caseNumber}-draft.pdf`);
  }
  if (version.pdfStorageKey) {
    return pdfResponse(
      await readStoredFile(version.pdfStorageKey),
      `${c.caseNumber}-v${version.versionNo}-approved.pdf`,
    );
  }
  // Approved versions without a stored file (seeded demo data) are rebuilt from their frozen snapshot.
  const approved = version.reason === "APPROVED";
  const result = await generatePvpiPdf(version.snapshot as unknown as CaseSnapshot, {
    ...common,
    mode: approved ? "approved" : "draft",
    versionLabel: `v${version.versionNo}`,
  });
  return pdfResponse(result.bytes, `${c.caseNumber}-v${version.versionNo}-${approved ? "approved" : "draft"}.pdf`);
}

import type { Metadata } from "next";
import { PlannedPage } from "@/components/planned-page";
import { canReport } from "@/lib/domain/access";
import { requireAccess } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "New ADR report" };

export default async function NewReportPage() {
  await requireAccess(canReport);
  return (
    <PlannedPage
      title="New ADR report"
      step={2}
      description="The structured reporting form (PvPI sections A to D) with drafts, validation and submission for institutional review."
    />
  );
}

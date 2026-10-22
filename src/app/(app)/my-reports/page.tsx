import type { Metadata } from "next";
import { PlannedPage } from "@/components/planned-page";
import { canReport } from "@/lib/domain/access";
import { requireAccess } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "My reports" };

export default async function MyReportsPage() {
  await requireAccess(canReport);
  return (
    <PlannedPage
      title="My reports"
      step={2}
      description="Your drafts and submitted reports, with their review status and any comments returned to you."
    />
  );
}

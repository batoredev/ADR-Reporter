import type { Metadata } from "next";
import { PlannedPage } from "@/components/planned-page";
import { canHandleEscalations } from "@/lib/domain/access";
import { requireAccess } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Urgent escalations" };

export default async function EscalationsPage() {
  await requireAccess(canHandleEscalations);
  return (
    <PlannedPage
      title="Urgent escalations"
      step={4}
      description="Potentially serious reports escalated to designated personnel: acknowledge, record urgent notifications made outside the app, and close."
    />
  );
}

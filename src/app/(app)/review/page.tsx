import type { Metadata } from "next";
import { PlannedPage } from "@/components/planned-page";
import { canReview } from "@/lib/domain/access";
import { requireAccess } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewQueuePage() {
  await requireAccess(canReview);
  return (
    <PlannedPage
      title="Review queue"
      step={4}
      description="The shared institutional queue: claim, release and reassign cases, verify with the checklist, comment, approve or return for correction."
    />
  );
}

import type { Metadata } from "next";
import { PlannedPage } from "@/components/planned-page";
import { canViewSubmissions } from "@/lib/domain/access";
import { requireAccess } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "External submissions" };

export default async function SubmissionsPage() {
  await requireAccess(canViewSubmissions);
  return (
    <PlannedPage
      title="External submissions"
      step={5}
      description="Approved reports awaiting submission outside the app, and records of how and when they were sent and acknowledged. The app records submissions; it never sends them."
    />
  );
}

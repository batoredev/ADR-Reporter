import type { Metadata } from "next";
import { PlannedPage } from "@/components/planned-page";
import { requireUser } from "@/server/auth/current-user";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  await requireUser();
  return (
    <PlannedPage
      title="Profile"
      step={2}
      description="Your reporter details (name, address, PIN, email, phone, occupation), used in section D of the PvPI form."
    />
  );
}

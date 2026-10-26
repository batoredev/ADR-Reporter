import type { Metadata } from "next";
import { ProfileView } from "./profile-form";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return <ProfileView />;
}

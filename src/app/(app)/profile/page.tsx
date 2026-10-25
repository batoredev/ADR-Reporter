import type { Metadata } from "next";
import { describeAccess } from "@/lib/domain/access";
import { requireUser } from "@/server/auth/current-user";
import { db } from "@/server/db";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { name: true, email: true, occupation: true, address: true, pin: true, phone: true, designation: true },
  });
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-muted-foreground">
          {describeAccess(user)}
          {profile.designation ? ` · ${profile.designation}` : ""}
        </p>
      </div>
      <ProfileForm
        initial={{
          name: profile.name,
          email: profile.email,
          occupation: profile.occupation ?? "",
          address: profile.address ?? "",
          pin: profile.pin ?? "",
          phone: profile.phone ?? "",
        }}
      />
    </div>
  );
}

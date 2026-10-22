import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { AccessSubject } from "@/lib/domain/access";
import { db } from "@/server/db";
import { readSessionUserId } from "./session";

export interface CurrentUser extends AccessSubject {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  institutionId: string;
  institutionName: string;
  department: string | null;
}

/** The signed-in user for this request, or null. Deduplicated within one render. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const userId = await readSessionUserId();
  if (!userId) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      designation: true,
      roles: true,
      isUrgentContact: true,
      canReassign: true,
      isActive: true,
      institution: { select: { id: true, name: true, department: true } },
    },
  });
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    designation: user.designation,
    roles: user.roles,
    isUrgentContact: user.isUrgentContact,
    canReassign: user.canReassign,
    institutionId: user.institution.id,
    institutionName: user.institution.name,
    department: user.institution.department,
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Requires a signed-in user who passes `check`; otherwise shows the access-denied page. */
export async function requireAccess(check: (user: CurrentUser) => boolean): Promise<CurrentUser> {
  const user = await requireUser();
  if (!check(user)) redirect("/access-denied");
  return user;
}

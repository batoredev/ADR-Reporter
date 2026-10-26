import "server-only";
import type { AccessSubject } from "@/lib/domain/access";
import { db } from "@/server/db";
import { sessionUserId } from "./session";

export interface CurrentUser extends AccessSubject {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  institutionId: string;
  institutionName: string;
  department: string | null;
}

/** The signed-in user for a session token, or null if the token is unknown, expired or the account inactive. */
export async function userForToken(token: string | null): Promise<CurrentUser | null> {
  if (!token) return null;
  const userId = await sessionUserId(token);
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
}

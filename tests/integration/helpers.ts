import type { CurrentUser } from "@/server/auth/current-user";
import { db } from "@/server/db";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

/** The seeded fictional cases. Tests that create their own cases leave these alone. */
export const SEEDED = new Set(Array.from({ length: 8 }, (_, i) => `ADR-00${i + 1}`));

export async function userFor(email: string): Promise<CurrentUser> {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { institution: true } });
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    designation: u.designation,
    roles: u.roles,
    isUrgentContact: u.isUrgentContact,
    canReassign: u.canReassign,
    institutionId: u.institutionId,
    institutionName: u.institution.name,
    department: u.institution.department,
  };
}

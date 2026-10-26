import "server-only";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { WorkflowError } from "@/server/workflow/errors";
import type { CurrentUser } from "./current-user";
import { verifyPassword } from "./password";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "./rate-limit";
import { createSession, destroySession } from "./session";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

/** Checks the credentials and starts a session. `client` (e.g. the caller's IP) feeds the rate limit. */
export async function login(input: unknown, client: string) {
  const parsed = credentials.safeParse(input);
  if (!parsed.success) throw new WorkflowError("Enter a valid email address and your password.");
  const { email, password } = parsed.data;

  const limiterKey = `${email}|${client}`;
  if (isLoginBlocked(limiterKey)) throw new WorkflowError("Too many failed attempts. Wait 15 minutes, then try again.");

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, isActive: true, institutionId: true },
  });
  const valid = await verifyPassword(password, user?.passwordHash);
  if (!user || !valid || !user.isActive) {
    recordLoginFailure(limiterKey);
    throw new WorkflowError("The email or password is incorrect.", "UNAUTHORIZED");
  }

  clearLoginFailures(limiterKey);
  const session = await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await writeAudit({ institutionId: user.institutionId, actorId: user.id, action: "USER_SIGNED_IN" });
  return session;
}

export async function logout(user: CurrentUser, token: string) {
  await destroySession(token);
  await writeAudit({ institutionId: user.institutionId, actorId: user.id, action: "USER_SIGNED_OUT" });
}

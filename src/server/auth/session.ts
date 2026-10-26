import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/server/db";

// Sessions are random bearer tokens. Only their SHA-256 hash is stored, so a
// database leak does not reveal usable tokens.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function sessionTtlMs(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 60 * 60 * 1000;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

/** The user id for a valid, unexpired session token, or null. */
export async function sessionUserId(token: string): Promise<string | null> {
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { userId: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.userId;
}

export async function destroySession(token: string): Promise<void> {
  await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

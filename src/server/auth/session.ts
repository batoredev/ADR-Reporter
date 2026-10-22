import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/server/db";

export const SESSION_COOKIE = "adr_session";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function sessionTtlMs(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS);
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 60 * 60 * 1000;
}

/** Creates a database session and sets the cookie. Call only from Server Actions or Route Handlers. */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  await db.session.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

/** Returns the user id for a valid, unexpired session cookie, or null. */
export async function readSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { userId: true, expiresAt: true },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  return session.userId;
}

/** Deletes the current session row and cookie. Call only from Server Actions or Route Handlers. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete(SESSION_COOKIE);
}

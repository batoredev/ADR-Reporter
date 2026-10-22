"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { verifyPassword } from "@/server/auth/password";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "@/server/auth/rate-limit";
import { createSession } from "@/server/auth/session";
import { db } from "@/server/db";

export interface LoginState {
  error?: string;
  email?: string;
}

const credentials = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export async function login(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const typedEmail = String(formData.get("email") ?? "");
  if (!parsed.success) {
    return { error: "Enter a valid email address and your password.", email: typedEmail };
  }
  const { email, password } = parsed.data;

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const limiterKey = `${email}|${ip}`;
  if (isLoginBlocked(limiterKey)) {
    return { error: "Too many failed attempts. Wait 15 minutes, then try again.", email };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, isActive: true, institutionId: true },
  });
  const valid = await verifyPassword(password, user?.passwordHash);
  if (!user || !valid || !user.isActive) {
    recordLoginFailure(limiterKey);
    return { error: "The email or password is incorrect.", email };
  }

  clearLoginFailures(limiterKey);
  await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await writeAudit({ institutionId: user.institutionId, actorId: user.id, action: "USER_SIGNED_IN" });
  redirect("/dashboard");
}

"use server";

import { redirect } from "next/navigation";
import { writeAudit } from "@/server/audit";
import { getCurrentUser } from "./current-user";
import { destroySession } from "./session";

export async function logout(): Promise<void> {
  const user = await getCurrentUser();
  await destroySession();
  if (user) {
    await writeAudit({ institutionId: user.institutionId, actorId: user.id, action: "USER_SIGNED_OUT" });
  }
  redirect("/login");
}

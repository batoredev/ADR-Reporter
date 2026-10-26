"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getToken } from "@/lib/api/client";
import { useApi } from "@/lib/api/use-api";
import type { CurrentUser } from "@/server/auth/current-user";
import { PageError, PageLoading } from "./page-state";

const UserContext = createContext<CurrentUser | null>(null);

/** The signed-in user. Only use inside <SessionGate>. */
export function useUser(): CurrentUser {
  const user = useContext(UserContext);
  if (!user) throw new Error("useUser() must be used inside <SessionGate>");
  return user;
}

/** Loads the signed-in user; sends visitors without a valid session to the login page. */
export function SessionGate({ children }: { children: (user: CurrentUser) => ReactNode }) {
  const router = useRouter();
  const signedIn = typeof window !== "undefined" && getToken() !== null;
  const me = useApi<CurrentUser>(signedIn ? "/auth/me" : null);

  useEffect(() => {
    if (!getToken() || me.error?.status === 401) router.replace("/login");
  }, [me.error, router]);

  if (me.error && me.error.status !== 401) return <PageError error={me.error} />;
  if (!me.data) return <PageLoading />;
  return <UserContext value={me.data}>{children(me.data)}</UserContext>;
}

/** Shows the access-denied page unless the signed-in user passes `check`. */
export function useRequireAccess(check: (user: CurrentUser) => boolean): boolean {
  const user = useUser();
  const router = useRouter();
  const allowed = check(user);
  useEffect(() => {
    if (!allowed) router.replace("/access-denied");
  }, [allowed, router]);
  return allowed;
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FictionalDataBanner } from "@/components/fictional-data-banner";
import { describeAccess } from "@/lib/domain/access";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemoMode } from "@/lib/demo";
import { getCurrentUser } from "@/server/auth/current-user";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  const demo = isDemoMode();
  const demoAccounts = demo
    ? DEMO_ACCOUNTS.map((account) => ({
        email: account.email,
        name: account.name,
        summary: describeAccess({
          roles: account.roles,
          isUrgentContact: account.isUrgentContact ?? false,
          canReassign: account.canReassign ?? false,
        }),
      }))
    : [];

  return (
    <div className="flex min-h-full flex-col bg-secondary">
      <FictionalDataBanner />
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 sm:p-8">
          <div className="mb-6 space-y-1">
            <p className="text-[13px] font-medium text-primary">ADR Reporter</p>
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <p className="text-muted-foreground">Suspected adverse drug reaction reporting and institutional review.</p>
          </div>
          <LoginForm demoAccounts={demoAccounts} demoPassword={demo ? DEMO_PASSWORD : null} />
        </div>
      </main>
    </div>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { actions } from "@/lib/api/actions";
import { getToken, setToken } from "@/lib/api/client";
import { useApi } from "@/lib/api/use-api";
import type { DemoAccountsView } from "@/server/api/views";

type DemoAccountOption = DemoAccountsView["accounts"][number];

export function LoginForm() {
  const router = useRouter();
  const demo = useApi<DemoAccountsView>("/auth/demo");
  const demoAccounts = demo.data?.accounts ?? [];
  const demoPassword = demo.data?.demoPassword ?? null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Already signed in: go straight to the dashboard.
  useEffect(() => {
    if (getToken()) router.replace("/dashboard");
  }, [router]);

  async function signIn(signInEmail: string, signInPassword: string) {
    setPending(true);
    setError(null);
    const result = await actions.login(signInEmail, signInPassword);
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    setToken(result.data.token);
    router.replace("/dashboard");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void signIn(email, password);
  }

  // Demo shortcut: fills the form and signs in through the normal sign-in path.
  function signInAs(account: DemoAccountOption) {
    if (!demoPassword) return;
    setEmail(account.email);
    setPassword(demoPassword);
    void signIn(account.email, demoPassword);
  }

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      {demoPassword && demoAccounts.length > 0 ? (
        <section aria-labelledby="demo-accounts-heading" className="space-y-3">
          <div>
            <h2 id="demo-accounts-heading" className="text-sm font-medium">
              Fictional demo accounts
            </h2>
            <p className="text-[13px] text-muted-foreground">
              Every account uses the password <code className="font-mono text-foreground">{demoPassword}</code>. Select
              one to sign in.
            </p>
          </div>
          <ul className="divide-y rounded-lg border">
            {demoAccounts.map((account) => (
              <li key={account.email}>
                <button
                  type="button"
                  onClick={() => signInAs(account)}
                  disabled={pending}
                  className="flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-60 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <span className="min-w-0">
                    <span className="block font-medium">{account.name}</span>
                    <span className="block text-[13px] break-all text-muted-foreground">{account.email}</span>
                  </span>
                  <span className="text-[13px] text-muted-foreground sm:max-w-[45%] sm:text-right">
                    {account.summary}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

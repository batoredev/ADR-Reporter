"use client";

import { useActionState, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginState } from "./actions";

export interface DemoAccountOption {
  email: string;
  name: string;
  summary: string;
}

interface LoginFormProps {
  demoAccounts: DemoAccountOption[];
  demoPassword: string | null;
}

export function LoginForm({ demoAccounts, demoPassword }: LoginFormProps) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(login, {});
  const formRef = useRef<HTMLFormElement>(null);
  const [email, setEmail] = useState(state.email ?? "");
  const [password, setPassword] = useState("");

  // Demo shortcut: fills the real form and submits it, so it uses the normal sign-in path.
  function signInAs(account: DemoAccountOption) {
    if (!demoPassword) return;
    setEmail(account.email);
    setPassword(demoPassword);
    queueMicrotask(() => formRef.current?.requestSubmit());
  }

  return (
    <div className="space-y-8">
      <form ref={formRef} action={formAction} className="space-y-4" noValidate>
        {state.error ? (
          <Alert variant="destructive" role="alert">
            <AlertCircle aria-hidden />
            <AlertDescription>{state.error}</AlertDescription>
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

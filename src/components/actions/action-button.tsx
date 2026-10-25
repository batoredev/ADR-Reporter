"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/server/workflow/errors";

interface ActionButtonProps {
  action: () => Promise<ActionResult<unknown>>;
  children: ReactNode;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  size?: "default" | "sm";
  /** Navigate here after success instead of refreshing the current page. */
  redirectTo?: string;
  disabled?: boolean;
  confirm?: string;
}

/** A button that runs one server action, shows its refusal inline, and refreshes the page. */
export function ActionButton({ action, children, variant, size, redirectTo, disabled, confirm }: ActionButtonProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    if (confirm && !window.confirm(confirm)) return;
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        router.refresh();
        return;
      }
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" variant={variant} size={size} onClick={run} disabled={disabled || pending}>
        {children}
      </Button>
      {error ? (
        <span role="alert" className="max-w-64 text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}

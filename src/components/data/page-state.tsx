"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, SearchX, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiError } from "@/lib/api/client";
import type { ApiState } from "@/lib/api/use-api";

export function PageLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}

export function PageError({ error, retry }: { error: ApiError; retry?: () => void }) {
  const [Icon, title] =
    error.status === 404
      ? [SearchX, "Not found"]
      : error.status === 403
        ? [ShieldX, "Access denied"]
        : [AlertTriangle, "Something went wrong"];
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-3 py-10 text-center">
      <Icon className="mx-auto size-8 text-muted-foreground" aria-hidden />
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground">{error.message}</p>
      <div className="flex justify-center gap-2">
        {retry && error.status !== 404 && error.status !== 403 ? (
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        ) : null}
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

/** Renders loading and error states for data from useApi, then the page itself. */
export function Loaded<T>({
  state,
  children,
}: {
  state: ApiState<T> & { reload: () => void };
  children: (data: T) => ReactNode;
}) {
  if (state.error && state.data === undefined) return <PageError error={state.error} retry={state.reload} />;
  if (state.data === undefined) return <PageLoading />;
  return children(state.data);
}

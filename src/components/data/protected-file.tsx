"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import { apiFile, openFile } from "@/lib/api/client";

/** A link-styled button that opens a signed-in-only file (PDF or upload) in a new tab. */
export function FileLink({ path, children, className }: { path: string; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => void openFile(path)}
      className={cn(
        "inline-flex items-center gap-1 text-left text-primary underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Loads a signed-in-only file as a local object URL for <iframe> or <img>. */
export function useFileUrl(path: string | null) {
  const [state, setState] = useState<{
    path: string;
    url: string | null;
    filename: string | null;
    contentType: string | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    if (!path) return;
    let url: string | null = null;
    let cancelled = false;
    apiFile(path).then(
      ({ blob, filename }) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ path, url, filename, contentType: blob.type, error: null });
      },
      (error: unknown) =>
        !cancelled &&
        setState({
          path,
          url: null,
          filename: null,
          contentType: null,
          error: error instanceof Error ? error.message : "The file could not be loaded.",
        }),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  const current = state?.path === path ? state : null;
  return {
    url: current?.url ?? null,
    filename: current?.filename ?? null,
    contentType: current?.contentType ?? null,
    error: current?.error ?? null,
    failed: Boolean(current?.error),
  };
}

export function ProtectedFrame({ path, title, className }: { path: string; title: string; className?: string }) {
  const { url, failed } = useFileUrl(path);
  if (failed) return <p className="p-4 text-sm text-destructive">The preview could not be loaded.</p>;
  if (!url) return <div className={cn("animate-pulse bg-secondary", className)} aria-label="Loading preview" />;
  return <iframe title={title} src={`${url}#view=FitH`} className={className} />;
}

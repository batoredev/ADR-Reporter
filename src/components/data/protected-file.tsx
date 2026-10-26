"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import { apiBlob, openFile } from "@/lib/api/client";

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
export function useFileUrl(path: string | null): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ path: string; url: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!path) return;
    let url: string | null = null;
    let cancelled = false;
    apiBlob(path).then(
      (blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ path, url, failed: false });
      },
      () => !cancelled && setState({ path, url: null, failed: true }),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return state && state.path === path ? { url: state.url, failed: state.failed } : { url: null, failed: false };
}

export function ProtectedFrame({ path, title, className }: { path: string; title: string; className?: string }) {
  const { url, failed } = useFileUrl(path);
  if (failed) return <p className="p-4 text-sm text-destructive">The preview could not be loaded.</p>;
  if (!url) return <div className={cn("animate-pulse bg-secondary", className)} aria-label="Loading preview" />;
  return <iframe title={title} src={`${url}#view=FitH`} className={className} />;
}

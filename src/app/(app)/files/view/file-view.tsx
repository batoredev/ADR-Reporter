"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Download, LoaderCircle } from "lucide-react";
import { useFileUrl } from "@/components/data/protected-file";
import { Button } from "@/components/ui/button";
import { pages } from "@/lib/routes";

export function FileView() {
  const requested = useSearchParams().get("path");
  // Only document endpoints are accepted; the session token stays in this browser.
  const match = requested?.match(
    /^\/cases\/([a-zA-Z0-9_-]+)\/(?:pdf(?:\?version=[1-9]\d*)?|documents\/[a-zA-Z0-9_-]+)$/,
  );
  const path = match ? requested : null;
  const { url, filename, contentType, error } = useFileUrl(path);
  const isPdf = contentType === "application/pdf";

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Button asChild variant="outline">
        <Link href={match ? pages.caseView(match[1]) : "/dashboard"}>
          <ArrowLeft aria-hidden /> {match ? "Back to report" : "Back to dashboard"}
        </Link>
      </Button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="break-all text-xl font-semibold tracking-tight">{filename ?? "Document"}</h1>
        {url && filename ? (
          <Button asChild>
            <a href={url} download={filename}>
              <Download aria-hidden /> Download {isPdf ? "PDF" : "file"}
            </a>
          </Button>
        ) : null}
      </div>
      {!path || error ? (
        <div role="alert" className="space-y-3 rounded-lg border p-5">
          <p className="font-medium">The document could not be opened.</p>
          <p className="text-sm text-muted-foreground">{error ?? "The document link is invalid."}</p>
          {path ? (
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : !url ? (
        <p role="status" className="flex items-center gap-2 py-8 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Preparing your document…
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            If the preview is blank or your browser cannot display it, use the download button above.
          </p>
          {isPdf ? (
            <iframe
              title="PDF preview"
              src={`${url}#view=FitH`}
              className="h-[75vh] w-full rounded-lg border bg-white"
            />
          ) : contentType === "image/png" || contentType === "image/jpeg" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={filename ?? "Uploaded document"} className="mx-auto max-h-[75vh] rounded-lg border" />
          ) : null}
        </>
      )}
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { actions } from "@/lib/api/actions";
import { pages } from "@/lib/routes";

export function SubmitForm({
  caseId,
  lockVersion,
  resubmission,
}: {
  caseId: string;
  lockVersion: number;
  resubmission: boolean;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);
  const [responseNote, setResponseNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await actions.submit(caseId, { lockVersion, declaration: confirmed, responseNote });
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    router.push(`${pages.caseView(caseId)}&submitted=${result.data.versionNo}`);
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-lg border bg-card p-4">
      {resubmission ? (
        <div className="space-y-1">
          <label htmlFor="responseNote" className="text-[13px] font-medium">
            Note to the reviewer (optional)
          </label>
          <textarea
            id="responseNote"
            rows={3}
            value={responseNote}
            onChange={(e) => setResponseNote(e.target.value)}
            className="w-full rounded-lg border border-input px-2.5 py-1.5 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            placeholder="What you corrected, or why something is unavailable"
          />
        </div>
      ) : null}
      <label className="flex gap-2 text-[13px]">
        <input
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>
          I confirm this report is accurate to the best of my knowledge and contains no invented information. Submitting
          it is not an admission that the medicine caused the reaction.
        </span>
      </label>
      <p className="text-xs text-muted-foreground">
        Submitting sends the report to the institutional review pool. It does not send anything to PvPI. Signing in is
        not a signature; the printed form has a space for a handwritten one.
      </p>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={!confirmed || pending}>
        <Send aria-hidden /> {resubmission ? "Resubmit for review" : "Submit for institutional review"}
      </Button>
    </form>
  );
}

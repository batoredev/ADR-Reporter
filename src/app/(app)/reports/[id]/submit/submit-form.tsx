"use client";

import { useActionState, useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitAction, type SubmitState } from "../../actions";

export function SubmitForm({
  caseId,
  lockVersion,
  resubmission,
}: {
  caseId: string;
  lockVersion: number;
  resubmission: boolean;
}) {
  const [state, action, pending] = useActionState<SubmitState, FormData>(submitAction.bind(null, caseId), {});
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form action={action} className="space-y-3 rounded-lg border bg-card p-4">
      <input type="hidden" name="lockVersion" value={lockVersion} />
      {resubmission ? (
        <div className="space-y-1">
          <label htmlFor="responseNote" className="text-[13px] font-medium">
            Note to the reviewer (optional)
          </label>
          <textarea
            id="responseNote"
            name="responseNote"
            rows={3}
            className="w-full rounded-lg border border-input px-2.5 py-1.5 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            placeholder="What you corrected, or why something is unavailable"
          />
        </div>
      ) : null}
      <label className="flex gap-2 text-[13px]">
        <input
          type="checkbox"
          name="declaration"
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
      {state.error ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={!confirmed || pending}>
        <Send aria-hidden /> {resubmission ? "Resubmit for review" : "Submit for institutional review"}
      </Button>
    </form>
  );
}

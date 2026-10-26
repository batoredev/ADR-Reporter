"use client";

import { useState } from "react";
import { Siren } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { actions } from "@/lib/api/actions";
import { refreshData } from "@/lib/api/use-api";

export function EscalateButton({ caseId }: { caseId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setError(null);
    const result = await actions.escalate(caseId, note);
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    refreshData();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <Siren aria-hidden /> Escalate urgently
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Escalate urgently</DialogTitle>
          <DialogDescription>
            The designated urgent contacts are alerted straight away. This does not wait for, or replace, the routine
            review.
          </DialogDescription>
        </DialogHeader>
        <label htmlFor="escalation-note" className="text-[13px] font-medium">
          Urgency note
        </label>
        <textarea
          id="escalation-note"
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-lg border border-input px-2.5 py-1.5 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          placeholder="What happened and why it is urgent"
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={pending}>
            <Siren aria-hidden /> Escalate now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

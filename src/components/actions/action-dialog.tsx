"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
import type { ActionResult } from "@/server/workflow/errors";

const control =
  "w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type DialogField =
  | {
      name: string;
      label: string;
      type: "text" | "datetime-local" | "textarea";
      placeholder?: string;
      hint?: string;
      defaultValue?: string;
      optional?: boolean;
    }
  | {
      name: string;
      label: string;
      type: "select" | "radio";
      options: { value: string; label: string; hint?: string }[];
      placeholder?: undefined;
      hint?: string;
      defaultValue?: string;
      optional?: boolean;
    };

/** Show a field only while another field has this value. */
export interface DialogFieldCondition {
  field: string;
  equals: string;
}

interface ActionDialogProps {
  trigger: ReactNode;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  triggerSize?: "default" | "sm";
  title: string;
  description?: ReactNode;
  fields: (DialogField & { showWhen?: DialogFieldCondition })[];
  submitLabel: string;
  submitVariant?: "default" | "destructive";
  action: (values: Record<string, string>) => Promise<ActionResult<unknown>>;
  disabled?: boolean;
}

/** A dialog with a few inputs that runs one server action. Refusals stay in the dialog. */
export function ActionDialog(p: ActionDialogProps) {
  const router = useRouter();
  const initial = () => Object.fromEntries(p.fields.map((f) => [f.name, f.defaultValue ?? ""]));
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));

  function openChange(next: boolean) {
    setOpen(next);
    if (next) {
      setValues(initial());
      setError(null);
    }
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await p.action(values);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={openChange}>
      <DialogTrigger asChild>
        <Button type="button" variant={p.triggerVariant ?? "outline"} size={p.triggerSize} disabled={p.disabled}>
          {p.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
          {p.description ? <DialogDescription>{p.description}</DialogDescription> : null}
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {p.fields
            .filter((f) => !f.showWhen || values[f.showWhen.field] === f.showWhen.equals)
            .map((f) => {
              const id = `dialog-${f.name}`;
              const label = (
                <span className="text-[13px] font-medium">
                  {f.label}
                  {f.optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
                </span>
              );
              const hint = f.hint ? <span className="block text-xs text-muted-foreground">{f.hint}</span> : null;
              if (f.type === "radio") {
                return (
                  <fieldset key={f.name} className="space-y-1.5">
                    <legend className="mb-1">{label}</legend>
                    {f.options.map((o) => (
                      <label key={o.value} className="flex items-start gap-2 text-sm">
                        <input
                          type="radio"
                          name={id}
                          value={o.value}
                          checked={values[f.name] === o.value}
                          onChange={() => set(f.name, o.value)}
                          className="mt-1 accent-primary"
                        />
                        <span>
                          {o.label}
                          {o.hint ? <span className="block text-xs text-muted-foreground">{o.hint}</span> : null}
                        </span>
                      </label>
                    ))}
                    {hint}
                  </fieldset>
                );
              }
              return (
                <div key={f.name} className="space-y-1">
                  <label htmlFor={id}>{label}</label>
                  {f.type === "select" ? (
                    <select
                      id={id}
                      value={values[f.name]}
                      onChange={(e) => set(f.name, e.target.value)}
                      className={`${control} h-8`}
                    >
                      <option value="">Choose…</option>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea
                      id={id}
                      rows={3}
                      value={values[f.name]}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.name, e.target.value)}
                      className={`${control} py-1.5`}
                    />
                  ) : (
                    <input
                      id={id}
                      type={f.type}
                      value={values[f.name]}
                      placeholder={f.placeholder}
                      onChange={(e) => set(f.name, e.target.value)}
                      className={`${control} h-8`}
                    />
                  )}
                  {hint}
                </div>
              );
            })}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={p.submitVariant ?? "default"} disabled={pending}>
              {pending ? "Saving…" : p.submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

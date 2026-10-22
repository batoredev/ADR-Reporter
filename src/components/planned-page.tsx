import { Construction } from "lucide-react";

interface PlannedPageProps {
  title: string;
  step: number;
  description: string;
}

/** Placeholder for a screen scheduled in a later build step. */
export function PlannedPage({ title, step, description }: PlannedPageProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="flex gap-3 rounded-lg border border-dashed bg-secondary px-4 py-5">
        <Construction className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1">
          <p className="font-medium">Not built yet: planned for Step {step}</p>
          <p className="text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

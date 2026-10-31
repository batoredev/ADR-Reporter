import { Info } from "lucide-react";

export function FictionalDataBanner({ compact = false }: { compact?: boolean }) {
  if (compact)
    return (
      <p
        className="bg-secondary px-3 py-2 text-center text-xs text-muted-foreground"
        title="Fictional demonstration system. Do not enter real patient information."
      >
        <Info className="mr-1.5 inline size-3.5" aria-hidden />
        <span className="sm:hidden">Fictional demonstration system · test data only</span>
        <span className="hidden sm:inline">Demo · fictional data</span>
      </p>
    );
  return (
    <div className="border-b border-warning/20 bg-warning-soft px-4 py-1.5 text-center text-[13px] text-warning">
      <Info className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
      Fictional demonstration system. Do not enter real patient information.
    </div>
  );
}

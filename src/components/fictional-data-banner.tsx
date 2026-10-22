import { Info } from "lucide-react";

export function FictionalDataBanner() {
  return (
    <div className="border-b border-warning/20 bg-warning-soft px-4 py-1.5 text-center text-[13px] text-warning">
      <Info className="mr-1.5 inline size-3.5 align-[-2px]" aria-hidden />
      Fictional demonstration system. Do not enter real patient information.
    </div>
  );
}

import { Sparkles } from "lucide-react";
import type { AiAttempt, AiStatus } from "@/server/ai/provider";

/** Which AI services will be tried, in order: free ones first, then paid. */
export function AiChain({ ai }: { ai: AiStatus }) {
  if (!ai.available) return <>AI unavailable: enter details manually. ({ai.reason})</>;
  if (ai.provider === "fixture") return <>Test mode: saved example data, no AI service</>;
  return (
    <>
      <Sparkles className="mr-1 inline size-3 text-ai" aria-hidden />
      Try in order: {ai.chain.map((c) => `${c.provider} / ${c.model}${c.tier === "paid" ? " (paid)" : ""}`).join(" → ")}
      .{ai.paidEnabled ? " Paid fallback enabled." : " Paid Claude disabled."}
    </>
  );
}

/** Who produced a suggestion, and which services were busy before it. */
export function AiSource({ provider, model, attempts }: { provider: string; model: string; attempts: AiAttempt[] }) {
  if (provider === "fixture") return <>saved test data (not AI)</>;
  return (
    <>
      {provider} / {model}
      {attempts.length ? (
        <span className="text-muted-foreground">
          {" "}
          (after {attempts.map((a) => a.model).join(", ")} could not answer)
        </span>
      ) : null}
    </>
  );
}

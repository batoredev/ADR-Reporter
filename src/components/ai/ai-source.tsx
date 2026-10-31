import type { AiStatus } from "@/server/ai/provider";

/** Show only availability information that helps the reporter continue. */
export function AiChain({ ai }: { ai: AiStatus }) {
  if (!ai.available) return <>This tool is temporarily unavailable. You can enter details manually.</>;
  if (ai.provider === "fixture") return <>Demonstration example</>;
  return null;
}

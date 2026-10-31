import "server-only";
import type { z } from "zod";

export type DocumentMimeType = "image/png" | "image/jpeg" | "application/pdf";

/** Which job a request is for. Recorded with each run; the test provider answers by task. */
export type AiTask = "extract-document" | "narrative" | "consistency" | "guided" | "chat";

export interface GenerateRequest<T> {
  task: AiTask;
  /** Standing instructions (the rules the model must follow). */
  system: string;
  /** What to do with this particular input. */
  prompt: string;
  /** An uploaded document to read, if any. */
  document?: { bytes: Uint8Array; mimeType: DocumentMimeType };
  /** The reply must be JSON matching this schema; anything else is rejected. */
  schema: z.ZodType<T>;
  maxOutputTokens?: number;
  /** Task-specific semantic checks; throwing rejects a reply and tries the next provider. */
  validateOutput?: (output: T) => void;
  /** Aborts the attempt; the router moves on to the next provider. */
  signal?: AbortSignal;
}

export interface GenerateResult<T> {
  output: T;
  /** Provider metadata kept with the run (ids, token usage). Never the API key. */
  meta: Record<string, unknown>;
}

export interface AiProvider {
  /** Provider name, e.g. "gemini". Recorded with every run. */
  name: string;
  /** Model identifier. Recorded with every run. */
  model: string;
  /** Free tier or paid, shown to the user so the cost is never a surprise. */
  tier: "free" | "paid" | "test";
  canRead(mimeType: DocumentMimeType): boolean;
  generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>>;
}

/** A failure the reporter may see (service busy, key rejected, unreadable reply). The router tries the next provider. */
export class AiError extends Error {}

/** Parses a JSON reply and checks it against the schema; a reply that does not fit is never used. */
export function parseReply<T>(schema: z.ZodType<T>, text: string | null | undefined, provider: string): T {
  if (!text) throw new AiError(`${provider} returned an empty reply.`);
  let json: unknown;
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new AiError(`${provider} replied with text that is not JSON.`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new AiError(`${provider} replied in the wrong format.`);
  return parsed.data;
}

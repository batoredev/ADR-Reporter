import "server-only";
import { createAnthropicProvider } from "./anthropic";
import { createFixtureProvider } from "./fixture";
import { createGeminiProvider } from "./gemini";
import { createOllamaProvider, OLLAMA_CLOUD_URL } from "./ollama";
import { AiError, type AiProvider, type DocumentMimeType, type GenerateRequest } from "./types";

export { AiError, type AiProvider, type AiTask, type DocumentMimeType } from "./types";

export const DEFAULT_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
export const DEFAULT_OLLAMA_MODEL = "gemma4:31b";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";
const DEFAULT_ORDER = ["gemini", "ollama", "anthropic"];

export interface AiStatus {
  available: boolean;
  /** First provider tried (kept for older screens). */
  provider: string;
  model: string | null;
  /** Every provider and model, in the order they are tried. */
  chain: { provider: string; model: string; tier: AiProvider["tier"] }[];
  reason?: string;
}

type Env = Record<string, string | undefined>;

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The providers to try, in order, from the environment (.env locally,
 * Edge Function secrets in Supabase):
 *
 *   AI_PROVIDER       none | fixture | a comma list such as "gemini,ollama,anthropic"
 *                     (default: free first, then paid: gemini, ollama, anthropic)
 *   GEMINI_API_KEY    enables Gemini; GEMINI_MODEL is a comma list tried in turn
 *   OLLAMA_API_KEY    enables Ollama Cloud; OLLAMA_BASE_URL points at another Ollama server instead
 *   ANTHROPIC_API_KEY enables Claude; ANTHROPIC_MODEL (default claude-sonnet-5-5), AI_EFFORT optional
 *
 * A provider without its key is skipped, never an error.
 */
export function configuredProviders(env: Env = process.env): AiProvider[] {
  const setting = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  if (setting === "none") return [];
  if (setting === "fixture") return [createFixtureProvider()];
  const order = list(setting).length ? list(setting) : DEFAULT_ORDER;
  const providers: AiProvider[] = [];
  for (const name of [...new Set(order)]) {
    if (name === "gemini") {
      const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
      if (!apiKey) continue;
      const models = list(env.GEMINI_MODEL).length ? list(env.GEMINI_MODEL) : DEFAULT_GEMINI_MODELS;
      for (const model of models) providers.push(createGeminiProvider({ apiKey, model }));
    } else if (name === "ollama") {
      const apiKey = env.OLLAMA_API_KEY?.trim();
      const baseUrl = env.OLLAMA_BASE_URL?.trim() || (apiKey ? OLLAMA_CLOUD_URL : "");
      if (!baseUrl) continue;
      const models = list(env.OLLAMA_MODEL).length ? list(env.OLLAMA_MODEL) : [DEFAULT_OLLAMA_MODEL];
      for (const model of models) providers.push(createOllamaProvider({ baseUrl, apiKey, model }));
    } else if (name === "anthropic") {
      const apiKey = env.ANTHROPIC_API_KEY?.trim() || env.AI_API_KEY?.trim();
      if (!apiKey) continue;
      const model = env.ANTHROPIC_MODEL?.trim() || env.AI_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
      providers.push(createAnthropicProvider({ apiKey, model, effort: env.AI_EFFORT?.trim() || undefined }));
    }
  }
  return providers;
}

export function aiStatus(env: Env = process.env): AiStatus {
  const providers = configuredProviders(env);
  const chain = providers.map((p) => ({ provider: p.name, model: p.model, tier: p.tier }));
  if (providers.length) return { available: true, provider: providers[0].name, model: providers[0].model, chain };
  const setting = (env.AI_PROVIDER ?? "").trim().toLowerCase();
  return {
    available: false,
    provider: setting || "none",
    model: null,
    chain,
    reason:
      setting === "none"
        ? "AI is switched off (AI_PROVIDER=none)."
        : "No AI key is set (GEMINI_API_KEY, OLLAMA_API_KEY or ANTHROPIC_API_KEY).",
  };
}

export interface AiAttempt {
  provider: string;
  model: string;
  error: string;
}

export interface AiOutcome<T> {
  output: T;
  provider: string;
  model: string;
  meta: Record<string, unknown>;
  /** Providers that were tried first and failed, with why. */
  attempts: AiAttempt[];
}

/** Thrown when no provider could do the job; carries every attempt for the record. */
export class AiUnavailableError extends AiError {
  constructor(
    message: string,
    readonly attempts: AiAttempt[],
  ) {
    super(message);
  }
}

const ATTEMPT_TIMEOUT_MS: Record<string, number> = { gemini: 45_000, ollama: 60_000, anthropic: 100_000 };

/**
 * Runs a request on the first provider that can do it: free ones first, then
 * paid. A busy, over-quota or failing provider hands over to the next one. The
 * whole run stays inside AI_TOTAL_TIMEOUT_MS (default 140 s), below the Edge
 * Function's own limit.
 */
export async function generateWithFallback<T>(
  request: GenerateRequest<T>,
  options: { providers?: AiProvider[]; totalTimeoutMs?: number } = {},
): Promise<AiOutcome<T>> {
  const providers = options.providers ?? configuredProviders();
  if (!providers.length) throw new AiUnavailableError("AI is not configured. Enter the details manually.", []);
  const mime: DocumentMimeType | undefined = request.document?.mimeType;
  const usable = mime ? providers.filter((p) => p.canRead(mime)) : providers;
  if (!usable.length)
    throw new AiUnavailableError("None of the configured AI services can read this kind of file. Try a photo.", []);

  const deadline = Date.now() + (options.totalTimeoutMs ?? (Number(process.env.AI_TOTAL_TIMEOUT_MS) || 140_000));
  const attempts: AiAttempt[] = [];
  for (const provider of usable) {
    const remaining = deadline - Date.now();
    if (remaining < 5_000) {
      attempts.push({ provider: provider.name, model: provider.model, error: "Skipped: out of time." });
      continue;
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(ATTEMPT_TIMEOUT_MS[provider.name] ?? 60_000, remaining),
    );
    try {
      const result = await provider.generate({ ...request, signal: controller.signal });
      return { output: result.output, provider: provider.name, model: provider.model, meta: result.meta, attempts };
    } catch (error) {
      if (!(error instanceof AiError)) console.error(`AI provider ${provider.name}/${provider.model} failed`, error);
      attempts.push({
        provider: provider.name,
        model: provider.model,
        error: error instanceof AiError ? error.message : "Unexpected error.",
      });
    } finally {
      clearTimeout(timer);
    }
  }
  const last = attempts.at(-1)?.error ?? "No AI service answered.";
  throw new AiUnavailableError(
    attempts.length > 1 ? `No AI service could do this right now. Last reply: ${last} Try again later.` : last,
    attempts,
  );
}

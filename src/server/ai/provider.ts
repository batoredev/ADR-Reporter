import "server-only";
import { createAnthropicProvider } from "./anthropic";
import { createFixtureProvider } from "./fixture";
import type { AiProvider } from "./types";

export { AiError, type AiProvider, type ExtractionMimeType } from "./types";

export interface AiStatus {
  available: boolean;
  provider: string;
  model: string | null;
  reason?: string;
}

/**
 * The configured provider, from .env:
 *   AI_PROVIDER = none | anthropic | fixture   (fixture returns saved test data, for automated tests)
 *   AI_MODEL    = model identifier (anthropic default: claude-opus-5-5)
 *   AI_API_KEY  = provider key (ANTHROPIC_API_KEY also accepted)
 */
export function getAiProvider(): AiProvider | null {
  const provider = (process.env.AI_PROVIDER ?? "none").trim().toLowerCase();
  const model = process.env.AI_MODEL?.trim();
  if (provider === "anthropic") {
    const key = process.env.AI_API_KEY?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
    if (!key) return null;
    return createAnthropicProvider({
      apiKey: key,
      model: model || "claude-opus-5-5",
      effort: process.env.AI_EFFORT?.trim(),
    });
  }
  if (provider === "fixture") return createFixtureProvider();
  return null;
}

export function aiStatus(): AiStatus {
  const provider = (process.env.AI_PROVIDER ?? "none").trim().toLowerCase() || "none";
  const configured = getAiProvider();
  if (configured) return { available: true, provider: configured.name, model: configured.model };
  if (provider === "anthropic") return { available: false, provider, model: null, reason: "AI_API_KEY is not set." };
  if (provider === "none") return { available: false, provider, model: null, reason: "AI_PROVIDER is set to none." };
  return { available: false, provider, model: null, reason: `Unknown AI_PROVIDER "${provider}".` };
}

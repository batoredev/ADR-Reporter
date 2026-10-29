import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { toBase64 } from "./json-schema";
import { AiError, type AiProvider } from "./types";

/** Models that take the server-side refusal fallback in its "default" form. */
const SERVER_FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Anthropic Claude: the paid last resort after the free providers. Structured
 * output is validated against the same Zod schema. On models that support it,
 * a declined request is retried server-side on another Claude model
 * (`fallbacks: "default"`).
 */
export function createAnthropicProvider(config: { apiKey: string; model: string; effort?: string }): AiProvider {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: 120_000, maxRetries: 1 });
  const serverFallback = SERVER_FALLBACK_MODELS.has(config.model);
  return {
    name: "anthropic",
    model: config.model,
    tier: "paid",
    canRead: () => true,
    async generate({ system, prompt, document, schema, maxOutputTokens, signal }) {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (document) {
        const data = toBase64(document.bytes);
        content.push(
          document.mimeType === "application/pdf"
            ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
            : { type: "image", source: { type: "base64", media_type: document.mimeType, data } },
        );
      }
      content.push({ type: "text", text: prompt });
      try {
        const response = await client.beta.messages.parse(
          {
            model: config.model,
            max_tokens: maxOutputTokens ?? 16000,
            system,
            messages: [{ role: "user", content }],
            output_config: {
              format: betaZodOutputFormat(schema),
              ...(config.effort ? { effort: config.effort as Effort } : {}),
            },
            ...(serverFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          },
          { signal },
        );
        if (response.stop_reason === "refusal") throw new AiError("Claude declined to read this input.");
        if (response.stop_reason === "max_tokens") throw new AiError("Claude's reply was cut off.");
        if (!response.parsed_output) throw new AiError("Claude's reply could not be read.");
        return {
          output: response.parsed_output,
          meta: { id: response.id, model: response.model, usage: response.usage },
        };
      } catch (error) {
        if (error instanceof AiError) throw error;
        if (error instanceof Anthropic.AuthenticationError)
          throw new AiError("Claude rejected the API key (ANTHROPIC_API_KEY).");
        if (error instanceof Anthropic.PermissionDeniedError)
          throw new AiError("The API key is not allowed to use this Claude model.");
        if (error instanceof Anthropic.NotFoundError)
          throw new AiError(`The Claude model "${config.model}" was not found (ANTHROPIC_MODEL).`);
        if (error instanceof Anthropic.RateLimitError)
          throw new AiError("Claude is busy. Wait a moment and try again.");
        if (error instanceof Anthropic.APIUserAbortError) throw new AiError("Claude took too long to answer.");
        if (error instanceof Anthropic.APIConnectionError) throw new AiError("Could not reach Claude.");
        if (error instanceof Anthropic.BadRequestError && /credit balance/i.test(error.message))
          throw new AiError("The Claude account has no credit left (Anthropic console, Plans & Billing).");
        if (error instanceof Anthropic.APIError)
          throw new AiError(`Claude returned an error (${error.status ?? "unknown"}).`);
        throw error;
      }
    },
  };
}

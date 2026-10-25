import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { EXTRACTION_INSTRUCTIONS, extractionSchema } from "@/lib/domain/extraction";
import { AiError, type AiProvider } from "./types";

/** Anthropic Claude adapter: image or PDF in, schema-validated JSON out. */
export function createAnthropicProvider(config: { apiKey: string; model: string; effort?: string }): AiProvider {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: 120_000 });
  return {
    name: "anthropic",
    model: config.model,
    async extractMedications({ bytes, mimeType }) {
      const data = bytes.toString("base64");
      const document =
        mimeType === "application/pdf"
          ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
          : ({ type: "image", source: { type: "base64", media_type: mimeType, data } } as const);
      try {
        const response = await client.messages.parse({
          model: config.model,
          max_tokens: 16000,
          system: EXTRACTION_INSTRUCTIONS,
          messages: [
            {
              role: "user",
              content: [document, { type: "text", text: "Extract the prescribed medicines from this document." }],
            },
          ],
          output_config: {
            format: zodOutputFormat(extractionSchema),
            ...(config.effort ? { effort: config.effort as "low" | "medium" | "high" } : {}),
          },
        });
        if (response.stop_reason === "refusal") throw new AiError("The AI service declined to read this document.");
        if (response.stop_reason === "max_tokens")
          throw new AiError("The AI reply was cut off. Try a clearer or smaller document.");
        if (!response.parsed_output) throw new AiError("The AI reply could not be read. Nothing was filled in.");
        return {
          output: response.parsed_output,
          raw: { id: response.id, model: response.model, usage: response.usage },
        };
      } catch (error) {
        if (error instanceof AiError) throw error;
        if (error instanceof Anthropic.AuthenticationError)
          throw new AiError("The AI service rejected the API key (AI_API_KEY).");
        if (error instanceof Anthropic.PermissionDeniedError)
          throw new AiError("The API key is not allowed to use this model.");
        if (error instanceof Anthropic.NotFoundError)
          throw new AiError(`The model "${config.model}" was not found (AI_MODEL).`);
        if (error instanceof Anthropic.RateLimitError)
          throw new AiError("The AI service is busy. Wait a moment and try again.");
        if (error instanceof Anthropic.APIConnectionError)
          throw new AiError("Could not reach the AI service. Check the internet connection.");
        if (error instanceof Anthropic.APIError)
          throw new AiError(`The AI service returned an error (${error.status ?? "unknown"}).`);
        throw error;
      }
    },
  };
}

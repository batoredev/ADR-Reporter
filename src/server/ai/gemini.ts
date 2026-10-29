import "server-only";
import { replyJsonSchema, toBase64 } from "./json-schema";
import { AiError, parseReply, type AiProvider } from "./types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Gemini finish reasons that mean the model declined rather than ran out of room. */
const REFUSED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"]);

interface GeminiReply {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: Record<string, unknown>;
  modelVersion?: string;
  error?: { code?: number; message?: string; status?: string };
}

/**
 * Google Gemini over plain fetch (no SDK), so the same code runs in Node and
 * in the Supabase Edge Function. The free tier is the first choice; it is
 * often busy (503) or out of daily quota (429), which the router treats as
 * "try the next model".
 */
export function createGeminiProvider(config: { apiKey: string; model: string; fetchImpl?: typeof fetch }): AiProvider {
  const doFetch = config.fetchImpl ?? fetch;
  return {
    name: "gemini",
    model: config.model,
    tier: "free",
    canRead: () => true,
    async generate({ system, prompt, document, schema, maxOutputTokens, signal }) {
      const parts: Record<string, unknown>[] = [];
      if (document) parts.push({ inlineData: { mimeType: document.mimeType, data: toBase64(document.bytes) } });
      parts.push({ text: prompt });
      let response: Response;
      try {
        response = await doFetch(`${ENDPOINT}/${encodeURIComponent(config.model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": config.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts }],
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: replyJsonSchema(schema),
              maxOutputTokens: maxOutputTokens ?? 8192,
            },
          }),
          signal,
        });
      } catch {
        throw new AiError(signal?.aborted ? "Gemini took too long to answer." : "Could not reach Gemini.");
      }
      const reply = (await response.json().catch(() => ({}))) as GeminiReply;
      if (!response.ok) {
        const status = response.status;
        if (status === 429) throw new AiError("Gemini's quota is used up for now.");
        if (status === 503 || status === 500) throw new AiError("Gemini is busy at the moment.");
        if (status === 401 || status === 403) throw new AiError("Gemini rejected the API key (GEMINI_API_KEY).");
        if (status === 404) throw new AiError(`The Gemini model "${config.model}" is not available.`);
        throw new AiError(`Gemini returned an error (${status}).`);
      }
      if (reply.promptFeedback?.blockReason) throw new AiError("Gemini declined to read this input.");
      const candidate = reply.candidates?.[0];
      const finish = candidate?.finishReason ?? "";
      if (finish === "MAX_TOKENS") throw new AiError("Gemini's reply was cut off.");
      if (REFUSED.has(finish) || finish.startsWith("IMAGE_")) throw new AiError("Gemini declined to read this input.");
      const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("");
      return {
        output: parseReply(schema, text, "Gemini"),
        meta: { modelVersion: reply.modelVersion ?? config.model, usage: reply.usageMetadata ?? null },
      };
    },
  };
}

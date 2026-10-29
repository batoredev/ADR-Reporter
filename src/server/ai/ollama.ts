import "server-only";
import { replyJsonSchema, toBase64 } from "./json-schema";
import { AiError, parseReply, type AiProvider } from "./types";

export const OLLAMA_CLOUD_URL = "https://ollama.com";

interface OllamaReply {
  message?: { content?: string };
  /** "stop" when complete, "length" when it hit num_predict. */
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * Ollama's /api/chat over plain fetch: Ollama Cloud (https://ollama.com, with
 * OLLAMA_API_KEY) or any Ollama server the Edge Function can reach. A
 * function in the cloud cannot reach Ollama on someone's own computer.
 *
 * Local servers use schema-constrained output. Cloud requests include the
 * schema in the prompt and are validated after generation because Ollama Cloud
 * does not support the format parameter. Invalid replies fall back safely.
 * Ollama reads images, not PDF files; the router skips it for PDFs.
 */
export function createOllamaProvider(config: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetchImpl?: typeof fetch;
}): AiProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const cloud = new URL(baseUrl).hostname === "ollama.com" || /:.*cloud$/.test(config.model);
  return {
    name: "ollama",
    model: config.model,
    tier: "free",
    canRead: (mimeType) => mimeType === "image/png" || mimeType === "image/jpeg",
    async generate({ system, prompt, document, schema, maxOutputTokens, signal }) {
      const jsonSchema = replyJsonSchema(schema);
      const user: Record<string, unknown> = { role: "user", content: prompt };
      if (document) user.images = [toBase64(document.bytes)];
      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: config.model,
            stream: false,
            think: false,
            // Cloud does not support constrained structured outputs. Supply the
            // schema in the prompt and validate locally; invalid JSON falls back.
            ...(!cloud ? { format: jsonSchema } : {}),
            options: { temperature: 0, num_predict: maxOutputTokens ?? 8192 },
            messages: [
              {
                role: "system",
                content: `${system}\n\nReply with JSON only, matching this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
              },
              user,
            ],
          }),
          signal,
        });
      } catch {
        throw new AiError(signal?.aborted ? "Ollama took too long to answer." : "Could not reach Ollama.");
      }
      const reply = (await response.json().catch(() => ({}))) as OllamaReply;
      if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) throw new AiError("Ollama rejected the API key (OLLAMA_API_KEY).");
        if (status === 429) throw new AiError("Ollama's usage limit is reached for now.");
        if (status === 404) throw new AiError(`The Ollama model "${config.model}" was not found.`);
        throw new AiError(`Ollama returned an error (${status}).`);
      }
      if (reply.done_reason === "length") throw new AiError("Ollama's reply was cut off.");
      return {
        output: parseReply(schema, reply.message?.content, "Ollama"),
        meta: { promptTokens: reply.prompt_eval_count ?? null, outputTokens: reply.eval_count ?? null },
      };
    },
  };
}

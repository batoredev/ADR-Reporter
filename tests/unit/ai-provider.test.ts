import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
const policy = vi.hoisted(() => ({ ALLOW_PAID_AI: false }));
vi.mock("@/server/ai/config", () => policy);
import { configuredProviders, generateWithFallback, aiStatus, AiError, type AiProvider } from "@/server/ai/provider";
import { createGeminiProvider } from "@/server/ai/gemini";
import { createOllamaProvider } from "@/server/ai/ollama";
import { createFixtureProvider } from "@/server/ai/fixture";
import { documentExtractionSchema } from "@/lib/domain/extraction";
import { narrativeSchema } from "@/lib/domain/narrative";
import { consistencySchema } from "@/lib/domain/ai-checks";
import { guidedSchema } from "@/lib/domain/guided";

const schema = z.object({ answer: z.string() });
const request = { task: "narrative" as const, system: "Return JSON", prompt: "Test", schema };
function provider(name: string, tier: AiProvider["tier"] = "free", fail = false): AiProvider {
  return {
    name,
    model: name,
    tier,
    canRead: () => true,
    generate: vi.fn(async ({ schema }) => {
      if (fail) throw new AiError("quota exhausted");
      return { output: schema.parse({ answer: name }), meta: {} };
    }),
  };
}
afterEach(() => {
  policy.ALLOW_PAID_AI = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AI routing and paid opt-in", () => {
  it("defaults to Ollama then Gemini and excludes Claude even with an explicit key/order", () => {
    const env = { OLLAMA_API_KEY: "test", GEMINI_API_KEY: "test", ANTHROPIC_API_KEY: "test" };
    expect(configuredProviders(env).map((p) => p.name)).toEqual(["ollama", "gemini", "gemini"]);
    expect(configuredProviders({ ...env, AI_PROVIDER: "anthropic" })).toHaveLength(0);
    expect(aiStatus(env).paidEnabled).toBe(false);
  });
  it("only enables paid fallback after the code switch and always puts it last", () => {
    policy.ALLOW_PAID_AI = true;
    expect(
      configuredProviders({
        AI_PROVIDER: "anthropic,gemini,ollama",
        ANTHROPIC_API_KEY: "test",
        GEMINI_API_KEY: "test",
        OLLAMA_API_KEY: "test",
      }).at(-1)?.tier,
    ).toBe("paid");
  });
  it("falls back after errors, records attempts, skips incompatible document providers", async () => {
    const first = provider("ollama");
    first.canRead = () => false;
    const bad = provider("gemini", "free", true);
    const good = provider("last");
    const result = await generateWithFallback(
      { ...request, document: { bytes: new Uint8Array(), mimeType: "application/pdf" } },
      { providers: [first, bad, good] },
    );
    expect(first.generate).not.toHaveBeenCalled();
    expect(result.output.answer).toBe("last");
    expect(result.attempts[0].error).toBe("quota exhausted");
  });
  it("never invokes an injected paid provider when paid use is disabled", async () => {
    const paid = provider("claude", "paid");
    await expect(generateWithFallback(request, { providers: [paid] })).rejects.toThrow(/not configured/);
    expect(paid.generate).not.toHaveBeenCalled();
  });
  it("reserves time for later providers even if the first ignores cancellation", async () => {
    vi.useFakeTimers();
    const stuck = provider("stuck");
    stuck.generate = () => new Promise(() => {});
    const last = provider("last");
    const pending = generateWithFallback(request, { providers: [stuck, last], totalTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(51);
    const result = await pending;
    expect(result.output.answer).toBe("last");
    expect(result.attempts[0].error).toMatch(/too long/);
  });
  it("caller cancellation stops the chain", async () => {
    const controller = new AbortController();
    controller.abort();
    const p = provider("test");
    await expect(generateWithFallback({ ...request, signal: controller.signal }, { providers: [p] })).rejects.toThrow(
      /cancelled/,
    );
    expect(p.generate).not.toHaveBeenCalled();
  });
  it("tries the next provider when task-specific quality checks reject a schema-valid reply", async () => {
    const first = provider("unreadable");
    const second = provider("clear");
    const result = await generateWithFallback(
      {
        ...request,
        validateOutput: (output) => {
          if (output.answer === "unreadable") throw new AiError("The document is unreadable.");
        },
      },
      { providers: [first, second] },
    );
    expect(result.output.answer).toBe("clear");
    expect(result.attempts[0].error).toContain("unreadable");
  });
});

describe("provider request compatibility", () => {
  it("uses Gemini JSON schema, image bytes and header auth without unsupported thinking options", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"answer":"ok"}' }] }, finishReason: "STOP" }] }),
        ),
      );
    const p = createGeminiProvider({ apiKey: "test-key", model: "gemini-3.8-flash", fetchImpl });
    const r = await p.generate({ ...request, document: { bytes: new Uint8Array([1]), mimeType: "image/png" } });
    expect(r.output.answer).toBe("ok");
    const init = fetchImpl.mock.calls[0][1]!;
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseJsonSchema.type).toBe("object");
    expect(body.generationConfig.thinkingConfig).toBeUndefined();
    expect(body.contents[0].parts[0].inlineData.data).toBe("AQ==");
    expect(init.headers).toMatchObject({ "x-goog-api-key": "test-key" });
  });
  it.each(["https://ollama.com", "http://localhost:11434"])(
    "handles structured JSON correctly at %s",
    async (baseUrl) => {
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: { content: '```json\n{"answer":"ok"}\n```' }, done_reason: "stop" })),
        );
      const p = createOllamaProvider({ baseUrl, model: "gemma4:31b", fetchImpl });
      expect((await p.generate(request)).output.answer).toBe("ok");
      const body = JSON.parse(fetchImpl.mock.calls[0][1]!.body as string);
      expect(Boolean(body.format)).toBe(!baseUrl.includes("ollama.com"));
      expect(body.messages[0].content).toContain('"answer"');
      expect(p.canRead("application/pdf")).toBe(false);
    },
  );
  it("rejects malformed or cut-off replies so another provider can be tried", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ message: { content: "not json" } })));
    await expect(
      createOllamaProvider({ baseUrl: "https://ollama.com", model: "test", fetchImpl }).generate(request),
    ).rejects.toThrow(AiError);
  });
  it("has schema-valid saved fixtures for every supported task", async () => {
    const p = createFixtureProvider();
    for (const [task, taskSchema] of Object.entries({
      "extract-document": documentExtractionSchema,
      narrative: narrativeSchema,
      consistency: consistencySchema,
      guided: guidedSchema,
    })) {
      await expect(
        p.generate({ ...request, task: task as typeof request.task, schema: taskSchema as z.ZodType }),
      ).resolves.toHaveProperty("output");
    }
  });
});

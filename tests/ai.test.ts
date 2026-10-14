import { describe, expect, it, vi } from "vitest";
import { OllamaClient, inspectAiRuntime, loadConfig } from "@secthing/platform";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("OllamaClient", () => {
  it("discovers an embedding-only runtime independently of chat", async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ models: [{ name: "nomic-embed-text" }] }));
    vi.stubGlobal("fetch", fetch);
    try {
      const status = await inspectAiRuntime(loadConfig({ DATABASE_URL: "postgres://test:test@localhost/test", AI_MODE: "local",
        AI_EMBEDDING_PROVIDER: "ollama", AI_EMBEDDING_BASE_URL: "http://embedding-runtime:11434", AI_EMBEDDING_MODEL: "nomic-embed-text" }));
      expect(status).toMatchObject({ status: "available", chat: { available: false }, embeddings: { available: true } });
      expect(fetch.mock.calls[0][0].hostname).toBe("embedding-runtime");
    } finally { vi.unstubAllGlobals(); }
  });
  it("normalizes model, chat, and embedding responses", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ models: [{ name: "qwen2.5:3b", size: 1_234, modified_at: "2026-09-16T00:00:00Z" }] }))
      .mockResolvedValueOnce(jsonResponse({ model: "qwen2.5:3b", message: { content: "ready" }, total_duration: 42 }))
      .mockResolvedValueOnce(jsonResponse({ model: "nomic-embed-text", embeddings: [[0.1, 0.2]] }));
    const client = new OllamaClient({ baseUrl: "http://ollama:11434", timeoutMs: 1_000, fetch: fetch as typeof globalThis.fetch });

    await expect(client.listModels()).resolves.toEqual([{ name: "qwen2.5:3b", sizeBytes: 1_234, modifiedAt: "2026-09-16T00:00:00Z" }]);
    await expect(client.chat({ model: "qwen2.5:3b", messages: [{ role: "user", content: "hello" }] })).resolves.toEqual({ model: "qwen2.5:3b", content: "ready", totalDurationNs: 42 });
    await expect(client.embed({ model: "nomic-embed-text", inputs: ["hello"] })).resolves.toEqual({ model: "nomic-embed-text", embeddings: [[0.1, 0.2]] });
  });
});

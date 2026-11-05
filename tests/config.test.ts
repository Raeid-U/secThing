import { describe, expect, it } from "vitest";
import { loadConfig } from "@secthing/platform";

describe("loadConfig", () => {
  it("accepts the minimum Phase 1 runtime configuration", () => {
    expect(loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/secthing" })).toMatchObject({
      dataDir: "./data",
      backendPort: 8080,
      aiMode: "disabled",
      localOnly: true,
    });
  });

  it("rejects an invalid database URL", () => {
    expect(() => loadConfig({ DATABASE_URL: "not-a-url" })).toThrow();
  });

  it("rejects an SEC request rate over the documented ceiling", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/secthing", SEC_RATE_LIMIT_PER_SECOND: "10.01" })).toThrow();
  });

  it("requires an Ollama chat endpoint when AI is enabled", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/secthing", AI_MODE: "local" })).toThrow();
    expect(loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/secthing", AI_MODE: "local", AI_CHAT_PROVIDER: "ollama", AI_CHAT_BASE_URL: "http://ollama:11434" })).toMatchObject({ aiMode: "local", aiChatProvider: "ollama" });
  });

  it("treats blank optional AI variables injected by Compose as unset", () => {
    expect(loadConfig({
      DATABASE_URL: "postgresql://user:pass@localhost:5432/secthing",
      AI_CHAT_PROVIDER: "",
      AI_CHAT_BASE_URL: "",
      AI_CHAT_API_KEY: "",
      AI_CHAT_MODEL: "",
      AI_EMBEDDING_PROVIDER: "",
      AI_EMBEDDING_BASE_URL: "",
      AI_EMBEDDING_API_KEY: "",
      AI_EMBEDDING_MODEL: "",
      AI_EMBEDDING_DIMENSION: "",
    })).toMatchObject({ aiMode: "disabled", aiChatModel: undefined, aiEmbeddingDimension: undefined });
  });

  it("enables embeddings without requiring a chat endpoint", () => {
    expect(loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/secthing", AI_MODE: "local",
      AI_EMBEDDING_PROVIDER: "ollama", AI_EMBEDDING_BASE_URL: "http://ollama:11434", AI_EMBEDDING_MODEL: "nomic-embed-text" }))
      .toMatchObject({ aiMode: "local", aiChatBaseUrl: undefined, aiEmbeddingModel: "nomic-embed-text" });
  });

  it("requires explicit permission to leave local-only mode", () => {
    expect(() => loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/secthing", AI_MODE: "external",
      AI_EMBEDDING_BASE_URL: "https://external.example" })).toThrow("Disable LOCAL_ONLY");
  });
});

describe("bounded AI controls", () => {
  const base = { DATABASE_URL: "postgres://test:test@localhost/test" };
  it("rejects indefinite residency, oversized batches, and unusable context/output budgets", () => {
    expect(loadConfig(base).aiVerificationMaxOutputTokens).toBe(2048);
    expect(loadConfig({ ...base, AI_CHAT_CONTEXT_WINDOW: "2048", AI_CHAT_MAX_OUTPUT_TOKENS: "512" }).aiVerificationMaxOutputTokens).toBe(768);
    expect(() => loadConfig({ ...base, AI_VERIFICATION_MAX_OUTPUT_TOKENS: "8192" })).toThrow("512 tokens");
    expect(() => loadConfig({ ...base, AI_MODEL_KEEP_ALIVE_SECONDS: "-1" })).toThrow();
    expect(() => loadConfig({ ...base, AI_EMBEDDING_BATCH_SIZE: "1000" })).toThrow();
    expect(() => loadConfig({ ...base, AI_CHAT_CONTEXT_WINDOW: "1024", AI_CHAT_MAX_OUTPUT_TOKENS: "1024" })).toThrow("512 tokens");
    expect(loadConfig({ ...base, AI_MODEL_KEEP_ALIVE_SECONDS: "0" }).aiModelKeepAliveSeconds).toBe(0);
  });
});

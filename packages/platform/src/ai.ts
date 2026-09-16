import type { PlatformConfig } from "./config.js";

type FetchLike = typeof fetch;

export type AiModel = { name: string; sizeBytes?: number; modifiedAt?: string };
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type ChatRequest = { model: string; messages: ChatMessage[]; temperature?: number };
export type ChatResponse = { model: string; content: string; totalDurationNs?: number };
export type EmbeddingRequest = { model: string; inputs: string[] };
export type EmbeddingResponse = { model: string; embeddings: number[][] };
export type AiRuntimeStatus = {
  mode: PlatformConfig["aiMode"];
  provider?: "ollama";
  status: "disabled" | "unavailable" | "available";
  detail?: string;
  models: AiModel[];
  chat: { configuredModel?: string; available: boolean };
  embeddings: { configuredModel?: string; available: boolean };
};

export interface ChatProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export interface EmbeddingProvider {
  embed(request: EmbeddingRequest): Promise<EmbeddingResponse>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "AI runtime request failed.";
}

function matchingModel(models: AiModel[], configured: string | undefined): boolean {
  if (!configured) return false;
  const base = configured.split(":")[0];
  return models.some((model) => model.name === configured || model.name.split(":")[0] === base);
}

export class OllamaClient implements ChatProvider, EmbeddingProvider {
  constructor(private readonly options: { baseUrl: string; apiKey?: string; timeoutMs: number; fetch?: FetchLike }) {}

  async listModels(): Promise<AiModel[]> {
    const body = await this.request("/api/tags", { method: "GET" });
    if (!body || typeof body !== "object" || !Array.isArray((body as Record<string, unknown>).models)) return [];
    return (body as { models: unknown[] }).models.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const model = entry as Record<string, unknown>;
      return typeof model.name === "string"
        ? [{ name: model.name, sizeBytes: typeof model.size === "number" ? model.size : undefined, modifiedAt: typeof model.modified_at === "string" ? model.modified_at : undefined }]
        : [];
    });
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = await this.request("/api/chat", {
      method: "POST",
      body: JSON.stringify({ model: request.model, messages: request.messages, stream: false, options: request.temperature === undefined ? undefined : { temperature: request.temperature } }),
    });
    const response = body as Record<string, unknown>;
    const message = response.message;
    const content = message && typeof message === "object" ? (message as Record<string, unknown>).content : undefined;
    if (typeof content !== "string") throw new Error("Ollama returned a chat response without message content.");
    return { model: typeof response.model === "string" ? response.model : request.model, content, totalDurationNs: typeof response.total_duration === "number" ? response.total_duration : undefined };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const body = await this.request("/api/embed", { method: "POST", body: JSON.stringify({ model: request.model, input: request.inputs }) });
    const response = body as Record<string, unknown>;
    const embeddings = Array.isArray(response.embeddings)
      ? response.embeddings.filter((embedding): embedding is number[] => Array.isArray(embedding) && embedding.every((value) => typeof value === "number"))
      : [];
    if (embeddings.length !== request.inputs.length) throw new Error("Ollama returned an unexpected embedding response.");
    return { model: typeof response.model === "string" ? response.model : request.model, embeddings };
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const fetcher = this.options.fetch ?? fetch;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetcher(new URL(path, this.options.baseUrl), {
        ...init,
        headers: { Accept: "application/json", "Content-Type": "application/json", ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}), ...init.headers },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Ollama request failed (${response.status}): ${text.slice(0, 240)}`);
      return text ? JSON.parse(text) as unknown : {};
    } finally {
      clearTimeout(timeout);
    }
  }
}

function createOllamaClient(config: PlatformConfig): OllamaClient | undefined {
  return config.aiChatProvider === "ollama" && config.aiChatBaseUrl
    ? new OllamaClient({ baseUrl: config.aiChatBaseUrl, apiKey: config.aiChatApiKey, timeoutMs: config.aiRequestTimeoutMs })
    : undefined;
}

export async function inspectAiRuntime(config: PlatformConfig): Promise<AiRuntimeStatus> {
  if (config.aiMode === "disabled") return { mode: config.aiMode, status: "disabled", models: [], chat: { available: false }, embeddings: { available: false } };
  const client = createOllamaClient(config);
  if (!client) return { mode: config.aiMode, status: "unavailable", detail: "No supported chat provider is configured.", models: [], chat: { configuredModel: config.aiChatModel, available: false }, embeddings: { configuredModel: config.aiEmbeddingModel, available: false } };
  try {
    const models = await client.listModels();
    return {
      mode: config.aiMode,
      provider: "ollama",
      status: "available",
      models,
      chat: { configuredModel: config.aiChatModel, available: matchingModel(models, config.aiChatModel) },
      embeddings: { configuredModel: config.aiEmbeddingModel, available: matchingModel(models, config.aiEmbeddingModel) },
    };
  } catch (error) {
    return { mode: config.aiMode, provider: "ollama", status: "unavailable", detail: errorMessage(error), models: [], chat: { configuredModel: config.aiChatModel, available: false }, embeddings: { configuredModel: config.aiEmbeddingModel, available: false } };
  }
}

export async function verifyAiChat(config: PlatformConfig): Promise<ChatResponse> {
  const client = createOllamaClient(config);
  if (!client || !config.aiChatModel) throw new Error("A configured Ollama chat model is required for AI verification.");
  return client.chat({ model: config.aiChatModel, messages: [{ role: "user", content: "Reply with exactly: ready" }], temperature: 0 });
}

import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATA_DIR: z.string().min(1).default("./data"),
  BACKEND_PORT: z.coerce.number().int().positive().default(8080),
  SEC_USER_AGENT: z.string().optional(),
  SEC_RATE_LIMIT_PER_SECOND: z.coerce.number().positive().max(10).default(5),
  AI_MODE: z.enum(["disabled", "local", "external"]).default("disabled"),
  AI_CHAT_PROVIDER: z.enum(["ollama"]).optional(),
  AI_CHAT_BASE_URL: z.string().url().optional(),
  AI_CHAT_API_KEY: z.string().min(1).optional(),
  AI_CHAT_MODEL: z.string().min(1).optional(),
  AI_CHAT_CONTEXT_WINDOW: z.coerce.number().int().positive().default(8_192),
  AI_EMBEDDING_PROVIDER: z.enum(["ollama"]).optional(),
  AI_EMBEDDING_BASE_URL: z.string().url().optional(),
  AI_EMBEDDING_API_KEY: z.string().min(1).optional(),
  AI_EMBEDDING_MODEL: z.string().min(1).optional(),
  AI_EMBEDDING_DIMENSION: z.coerce.number().int().positive().optional(),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(60_000),
  LOCAL_ONLY: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
}).superRefine((environment, context) => {
  if (environment.AI_MODE === "disabled") return;
  if (!environment.AI_CHAT_PROVIDER || !environment.AI_CHAT_BASE_URL) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "AI_CHAT_PROVIDER and AI_CHAT_BASE_URL are required when AI_MODE is enabled." });
  }
});

export type PlatformConfig = {
  databaseUrl: string;
  dataDir: string;
  backendPort: number;
  secUserAgent?: string;
  secRateLimitPerSecond: number;
  aiMode: "disabled" | "local" | "external";
  aiChatProvider?: "ollama";
  aiChatBaseUrl?: string;
  aiChatApiKey?: string;
  aiChatModel?: string;
  aiChatContextWindow: number;
  aiEmbeddingProvider?: "ollama";
  aiEmbeddingBaseUrl?: string;
  aiEmbeddingApiKey?: string;
  aiEmbeddingModel?: string;
  aiEmbeddingDimension?: number;
  aiRequestTimeoutMs: number;
  localOnly: boolean;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const environment = environmentSchema.parse(source);
  return {
    databaseUrl: environment.DATABASE_URL,
    dataDir: environment.DATA_DIR,
    backendPort: environment.BACKEND_PORT,
    secUserAgent: environment.SEC_USER_AGENT,
    secRateLimitPerSecond: environment.SEC_RATE_LIMIT_PER_SECOND,
    aiMode: environment.AI_MODE,
    aiChatProvider: environment.AI_CHAT_PROVIDER,
    aiChatBaseUrl: environment.AI_CHAT_BASE_URL,
    aiChatApiKey: environment.AI_CHAT_API_KEY,
    aiChatModel: environment.AI_CHAT_MODEL,
    aiChatContextWindow: environment.AI_CHAT_CONTEXT_WINDOW,
    aiEmbeddingProvider: environment.AI_EMBEDDING_PROVIDER,
    aiEmbeddingBaseUrl: environment.AI_EMBEDDING_BASE_URL,
    aiEmbeddingApiKey: environment.AI_EMBEDDING_API_KEY,
    aiEmbeddingModel: environment.AI_EMBEDDING_MODEL,
    aiEmbeddingDimension: environment.AI_EMBEDDING_DIMENSION,
    aiRequestTimeoutMs: environment.AI_REQUEST_TIMEOUT_MS,
    localOnly: environment.LOCAL_ONLY,
  };
}

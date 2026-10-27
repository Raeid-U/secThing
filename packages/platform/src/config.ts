import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.string().min(1).optional(),
);

const optionalPositiveInteger = z.preprocess(
  (value) => value === "" ? undefined : value,
  z.coerce.number().int().positive().optional(),
);

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATA_DIR: z.string().min(1).default("./data"),
  BACKEND_PORT: z.coerce.number().int().positive().default(8080),
  SEC_USER_AGENT: z.string().optional(),
  SEC_RATE_LIMIT_PER_SECOND: z.coerce.number().positive().max(10).default(5),
  AI_MODE: z.enum(["disabled", "local", "external"]).default("disabled"),
  AI_CHAT_PROVIDER: z.preprocess((value) => value === "" ? undefined : value, z.enum(["ollama", "openai_compatible"]).optional()),
  AI_CHAT_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  AI_CHAT_API_KEY: optionalNonEmptyString,
  AI_CHAT_MODEL: optionalNonEmptyString,
  AI_CHAT_CONTEXT_WINDOW: z.coerce.number().int().positive().default(8_192),
  AI_CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1_024),
  AI_EMBEDDING_PROVIDER: z.preprocess((value) => value === "" ? undefined : value, z.enum(["ollama", "openai_compatible"]).optional()),
  AI_EMBEDDING_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  AI_EMBEDDING_API_KEY: optionalNonEmptyString,
  AI_EMBEDDING_MODEL: optionalNonEmptyString,
  AI_EMBEDDING_DIMENSION: optionalPositiveInteger,
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(300_000).default(60_000),
  LOCAL_ONLY: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
}).superRefine((environment, context) => {
  if (environment.AI_MODE === "disabled") return;
  if (!environment.AI_CHAT_BASE_URL && !environment.AI_EMBEDDING_BASE_URL) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "A chat or embedding provider endpoint is required when AI_MODE is enabled." });
  }
  if (environment.AI_MODE === "external" && environment.LOCAL_ONLY) context.addIssue({ code: z.ZodIssueCode.custom, message: "Disable LOCAL_ONLY explicitly before using external AI." });
});

export type PlatformConfig = {
  databaseUrl: string;
  dataDir: string;
  backendPort: number;
  secUserAgent?: string;
  secRateLimitPerSecond: number;
  aiMode: "disabled" | "local" | "external";
  aiChatProvider?: "ollama" | "openai_compatible";
  aiChatBaseUrl?: string;
  aiChatApiKey?: string;
  aiChatModel?: string;
  aiChatContextWindow: number;
  aiChatMaxOutputTokens?: number;
  aiEmbeddingProvider?: "ollama" | "openai_compatible";
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
    aiChatMaxOutputTokens: environment.AI_CHAT_MAX_OUTPUT_TOKENS,
    aiEmbeddingProvider: environment.AI_EMBEDDING_PROVIDER,
    aiEmbeddingBaseUrl: environment.AI_EMBEDDING_BASE_URL,
    aiEmbeddingApiKey: environment.AI_EMBEDDING_API_KEY,
    aiEmbeddingModel: environment.AI_EMBEDDING_MODEL,
    aiEmbeddingDimension: environment.AI_EMBEDDING_DIMENSION,
    aiRequestTimeoutMs: environment.AI_REQUEST_TIMEOUT_MS,
    localOnly: environment.LOCAL_ONLY,
  };
}

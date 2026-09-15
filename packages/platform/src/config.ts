import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATA_DIR: z.string().min(1).default("./data"),
  BACKEND_PORT: z.coerce.number().int().positive().default(8080),
  SEC_USER_AGENT: z.string().optional(),
  AI_MODE: z.enum(["disabled", "local", "external"]).default("disabled"),
  LOCAL_ONLY: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
});

export type PlatformConfig = {
  databaseUrl: string;
  dataDir: string;
  backendPort: number;
  secUserAgent?: string;
  aiMode: "disabled" | "local" | "external";
  localOnly: boolean;
};

export function loadConfig(source: NodeJS.ProcessEnv = process.env): PlatformConfig {
  const environment = environmentSchema.parse(source);
  return {
    databaseUrl: environment.DATABASE_URL,
    dataDir: environment.DATA_DIR,
    backendPort: environment.BACKEND_PORT,
    secUserAgent: environment.SEC_USER_AGENT,
    aiMode: environment.AI_MODE,
    localOnly: environment.LOCAL_ONLY,
  };
}


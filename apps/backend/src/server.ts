import cors from "@fastify/cors";
import Fastify from "fastify";
import {
  assessReadiness,
  capabilities,
  loadConfig,
  type PlatformConfig,
} from "@secthing/platform";

export function buildServer(config: PlatformConfig = loadConfig()) {
  const app = Fastify({ logger: true });
  app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok" as const }));
  app.get("/ready", async (_request, reply) => {
    const readiness = await assessReadiness(config);
    if (readiness.status !== "ready") return reply.code(503).send(readiness);
    return readiness;
  });
  app.get("/api/v1/system/capabilities", async () => capabilities(config));
  return app;
}


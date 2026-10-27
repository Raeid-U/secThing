import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../apps/backend/src/server.js";
import { post } from "../apps/frontend/app/research/types.js";
import { capabilities, loadConfig } from "@secthing/platform";

const app = buildServer({
  databaseUrl: "postgresql://user:pass@localhost:5432/secthing",
  dataDir: "./data",
  backendPort: 8080,
  aiMode: "disabled",
  localOnly: true,
});

afterAll(async () => app.close());

describe("backend health", () => {
  it("reports process liveness without a database connection", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("advertises current capability state", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/system/capabilities" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ phase: 9, companyIngestion: false, filingSearch: true, ragChat: false });
  });

  it("advertises grounded questions only for a complete chat configuration", () => {
    const configured = loadConfig({ DATABASE_URL: "postgresql://user:pass@localhost:5432/secthing", AI_MODE: "local",
      AI_CHAT_PROVIDER: "ollama", AI_CHAT_BASE_URL: "http://ollama:11434", AI_CHAT_MODEL: "fixture-chat" });
    expect(capabilities(configured)).toMatchObject({ phase: 9, ragChat: true });
  });

  it("reports disabled AI without contacting a runtime", async () => {
    const response = await app.inject({ method: "GET", url: "/api/v1/system/ai/status" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mode: "disabled", status: "disabled", models: [] });
  });

  it("does not run AI verification while AI is disabled", async () => {
    const init = post();
    const response = await app.inject({ method: "POST", url: "/api/v1/system/ai/verify",
      headers: Object.fromEntries(new Headers(init.headers)), payload: init.body as string | undefined });
    expect(response.statusCode).toBe(409);
  });
});

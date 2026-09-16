import { afterAll, describe, expect, it } from "vitest";
import { buildServer } from "../apps/backend/src/server.js";

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
    expect(response.json()).toMatchObject({ phase: 2, companyIngestion: false, ragChat: false });
  });
});

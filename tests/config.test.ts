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
});

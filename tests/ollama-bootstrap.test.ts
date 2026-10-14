import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function bootstrap(overrides: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "secthing-ollama-bootstrap-"));
  directories.push(directory);
  const log = join(directory, "calls");
  await writeFile(log, "");
  await writeFile(join(directory, "ollama"), `#!/bin/sh
printf '%s|%s|%s\\n' "$OLLAMA_HOST" "$1" "$2" >> "$CALL_LOG"
case "$1" in
  show) [ "$2" = "\${CACHED_MODEL:-}" ] ;;
  pull) [ "$2" != "\${FAILED_MODEL:-}" ] ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 });
  const result = spawnSync("sh", [resolve("scripts/pull-ollama-models.sh")], {
    encoding: "utf8",
    env: {
      ...process.env, PATH: `${directory}:${process.env.PATH}`, CALL_LOG: log,
      AI_MODE: "local", OLLAMA_HOST: "http://ollama:11434",
      AI_CHAT_PROVIDER: "ollama", AI_CHAT_BASE_URL: "http://ollama:11434", AI_CHAT_MODEL: "test-chat:small",
      AI_EMBEDDING_PROVIDER: "ollama", AI_EMBEDDING_BASE_URL: "http://ollama:11434", AI_EMBEDDING_MODEL: "test-embedding",
      ...overrides,
    },
  });
  return { ...result, calls: await readFile(log, "utf8") };
}

describe.skipIf(process.platform === "win32")("bundled Ollama model provisioning (Linux shell)", () => {
  it("pulls the chat and embedding names supplied in the environment", async () => {
    const result = await bootstrap();
    expect(result.status).toBe(0);
    expect(result.calls.split("\n").filter((call) => call.includes("|pull|"))).toEqual([
      "http://ollama:11434|pull|test-chat:small",
      "http://ollama:11434|pull|test-embedding",
    ]);
  });

  it("retains cached models without downloading them again", async () => {
    const result = await bootstrap({ CACHED_MODEL: "test-chat:small" });
    expect(result.status).toBe(0);
    expect(result.calls).not.toContain("|pull|test-chat:small");
    expect(result.calls).toContain("|pull|test-embedding");
  });

  it("provisions a shared chat/embedding model only once", async () => {
    const result = await bootstrap({ AI_EMBEDDING_MODEL: "test-chat:small" });
    expect(result.status).toBe(0);
    expect(result.calls.split("\n").filter((call) => call.includes("|pull|"))).toHaveLength(1);
  });

  it("makes no model calls when AI is disabled or external", async () => {
    for (const mode of ["disabled", "external"]) {
      const result = await bootstrap({ AI_MODE: mode });
      expect(result.status).toBe(0);
      expect(result.calls).toBe("");
    }
  });

  it("skips unconfigured models and endpoints outside the bundled runtime", async () => {
    const result = await bootstrap({ AI_CHAT_MODEL: "", AI_EMBEDDING_BASE_URL: "http://host.docker.internal:11434" });
    expect(result.status).toBe(0);
    expect(result.calls).toBe("");
  });

  it("fails visibly on a pull error rather than reporting successful initialization", async () => {
    const result = await bootstrap({ FAILED_MODEL: "test-embedding" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Failed to pull embedding model: test-embedding");
    expect(result.stdout).not.toContain("models are ready");
  });
});

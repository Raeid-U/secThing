import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AiBusyError, AiScheduler, GroundedAnswer, applyMigrations, connectDatabase, loadConfig, analyzeQuestion, type EvidencePackage, type Retrieval, type ChatRequest } from "@secthing/platform";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("AI scheduling and support boundary (PostgreSQL)", () => {
  const schema = `ai_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(databaseUrl ?? "postgres://localhost/unused");
  url.searchParams.set("search_path", `${schema},public`);
  const admin = connectDatabase(databaseUrl ?? url.toString());
  const sql = connectDatabase(url.toString());
  const peer = connectDatabase(url.toString());
  const config = loadConfig({ DATABASE_URL: url.toString(), AI_MODE: "local", AI_CHAT_PROVIDER: "ollama", AI_CHAT_BASE_URL: "http://fixture:11434", AI_CHAT_MODEL: "chat", AI_QUEUE_WAIT_MS: "2000" });
  const runtime = config.aiChatBaseUrl!;
  const first = new AiScheduler(sql, config);
  const second = new AiScheduler(peer, config);
  beforeAll(async () => {
    await admin.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(289462260)`;
      await tx`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`;
    });
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
    await applyMigrations(sql);
  }, 30_000);
  beforeEach(async () => { await sql`TRUNCATE ai_runtime_state, companies RESTART IDENTITY CASCADE`; });
  afterAll(async () => { await sql.end(); await peer.end(); await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); });

  it("serializes different processes, prefers interactive work, and releases after an exception", async () => {
    const order: string[] = [];
    let release!: () => void;
    const hold = first.run(runtime, "embed", "background", async () => { order.push("active"); await new Promise<void>((resolve) => { release = resolve; }); });
    await vi.waitFor(() => expect(order).toEqual(["active"]));
    const background = second.run(runtime, "embed", "background", async () => { order.push("background"); });
    await vi.waitFor(async () => expect((await sql`SELECT * FROM ai_runtime_queue`).length).toBe(1));
    const interactive = first.run(runtime, "chat", "interactive", async () => { order.push("interactive"); throw new Error("fixture failure"); }).catch((e) => e);
    await vi.waitFor(async () => expect((await sql`SELECT * FROM ai_runtime_queue`).length).toBe(2));
    release();
    await hold;
    expect(await interactive).toBeInstanceOf(Error);
    await background;
    expect(order).toEqual(["active", "interactive", "background"]);
    expect(await sql`SELECT * FROM ai_runtime_queue`).toHaveLength(0);
  });

  it("bounds queue capacity and wait without starting timed-out work", async () => {
    let release!: () => void;
    const active = first.run(runtime, "chat", "interactive", () => new Promise<void>((resolve) => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const limited = new AiScheduler(peer, { ...config, aiQueueLimit: 1, aiQueueWaitMs: 250 });
    const action = vi.fn();
    const waiting = limited.run(runtime, "chat", "interactive", action).catch((e) => e);
    await vi.waitFor(async () => expect((await sql`SELECT * FROM ai_runtime_queue`).length).toBe(1));
    await expect(limited.run(runtime, "embed", "background", action)).rejects.toThrow("queue is full");
    expect(await waiting).toBeInstanceOf(AiBusyError);
    expect(action).not.toHaveBeenCalled();
    release(); await active;
    await first.run(runtime, "chat", "interactive", async () => undefined);
  });

  it("uses same-model affinity but ages old background requests ahead of newer questions", async () => {
    let release!: () => void;
    const order: string[] = [];
    const active = first.run(runtime, "chat", "interactive", () => new Promise<void>((resolve) => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const old = second.run(runtime, "embed", "background", async () => { order.push("old"); });
    await vi.waitFor(async () => expect((await sql`SELECT * FROM ai_runtime_queue`).length).toBe(1));
    await sql`UPDATE ai_runtime_queue SET created_at = now() - interval '20 seconds'`;
    const other = first.run(runtime, "other", "interactive", async () => { order.push("other"); });
    const chat = second.run(runtime, "chat", "interactive", async () => { order.push("chat"); });
    await vi.waitFor(async () => expect((await sql`SELECT * FROM ai_runtime_queue`).length).toBe(3));
    release(); await Promise.all([active, old, other, chat]);
    expect(order[0]).toBe("old");
  });

  it("prefers a queued request for the resident model within the same priority", async () => {
    await first.run(runtime, "chat", "interactive", async () => undefined);
    let release!: () => void;
    const order: string[] = [];
    const active = first.run(runtime, "chat", "interactive", () => new Promise<void>((resolve) => { release = resolve; }));
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const other = second.run(runtime, "other", "interactive", async () => { order.push("other"); });
    await vi.waitFor(async () => expect((await sql`SELECT * FROM ai_runtime_queue`).length).toBe(1));
    const same = first.run(runtime, "chat", "interactive", async () => { order.push("chat"); });
    await vi.waitFor(async () => expect((await sql`SELECT * FROM ai_runtime_queue`).length).toBe(2));
    release(); await Promise.all([active, other, same]);
    expect(order).toEqual(["chat", "other"]);
  });

  async function company() { const [row] = await sql`INSERT INTO companies (cik, legal_name, identity_source, identity_fetched_at) VALUES (123, 'Fixture', 'fixture', now()) ON CONFLICT (cik) DO UPDATE SET legal_name = EXCLUDED.legal_name RETURNING id`; return Number(row.id); }
  const evidence: EvidencePackage = { question: "What was revenue in 2022?", analysis: analyzeQuestion("What was revenue in 2022?"),
    sources: [{ label: "F1", kind: "financial_fact", sourceId: "fact:1", text: "Revenue was 100 USD for 2022.", tokenEstimate: 100, locator: { periodEnd: "2022-12-31", filed: "2023-02-01", formType: "10-K" } }],
    tokens: { budget: 4096, used: 100, reservedOutput: 1024 }, generationIds: [], coverage: { excludedDocumentCount: 1 } };
  const retrieval = { evidencePackage: async () => structuredClone(evidence) } as unknown as Retrieval;
  const draft = { findings: [{ statement: "Revenue was 100 USD for 2022.", citations: ["F1"] }], interpretation: [], limitations: ["Untrusted generated padding"] };
  const approved = { verdicts: [{ id: "finding-0", factual: true, temporal: true, contextual: true, quotes: [{ source: "F1", text: "Revenue was 100 USD" }] }] };

  it("checks support independently, retains load metrics in audits, and does not publish unchecked limitations", async () => {
    const requests: ChatRequest[] = [];
    const provider = { chat: async (request: ChatRequest) => { requests.push(request); return { model: "chat", content: JSON.stringify(requests.length === 1 ? draft : approved), loadDurationNs: 42 }; } };
    const result = await new GroundedAnswer(sql, config, provider, retrieval).answer(await company(), evidence.question);
    expect(result.status).toBe("answered");
    expect(requests).toHaveLength(2);
    const verification = JSON.parse(requests[1].messages[1].content);
    expect(verification.claims).toHaveLength(1);
    expect(verification.sources.map((s: { label: string }) => s.label)).toEqual(["F1"]);
    expect(requests[1].messages[0].content).toContain("independently assess");
    expect(result.limitations.join(" ")).not.toContain("Untrusted generated padding");
    expect(result.limitations.join(" ")).toContain("excludes 1");
    const [run] = await sql`SELECT validation_status, raw_output FROM model_runs`;
    expect(run.validation_status).toBe("support_checked");
    expect(run.raw_output.calls[1]).toMatchObject({ purpose: "verification", loadDurationNs: 42 });
  });

  it("withholds all claims on verifier failure and uses evidence-only fallback", async () => {
    let count = 0;
    const provider = { chat: async () => ({ model: "chat", content: JSON.stringify(++count === 1 ? draft : { verdicts: [] }) }) };
    const result = await new GroundedAnswer(sql, config, provider, retrieval).answer(await company(), evidence.question);
    expect(result.status).toBe("generation_limited");
    expect(result.findings[0].statement).toBe(evidence.sources[0].text);
    expect((await sql`SELECT validation_status FROM model_runs`)[0].validation_status).toBe("evidence_only");
  });

  it("retries malformed generation once, then falls back without invoking the verifier", async () => {
    const chat = vi.fn(async () => ({ model: "chat", content: "invalid JSON" }));
    const result = await new GroundedAnswer(sql, config, { chat }, retrieval).answer(await company(), evidence.question);
    expect(result.status).toBe("generation_limited"); expect(chat).toHaveBeenCalledTimes(2);
  });

  it("does not retry runtime failure or publish output that consumed the output reserve", async () => {
    const failed = vi.fn(async () => { throw new Error("runtime out of memory"); });
    expect((await new GroundedAnswer(sql, config, { chat: failed }, retrieval).answer(await company(), evidence.question)).status).toBe("generation_limited");
    expect(failed).toHaveBeenCalledTimes(1);
    const overBudget = vi.fn(async () => ({ model: "chat", content: JSON.stringify(draft), promptTokens: config.aiChatContextWindow }));
    const result = await new GroundedAnswer(sql, config, { chat: overBudget }, retrieval).answer(await company(), evidence.question);
    expect(result.status).toBe("generation_limited"); expect(overBudget).toHaveBeenCalledTimes(1);
    expect(result.limitations[0]).toContain("token usage");
  });

  it("avoids any inference when the complete question leaves no evidence budget", async () => {
    const chat = vi.fn();
    const small = { ...config, aiChatContextWindow: 2048 };
    const result = await new GroundedAnswer(sql, small, { chat }, retrieval).answer(await company(), "長".repeat(2000));
    expect(result.status).toBe("insufficient_evidence"); expect(chat).not.toHaveBeenCalled();
  });
});

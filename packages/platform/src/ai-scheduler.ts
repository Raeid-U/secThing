import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Sql } from "postgres";
import type { PlatformConfig } from "./config.js";

export class AiBusyError extends Error {
  constructor(message = "The AI runtime is busy. Please retry shortly.") { super(message); }
}

// Endpoint aliases on the same GPU must use the same configured base URL.
// This coordinates secThing processes, not unrelated applications using Ollama.
export class AiScheduler {
  constructor(private sql: Sql, private config: PlatformConfig) {}

  async run<T>(baseUrl: string, model: string, priority: "interactive" | "background", action: () => Promise<T>): Promise<T> {
    if (this.config.aiMode !== "local") return action();
    const runtime = new URL(baseUrl).origin;
    const lock = createHash("sha256").update(`secthing-ai:${runtime}`).digest().readBigInt64BE().toString();
    const waitMs = this.config.aiQueueWaitMs ?? 60_000;
    const ticket = await this.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`queue:${runtime}`}, 0))`;
      await tx`INSERT INTO ai_runtime_state (runtime_key) VALUES (${runtime}) ON CONFLICT DO NOTHING`;
      await tx`DELETE FROM ai_runtime_queue WHERE runtime_key = ${runtime} AND expires_at <= clock_timestamp()`;
      const [count] = await tx`SELECT count(*)::integer AS count FROM ai_runtime_queue WHERE runtime_key = ${runtime}`;
      if (count.count >= (this.config.aiQueueLimit ?? 16)) throw new AiBusyError("The AI request queue is full. Please retry shortly.");
      const [row] = await tx`INSERT INTO ai_runtime_queue (runtime_key, model, priority, expires_at)
        VALUES (${runtime}, ${model}, ${priority === "interactive" ? 1 : 0}, clock_timestamp() + ${waitMs} * interval '1 millisecond') RETURNING id`;
      return String(row.id);
    });
    const deadline = Date.now() + waitMs;
    const nextTicket = async () => {
      const [next] = await this.sql`SELECT q.id FROM ai_runtime_queue q JOIN ai_runtime_state s USING (runtime_key)
          WHERE q.runtime_key = ${runtime} AND q.expires_at > clock_timestamp()
          ORDER BY (q.created_at < clock_timestamp() - interval '15 seconds') DESC,
            CASE WHEN q.created_at < clock_timestamp() - interval '15 seconds' THEN q.id END,
            q.priority DESC, (q.model = s.last_model) DESC NULLS LAST, q.id LIMIT 1`;
      return String(next?.id);
    };
    try {
      while (Date.now() < deadline) {
        if (await nextTicket() === ticket) {
          // Reserve only at the head of the queue; waiting requests do not occupy
          // connections or transactions. A session lock dies with its connection.
          const connection = await this.sql.reserve();
          let acquired = false;
          try {
            const [row] = await connection`SELECT pg_try_advisory_lock(${lock}::bigint) AS acquired`;
            acquired = row.acquired;
            if (acquired && await nextTicket() === ticket) {
              if (Date.now() >= deadline) throw new AiBusyError();
              await connection`DELETE FROM ai_runtime_queue WHERE id = ${ticket}`;
              try { return await action(); }
              finally { await connection`UPDATE ai_runtime_state SET last_model = ${model} WHERE runtime_key = ${runtime}`; }
            }
          } finally {
            try { if (acquired) await connection`SELECT pg_advisory_unlock(${lock}::bigint)`; }
            finally { connection.release(); }
          }
        }
        await delay(100);
      }
      throw new AiBusyError("Timed out waiting for the AI runtime. Please retry shortly.");
    } finally { await this.sql`DELETE FROM ai_runtime_queue WHERE id = ${ticket}`; }
  }
}

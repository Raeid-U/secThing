import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, connectDatabase, LeaseLostError, WorkQueue } from "@secthing/platform";

const databaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("worker leases (PostgreSQL)", () => {
  const schema = `lease_test_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(databaseUrl ?? "postgres://localhost/unused");
  url.searchParams.set("search_path", `${schema},public`);
  const admin = connectDatabase(databaseUrl ?? url.toString());
  const sql = connectDatabase(url.toString());
  const first = new WorkQueue(sql, "worker-a");
  const second = new WorkQueue(sql, "worker-b");

  beforeAll(async () => {
    await admin.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(289462260)`;
      await tx`CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public`;
    });
    await admin.unsafe(`CREATE SCHEMA "${schema}"`);
    await applyMigrations(sql);
  }, 30_000);
  afterAll(async () => {
    await sql.end();
    await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  });
  beforeEach(async () => {
    await sql`TRUNCATE jobs RESTART IDENTITY CASCADE`;
    await sql`INSERT INTO jobs (job_type) VALUES ('fixture')`;
    await sql`INSERT INTO work_items (job_id, work_type) VALUES (1, 'fetch_metadata')`;
  });

  it("claims once across workers and renews only the current, unexpired attempt", async () => {
    const claims = await Promise.all([first.claim(), second.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const index = claims[0] ? 0 : 1;
    const item = claims[index]!;
    const owner = index === 0 ? first : second;
    const other = index === 0 ? second : first;
    await sql`UPDATE work_items SET lease_expires_at = now() + interval '1 second'`;
    expect(await other.renew(item)).toBe(false);
    expect(await owner.renew(item)).toBe(true);
    expect(Number((await sql`SELECT extract(epoch FROM lease_expires_at - now()) AS seconds FROM work_items`)[0].seconds)).toBeGreaterThan(250);
    expect((await owner.recoverExpired())).toHaveLength(0);
    await sql`UPDATE work_items SET lease_expires_at = now() - interval '1 second'`;
    expect(await owner.renew(item)).toBe(false);
  });

  it("recovers work that expires after startup and fences the previous attempt's writes", async () => {
    expect(await second.recoverExpired()).toHaveLength(0); // Startup before expiry.
    const old = (await first.claim())!;
    await sql`UPDATE work_items SET lease_expires_at = now() - interval '1 second'`;
    expect(await second.recoverExpired()).toHaveLength(1); // Periodic recovery later.
    const current = (await second.claim())!;
    expect(current.attempt_count).toBe(2);
    await expect(first.transaction(old, async (tx) => {
      await tx`UPDATE jobs SET progress = '{"stale":true}'`;
    })).rejects.toBeInstanceOf(LeaseLostError);
    await second.transaction(current, async (tx) => {
      await tx`UPDATE jobs SET progress = '{"current":true}'`;
    });
    expect((await sql`SELECT progress FROM jobs`)[0].progress).toEqual({ current: true });
    expect(await first.renew(old)).toBe(false);
  });

  it("uses attempt identity even when the same worker reclaims an item", async () => {
    const old = (await first.claim())!;
    await sql`UPDATE work_items SET lease_expires_at = now() - interval '1 second'`;
    await first.recoverExpired();
    const current = (await first.claim())!;
    await expect(first.transaction(old, async () => {})).rejects.toBeInstanceOf(LeaseLostError);
    await first.transaction(current, async () => {});
  });

  it("does not reclaim a stage while its guarded persistence transaction holds the work row", async () => {
    const item = (await first.claim())!;
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const persist = first.transaction(item, async (tx) => {
      await tx`UPDATE work_items SET lease_expires_at = now() - interval '1 second' WHERE id = ${item.id}`;
      entered();
      await gate;
      await tx`UPDATE work_items SET status = 'complete', lease_owner = null, lease_expires_at = null WHERE id = ${item.id}`;
    });
    await ready;
    try { expect(await second.recoverExpired()).toHaveLength(0); }
    finally { release(); await persist; }
    expect(await second.recoverExpired()).toHaveLength(0);
    expect(await second.claim()).toBeUndefined();
  });

  it("bounds crash retries and leaves terminal failures visible", async () => {
    await sql`UPDATE work_items SET attempt_count = 2`;
    const item = (await first.claim())!;
    expect(item.attempt_count).toBe(3);
    await sql`UPDATE work_items SET lease_expires_at = now() - interval '1 second'`;
    expect(await second.recoverExpired()).toMatchObject([{ status: "failed" }]);
    expect(await second.claim()).toBeUndefined();
    expect((await sql`SELECT status, last_error FROM jobs`)[0]).toMatchObject({ status: "partial", last_error: expect.stringContaining("lease expired") });
  });

  it("recovers a lease expiring after a real worker has started, without another restart", async () => {
    await sql`UPDATE work_items SET status = 'running', attempt_count = 3, lease_owner = 'crashed-worker',
      lease_expires_at = now() + interval '3 seconds'`;
    const dataDir = await mkdtemp(join(tmpdir(), 'secthing-worker-recovery-'));
    const child = spawn(process.execPath, ['--import', 'tsx', 'apps/worker/src/index.ts'], {
      env: { ...process.env, DATABASE_URL: url.toString(), DATA_DIR: dataDir,
        SEC_USER_AGENT: 'secThing tests test@example.com', AI_MODE: 'disabled' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => { output += String(data); });
    child.stderr.on('data', (data) => { output += String(data); });
    const closed = new Promise<void>((resolve) => { child.once('close', () => resolve()); });
    try {
      await expect.poll(() => output.includes('worker.search_backfill'), { timeout: 5000 }).toBe(true);
      expect((await sql`SELECT status FROM work_items`)[0].status).toBe('running');
      await expect.poll(async () => (await sql`SELECT status FROM work_items`)[0].status, { timeout: 15_000 }).toBe('failed');
      expect(output).not.toContain('worker.poll_failed');
      expect((await sql`SELECT status FROM jobs`)[0].status).toBe('partial');
    } finally {
      child.kill('SIGTERM');
      await closed;
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 25_000);
});

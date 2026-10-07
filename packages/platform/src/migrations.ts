import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "postgres";

export const migrationsDirectory = new URL("../../../migrations/", import.meta.url);

export function migrationChecksum(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function crLfChecksum(body: string): string {
  return migrationChecksum(body.replace(/\r?\n/g, "\r\n"));
}

export async function applyMigrations(sql: Sql): Promise<void> {
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(289462260)`;
    await transaction`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const applied = await transaction<{ version: string; checksum: string }[]>`SELECT version, checksum FROM schema_migrations`;
    const appliedByVersion = new Map(applied.map((migration) => [migration.version, migration.checksum]));
    const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const body = await readFile(join(migrationsDirectory.pathname, file), "utf8");
      const checksum = migrationChecksum(body);
      const existingChecksum = appliedByVersion.get(file);
      if (existingChecksum === checksum) continue;
      // Early Windows checkouts recorded raw CRLF bytes. Accept only that exact
      // newline-only variant, then repair the stored checksum transactionally.
      if (existingChecksum === crLfChecksum(body)) {
        await transaction`UPDATE schema_migrations SET checksum = ${checksum} WHERE version = ${file}`;
        continue;
      }
      if (existingChecksum) throw new Error(`Migration checksum mismatch for ${file}`);
      await transaction.unsafe(body);
      await transaction`INSERT INTO schema_migrations (version, checksum) VALUES (${file}, ${checksum})`;
    }
  });
}

export async function migrationsAreCurrent(sql: Sql): Promise<boolean> {
  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  const applied = await sql<{ version: string; checksum: string }[]>`SELECT version, checksum FROM schema_migrations`;
  if (files.length !== applied.length) return false;
  const appliedByVersion = new Map(applied.map((migration) => [migration.version, migration.checksum]));
  for (const file of files) {
    const body = await readFile(join(migrationsDirectory.pathname, file), "utf8");
    if (appliedByVersion.get(file) !== migrationChecksum(body)) return false;
  }
  return true;
}

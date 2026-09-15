import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "postgres";

export const migrationsDirectory = new URL("../../../migrations/", import.meta.url);

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
      const checksum = createHash("sha256").update(body).digest("hex");
      const existingChecksum = appliedByVersion.get(file);
      if (existingChecksum === checksum) continue;
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
    if (appliedByVersion.get(file) !== createHash("sha256").update(body).digest("hex")) return false;
  }
  return true;
}

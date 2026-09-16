import { access, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import { connectDatabase } from "./database.js";
import { migrationsAreCurrent } from "./migrations.js";
import type { PlatformConfig } from "./config.js";

export type Check = { name: string; status: "pass" | "fail"; detail?: string };
export type Readiness = { status: "ready" | "not_ready"; checks: Check[] };

async function checkDatabase(config: PlatformConfig): Promise<Check> {
  const sql = connectDatabase(config.databaseUrl);
  try {
    await sql`SELECT 1`;
    const current = await migrationsAreCurrent(sql);
    return current
      ? { name: "database", status: "pass" }
      : { name: "migrations", status: "fail", detail: "Database migrations are not current." };
  } catch (error) {
    return { name: "database", status: "fail", detail: error instanceof Error ? error.message : "Database connection failed." };
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function checkDataDirectory(config: PlatformConfig): Promise<Check> {
  try {
    await mkdir(config.dataDir, { recursive: true });
    await access(config.dataDir, constants.R_OK | constants.W_OK);
    return { name: "data directory", status: "pass" };
  } catch (error) {
    return { name: "data directory", status: "fail", detail: error instanceof Error ? error.message : "Data directory is unavailable." };
  }
}

export async function assessReadiness(config: PlatformConfig): Promise<Readiness> {
  const checks = await Promise.all([checkDatabase(config), checkDataDirectory(config)]);
  return { status: checks.every((check) => check.status === "pass") ? "ready" : "not_ready", checks };
}

export async function assessWorkerReadiness(config: PlatformConfig): Promise<Readiness> {
  const readiness = await assessReadiness(config);
  const secConfig: Check = config.secUserAgent
    ? { name: "SEC configuration", status: "pass" }
    : { name: "SEC configuration", status: "fail", detail: "SEC_USER_AGENT with a contact email is required for company ingestion." };
  const checks = [...readiness.checks, secConfig];
  return { status: checks.every((check) => check.status === "pass") ? "ready" : "not_ready", checks };
}

export function capabilities(config: PlatformConfig) {
  return {
    companyIngestion: Boolean(config.secUserAgent),
    filingSearch: false,
    ragChat: false,
    aiMode: config.aiMode,
    localOnly: config.localOnly,
    phase: 2,
  };
}

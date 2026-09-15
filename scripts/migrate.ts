import { applyMigrations, connectDatabase, loadConfig } from "@secthing/platform";

async function main() {
  const config = loadConfig();
  const sql = connectDatabase(config.databaseUrl);
  try {
    await applyMigrations(sql);
    console.info("Database migrations are current.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();

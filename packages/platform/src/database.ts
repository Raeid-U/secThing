import postgres, { type Sql } from "postgres";

export function connectDatabase(databaseUrl: string): Sql {
  return postgres(databaseUrl, { max: 5, idle_timeout: 20, connect_timeout: 10 });
}


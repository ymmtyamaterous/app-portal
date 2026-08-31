import { env } from "@better-t-app/env/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

export * from "./schema";

export function createDb() {
  return db;
}

export const client = createClient({
  url: env.DATABASE_URL,
});

export const db = drizzle({ client, schema });

function usesLocalSqlite(url: string) {
  return url.startsWith("file:") || url === ":memory:";
}

export async function initializeDatabase() {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("PRAGMA busy_timeout = 5000");

  if (usesLocalSqlite(env.DATABASE_URL)) {
    await client.execute("PRAGMA journal_mode = WAL");
  }
}

import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;
export { schema };

/**
 * DATABASE_URL set → a real PostgreSQL server (Neon, Supabase, your own…).
 * Not set → an embedded PostgreSQL (PGlite) stored in .data/, so local
 * development works with zero setup. Both speak the same SQL and schema.
 */
async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const [{ drizzle }, { default: postgres }] = await Promise.all([
      import("drizzle-orm/postgres-js"),
      import("postgres"),
    ]);
    // Serverless functions each hold their own connection; keep it small and
    // skip prepared statements so connection poolers (PgBouncer, Neon) work.
    const client = postgres(url, { max: process.env.VERCEL ? 1 : 10, prepare: false });
    return drizzle(client, { schema });
  }

  if (process.env.VERCEL) {
    throw new Error(
      "DATABASE_URL не задан. Подключите базу Postgres (например Neon) в настройках проекта Vercel.",
    );
  }

  const [{ PGlite }, { drizzle }, { migrate }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("drizzle-orm/pglite"),
    import("drizzle-orm/pglite/migrator"),
  ]);
  const dataDir = path.join(process.cwd(), ".data", "pglite");
  await mkdir(dataDir, { recursive: true });
  const db = drizzle(new PGlite(dataDir), { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  // The query-builder API is identical; only the driver type differs.
  return db as unknown as DB;
}

// Kept on globalThis so hot reloads in development reuse one connection
// (PGlite allows a single open instance per data folder).
const holder = globalThis as typeof globalThis & { __maryxDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  holder.__maryxDb ??= connect().catch((err) => {
    holder.__maryxDb = undefined;
    throw err;
  });
  return holder.__maryxDb;
}

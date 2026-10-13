// Applies database migrations from ./drizzle to the PostgreSQL server in
// DATABASE_URL. Runs automatically before `npm run dev` and `npm run build`.
// Without DATABASE_URL the app uses an embedded database that migrates itself.

import nextEnv from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Same .env / .env.local files that Next.js reads.
nextEnv.loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL?.trim();

if (!url) {
  if (process.env.VERCEL) {
    console.error(
      "\n✖ DATABASE_URL не задан. Подключите Postgres (Storage → Neon) в настройках проекта Vercel.\n",
    );
    process.exit(1);
  }
  console.log("DATABASE_URL не задан — используется встроенная база в .data/ (миграции применятся сами).");
  process.exit(0);
}

const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("✓ База данных обновлена");
} catch (err) {
  console.error("✖ Не удалось применить миграции:", err);
  process.exitCode = 1;
} finally {
  await client.end();
}

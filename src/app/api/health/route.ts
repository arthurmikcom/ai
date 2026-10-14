import { PROVIDERS } from "@/lib/catalog";
import { getAuth, vercelHosts } from "@/lib/server/auth";
import { isConfigured } from "@/lib/server/config";
import { getDb, schema } from "@/lib/server/db";

const SETTINGS = "Vercel → Settings → Environment Variables, затем Redeploy";

/** The root cause's message, without anything that looks like a connection string. */
function describe(err: unknown): string {
  // Drizzle wraps driver errors as "Failed query: …"; the cause says what went wrong.
  while (err instanceof Error && err.cause instanceof Error) err = err.cause;
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/\b[a-z][\w+.-]*:\/\/\S+/gi, "<адрес скрыт>").slice(0, 300);
}

function databaseHint(message: string): string {
  if (/relation .* does not exist/i.test(message)) return "таблицы не созданы — сделайте Redeploy, миграции запускаются при сборке";
  if (/password authentication failed/i.test(message)) return "неверный логин или пароль в DATABASE_URL";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout/i.test(message)) return `сервер базы недоступен (${message})`;
  return message;
}

/**
 * Setup self-check for the site owner: after deploying, open /api/health to
 * see what's missing. It reports only whether settings are present, never
 * their values. ✗ blocks the site, ⚠ turns off one feature.
 */
export async function GET(request: Request) {
  const checks: Record<string, string> = {};
  let ok = true;
  const fail = (name: string, text: string) => {
    ok = false;
    checks[name] = `✗ ${text}`;
  };
  const onVercel = Boolean(process.env.VERCEL);

  if (!process.env.DATABASE_URL?.trim() && onVercel) {
    fail("База данных", "DATABASE_URL не задан — подключите Neon: Vercel → Storage, затем Redeploy");
  } else {
    try {
      const db = await getDb();
      await db.select({ id: schema.user.id }).from(schema.user).limit(1);
      checks["База данных"] = "✓ подключена, таблицы на месте";
    } catch (err) {
      fail("База данных", databaseHint(describe(err)));
    }
  }

  if (!process.env.BETTER_AUTH_SECRET?.trim() && onVercel) {
    fail("BETTER_AUTH_SECRET", `не задан — добавьте любую случайную строку от 32 символов: ${SETTINGS}`);
  } else {
    checks.BETTER_AUTH_SECRET = "✓ задан";
  }

  try {
    await getAuth();
    checks["Вход и регистрация"] = "✓ готовы";
  } catch (err) {
    fail("Вход и регистрация", describe(err));
  }

  // Sign-in only works on the addresses the auth server trusts.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const authUrl = process.env.BETTER_AUTH_URL?.trim();
  if (authUrl) {
    let authHost = "";
    try {
      authHost = new URL(authUrl).host;
    } catch {
      fail("Адрес сайта", `BETTER_AUTH_URL должен быть полным адресом вида https://${host}`);
    }
    if (authHost && authHost !== host) {
      fail("Адрес сайта", `вход работает только на ${authHost} (BETTER_AUTH_URL), а сайт открыт на ${host}`);
    } else if (authHost) {
      checks["Адрес сайта"] = `✓ ${host}`;
    }
  } else if (onVercel && !vercelHosts().includes(host)) {
    fail("Адрес сайта", `вход не настроен для ${host}. Добавьте BETTER_AUTH_URL=https://${host}: ${SETTINGS}`);
  } else {
    checks["Адрес сайта"] = `✓ ${host}`;
  }

  const providers = PROVIDERS.filter((p) => isConfigured(p.id)).map((p) => p.name);
  if (providers.length) checks["Нейросети"] = `✓ ${providers.join(", ")}`;
  else fail("Нейросети", `не добавлен ни один ключ (например OPENROUTER_API_KEY): ${SETTINGS}`);

  checks["Хранилище файлов"] = process.env.BLOB_READ_WRITE_TOKEN
    ? "✓ Vercel Blob подключён"
    : onVercel
      ? "⚠ не подключено — картинки, видео и вложения не сохранятся. Vercel → Storage → Blob (Private), затем Redeploy"
      : "✓ папка .data/files";

  if (!process.env.ADMIN_USER_IDS?.trim() && !process.env.ADMIN_EMAILS?.trim()) {
    checks["Администратор"] =
      "⚠ не назначен — зарегистрируйтесь, скопируйте ID в Настройках и добавьте ADMIN_USER_IDS";
  } else {
    checks["Администратор"] = "✓ назначен";
  }

  return Response.json(
    { ok, checks },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}

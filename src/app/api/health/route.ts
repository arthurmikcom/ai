import { PROVIDERS } from "@/lib/catalog";
import { getAuth, vercelHosts } from "@/lib/server/auth";
import { isConfigured, maryxOnly } from "@/lib/server/config";
import { sellablePacks } from "@/lib/server/billing/packs";
import { proPriceSetting, stripeConfigured, stripeCreditsConfigured } from "@/lib/server/billing/stripe";
import { yookassaConfigured } from "@/lib/server/billing/yookassa";
import { getDb, schema } from "@/lib/server/db";
import { siteDailyBudget } from "@/lib/server/spend";
import { blobProblem, storageKind } from "@/lib/server/storage";

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
  // The page is public: in MARYX-only mode it names no provider behind MARYX either.
  if (maryxOnly()) {
    checks["Нейросети"] = providers.length
      ? `✓ облачный ИИ подключён (MARYX). Режим «только MARYX»; выбор всех моделей — SHOW_ALL_MODELS=true`
      : `⚠ облачный ИИ не подключён — MARYX работает бесплатно в браузере посетителя. Для облачного ИИ, картинок и видео добавьте OPENROUTER_API_KEY: ${SETTINGS}`;
  } else if (providers.length) checks["Нейросети"] = `✓ ${providers.join(", ")}`;
  else {
    // The site still works: MARYX runs on a free Qwen model in each visitor's browser.
    checks["Нейросети"] =
      `⚠ облачные модели не подключены — работает только бесплатный Qwen в браузере посетителя. ` +
      `Для Claude, GPT, Gemini, картинок и видео добавьте OPENROUTER_API_KEY: ${SETTINGS}`;
  }

  // The money side: one key for everyone, limits per user, a daily budget for free use.
  const budget = siteDailyBudget();
  checks["Бюджет"] =
    budget === null
      ? `⚠ общий дневной бюджет на бесплатные запросы не задан — каждого пользователя ограничивают только лимиты тарифа. Чтобы расходы не превысили сумму в день, добавьте AI_DAILY_BUDGET_USD (например 5): ${SETTINGS}`
      : `✓ бесплатные запросы — до $${budget} в сутки на весь сайт`;
  checks["Задачи по расписанию"] = process.env.CRON_SECRET?.trim()
    ? "✓ выполняются вовремя, пока сайт открыт, и раз в сутки сами; для точного времени всегда — «будильник» на /api/cron/tasks (см. README)"
    : `⚠ без CRON_SECRET задачи выполняются, только пока у пользователя открыт сайт. Добавьте CRON_SECRET (16+ случайных символов): ${SETTINGS}`;
  const payments: string[] = [];
  let paymentsWarn = false;
  if (yookassaConfigured()) {
    if (process.env.CRON_SECRET?.trim()) payments.push("ЮKassa: Pro и кредиты");
    else {
      paymentsWarn = true;
      payments.push("ЮKassa: Pro и кредиты, но без CRON_SECRET подписки не продлеваются сами");
    }
  }
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (stripeCreditsConfigured()) {
    const test = stripeKey?.startsWith("sk_test_") || stripeKey?.startsWith("rk_test_") ? " (тестовый режим: настоящие деньги не списываются)" : "";
    const price = proPriceSetting();
    const pro = process.env.STRIPE_PRICE_PRO?.trim() ? "Pro (цена из Stripe)" : `Pro $${price.usd.toFixed(2)}/мес`;
    const creditsOnly = price.invalid ? "Stripe: только кредиты" : "Stripe: только кредиты (Pro выключен: PRO_PRICE_USD=0)";
    payments.push(`${stripeConfigured() ? `Stripe: ${pro} и кредиты` : creditsOnly}${test}`);
    if (price.invalid && !process.env.STRIPE_PRICE_PRO?.trim()) {
      payments.push(`PRO_PRICE_USD="${price.invalid}" — не цена (нужно, например, 9.99 и не меньше 0.50), поэтому Pro через Stripe не продаётся`);
    }
    if (test || price.invalid) paymentsWarn = true;
  } else if (stripeKey) {
    paymentsWarn = true;
    payments.push(
      "Stripe: ключ есть, но нет STRIPE_WEBHOOK_SECRET — добавьте вебхук https://<сайт>/api/billing/stripe/webhook в Stripe → Developers → Webhooks и его Signing secret",
    );
  }
  if (payments.length && !sellablePacks().length) {
    paymentsWarn = true;
    payments.push("в CREDIT_PACKS нет цен для подключённых способов оплаты — кредиты не продаются");
  }
  checks["Оплата"] = payments.length
    ? `${paymentsWarn ? "⚠" : "✓"} ${payments.join("; ")}`
    : "⚠ не подключена — Pro и кредиты можно выдавать промокодами в Настройках";

  // Payment providers check the public terms before they activate an account.
  if (payments.length) {
    const missing = ["LEGAL_NAME", "LEGAL_EMAIL"].filter((name) => !process.env[name]?.trim());
    checks["Условия и реквизиты"] = missing.length
      ? `⚠ на страницах /terms, /refund и /privacy не хватает ${missing.join(" и ")} (кто продаёт и куда писать) — платёжная система может не пропустить сайт: ${SETTINGS}`
      : "✓ страницы /terms, /refund и /privacy с реквизитами";
  }

  const storage = storageKind();
  const connect = "Connect Project: префикс BLOB, отметьте «Add a read-write token env var», затем Redeploy";
  if (storage === "blob") {
    const problem = await blobProblem();
    checks["Хранилище файлов"] = problem
      ? `⚠ Vercel Blob подключён, но не отвечает (${describe(problem)}) — картинки, видео и вложения не сохранятся. Vercel → Storage → ваше хранилище Blob → ${connect}`
      : "✓ Vercel Blob подключён";
  } else {
    checks["Хранилище файлов"] =
      storage === "none"
        ? `⚠ не подключено — картинки, видео и вложения не сохранятся. Vercel → Storage → Create → Blob (Private) → ${connect}`
        : "✓ папка .data/files";
  }

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

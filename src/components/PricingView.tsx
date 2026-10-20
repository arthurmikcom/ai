"use client";

import { Check, Coins, CreditCard, Gem, KeyRound, LoaderCircle, Sparkles } from "@/components/MaryxIcons";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { PLAN_NAMES, PLAN_ORDER, PLAN_TAGLINES, planRank } from "@/lib/plans";
import type { BillingOptions, PaidPlanId, PlanId, UsageKind } from "@/lib/types";
import { useApp } from "./AppState";
import { PromoForm } from "./PromoForm";
import { LegalLinks } from "./LegalPage";
import { PageHeading } from "./Design";

/** Forms for 1, 2–4 and 5+ of each kind, then what follows the number. */
const KIND_WORDS: Record<UsageKind, [string, string, string]> = {
  chat: ["сообщение", "сообщения", "сообщений"],
  image: ["изображение", "изображения", "изображений"],
  video: ["видео", "видео", "видео"],
  voice: ["голосовое сообщение", "голосовых сообщения", "голосовых сообщений"],
};

function plural(n: number, [one, few, many]: [string, string, string]): string {
  const tens = n % 100;
  const last = n % 10;
  if (tens >= 11 && tens <= 14) return many;
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

function limitText(limit: number | null, kind: UsageKind): string {
  if (limit === null) return `Без лимита: ${KIND_WORDS[kind][2]}`;
  if (limit === 0) return kind === "video" ? "Видео — на платных тарифах или за кредиты" : `${KIND_WORDS[kind][2]}: нет`;
  return `${limit.toLocaleString("ru-RU")} ${plural(limit, KIND_WORDS[kind])} в день`;
}

export function PricingView() {
  const { me, refreshMe, maryxOnly } = useApp();
  const [options, setOptions] = useState<BillingOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    api<BillingOptions>("/api/billing/plans").then(setOptions, (e: Error) => setError(e.message));
    // The balance may have changed since the app loaded (pictures, video, dictation).
    refreshMe();
  }, [refreshMe]);

  // The credits section appears once the plans have loaded, so a link to #credits scrolls here then.
  useEffect(() => {
    if (options && window.location.hash === "#credits") document.getElementById("credits")?.scrollIntoView();
  }, [options]);

  const buyCredits = async (method: "yookassa" | "stripe", pack: string) => {
    setBusy(`${method}:${pack}`);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/billing/credits", {
        method: "POST",
        body: JSON.stringify({ method, pack }),
      });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const [notice, setNotice] = useState<string | null>(null);
  const checkout = async (method: "yookassa" | "stripe", plan: PaidPlanId) => {
    setBusy(`${method}:${plan}`);
    setError(null);
    setNotice(null);
    try {
      const res = await api<{ url?: string; changed?: PaidPlanId }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ method, plan, consent }),
      });
      if (res.url) {
        window.location.assign(res.url);
        return;
      }
      // A Stripe subscription moved to the other plan: the difference comes on the next invoice.
      setNotice(`Готово: теперь у вас ${PLAN_NAMES[res.changed ?? plan]}. Разница за оставшиеся дни пересчитается в следующем счёте.`);
      refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const current: PlanId = me?.plan.id ?? "free";
  // A promo period can be extended by subscribing, and a YooKassa period
  // that won't renew by itself can be paid again; paid time starts after it.
  const repay = Boolean(me?.plan.repay);
  // A live Stripe subscription switches plan in place (with proration).
  const switching = Boolean(me?.plan.stripeLive);
  const canBuy = !switching && (current === "free" || me?.plan.provider === "promo" || repay);
  // Stripe can't start after a YooKassa period without double-charging it.
  const stripe = repay ? null : (options?.methods.stripe ?? null);
  const yookassa = options?.methods.yookassa ?? null;
  const anyMethod = Boolean(yookassa || stripe);

  const feature = (text: ReactNode, muted = false) => (
    <li className={`flex items-start gap-2 ${muted ? "text-zinc-500" : ""}`}>
      <Check className={`mt-0.5 size-4 shrink-0 ${muted ? "text-zinc-600" : "text-emerald-400"}`} />
      <span>{text}</span>
    </li>
  );

  /** What a plan gives, in the order people compare plans. */
  const features = (plan: PlanId, o: BillingOptions) => {
    const limits = o.limits[plan];
    const media = o.media[plan];
    const free = plan === "free";
    return (
      <>
        {feature(limitText(limits.chat, "chat"))}
        {free && o.freeImages
          ? feature(`Картинки: бесплатная нейросеть — ${limits.image === null ? "без лимита" : `${limits.image} в день`}, кредиты не тратятся`)
          : feature(<><b className="font-medium text-zinc-100">GPT Image</b>: картинки и обработка ваших фото{limits.image !== null ? ` — до ${limits.image} в день` : ""}</>)}
        {limits.video === 0 ? feature("Видео — на платных тарифах или за кредиты", true) : feature(limitText(limits.video, "video"))}
        {!free && media && feature(<>В месяц на картинки и видео: ≈ {media.images.toLocaleString("ru-RU")} картинок или ≈ {media.videos.toLocaleString("ru-RU")} видео</>)}
        {feature(limitText(limits.voice, "voice"))}
        {feature(maryxOnly ? "MARYX — тексты, картинки и видео" : "Claude, GPT, Gemini и другие модели")}
        {feature("Плагины и свои ассистенты")}
        {o.budget[plan] !== null && feature(`${maryxOnly ? "Сложные задачи" : "Дорогие модели"}, «Думать глубже» и большие файлы расходуют дневной лимит быстрее`, true)}
      </>
    );
  };

  /** The way to a paid plan from where the user is now. */
  const action = (plan: PaidPlanId) => {
    if (plan === current) {
      return (
        <Link href="/settings" className="plan-action plan-action--ghost">
          Управлять подпиской
        </Link>
      );
    }
    const stripePrice = stripe?.prices[plan];
    if (switching) {
      return stripePrice ? (
        <button type="button" disabled={busy !== null || !consent} onClick={() => checkout("stripe", plan)} className="plan-action">
          {busy === `stripe:${plan}` ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          {planRank(plan) > planRank(current) ? "Перейти на" : "Сменить на"} {PLAN_NAMES[plan]}
        </button>
      ) : null;
    }
    if (!canBuy) {
      return (
        <Link href="/settings" className="plan-action plan-action--ghost">
          Управлять подпиской
        </Link>
      );
    }
    const rubles = plan === "pro" ? yookassa : null;
    if (!stripePrice && !rubles) {
      return (
        <p className="plan-note">
          {me?.admin
            ? anyMethod
              ? `${PLAN_NAMES[plan]} не продаётся: проверьте ${plan.toUpperCase()}_PRICE_USD.`
              : "Оплата не подключена: задайте ключи Stripe. Пока можно выдавать Pro промокодами в настройках."
            : "Онлайн-оплата скоро появится. Если у вас есть промокод — введите его ниже."}
        </p>
      );
    }
    return (
      <div className="grid gap-2">
        {stripePrice && (
          <button type="button" disabled={busy !== null || !consent} onClick={() => checkout("stripe", plan)} className="plan-action">
            {busy === `stripe:${plan}` ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
            Оформить {PLAN_NAMES[plan]}
          </button>
        )}
        {rubles && (
          <button
            type="button"
            disabled={busy !== null || !consent}
            onClick={() => checkout("yookassa", plan)}
            className={stripePrice ? "plan-action plan-action--ghost" : "plan-action"}
          >
            {busy === `yookassa:${plan}` ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
            В рублях · {rubles.price}
          </button>
        )}
      </div>
    );
  };

  const EYEBROW: Record<PlanId, string> = { free: "Первый шаг", plus: "Для старта", pro: "Популярный", ultra: "Максимум" };

  return (
    <div className="pricing-page h-full overflow-y-auto">
      <div className="page-content !max-w-[1240px]">
        <PageHeading number="05" eyebrow="Больше возможностей" title="Тарифы" description={
            maryxOnly
              ? "Выберите свой масштаб. MARYX доступен на любом тарифе — платные дают больше сообщений, картинки GPT Image и видео."
              : "Выберите свой масштаб. Все модели доступны на любом тарифе — платные дают больше пространства для работы и творчества."
          } />

        {!options && !error && (
          <div className="mt-16 flex justify-center">
            <LoaderCircle className="size-6 animate-spin text-zinc-500" />
          </div>
        )}

        {options && anyMethod && (canBuy || switching) && (
          <label className="plan-consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              Согласен на автоматическое ежемесячное списание стоимости подписки и с{" "}
              <Link href="/terms" target="_blank">
                условиями
              </Link>
              . Отключить автопродление можно в любой момент в настройках.
            </span>
          </label>
        )}
        {options && current !== "free" && canBuy && anyMethod && (
          <p className="plan-consent-note">
            {repay
              ? "Подписка сама не продлится. Оплатите заново — новый месяц начнётся после окончания текущего."
              : "У вас тариф по промокоду. Если оформить подписку сейчас, оплаченный месяц начнётся после окончания промо-периода."}
          </p>
        )}
        {notice && (
          <p role="status" className="plan-consent-note">
            {notice}
          </p>
        )}

        {options && (
          <div className="plans-grid">
            {PLAN_ORDER.map((plan) => {
              const isCurrent = plan === current;
              const price = plan === "free" ? "0 $" : (options.prices[plan] ?? "—");
              return (
                <div key={plan} className="plan-card flex flex-col" data-plan={plan} data-current={isCurrent || undefined}>
                  <div className="plan-label mb-4">
                    <span className="plan-icon">{plan === "free" ? <Sparkles size={22} /> : <Gem size={22} />}</span>
                    <div className="section-label">{EYEBROW[plan]}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold text-zinc-100">{PLAN_NAMES[plan]}</h2>
                    {isCurrent && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-zinc-300">ваш тариф</span>}
                  </div>
                  <p className="mt-1 min-h-10 text-sm text-zinc-400">{PLAN_TAGLINES[plan]}</p>
                  <div className="plan-price">
                    {price}
                    {plan !== "free" && price !== "—" && <span> / месяц</span>}
                  </div>
                  <div className="plan-actions">{plan !== "free" && action(plan)}</div>
                  <ul className="mt-5 flex-1 space-y-3 text-[13px] text-zinc-300">{features(plan, options)}</ul>
                </div>
              );
            })}
          </div>
        )}

        {options && (
          <section id="credits" className="mt-10 scroll-mt-6">
            <div className="flex items-center gap-2">
              <Coins className="size-5 text-amber-300" />
              <h2 className="text-xl font-semibold text-zinc-100">AI-кредиты</h2>
              {me && (
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-zinc-300">
                  {me.credits < 0 ? `долг: ${(-me.credits).toLocaleString("ru-RU")}` : `у вас: ${me.credits.toLocaleString("ru-RU")}`}
                </span>
              )}
            </div>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              Закончился дневной лимит — продолжайте за кредиты, на любом тарифе. Списывается реальная стоимость
              запроса: {maryxOnly ? "простое сообщение" : "сообщение быстрой модели"} — около {options.credits.min.chat} кредита,{" "}
              {maryxOnly ? "сложные задачи" : "умные модели"} и большие файлы — больше, картинка — от {options.credits.min.image}, видео —
              от {options.credits.min.video}. Кредиты не сгорают.
            </p>
            {options.credits.packs.length > 0 ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                {options.credits.packs.map((pack) => (
                  <div key={pack.id} className="surface-card flex flex-col rounded-2xl p-5">
                    <div className="text-3xl font-medium tracking-tight text-zinc-100">
                      {pack.credits.toLocaleString("ru-RU")}
                    </div>
                    <div className="text-sm text-zinc-500">кредитов</div>
                    <div className="mt-5 space-y-2">
                      {pack.usd && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => buyCredits("stripe", pack.id)}
                          className="maryx-button flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm"
                        >
                          {busy === `stripe:${pack.id}` ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                          {pack.usd} · картой
                        </button>
                      )}
                      {pack.rub && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => buyCredits("yookassa", pack.id)}
                          className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm ${pack.usd ? "border border-white/15 bg-white/5 font-medium text-zinc-100 hover:bg-white/10 disabled:opacity-50" : "maryx-button"}`}
                        >
                          {busy === `yookassa:${pack.id}` ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                          {pack.rub} · в рублях
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-black/30 p-3 text-xs text-zinc-400">
                {me?.admin
                  ? "Продажа кредитов включится, когда будут заданы ключи Stripe. Пока можно начислять кредиты вручную или промокодами в настройках."
                  : "Покупка кредитов скоро появится. Кредиты также можно получить по промокоду."}
              </p>
            )}
          </section>
        )}

        {error && <p className="mt-6 text-center text-sm text-red-300">{error}</p>}

        {/* Own keys belong to the all-models mode. */}
        {!maryxOnly && (
          <div className="surface-card mx-auto mt-8 flex max-w-2xl items-start gap-3 rounded-2xl p-5 text-sm text-zinc-400">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-violet-300" />
            <p>
              Есть свой аккаунт OpenRouter? Подключите свой ключ в{" "}
              <Link href="/settings" className="text-violet-300 hover:text-violet-200">
                настройках
              </Link>{" "}
              — MARYX и модели OpenRouter будут работать за ваш счёт, без дневных лимитов.
            </p>
          </div>
        )}

        <div className="surface-card mx-auto mt-8 max-w-md rounded-2xl p-5">
          <h3 className="mb-2 text-center text-sm font-medium text-zinc-300">Есть промокод?</h3>
          <PromoForm />
        </div>

        {anyMethod && (
          <p className="mt-8 text-center text-xs text-zinc-500">
            Подписка продлевается автоматически раз в месяц. Отменить можно в любой момент в настройках —
            доступ сохранится до конца оплаченного периода.
          </p>
        )}
        <LegalLinks className="mt-4" />
      </div>
    </div>
  );
}

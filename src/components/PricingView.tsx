"use client";

import { Banknote, Check, Coins, CreditCard, Gem, KeyRound, LoaderCircle, Sparkles } from "@/components/MaryxIcons";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/client/api";
import { PLAN_NAMES, PLAN_ORDER, PLAN_TAGLINES, planRank } from "@/lib/plans";
import type { BillingOptions, PaidPlanId, PaymentMethod as Method, PlanId, UsageKind } from "@/lib/types";
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

/** A month paid once: nothing renews, so no consent to auto-renewal is asked. */
const ONCE: Method[] = ["paypal", "ton"];

const METHOD_ICON: Record<Method, typeof CreditCard> = { stripe: CreditCard, paddle: CreditCard, yookassa: CreditCard, paypal: Banknote, ton: Coins };

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

  // The credits and promo sections appear once the plans have loaded, so a link to #credits or #promo scrolls there then.
  useEffect(() => {
    const hash = window.location.hash;
    if (options && (hash === "#credits" || hash === "#promo")) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [options]);

  const buyCredits = async (method: Method, pack: string) => {
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
  const checkout = async (method: Method, plan: PaidPlanId) => {
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
      // A subscription moved to the other plan: Stripe settles the difference on the next invoice, Paddle right away.
      setNotice(
        `Готово: теперь у вас ${PLAN_NAMES[res.changed ?? plan]}. ${
          method === "paddle" ? "Разница за оставшиеся дни уже пересчитана." : "Разница за оставшиеся дни пересчитается в следующем счёте."
        }`,
      );
      refreshMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  };

  const current: PlanId = me?.plan.id ?? "free";
  const provider = me?.plan.provider;
  // A promo period can be extended by subscribing, and a YooKassa period
  // that won't renew by itself can be paid again; paid time starts after it.
  const repay = Boolean(me?.plan.repay);
  // A live Stripe or Paddle subscription switches plan in place (with proration).
  const switching = Boolean(me?.plan.stripeLive || me?.plan.paddleLive);
  // A month paid once (PayPal, TON) runs to its end; another month extends it or moves to another plan.
  const paidOnce = current !== "free" && (provider === "paypal" || provider === "ton");
  const canSubscribe = !switching && !paidOnce && (current === "free" || provider === "promo" || repay);
  const canPayOnce = !switching && (canSubscribe || paidOnce);
  // Stripe and Paddle can't start after a YooKassa period without double-charging it.
  const stripe = repay ? null : (options?.methods.stripe ?? null);
  const paddle = repay ? null : (options?.methods.paddle ?? null);
  const yookassa = options?.methods.yookassa ?? null;
  const paypal = options?.methods.paypal ?? null;
  const ton = options?.methods.ton ?? null;
  const renewing = Boolean(yookassa || stripe || paddle);
  const anyMethod = Boolean(renewing || paypal || ton);

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
          ? feature(`Картинки — ${limits.image === null ? "без лимита" : `${limits.image} в день`}, кредиты не тратятся`)
          : feature(<><b className="font-medium text-zinc-100">Картинки в высоком качестве</b> и обработка ваших фото{limits.image !== null ? ` — до ${limits.image} в день` : ""}</>)}
        {free && o.freeImages && o.freePhotoEdits > 0 && feature(`Обработка ваших фото — ${o.freePhotoEdits} в день`)}
        {limits.video === 0 ? feature("Видео — на платных тарифах или за кредиты", true) : feature(limitText(limits.video, "video"))}
        {!free && media && feature(<>В месяц на картинки и видео: ≈ {media.images.toLocaleString("ru-RU")} картинок или ≈ {media.videos.toLocaleString("ru-RU")} видео</>)}
        {feature(limitText(limits.voice, "voice"))}
        {feature(maryxOnly ? "MARYX — тексты, картинки и видео" : "Claude, GPT, Gemini и другие модели")}
        {feature("Плагины и свои ассистенты")}
        {o.budget[plan] !== null && feature(`${maryxOnly ? "Сложные задачи" : "Дорогие модели"}, «Думать глубже» и большие файлы расходуют дневной лимит быстрее`, true)}
      </>
    );
  };

  /** A payment button; the first one shown is the main one. */
  const payButton = (method: Method, plan: PaidPlanId, label: ReactNode, main: boolean) => {
    const Icon = METHOD_ICON[method];
    return (
      <button
        key={method}
        type="button"
        disabled={busy !== null || (!ONCE.includes(method) && !consent)}
        onClick={() => checkout(method, plan)}
        className={main ? "plan-action" : "plan-action plan-action--ghost"}
      >
        {busy === `${method}:${plan}` ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4" />}
        {label}
      </button>
    );
  };

  /** The way to a paid plan from where the user is now. */
  const action = (plan: PaidPlanId) => {
    if (plan === current && !paidOnce) {
      return (
        <Link href="/settings" className="plan-action plan-action--ghost">
          Управлять подпиской
        </Link>
      );
    }
    if (switching) {
      const live = me?.plan.paddleLive ? paddle : stripe;
      return live?.prices[plan]
        ? payButton(me?.plan.paddleLive ? "paddle" : "stripe", plan, <>{planRank(plan) > planRank(current) ? "Перейти на" : "Сменить на"} {PLAN_NAMES[plan]}</>, true)
        : null;
    }
    if (!canSubscribe && !canPayOnce) {
      return (
        <Link href="/settings" className="plan-action plan-action--ghost">
          Управлять подпиской
        </Link>
      );
    }
    const extend = paidOnce && plan === current;
    const buttons: { method: Method; label: ReactNode }[] = [];
    if (canSubscribe) {
      if (stripe?.prices[plan]) buttons.push({ method: "stripe", label: <>Оформить {PLAN_NAMES[plan]}</> });
      if (paddle?.prices[plan]) buttons.push({ method: "paddle", label: stripe?.prices[plan] ? "Через Paddle · карта, PayPal" : <>Оформить {PLAN_NAMES[plan]}</> });
      if (plan === "pro" && yookassa) buttons.push({ method: "yookassa", label: <>В рублях · {yookassa.price}</> });
    }
    if (canPayOnce) {
      if (paypal?.prices[plan]) buttons.push({ method: "paypal", label: extend ? "Продлить · PayPal" : "PayPal · 1 месяц" });
      if (ton?.prices[plan]) buttons.push({ method: "ton", label: extend ? "Продлить · крипто TON" : "Крипто TON · 1 месяц" });
    }
    if (!buttons.length) {
      return (
        <p className="plan-note">
          {paidOnce
            ? "Оплаченный месяц идёт до конца. Сменить тариф можно после него."
            : me?.admin
              ? anyMethod
                ? `${PLAN_NAMES[plan]} не продаётся: проверьте ${plan.toUpperCase()}_PRICE_USD или цену тарифа в Paddle.`
                : "Оплата не подключена: задайте ключи Stripe, Paddle, PayPal или кошелёк TON. Пока можно выдавать Pro промокодами в настройках."
              : "Онлайн-оплата скоро появится. Если у вас есть промокод — введите его ниже."}
        </p>
      );
    }
    return <div className="grid gap-2">{buttons.map((b, i) => payButton(b.method, plan, b.label, i === 0))}</div>;
  };

  const EYEBROW: Record<PlanId, string> = { free: "Первый шаг", plus: "Для старта", pro: "Популярный", ultra: "Максимум" };

  return (
    <div className="pricing-page h-full overflow-y-auto">
      <div className="page-content !max-w-[1240px]">
        <PageHeading number="05" eyebrow="Больше возможностей" title="Тарифы" description={
            maryxOnly
              ? "Выберите свой масштаб. MARYX доступен на любом тарифе — платные дают больше сообщений, картинки в высоком качестве и видео."
              : "Выберите свой масштаб. Все модели доступны на любом тарифе — платные дают больше пространства для работы и творчества."
          } />

        {!options && !error && (
          <div className="mt-16 flex justify-center">
            <LoaderCircle className="size-6 animate-spin text-zinc-500" />
          </div>
        )}

        {options && renewing && (canSubscribe || switching) && (
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
        {options && current !== "free" && (canSubscribe || paidOnce) && anyMethod && (
          <p className="plan-consent-note">
            {paidOnce
              ? "Месяц оплачен разово. Продлите его ещё на месяц или перейдите на другой тариф — оставшиеся дни пересчитаются по его цене."
              : repay
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
                      {(
                        [
                          ["stripe", pack.usd, `${pack.usd} · картой`],
                          ["paddle", pack.usd, options.credits.methods.includes("stripe") ? `${pack.usd} · через Paddle` : `${pack.usd} · картой`],
                          ["paypal", pack.usd, `${pack.usd} · PayPal`],
                          ["ton", pack.usd, `${pack.usd} · в TON`],
                          ["yookassa", pack.rub, `${pack.rub} · в рублях`],
                        ] as [Method, string | undefined, string][]
                      )
                        .filter(([method, price]) => price && options.credits.methods.includes(method))
                        .map(([method, , label], i) => {
                          const Icon = METHOD_ICON[method];
                          return (
                            <button
                              key={method}
                              type="button"
                              disabled={busy !== null}
                              onClick={() => buyCredits(method, pack.id)}
                              className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm ${i ? "border border-white/15 bg-white/5 font-medium text-zinc-100 hover:bg-white/10 disabled:opacity-50" : "maryx-button"}`}
                            >
                              {busy === `${method}:${pack.id}` ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4" />}
                              {label}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-black/30 p-3 text-xs text-zinc-400">
                {me?.admin
                  ? "Продажа кредитов включится, когда будет подключена оплата (Stripe, Paddle, PayPal, кошелёк TON или ЮKassa). Пока можно начислять кредиты вручную или промокодами в настройках."
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

        <div id="promo" className="surface-card mx-auto mt-8 max-w-md scroll-mt-6 rounded-2xl p-5">
          <h3 className="mb-2 text-center text-sm font-medium text-zinc-300">Есть промокод?</h3>
          <PromoForm />
        </div>

        {renewing && (
          <p className="mt-8 text-center text-xs text-zinc-500">
            Подписка продлевается автоматически раз в месяц. Отменить можно в любой момент в настройках —
            доступ сохранится до конца оплаченного периода.
          </p>
        )}
        {(paypal || ton) && (
          <p className={`${renewing ? "mt-2" : "mt-8"} text-center text-xs text-zinc-500`}>
            PayPal и TON — разовая оплата на 1 месяц, без автопродления. Оплачивая, вы соглашаетесь с{" "}
            <Link href="/terms" target="_blank" className="underline">
              условиями
            </Link>
            .
          </p>
        )}
        <LegalLinks className="mt-4" />
      </div>
    </div>
  );
}

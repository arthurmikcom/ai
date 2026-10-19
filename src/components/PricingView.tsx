"use client";

import { Check, Coins, CreditCard, Gem, KeyRound, LoaderCircle, Sparkles } from "@/components/MaryxIcons";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { BillingOptions, PlanId, UsageKind } from "@/lib/types";
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
  if (limit === 0) return kind === "video" ? "Видео — в Pro или за кредиты" : `${KIND_WORDS[kind][2]}: нет`;
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

  const checkout = async (method: "yookassa" | "stripe") => {
    setBusy(method);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ method, consent }),
      });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const current: PlanId = me?.plan.id ?? "free";
  // Pro from a promo code can be extended by subscribing, and a YooKassa period
  // that won't renew by itself can be paid again; paid time starts after it.
  // While a Stripe subscription still exists (even unpaid) it's managed in Stripe, not bought again.
  const repay = Boolean(me?.plan.repay);
  const canBuy = !me?.plan.stripeLive && (current === "free" || me?.plan.provider === "promo" || repay);
  // Stripe can't start after a YooKassa period without double-charging it.
  const stripeMethod = repay ? null : options?.methods.stripe;
  const anyMethod = Boolean(options?.methods.yookassa || stripeMethod);

  const plans: { id: PlanId; name: string; tagline: string; price: string }[] = [
    { id: "free", name: "Бесплатный", tagline: "Чтобы попробовать", price: "0 ₽" },
    {
      id: "pro",
      name: "Pro",
      tagline: "Для тех, кто работает с ИИ каждый день",
      price: options?.methods.yookassa?.price ?? options?.methods.stripe?.price ?? options?.proPrice ?? "—",
    },
  ];

  return (
    <div className="pricing-page h-full overflow-y-auto">
      <div className="page-content !max-w-[1000px]">
        <PageHeading number="05" eyebrow="Больше возможностей" title="Тарифы" description={
            maryxOnly
              ? "Выберите свой масштаб. MARYX доступен на любом тарифе — Pro даёт больше пространства для работы и творчества."
              : "Выберите свой масштаб. Все модели доступны на любом тарифе — Pro даёт больше пространства для работы и творчества."
          } />

        {!options && !error && (
          <div className="mt-16 flex justify-center">
            <LoaderCircle className="size-6 animate-spin text-zinc-500" />
          </div>
        )}

        {options && (
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            {plans.map((plan) => {
              const isCurrent = plan.id === current;
              const pro = plan.id === "pro";
              return (
                <div
                  key={plan.id}
                  className={`plan-card flex flex-col ${
                    pro ? "plan-card-pro" : ""
                  }`}
                >
                  <div className="plan-label mb-5"><span className="plan-icon">{pro ? <Gem size={25} /> : <Sparkles size={25} />}</span><div className="section-label">{pro ? "Для больших задач" : "Первый шаг к большему"}</div></div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold text-zinc-100">{plan.name}</h2>
                    {isCurrent && (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-zinc-300">ваш тариф</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-zinc-400">{plan.tagline}</p>
                  <div className="mt-7 border-b border-white/10 pb-6 text-5xl font-medium tracking-[-0.05em] text-zinc-100">
                    {plan.price}
                    {pro && plan.price !== "—" && <span className="text-base font-normal text-zinc-400"> / месяц</span>}
                  </div>

                  <ul className="mt-6 flex-1 space-y-3 text-[13px] text-zinc-300">
                    {(Object.keys(KIND_WORDS) as UsageKind[]).map((kind) => (
                      <li key={kind} className="flex items-center gap-2">
                        <Check className="size-4 shrink-0 text-emerald-400" />
                        {limitText(options.limits[plan.id][kind], kind)}
                      </li>
                    ))}
                    <li className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-emerald-400" />
                      {maryxOnly ? "MARYX — тексты, картинки и видео" : "Claude, GPT, Gemini и другие модели"}
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-emerald-400" />
                      Свои ассистенты
                    </li>
                    {options.budget[plan.id] !== null && (
                      <li className="flex items-start gap-2 text-zinc-500">
                        <Check className="mt-0.5 size-4 shrink-0 text-zinc-600" />
                        {maryxOnly ? "Сложные задачи" : "Дорогие модели"}, «Думать глубже» и большие файлы расходуют дневной лимит быстрее
                      </li>
                    )}
                  </ul>

                  {pro && (
                    <div className="mt-6 space-y-2">
                      {!canBuy ? (
                        <Link
                          href="/settings"
                          className="block rounded-xl border border-white/10 py-2.5 text-center text-sm text-zinc-200 hover:bg-white/5"
                        >
                          Управлять подпиской
                        </Link>
                      ) : (
                        <>
                          {current === "pro" && anyMethod && (
                            <p className="text-xs text-violet-200">
                              {repay
                                ? "Подписка сама не продлится. Оплатите заново — новый месяц начнётся после окончания текущего."
                                : "У вас Pro по промокоду. Если оформить подписку сейчас, оплаченный месяц начнётся после окончания промо-периода."}
                            </p>
                          )}
                          {anyMethod && (
                            <label className="flex cursor-pointer items-start gap-2 pb-1 text-xs text-zinc-400">
                              <input
                                type="checkbox"
                                checked={consent}
                                onChange={(e) => setConsent(e.target.checked)}
                                className="mt-0.5 accent-violet-500"
                              />
                              <span>
                                Согласен на автоматическое ежемесячное списание стоимости подписки и с{" "}
                                <Link href="/terms" target="_blank" className="text-violet-300 hover:text-violet-200">
                                  условиями
                                </Link>
                                . Отключить автопродление можно в любой момент в настройках.
                              </span>
                            </label>
                          )}
                          {options.methods.yookassa && (
                            <button
                              type="button"
                              disabled={busy !== null || !consent}
                              onClick={() => checkout("yookassa")}
                              className="maryx-button flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm"
                            >
                              {busy === "yookassa" ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                              Оплатить картой или СБП · {options.methods.yookassa.price}
                            </button>
                          )}
                          {stripeMethod && (
                            <button
                              type="button"
                              disabled={busy !== null || !consent}
                              onClick={() => checkout("stripe")}
                              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-medium text-zinc-100 hover:bg-white/10 disabled:opacity-50"
                            >
                              {busy === "stripe" ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                              Международная карта · {stripeMethod.price}
                            </button>
                          )}
                          {!anyMethod && (
                            <p className="rounded-xl bg-black/30 p-3 text-center text-xs text-zinc-400">
                              {me?.admin
                                ? "Оплата не подключена: задайте ключи ЮKassa или Stripe. Пока можно выдавать Pro промокодами в настройках."
                                : "Онлайн-оплата скоро появится. Если у вас есть промокод — введите его ниже."}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
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
                      {pack.rub && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => buyCredits("yookassa", pack.id)}
                          className="maryx-button flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm"
                        >
                          {busy === `yookassa:${pack.id}` ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                          {pack.rub} · картой или СБП
                        </button>
                      )}
                      {pack.usd && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => buyCredits("stripe", pack.id)}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-medium text-zinc-100 hover:bg-white/10 disabled:opacity-50"
                        >
                          {busy === `stripe:${pack.id}` ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                          {pack.usd} · международная карта
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-xl bg-black/30 p-3 text-xs text-zinc-400">
                {me?.admin
                  ? "Продажа кредитов включится, когда будут заданы ключи ЮKassa или Stripe. Пока можно начислять кредиты вручную или промокодами в настройках."
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

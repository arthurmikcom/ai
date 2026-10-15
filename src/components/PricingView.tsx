"use client";

import { Check, CreditCard, LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { BillingOptions, PlanId, UsageKind } from "@/lib/types";
import { useApp } from "./AppState";
import { PromoForm } from "./PromoForm";
import { PageHeading } from "./Design";

const KIND_LABEL: Record<UsageKind, string> = {
  chat: "сообщений в день",
  image: "изображений в день",
  video: "видео в день",
};

function limitText(limit: number | null, kind: UsageKind): string {
  if (limit === null) return `Без лимита: ${KIND_LABEL[kind].replace(" в день", "")}`;
  if (limit === 0) return kind === "video" ? "Видео — только в Pro" : `${KIND_LABEL[kind]}: нет`;
  return `${limit} ${KIND_LABEL[kind]}`;
}

export function PricingView() {
  const { me } = useApp();
  const [options, setOptions] = useState<BillingOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);

  useEffect(() => {
    api<BillingOptions>("/api/billing/plans").then(setOptions, (e: Error) => setError(e.message));
  }, []);

  const checkout = async (method: "yookassa" | "stripe") => {
    setBusy(method);
    setError(null);
    try {
      const { url } = await api<{ url: string }>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({ method, consent }),
      });
      window.location.href = url;
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
      price: options?.methods.yookassa?.price ?? options?.methods.stripe?.price ?? "—",
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="page-content !max-w-[1000px]">
        <PageHeading number="05" eyebrow="Больше возможностей" title="Тарифы" description="Выберите свой масштаб. Все модели доступны на любом тарифе — Pro даёт больше пространства для работы и творчества." />

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
                  <div className="section-label mb-5">{pro ? "Для больших задач" : "Первый шаг к большему"}</div>
                  <div className="flex items-center gap-2">
                    {pro && <Sparkles className="size-5 text-violet-300" />}
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
                    {(Object.keys(KIND_LABEL) as UsageKind[]).map((kind) => (
                      <li key={kind} className="flex items-center gap-2">
                        <Check className="size-4 shrink-0 text-emerald-400" />
                        {limitText(options.limits[plan.id][kind], kind)}
                      </li>
                    ))}
                    <li className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-emerald-400" />
                      Claude, GPT, Gemini и другие модели
                    </li>
                    <li className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-emerald-400" />
                      Свои ассистенты
                    </li>
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
                                Согласен на автоматическое ежемесячное списание стоимости подписки. Отключить
                                автопродление можно в любой момент в настройках.
                              </span>
                            </label>
                          )}
                          {options.methods.yookassa && (
                            <button
                              type="button"
                              disabled={busy !== null || !consent}
                              onClick={() => checkout("yookassa")}
                              className="nexus-button flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm"
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

        {error && <p className="mt-6 text-center text-sm text-red-300">{error}</p>}

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
      </div>
    </div>
  );
}

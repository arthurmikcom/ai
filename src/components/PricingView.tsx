"use client";

import { Check, CreditCard, LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { BillingOptions, PlanId, UsageKind } from "@/lib/types";
import { useApp } from "./AppState";
import { PromoForm } from "./PromoForm";

const KIND_LABEL: Record<UsageKind, string> = {
  chat: "сообщений в день",
  image: "изображений в день",
  video: "видео в день",
};

function limitText(limit: number | null, kind: UsageKind): string {
  return limit === null ? `Без лимита: ${KIND_LABEL[kind].replace(" в день", "")}` : `${limit} ${KIND_LABEL[kind]}`;
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
  // Pro from a promo code can be extended by subscribing; paid time starts after it.
  // While a Stripe subscription still exists (even unpaid) it's managed in Stripe, not bought again.
  const canBuy = !me?.plan.stripeLive && (current === "free" || me?.plan.provider === "promo");
  const anyMethod = Boolean(options?.methods.yookassa || options?.methods.stripe);

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
      <div className="mx-auto max-w-4xl px-4 pb-16 pt-14 md:pt-8">
        <h1 className="text-center text-3xl font-semibold text-zinc-100">Тарифы</h1>
        <p className="mt-2 text-center text-sm text-zinc-400">
          Все модели доступны на любом тарифе. Pro снимает ограничения на объём.
        </p>

        {!options && !error && (
          <div className="mt-16 flex justify-center">
            <LoaderCircle className="size-6 animate-spin text-zinc-500" />
          </div>
        )}

        {options && (
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {plans.map((plan) => {
              const isCurrent = plan.id === current;
              const pro = plan.id === "pro";
              return (
                <div
                  key={plan.id}
                  className={`flex flex-col rounded-3xl border p-6 ${
                    pro ? "border-violet-400/40 bg-gradient-to-b from-violet-500/10 to-zinc-900" : "border-white/10 bg-zinc-900"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {pro && <Sparkles className="size-5 text-violet-300" />}
                    <h2 className="text-xl font-semibold text-zinc-100">{plan.name}</h2>
                    {isCurrent && (
                      <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-zinc-300">ваш тариф</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-zinc-400">{plan.tagline}</p>
                  <div className="mt-5 text-3xl font-semibold text-zinc-100">
                    {plan.price}
                    {pro && plan.price !== "—" && <span className="text-base font-normal text-zinc-400"> / месяц</span>}
                  </div>

                  <ul className="mt-6 flex-1 space-y-2 text-sm text-zinc-300">
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
                              У вас Pro по промокоду. Если оформить подписку сейчас, оплаченный месяц начнётся
                              после окончания промо-периода.
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
                              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 py-2.5 text-sm font-medium text-white shadow-lg shadow-violet-500/20 hover:brightness-110 disabled:opacity-50"
                            >
                              {busy === "yookassa" ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                              Оплатить картой или СБП · {options.methods.yookassa.price}
                            </button>
                          )}
                          {options.methods.stripe && (
                            <button
                              type="button"
                              disabled={busy !== null || !consent}
                              onClick={() => checkout("stripe")}
                              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 py-2.5 text-sm font-medium text-zinc-100 hover:bg-white/10 disabled:opacity-50"
                            >
                              {busy === "stripe" ? <LoaderCircle className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                              International card · {options.methods.stripe.price}
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

        <div className="mx-auto mt-10 max-w-md">
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

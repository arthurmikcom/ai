// What the public legal pages (/terms, /refund, /privacy) say about who runs
// the site and what it costs. The owner's details come from the environment
// (LEGAL_NAME, LEGAL_ADDRESS, LEGAL_EMAIL), so none are kept in the code.
// Payment providers (Stripe, Paddle, PayPal, ЮKassa) check these pages before they activate an account.

import { PAID_PLANS, PLAN_NAMES } from "@/lib/plans";
import type { PaidPlanId } from "@/lib/types";
import type { PackDef } from "./billing/credits";
import { sellablePacks } from "./billing/packs";
import { sellsInUsd } from "./billing/packs";
import { paddleCreditsConfigured, paddlePlanPrice, paddleSells } from "./billing/paddle";
import { paypalConfigured } from "./billing/paypal";
import { planLimit, planPriceSetting, proPriceRub } from "./billing/plans";
import { planDailyUsd } from "./spend";
import { stripeConfigured, stripeCreditsConfigured, stripePlanPrice, stripeSells } from "./billing/stripe";
import { tonConfigured } from "./billing/ton";
import { yookassaConfigured } from "./billing/yookassa";

export interface LegalInfo {
  /** Who runs the service: a company or a person (LEGAL_NAME). */
  name: string;
  /** Postal address, for the provider's checks and customers (LEGAL_ADDRESS). */
  address?: string;
  /** Where customers write: support, refunds, privacy (LEGAL_EMAIL). */
  email?: string;
}

const env = (name: string) => process.env[name]?.trim() || undefined;

export function legalInfo(): LegalInfo {
  return { name: env("LEGAL_NAME") ?? "MARYX Ai", address: env("LEGAL_ADDRESS"), email: env("LEGAL_EMAIL") };
}

export interface PaidPlanTerms {
  id: PaidPlanId;
  name: string;
  /** Monthly price of the subscription by card (Stripe's, else Paddle's; undefined where neither sells it). */
  price?: { amount: number; currency: string };
  /** A month paid once through PayPal or TON, in US dollars. */
  once?: number;
  /** Monthly price through ЮKassa, in roubles (Pro only). */
  rub?: number;
  chat: number | null;
  image: number | null;
  video: number | null;
}

export interface PublicPrices {
  /** The paid plans, each with its prices as sold here. */
  plans: PaidPlanTerms[];
  /** Packs on sale, priced only in the currencies a payment method takes. */
  packs: PackDef[];
  /** Payment providers that take money on this site. */
  providers: string[];
  /** Those that pay for a month at a time (PayPal, TON). */
  oneOff: string[];
  /** Paddle sells as the merchant of record (its terms must say so). */
  paddle: boolean;
  /** Payments in the TON cryptocurrency are taken. */
  ton: boolean;
  free: { chat: number | null; image: number | null };
}

/** Prices and limits exactly as the site sells them, for the terms page (seen without signing in). */
export async function publicPrices(): Promise<PublicPrices> {
  const usd = sellsInUsd();
  const rub = yookassaConfigured();
  const oneOff = [...(paypalConfigured() ? ["PayPal"] : []), ...(tonConfigured() ? ["TON"] : [])];
  // A provider's outage only hides the price; the page still opens.
  const plans = await Promise.all(
    PAID_PLANS.map(async (id): Promise<PaidPlanTerms> => ({
      id,
      name: PLAN_NAMES[id],
      price:
        stripeConfigured() && stripeSells(id)
          ? await stripePlanPrice(id).catch(() => undefined)
          : paddleSells(id)
            ? await paddlePlanPrice(id).catch(() => undefined)
            : undefined,
      once: oneOff.length && planPriceSetting(id).usd > 0 ? planPriceSetting(id).usd : undefined,
      rub: rub && id === "pro" ? proPriceRub() : undefined,
      chat: planLimit(id, "chat"),
      image: planLimit(id, "image"),
      video: planLimit(id, "video"),
    })),
  );
  return {
    plans,
    packs: sellablePacks().map((p) => ({ ...p, usd: usd ? p.usd : 0, rub: rub ? p.rub : 0 })),
    providers: [
      ...(stripeCreditsConfigured() ? ["Stripe"] : []),
      ...(paddleCreditsConfigured() ? ["Paddle"] : []),
      ...(paypalConfigured() ? ["PayPal"] : []),
      ...(rub ? ["ЮKassa"] : []),
    ],
    oneOff,
    paddle: paddleCreditsConfigured(),
    ton: tonConfigured(),
    free: { chat: planLimit("free", "chat"), image: planLimit("free", "image") },
  };
}

/** The payment providers in a sentence ("Stripe, PayPal и ЮKassa"), or a general word when none is set up. */
export function providersText(providers: string[], none = "платёжные системы"): string {
  return providers.length > 1 ? `${providers.slice(0, -1).join(", ")} и ${providers.at(-1)}` : (providers[0] ?? none);
}

/** Whether the plans have a daily AI budget besides their counts (it's mentioned in the terms). */
export function hasBudgets(): boolean {
  return planDailyUsd("free") !== null || PAID_PLANS.some((p) => planDailyUsd(p) !== null);
}

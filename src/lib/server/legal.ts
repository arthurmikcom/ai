// What the public legal pages (/terms, /refund, /privacy) say about who runs
// the site and what it costs. The owner's details come from the environment
// (LEGAL_NAME, LEGAL_ADDRESS, LEGAL_EMAIL), so none are kept in the code.
// Payment providers (Stripe, ЮKassa) check these pages before they activate an account.

import type { PackDef } from "./billing/credits";
import { sellablePacks } from "./billing/packs";
import { planLimit, proPriceRub } from "./billing/plans";
import { planDailyUsd } from "./spend";
import { stripeConfigured, stripeCreditsConfigured, stripeProPrice } from "./billing/stripe";
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

export interface PublicPrices {
  /** Monthly Pro price through Stripe (undefined where Pro isn't sold there). */
  proStripe?: { amount: number; currency: string };
  /** Monthly Pro price through ЮKassa, in roubles. */
  proRub?: number;
  /** Packs on sale, priced only in the currencies a payment method takes. */
  packs: PackDef[];
  /** Payment providers that take money on this site. */
  providers: string[];
  free: { chat: number | null; image: number | null };
  pro: { chat: number | null; image: number | null; video: number | null };
}

/** Prices and limits exactly as the site sells them, for the terms page (seen without signing in). */
export async function publicPrices(): Promise<PublicPrices> {
  const usd = stripeCreditsConfigured();
  const rub = yookassaConfigured();
  // A Stripe outage only hides the price; the page still opens.
  const proStripe = stripeConfigured() ? await stripeProPrice().catch(() => undefined) : undefined;
  return {
    proStripe,
    proRub: rub ? proPriceRub() : undefined,
    packs: sellablePacks().map((p) => ({ ...p, usd: usd ? p.usd : 0, rub: rub ? p.rub : 0 })),
    providers: [...(usd ? ["Stripe"] : []), ...(rub ? ["ЮKassa"] : [])],
    free: { chat: planLimit("free", "chat"), image: planLimit("free", "image") },
    pro: { chat: planLimit("pro", "chat"), image: planLimit("pro", "image"), video: planLimit("pro", "video") },
  };
}

/** The payment providers in a sentence ("Stripe и ЮKassa"), or a general word when none is set up. */
export function providersText(providers: string[], none = "платёжные системы"): string {
  return providers.length ? providers.join(" и ") : none;
}

/** Whether the plans have a daily AI budget besides their counts (it's mentioned in the terms). */
export function hasBudgets(): boolean {
  return planDailyUsd("free") !== null || planDailyUsd("pro") !== null;
}

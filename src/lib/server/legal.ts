// What the public legal pages (/terms, /refund, /privacy) say about who runs
// the site and what it costs. The owner's details come from the environment
// (LEGAL_NAME, LEGAL_ADDRESS, LEGAL_EMAIL), so none are kept in the code.
// Payment providers (Stripe, ЮKassa) check these pages before they activate an account.

import { creditPacks, type PackDef } from "./billing/credits";
import { planDailyUsd } from "./spend";
import { planLimit, proPriceRub } from "./billing/plans";
import { proPriceUsd } from "./billing/stripe";

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
  /** Monthly Pro price; undefined where it isn't set (a price kept in Stripe is shown at checkout). */
  proUsd?: number;
  proRub?: number;
  packs: PackDef[];
  free: { chat: number | null; image: number | null };
  pro: { chat: number | null; image: number | null; video: number | null };
}

/** Prices and limits as the site sells them, for the terms page (seen without signing in). */
export function publicPrices(): PublicPrices {
  const usd = env("STRIPE_SECRET_KEY") && !env("STRIPE_PRICE_PRO") && proPriceUsd() > 0 ? proPriceUsd() : undefined;
  const rub = env("YOOKASSA_SHOP_ID") ? proPriceRub() : undefined;
  return {
    proUsd: usd,
    proRub: rub,
    packs: creditPacks(),
    free: { chat: planLimit("free", "chat"), image: planLimit("free", "image") },
    pro: { chat: planLimit("pro", "chat"), image: planLimit("pro", "image"), video: planLimit("pro", "video") },
  };
}

/** Whether the plans have a daily AI budget besides their counts (it's mentioned in the terms). */
export function hasBudgets(): boolean {
  return planDailyUsd("free") !== null || planDailyUsd("pro") !== null;
}

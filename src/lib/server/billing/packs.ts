import { creditPacks, type PackDef } from "./credits";
import { paddleCreditsConfigured } from "./paddle";
import { paypalConfigured } from "./paypal";
import { stripeCreditsConfigured } from "./stripe";
import { tonConfigured } from "./ton";
import { yookassaConfigured } from "./yookassa";

/** Whether a payment method takes US dollars (Stripe, Paddle, PayPal, or TON priced in dollars). */
export function sellsInUsd(): boolean {
  return stripeCreditsConfigured() || paddleCreditsConfigured() || paypalConfigured() || tonConfigured();
}

/** Credit packs a user can actually buy here: priced for a payment method that is set up. */
export function sellablePacks(): PackDef[] {
  const rub = yookassaConfigured();
  const usd = sellsInUsd();
  return creditPacks().filter((p) => (rub && p.rub > 0) || (usd && p.usd > 0));
}

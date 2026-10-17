import { creditPacks, type PackDef } from "./credits";
import { stripeCreditsConfigured } from "./stripe";
import { yookassaConfigured } from "./yookassa";

/** Credit packs a user can actually buy here: priced for a payment method that is set up. */
export function sellablePacks(): PackDef[] {
  const rub = yookassaConfigured();
  const usd = stripeCreditsConfigured();
  return creditPacks().filter((p) => (rub && p.rub > 0) || (usd && p.usd > 0));
}

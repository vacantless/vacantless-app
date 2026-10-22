// S726h: the founding-price stamp. A Growth checkout that used promo code
// FOUNDING10 (coupon FOUNDING50X3, 50% off for 3 months, 10 uses) gets its
// price locked for 12 months from sign-up. The webhook writes that on the
// Stripe subscription's metadata, so any future price change can skip it.
// Pure, so it is tested without Stripe.

export const FOUNDING_COUPON_ID = "FOUNDING50X3";
export const FOUNDING_PROMO_CODE = "FOUNDING10";
export const FOUNDING_LOCK_MONTHS = 12;
// S731: the Founding 20 offer (lib/founding-offer) uses its own coupon; its
// subscriptions get the same 12-month price-lock stamp.
import { FOUNDING20_COUPON_ID } from "./founding-offer";

/**
 * True when a Stripe object (a subscription with discounts expanded, or a
 * Checkout session) carries the founding coupon or promo code. Searches the
 * whole value, because the place Stripe keeps the coupon has moved between
 * API versions (discount.coupon, discount.source.coupon, promotion_code.code).
 */
export function hasFoundingDiscount(value: unknown): boolean {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): boolean => {
    if (depth > 8 || v == null) return false;
    if (typeof v === "string") return v === FOUNDING_COUPON_ID || v === FOUNDING_PROMO_CODE || v === FOUNDING20_COUPON_ID;
    if (typeof v !== "object" || seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some((x) => walk(x, depth + 1));
    return Object.values(v as Record<string, unknown>).some((x) => walk(x, depth + 1));
  };
  return walk(value, 0);
}

/** Sign-up (Unix seconds) plus 12 months, as YYYY-MM-DD in UTC. */
export function foundingLockUntil(createdSec: number): string {
  const d = new Date(createdSec * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + FOUNDING_LOCK_MONTHS;
  const target = new Date(Date.UTC(y, m, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

/** The metadata to add, or null when the sub is not founding or already stamped. */
export function foundingStampMetadata(input: {
  subscription: unknown;
  session?: unknown;
  createdSec: number;
  existingMetadata: Record<string, string> | null | undefined;
}): Record<string, string> | null {
  if (input.existingMetadata?.founding_price) return null;
  if (!hasFoundingDiscount(input.subscription) && !hasFoundingDiscount(input.session)) return null;
  return {
    founding_price: "locked",
    founding_price_until: foundingLockUntil(input.createdSec),
    founding_price_note: "Price locked until sign-up plus 12 months. Skip in any price change.",
  };
}

import { tr } from "@/lib/i18n";

// Early-bird tiered pricing: the HomePage sidebar "early-bird discount", Landing copy and checkout pricing all read this,
// so the tiers shown match the prices computed (the server keeps its own copy in functions/src/pricing.js; change both together).
export interface EarlyBirdTier {
  minDays: number; // days until pickup, lower bound (inclusive)
  maxDays: number; // upper bound (inclusive)
  discountPercent: number; // discount percent, e.g. 5 means 5% off
}

// 1002 spec: 5% off for tomorrow, 20% off 2–30 days ahead; book up to 30 days ahead. A 30% off tier for 14+ days is planned for a later release;
// then add a third tier here and change the second tier's maxDays to 13.
export const EARLY_BIRD_TIERS: EarlyBirdTier[] = [
  { minDays: 0, maxDays: 1, discountPercent: 5 },
  { minDays: 2, maxDays: 30, discountPercent: 20 },
];

// Days between the pickup date and "today", rounded to whole days; past dates or today count as 0.
// 2026-10-09: always uses the Taipei date (matching earlyBirdPercent in the server's functions/src/pricing.js),
// not the browser time zone, so users abroad don't see a different discount tier than checkout charges.
export function daysUntilPickup(pickupDate: string, today: Date = new Date()): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const diffDays = Math.round((toUtc(pickupDate) - toUtc(today.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }))) / (24 * 60 * 60 * 1000));
  return Math.max(0, diffDays);
}

export function earlyBirdTierFor(pickupDate: string, today: Date = new Date()): EarlyBirdTier | null {
  const days = daysUntilPickup(pickupDate, today);
  return EARLY_BIRD_TIERS.find((t) => days >= t.minDays && days <= t.maxDays) ?? null;
}

// More than 30 days ahead gets no early-bird discount; returns the list price (discountPercent: 0).
export function applyEarlyBirdPrice(
  originalPrice: number,
  pickupDate: string,
  today: Date = new Date()
): { discountPercent: number; lockedPrice: number; tierLabel: string } {
  const tier = earlyBirdTierFor(pickupDate, today);
  const discountPercent = tier?.discountPercent ?? 0;
  const lockedPrice = Math.round(originalPrice * (1 - discountPercent / 100));
  return {
    discountPercent,
    lockedPrice,
    tierLabel: tier ? `${tierRangeText(tier)}．${discountText(tier.discountPercent)}` : tr("已超過早鳥折扣天數", "Beyond the early-bird window"),
  };
}

/** Discount text: Chinese "95折/8折", English "5% off" */
export function discountText(discountPercent: number): string {
  const paid = 100 - discountPercent;
  return tr(`${paid % 10 === 0 ? paid / 10 : paid}折`, `${discountPercent}% off`);
}

/** Day-range text for a tier, e.g. "提前 2–13 天" / "2–13 days ahead" */
export function tierRangeText(tier: EarlyBirdTier): string {
  if (tier.minDays === 0) return tr("明天", "Tomorrow");
  return tr(`提前 ${tier.minDays}–${tier.maxDays} 天`, `${tier.minDays}–${tier.maxDays} days ahead`);
}

/** Diner cancellation deadline: hoursBefore hours before the pickup slot starts (same logic as cancelDeadlineAt in functions/src/pricing.js) */
export function cancelDeadlineAt(pickupDate: string, pickupWindow: string, hoursBefore = 48): Date {
  const start = pickupWindow.split("-")[0]?.trim() || "00:00";
  return new Date(new Date(`${pickupDate}T${start}:00+08:00`).getTime() - hoursBefore * 3600000);
}

/** Coupon value after cancelling: list price (item price + add-ons/reductions) × rate, capped at the amount paid; the server's value is authoritative */
export function cancelCouponAmount(lock: { list_price?: number; adjust_amount?: number; paid_amount?: number; locked_price?: number }, rate = 0.3): number {
  const original = Math.max(0, (lock.list_price ?? 0) + (lock.adjust_amount ?? 0));
  const paid = Number.isFinite(lock.paid_amount) ? lock.paid_amount! : lock.locked_price ?? 0;
  return Math.max(0, Math.min(Math.round(original * rate), paid));
}

/** Vendor's net after platform commission (rounded to the dollar) */
export function netOfCommission(price: number, rate = 0.05): number {
  return Math.round(price * (1 - rate));
}

/** Suggested price to net `net` dollars: add the commission rate (vendors add 5% when pricing), rounded up to the dollar */
export function withCommission(net: number, rate = 0.05): number {
  return Math.ceil(net * (1 + rate));
}

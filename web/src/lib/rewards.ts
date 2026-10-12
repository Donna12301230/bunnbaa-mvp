import { tr } from "@/lib/i18n";

// Growth reward coupon types (spec §8.3) and allocation algorithm (§8.4), shared with functions/src/rewards.js;
// used here only for vendor portal simulations and diner-facing display.
// Phase one keeps only 3 types (free meal, half price, guaranteed 5% off); 90%, 70% and 20% off coupons are planned for a later release.
export const COUPON_TIERS = [
  { code: "free", label: "免費餐券", labelEn: "Free meal", discount: 100, cost: 95, weight: 0.3 },
  { code: "t50", label: "半價券", labelEn: "Half price", discount: 50, cost: 45, weight: 0.7 },
];
export const BASE_TIER = { code: "t95", label: "九五折券", labelEn: "5% off", discount: 5 };
export const ALL_TIERS = [...COUPON_TIERS, BASE_TIER];

export function tierLabel(code: string): string {
  // Coupon refunded on order cancellation (cancelForCoupon in functions/src/orders.js); does not go through the reward pool
  if (code === "refund") return tr("取消補償券", "Cancellation coupon");
  const t = ALL_TIERS.find((x) => x.code === code);
  return t ? tr(t.label, t.labelEn) : code;
}

/** Diner-facing headline "折 N 元" (N dollars off, 1002 spec §8.3); the subtitle is the coupon name */
export function couponTitle(discount: number): string {
  return tr(`折 ${discount} 元`, `NT$${discount} off`);
}

export function allocatePool(pool: number, tickets: number) {
  const N = Math.max(0, Math.floor(tickets));
  const P = Math.max(0, Math.floor(pool));
  const counts: Record<string, number> = Object.fromEntries(COUPON_TIERS.map((t) => [t.code, 0]));
  if (N === 0) return { counts: { ...counts, [BASE_TIER.code]: 0 }, spent: 0, leftover: P };
  if (N * BASE_TIER.discount > P) {
    const baseCount = Math.floor(P / BASE_TIER.discount);
    return { counts: { ...counts, [BASE_TIER.code]: baseCount }, spent: baseCount * BASE_TIER.discount, leftover: P - baseCount * BASE_TIER.discount };
  }
  const budget = P - N * BASE_TIER.discount;
  let remaining = budget;
  let upgraded = 0;
  for (const tier of COUPON_TIERS) {
    const n = Math.min(Math.floor((budget * tier.weight) / tier.cost), N - upgraded);
    counts[tier.code] = n;
    upgraded += n;
    remaining -= n * tier.cost;
  }
  const top = COUPON_TIERS[0];
  if (counts[top.code] === 0 && remaining >= top.cost && upgraded < N) {
    counts[top.code] = 1;
    upgraded++;
    remaining -= top.cost;
  }
  const filler = COUPON_TIERS[COUPON_TIERS.length - 1];
  while (remaining >= filler.cost && upgraded < N) {
    counts[filler.code]++;
    upgraded++;
    remaining -= filler.cost;
  }
  counts[BASE_TIER.code] = N - upgraded;
  return { counts, spent: P - remaining, leftover: remaining };
}

/** Pool opening progress (0–100): cumulative net revenue ÷ opening threshold. Older rewardStatus docs without a revenue field are back-calculated from the remaining amount */
export function openProgress(st: { revenue_so_far?: number; min_revenue?: number; amount_to_open: number }, fallbackMin = 10000): number {
  const min = st.min_revenue ?? fallbackMin;
  const so = st.revenue_so_far ?? Math.max(0, min - st.amount_to_open);
  return min > 0 ? Math.max(0, Math.min(100, (so / min) * 100)) : 0;
}

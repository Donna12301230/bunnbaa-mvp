import { tr } from "@/lib/i18n";

// 成長獎勵券種（規格 §8.3）與分配演算法（§8.4），跟 functions/src/rewards.js 同一份，
// 這裡只給商家後台試算與前台顯示用。
// 第一階段只保留 3 種（免費餐券、半價券、保底九五折）；一折、三折、八折券列入後續改版。
export const COUPON_TIERS = [
  { code: "free", label: "免費餐券", labelEn: "Free meal", discount: 100, cost: 95, weight: 0.3 },
  { code: "t50", label: "半價券", labelEn: "Half price", discount: 50, cost: 45, weight: 0.7 },
];
export const BASE_TIER = { code: "t95", label: "九五折券", labelEn: "5% off", discount: 5 };
export const ALL_TIERS = [...COUPON_TIERS, BASE_TIER];

export function tierLabel(code: string): string {
  const t = ALL_TIERS.find((x) => x.code === code);
  return t ? tr(t.label, t.labelEn) : code;
}

/** 前台主標「折 N 元」、副標「（百元一折）」 */
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

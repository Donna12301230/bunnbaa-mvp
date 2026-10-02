import { tr } from "@/lib/i18n";

// 早鳥階梯定價——HomePage 側欄「早鳥預約折扣」、Landing 文案、下單算價都讀這一份，
// 顯示的階梯跟算出來的價格是同一套規則（伺服器 functions/src/pricing.js 另有一份，要一起改）。
export interface EarlyBirdTier {
  minDays: number; // 距離取餐日的天數，下限（含）
  maxDays: number; // 上限（含）
  discountPercent: number; // 折扣百分比，例：5 代表 95 折
}

// 1002 規格：明天 95 折、提前 2–30 天 8 折；預訂最遠 30 天。提前 14 天以上 7 折列為後續改版，
// 到時候在這裡加第三階、把第二階 maxDays 改成 13 即可。
export const EARLY_BIRD_TIERS: EarlyBirdTier[] = [
  { minDays: 0, maxDays: 1, discountPercent: 5 },
  { minDays: 2, maxDays: 30, discountPercent: 20 },
];

export const VISIBLE_EARLY_BIRD_TIERS = EARLY_BIRD_TIERS;

// 取餐日跟「今天」之間差幾天，四捨五入到整天；已過期或就是今天算 0 天。
export function daysUntilPickup(pickupDate: string, today: Date = new Date()): number {
  const pickup = new Date(`${pickupDate}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffDays = Math.round((pickup.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(0, diffDays);
}

export function earlyBirdTierFor(pickupDate: string, today: Date = new Date()): EarlyBirdTier | null {
  const days = daysUntilPickup(pickupDate, today);
  return EARLY_BIRD_TIERS.find((t) => days >= t.minDays && days <= t.maxDays) ?? null;
}

// 超過 30 天沒有早鳥折扣，回傳原價（discountPercent: 0）。
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

/** 折扣文字：中文「95折／8折」，英文「5% off」 */
export function discountText(discountPercent: number): string {
  const paid = 100 - discountPercent;
  return tr(`${paid % 10 === 0 ? paid / 10 : paid}折`, `${discountPercent}% off`);
}

/** 階梯的天數範圍文字，例：「提前 2–13 天」「2–13 days ahead」 */
export function tierRangeText(tier: EarlyBirdTier): string {
  if (tier.minDays === 0) return tr("明天", "Tomorrow");
  return tr(`提前 ${tier.minDays}–${tier.maxDays} 天`, `${tier.minDays}–${tier.maxDays} days ahead`);
}

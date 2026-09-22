// 早鳥階梯定價——對應 HomePage.tsx 側欄「早鳥預約折扣」顯示的三個階梯（純前端
// 靜態文字，沒有任何地方真的算過折扣）。這裡補上實際算折扣/鎖定價的邏輯，讓
// 顯示的階梯跟下單時算出來的價格是同一套規則。
export interface EarlyBirdTier {
  minDays: number; // 距離取餐日的天數，下限（含）
  maxDays: number; // 上限（含）
  discountPercent: number; // 折扣百分比，例：5 代表 95 折
  label: string;
}

export const EARLY_BIRD_TIERS: EarlyBirdTier[] = [
  { minDays: 0, maxDays: 1, discountPercent: 5, label: "今日／明日．95折" },
  { minDays: 2, maxDays: 13, discountPercent: 20, label: "提前 2–13 天．8折" },
  { minDays: 14, maxDays: 30, discountPercent: 30, label: "提前 14–30 天．7折" },
];

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
  return { discountPercent, lockedPrice, tierLabel: tier?.label ?? "已超過早鳥折扣天數" };
}

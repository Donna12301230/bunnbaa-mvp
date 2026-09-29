import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import type { Lock } from "@/types";
import { tr } from "@/lib/i18n";

const STATUS_STYLE: Record<string, { zh: string; en: string; className: string }> = {
  locked: { zh: "已鎖定", en: "Locked", className: "bg-orange-100 text-orange-700" },
  for_resale: { zh: "轉賣中", en: "For resale", className: "bg-amber-100 text-amber-800" },
  for_gift: { zh: "贈送中", en: "Being gifted", className: "bg-pink-100 text-pink-700" },
  fulfilled: { zh: "已完成取餐", en: "Picked up", className: "bg-green-100 text-green-700" },
  resold_and_fulfilled: { zh: "已由轉賣對象完成取餐", en: "Picked up by new owner", className: "bg-green-100 text-green-700" },
  no_show: { zh: "已登記未取餐", en: "No-show", className: "bg-red-100 text-red-700" },
};

/** 狀態標籤（依目前語言）＋顏色；每次讀都重新依語言組字串 */
export const LOCK_STATUS_STYLE: Record<string, { label: string; className: string }> = new Proxy({} as Record<string, { label: string; className: string }>, {
  get(_, key: string) {
    const s = STATUS_STYLE[key];
    return s ? { label: tr(s.zh, s.en), className: s.className } : undefined;
  },
});

export type LockOutcome = "fulfilled" | "no_show";

// 還沒取餐、可以核銷或登記未取餐的狀態（跟 functions markLockOutcome 的伺服器檢查一致）
export const REDEEMABLE_STATUSES = new Set(["locked", "for_resale"]);
export const PENDING_STATUSES = new Set(["locked", "for_resale", "for_gift"]);
export const DONE_STATUSES = new Set(["fulfilled", "resold_and_fulfilled"]);

/** 取餐編號＝lock id 末 8 碼（跟消費端 QR 下方顯示的一致） */
export function pickupCode(lock: Pick<Lock, "id">): string {
  return lock.id.slice(-8).toUpperCase();
}

/** 取餐時段結束（台北時間）後才能登記未取餐，跟 functions markLockOutcome 的伺服器檢查一致 */
export function noShowAllowed(lock: Pick<Lock, "pickup_date" | "pickup_window">, now = Date.now()): boolean {
  const endTime = lock.pickup_window?.split("-")[1]?.trim();
  const end = new Date(`${lock.pickup_date}T${endTime}:00+08:00`).getTime();
  return Number.isFinite(end) && now >= end;
}

export const NO_SHOW_TOO_EARLY_HINT = () => tr("取餐時段結束後才能登記未取餐", "Available after the pickup window ends");

/** 狀態轉換只能走 Cloud Function（firestore.rules 擋直接寫） */
export async function markLockOutcome(lockId: string, outcome: LockOutcome, note?: string) {
  const fn = httpsCallable(functions, "markLockOutcome");
  await fn({ lock_id: lockId, outcome, note });
}

import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import type { Lock } from "@/types";
import { tr } from "@/lib/i18n";

const STATUS_STYLE: Record<string, { zh: string; en: string; className: string }> = {
  locked: { zh: "已鎖定", en: "Locked", className: "bg-orange-100 text-orange-700" },
  for_resale: { zh: "轉賣中", en: "For resale", className: "bg-amber-100 text-amber-800" },
  for_gift: { zh: "贈送中", en: "Being gifted", className: "bg-pink-100 text-pink-700" },
  fulfilled: { zh: "已完成取餐", en: "Picked up", className: "bg-green-100 text-green-700" },
  resold_and_fulfilled: { zh: "已由轉讓對象取餐", en: "Picked up by new owner", className: "bg-green-100 text-green-700" },
  no_show: { zh: "已登記未取餐（舊制）", en: "No-show (legacy)", className: "bg-red-100 text-red-700" },
  charity: { zh: "已轉愛心餐", en: "Charity meal", className: "bg-pink-100 text-pink-700" },
  cancelling: { zh: "退款中", en: "Refunding", className: "bg-gray-100 text-gray-700" },
  cancelled: { zh: "已取消", en: "Cancelled", className: "bg-gray-100 text-gray-500" },
};

/** 狀態標籤（依目前語言）＋顏色；每次讀都重新依語言組字串 */
export const LOCK_STATUS_STYLE: Record<string, { label: string; className: string }> = new Proxy({} as Record<string, { label: string; className: string }>, {
  get(_, key: string) {
    const s = STATUS_STYLE[key];
    return s ? { label: tr(s.zh, s.en), className: s.className } : undefined;
  },
});

// 還沒取餐、可以核銷的狀態（跟 functions completePickup 的伺服器檢查一致）
export const REDEEMABLE_STATUSES = new Set(["locked", "for_resale", "for_gift"]);
export const PENDING_STATUSES = new Set(["locked", "for_resale", "for_gift"]);
export const DONE_STATUSES = new Set(["fulfilled", "resold_and_fulfilled"]);
// 算營收的狀態：全額預付且沒退款（未取餐、轉愛心餐也不退）。跟 functions/src/finance.js 的 PAID_STATUSES 一致
export const REVENUE_STATUSES = new Set(["locked", "for_resale", "for_gift", "fulfilled", "resold_and_fulfilled", "charity", "no_show"]);

/** 取餐號：4 碼（第一階段規格）；舊資料沒有就用 lock id 末 8 碼 */
export function pickupCode(lock: Pick<Lock, "id" | "pickup_code">): string {
  return lock.pickup_code ?? lock.id.slice(-8).toUpperCase();
}

export interface PickupSummary {
  kind: "lock" | "charity";
  lock_id?: string;
  reservation_id?: string;
  pickup_code?: string;
  item_name?: string;
  pickup_date?: string;
  pickup_window?: string;
  main_dish?: string | null;
  slots?: { category: string; removed: boolean; dish: string | null; wished: string | null; backup_used?: boolean }[];
  extra_side?: { dish: string; mode: "backup" | "addon"; used: boolean } | null;
  custom_options?: { label: string; choice: string; price?: number }[];
  adjust_amount?: number;
  sides?: string[];
  rice?: string;
  coupon_discount?: number;
  paid?: number;
  status?: string;
  note?: string | null;
  completed?: boolean;
}

/**
 * 取餐核銷一律走 Cloud Function completePickup（firestore.rules 擋直接寫）：
 * 掃 QR（token）、備援（4 碼取餐號＋手機末三碼），或在今日訂單列表當面核對（lock_id）。
 * preview=true 只看內容不核銷。
 */
export async function completePickup(args: { token?: string; pickup_code?: string; phone_last3?: string; lock_id?: string; preview?: boolean }) {
  const res = await httpsCallable(functions, "completePickup")(args);
  return res.data as PickupSummary;
}

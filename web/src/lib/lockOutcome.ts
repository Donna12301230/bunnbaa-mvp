import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import type { Lock } from "@/types";
import { tr } from "@/lib/i18n";

// 訂單狀態的文字與顏色——全站唯一一份（2026-10-09：原本我的餐點、會員中心、管理頁各有一套，用詞與顏色都不同）。
// 顏色讀 index.css 的 --status-* 變數（含暗色版本）。adminZh／adminEn：管理頁需要更精確的說法時才填。
// 類別名稱要完整寫出來，Tailwind 才掃得到（不能用字串組）
const TONE: Record<string, string> = {
  locked: "bg-[var(--status-locked-bg)] text-[var(--status-locked)]",
  resale: "bg-[var(--status-resale-bg)] text-[var(--status-resale)]",
  gift: "bg-[var(--status-gift-bg)] text-[var(--status-gift)]",
  fulfilled: "bg-[var(--status-fulfilled-bg)] text-[var(--status-fulfilled)]",
  resold: "bg-[var(--status-resold-bg)] text-[var(--status-resold)]",
  noshow: "bg-[var(--status-noshow-bg)] text-[var(--status-noshow)]",
  charity: "bg-[var(--status-charity-bg)] text-[var(--status-charity)]",
  muted: "bg-[var(--status-muted-bg)] text-[var(--status-muted)]",
};
const tone = (name: string) => TONE[name];
const STATUS_STYLE: Record<string, { zh: string; en: string; adminZh?: string; adminEn?: string; className: string }> = {
  locked: { zh: "已鎖定", en: "Locked", className: tone("locked") },
  for_resale: { zh: "轉讓中", en: "Listed for transfer", className: tone("resale") },
  for_gift: { zh: "贈送中", en: "Being gifted", className: tone("gift") },
  fulfilled: { zh: "已取餐", en: "Picked up", className: tone("fulfilled") },
  resold_and_fulfilled: { zh: "已由受讓人取餐", en: "Picked up by new owner", className: tone("resold") },
  no_show: { zh: "未取餐", en: "Not picked up", adminZh: "未取餐（舊制）", adminEn: "No-show (legacy)", className: tone("noshow") },
  charity: { zh: "已轉為愛心餐", en: "Charity meal", className: tone("charity") },
  cancelling: { zh: "處理中", en: "Processing", className: tone("muted") },
  cancelled: { zh: "已取消", en: "Cancelled", className: tone("muted") },
};

/** 狀態文字與顏色；admin=true 用管理頁的說法 */
export function lockStatus(status: string, admin = false): { label: string; className: string } {
  const s = STATUS_STYLE[status];
  if (!s) return { label: status, className: tone("muted") };
  return { label: admin ? tr(s.adminZh ?? s.zh, s.adminEn ?? s.en) : tr(s.zh, s.en), className: s.className };
}

/** 狀態標籤（依目前語言）＋顏色；每次讀都重新依語言組字串 */
export const LOCK_STATUS_STYLE: Record<string, { label: string; className: string }> = new Proxy({} as Record<string, { label: string; className: string }>, {
  get(_, key: string) {
    return STATUS_STYLE[key] ? lockStatus(key) : undefined;
  },
});

// 還沒取餐、可以核銷的狀態（跟 functions completePickup 的伺服器檢查一致）
export const REDEEMABLE_STATUSES = new Set(["locked", "for_resale", "for_gift"]);
export const PENDING_STATUSES = new Set(["locked", "for_resale", "for_gift"]);
export const DONE_STATUSES = new Set(["fulfilled", "resold_and_fulfilled"]);
// 營收口徑＝撥款口徑（2026-10-09，跟 functions/src/pricing.js revenueOf 一致）：全額預付的照實付算（未取餐、轉愛心餐也不退）；
// 顧客取消換券時留下的款項（kept_amount）也算；停班停課、店家未出餐退成點數的不算。
export const REVENUE_STATUSES = new Set(["locked", "for_resale", "for_gift", "fulfilled", "resold_and_fulfilled", "charity", "no_show"]);
export function revenueOf(lock: Pick<Lock, "status" | "locked_price"> & { kept_amount?: number }): number {
  if (lock.status === "cancelled") return Number(lock.kept_amount) || 0;
  return REVENUE_STATUSES.has(lock.status) ? Number(lock.locked_price) || 0 : 0;
}

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

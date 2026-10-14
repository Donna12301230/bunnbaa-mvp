import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import type { Lock } from "@/types";
import { tr } from "@/lib/i18n";

// Order status text and colors: the single site-wide source (2026-10-09: My meals, the member center and the admin pages each had their own set, with different wording and colors).
// Colors read the --status-* variables in index.css (including dark versions). adminZh / adminEn: only set when the admin pages need more precise wording.
// Class names must be written out in full so Tailwind can find them (no string concatenation)
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

/** Status text and colors; admin=true uses the admin pages' wording */
export function lockStatus(status: string, admin = false): { label: string; className: string } {
  const s = STATUS_STYLE[status];
  if (!s) return { label: status, className: tone("muted") };
  return { label: admin ? tr(s.adminZh ?? s.zh, s.adminEn ?? s.en) : tr(s.zh, s.en), className: s.className };
}

/** Status label (in the current language) + colors; the string is rebuilt for the language on every read */
export const LOCK_STATUS_STYLE: Record<string, { label: string; className: string }> = new Proxy({} as Record<string, { label: string; className: string }>, {
  get(_, key: string) {
    return STATUS_STYLE[key] ? lockStatus(key) : undefined;
  },
});

// Statuses that haven't been picked up yet and can be redeemed (matches the server check in functions completePickup)
export const REDEEMABLE_STATUSES = new Set(["locked", "for_resale", "for_gift"]);
export const PENDING_STATUSES = new Set(["locked", "for_resale", "for_gift"]);
export const DONE_STATUSES = new Set(["fulfilled", "resold_and_fulfilled"]);
// Revenue basis = payout basis (2026-10-09, matches revenueOf in functions/src/pricing.js): fully prepaid locks count at the amount paid (no-shows and charity-meal conversions aren't refunded);
// money kept when a diner cancels for a coupon (kept_amount) also counts; refunds to points for work-suspension days or vendor no-service don't.
export const REVENUE_STATUSES = new Set(["locked", "for_resale", "for_gift", "fulfilled", "resold_and_fulfilled", "charity", "no_show"]);
export function revenueOf(lock: Pick<Lock, "status" | "locked_price"> & { kept_amount?: number }): number {
  if (lock.status === "cancelled") return Number(lock.kept_amount) || 0;
  return REVENUE_STATUSES.has(lock.status) ? Number(lock.locked_price) || 0 : 0;
}

/** Pickup number: 4 digits; legacy records without one use the last 8 characters of the lock id */
export function pickupCode(lock: Pick<Lock, "id" | "pickup_code">): string {
  return lock.pickup_code ?? lock.id.slice(-8).toUpperCase();
}

export interface PickupSummary {
  kind: "lock" | "charity";
  lock_id?: string;
  reservation_id?: string;
  pickup_code?: string;
  item_name?: string;
  item_name_en?: string | null;
  dish_names_en?: Record<string, string> | null;
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
 * Pickup redemption always goes through the Cloud Function completePickup (firestore.rules blocks direct writes):
 * scanning the QR (token), the fallback (4-digit pickup number + last three digits of the phone), or checking face to face in today's order list (lock_id).
 * preview=true only shows the contents without redeeming.
 */
export async function completePickup(args: { token?: string; pickup_code?: string; phone_last3?: string; lock_id?: string; preview?: boolean }) {
  const res = await httpsCallable(functions, "completePickup")(args);
  return res.data as PickupSummary;
}

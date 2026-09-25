// 取餐時段——跟 functions/src/pricing.js 的 PICKUP_WINDOWS／MAX_ADVANCE_DAYS
// 是同一套規則（伺服器會再驗證一次），要改兩邊一起改。
// window 用 ASCII 連字號（寫進 locks.pickup_window），label 用 en dash 給畫面顯示。
export const PICKUP_SLOTS = [
  { window: "11:30-12:00", label: "11:30–12:00" },
  { window: "12:00-12:30", label: "12:00–12:30" },
  { window: "12:30-13:00", label: "12:30–13:00" },
] as const;

// 最遠可以預約幾天後（早鳥最後一階的上限）
export const MAX_ADVANCE_DAYS = 30;

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayStr(now: Date = new Date()): string {
  return toDateStr(now);
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function maxPickupDateStr(now: Date = new Date()): string {
  return addDaysStr(todayStr(now), MAX_ADVANCE_DAYS);
}

/** 時段已經開始（或已過）就不能再訂。 */
export function isSlotStarted(pickupDate: string, pickupWindow: string, now: Date = new Date()): boolean {
  const start = pickupWindow.split("-")[0];
  return new Date(`${pickupDate}T${start}:00`).getTime() <= now.getTime();
}

/** 最近一個還能訂的日期＋時段：今天還有沒開始的時段就用今天，否則明天第一個時段。 */
export function nextAvailablePickup(now: Date = new Date()): { date: string; window: string } {
  const today = todayStr(now);
  const slot = PICKUP_SLOTS.find((s) => !isSlotStarted(today, s.window, now));
  if (slot) return { date: today, window: slot.window };
  return { date: addDaysStr(today, 1), window: PICKUP_SLOTS[0].window };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.trim().split(":").map(Number);
  return h * 60 + m;
}

/** 兩個時段有沒有重疊，例如舊資料的 12:00-13:00 跟 12:00-12:30 算重疊。 */
export function windowsOverlap(a: string, b: string): boolean {
  const [aStart, aEnd] = a.split(/[-–]/);
  const [bStart, bEnd] = b.split(/[-–]/);
  if (!aEnd || !bEnd) return a === b;
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

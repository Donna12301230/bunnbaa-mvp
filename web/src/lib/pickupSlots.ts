import type { BusinessHour, Vendor } from "@/types";

// 取餐時段——跟 functions/src/pricing.js 是同一套規則（伺服器會再驗證一次），
// 要改兩邊一起改。商家可以在後台「店家設定」自訂 pickup_windows／business_hours／
// holidays；沒設定的商家沿用下面的預設時段、每天營業。
// window 用 ASCII 連字號（寫進 locks.pickup_window），畫面顯示用 slotLabel() 換成 en dash。
export const DEFAULT_PICKUP_WINDOWS = ["11:30-12:00", "12:00-12:30", "12:30-13:00"];

export const PICKUP_SLOTS = DEFAULT_PICKUP_WINDOWS.map((window) => ({ window, label: slotLabel(window) }));

export function slotLabel(window: string): string {
  return window.replace("-", "–");
}

// 商家後台可設定的上限，跟 firestore.rules 一致
export const MAX_PICKUP_WINDOWS = 12;
export const MAX_HOLIDAYS = 100;

const WINDOW_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

/** "11:30-12:00" 這種格式，而且結束晚於開始。 */
export function isValidWindow(window: string): boolean {
  if (!WINDOW_PATTERN.test(window)) return false;
  const [start, end] = window.split("-");
  return toMinutes(start) < toMinutes(end);
}

type ScheduleSource = Pick<Vendor, "pickup_windows" | "business_hours" | "holidays"> | null | undefined;

/** 這家店的取餐時段（依開始時間排序）；沒設定就用預設。 */
export function vendorWindows(vendor: ScheduleSource): string[] {
  const own = vendor?.pickup_windows?.filter(isValidWindow) ?? [];
  const list = own.length > 0 ? own : DEFAULT_PICKUP_WINDOWS;
  return [...list].sort((a, b) => toMinutes(a.split("-")[0]) - toMinutes(b.split("-")[0]));
}

/** 這天店家有沒有休息：特定公休日，或每週營業時段裡那天沒開。 */
export function vendorClosedReason(vendor: ScheduleSource, pickupDate: string): string | null {
  if (vendor?.holidays?.includes(pickupDate)) return "這天是店家公休日";
  const weekday = new Date(`${pickupDate}T00:00:00`).getDay();
  const hours: BusinessHour | undefined = vendor?.business_hours?.find((h) => h.weekday === weekday);
  if (hours && !hours.open) return "店家這天沒有營業";
  return null;
}

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

/** 這天還能訂的時段（店休回傳空陣列）。 */
export function openWindowsOn(vendor: ScheduleSource, pickupDate: string, now: Date = new Date()): string[] {
  if (vendorClosedReason(vendor, pickupDate)) return [];
  return vendorWindows(vendor).filter((w) => !isSlotStarted(pickupDate, w, now));
}

/** 最近一個還能訂的日期＋時段（會跳過店家公休）。整個預約範圍都訂不到時回傳 null。 */
export function nextAvailablePickup(vendor?: ScheduleSource, now: Date = new Date()): { date: string; window: string } | null {
  const today = todayStr(now);
  for (let offset = 0; offset <= MAX_ADVANCE_DAYS; offset++) {
    const date = addDaysStr(today, offset);
    const open = openWindowsOn(vendor, date, now);
    if (open.length > 0) return { date, window: open[0] };
  }
  return null;
}

/**
 * 計畫型（多日方案）的取餐日：從 startDate 起、同一個時段，跳過公休／沒營業的日子，
 * 湊滿 days 天。跟 functions/src/pricing.js 的 planPickupDates 同一套規則，
 * 這裡只給加入計畫的確認視窗預覽用，真正的日期由伺服器排。
 * 起始日不能訂、或 30 天內湊不滿時回傳 null。
 */
export function planPickupDates(
  vendor: ScheduleSource,
  startDate: string,
  pickupWindow: string,
  days: number,
  now: Date = new Date()
): string[] | null {
  if (!openWindowsOn(vendor, startDate, now).includes(pickupWindow)) return null;
  const last = maxPickupDateStr(now);
  const dates: string[] = [];
  for (let date = startDate; dates.length < days; date = addDaysStr(date, 1)) {
    if (date > last) return null;
    if (openWindowsOn(vendor, date, now).includes(pickupWindow)) dates.push(date);
  }
  return dates;
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

import { tr } from "@/lib/i18n";
import type { BusinessHour, MealPeriod, MenuItem, Vendor } from "@/types";
import { DEFAULT_PLATFORM_CONFIG, liveConfig } from "@/lib/platformConfig";
import { EARLY_BIRD_TIERS } from "@/lib/pricing";

// 取餐時段——跟 functions/src/pricing.js 是同一套規則（伺服器會再驗證一次），要改兩邊一起改。
// 1002 規格：早／中／晚三個餐期（依取餐時段開始時間歸類）、只做自取、營業日週一至週五、
// 取餐日前一天 20:00 截單（店家可提前）、預訂最遠 30 天。店家可以在後台「店家設定」自訂
// pickup_windows（每個餐期一段、以 30 分鐘為一格，每段最長 2 小時）／business_hours／holidays。
// window 用 ASCII 連字號（寫進 locks.pickup_window），畫面顯示用 slotLabel() 換成 en dash。
// 日期一律以台北時間計（規格 §13）。
export const DEFAULT_PICKUP_WINDOWS = ["11:00-11:30", "11:30-12:00", "12:00-12:30", "12:30-13:00"];

export function slotLabel(window: string): string {
  return window.replace("-", "–");
}

// 商家後台可設定的上限，跟 firestore.rules 一致
export const MAX_PICKUP_WINDOWS = 12;
export const MAX_HOLIDAYS = 100;
export const MAX_PICKUP_RANGE_MINUTES = DEFAULT_PLATFORM_CONFIG.maxPickupWindowMinutes;

const WINDOW_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "11:30-12:00" 這種格式，而且結束晚於開始。 */
export function isValidWindow(window: string): boolean {
  if (!WINDOW_PATTERN.test(window)) return false;
  const [start, end] = window.split("-");
  return toMinutes(start) < toMinutes(end);
}

type ScheduleSource = Pick<Vendor, "pickup_windows" | "business_hours" | "holidays"> & Partial<Pick<Vendor, "cutoff_time" | "disaster_dates">>;
export type MaybeSchedule = ScheduleSource | null | undefined;

/** 這家店的取餐時段（依開始時間排序）；沒設定就用預設。 */
export function vendorWindows(vendor: MaybeSchedule): string[] {
  const own = vendor?.pickup_windows?.filter(isValidWindow) ?? [];
  const list = own.length > 0 ? own : DEFAULT_PICKUP_WINDOWS;
  return [...list].sort((a, b) => toMinutes(a.split("-")[0]) - toMinutes(b.split("-")[0]));
}

// ── 餐期（§2 餐期範圍） ──
export const MEAL_PERIODS: MealPeriod[] = ["breakfast", "lunch", "dinner"];

export function mealPeriodLabel(period: MealPeriod): string {
  return { breakfast: tr("早餐", "Breakfast"), lunch: tr("午餐", "Lunch"), dinner: tr("晚餐", "Dinner") }[period];
}

/** 取餐時段屬於哪個餐期：依開始時間；都不在範圍內就歸最近的那一個 */
export function mealPeriodOf(window: string): MealPeriod {
  const start = toMinutes(window.split(/[-–]/)[0]);
  let best: MealPeriod = "lunch";
  let bestDistance = Infinity;
  for (const period of MEAL_PERIODS) {
    const [from, to] = liveConfig().mealPeriods[period].split("-").map(toMinutes);
    if (start >= from && start < to) return period;
    const distance = Math.min(Math.abs(start - from), Math.abs(start - to));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = period;
    }
  }
  return best;
}

/** 品項供應的餐期；沒設（舊資料）＝店家所有時段 */
export function itemMealPeriods(item: Pick<MenuItem, "meal_periods"> | null | undefined): MealPeriod[] {
  return (item?.meal_periods || []).filter((p): p is MealPeriod => MEAL_PERIODS.includes(p));
}

/** 品項可選的取餐時段（限品項供應的餐期；給 period 再限縮到該餐期） */
export function itemWindows(vendor: MaybeSchedule, item?: Pick<MenuItem, "meal_periods"> | null, period?: MealPeriod | null): string[] {
  const periods = itemMealPeriods(item);
  return vendorWindows(vendor).filter((w) => {
    const p = mealPeriodOf(w);
    return (periods.length === 0 || periods.includes(p)) && (!period || p === period);
  });
}

/** 品項是否供應某餐期（首頁依餐期分類） */
export function servesPeriod(vendor: MaybeSchedule, item: Pick<MenuItem, "meal_periods"> | null | undefined, period: MealPeriod): boolean {
  return itemWindows(vendor, item, period).length > 0;
}

/** 截單時間：店家只能比平台早 */
export function vendorCutoffTime(vendor: MaybeSchedule): string {
  const own = vendor?.cutoff_time;
  const platform = liveConfig().cutoffTime;
  return typeof own === "string" && TIME_PATTERN.test(own) && own < platform ? own : platform;
}

/** 某取餐日的截單時間點（前一天 20:00，台北時間） */
export function cutoffAt(pickupDate: string, vendor?: MaybeSchedule): Date {
  return new Date(`${addDaysStr(pickupDate, -1)}T${vendorCutoffTime(vendor)}:00+08:00`);
}

export function isPastCutoff(pickupDate: string, vendor?: MaybeSchedule, now: Date = new Date()): boolean {
  return now.getTime() >= cutoffAt(pickupDate, vendor).getTime();
}

/** 0=日 … 6=六 */
export function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** 營業日文字：週一至週五／Mon–Fri（依平台參數） */
export function businessDaysText(): string {
  const days = [...liveConfig().businessWeekdays].sort();
  const zh = ["日", "一", "二", "三", "四", "五", "六"];
  const en = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (contiguous && days.length > 2) return tr(`週${zh[days[0]]}至週${zh[days[days.length - 1]]}`, `${en[days[0]]}–${en[days[days.length - 1]]}`);
  return tr(days.map((d) => `週${zh[d]}`).join("、"), days.map((d) => en[d]).join(", "));
}

/** 這天店家有沒有休息：非營業日（週末）、特定公休日、每週營業時段裡那天沒開、停班停課。 */
export function vendorClosedReason(vendor: MaybeSchedule, pickupDate: string): string | null {
  const weekday = weekdayOf(pickupDate);
  if (!liveConfig().businessWeekdays.includes(weekday)) return tr(`營業日是${businessDaysText()}`, `Open ${businessDaysText()} only`);
  if (vendor?.disaster_dates?.includes(pickupDate)) return tr("這天因停班停課暫停供餐", "No service (work suspension)");
  if (vendor?.holidays?.includes(pickupDate)) return tr("這天是店家公休日", "The vendor is closed on this day");
  const hours: BusinessHour | undefined = vendor?.business_hours?.find((h) => h.weekday === weekday);
  if (hours && !hours.open) return tr("店家這天沒有營業", "The vendor isn't open on this day");
  return null;
}

/** 台北時間的今天 YYYY-MM-DD */
export function todayStr(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 那一週的週一 */
export function mondayOf(dateStr: string): string {
  const wd = weekdayOf(dateStr);
  return addDaysStr(dateStr, wd === 0 ? -6 : 1 - wd);
}

/** 最遠可以預約到哪天：30 天後（規格 §2 預訂開放範圍） */
export function maxPickupDateStr(now: Date = new Date()): string {
  return addDaysStr(todayStr(now), liveConfig().bookingRangeDays);
}

/** 這天還能不能訂（營業、還沒截單、在預訂範圍內）；不能訂時回傳原因 */
export function bookingProblem(vendor: MaybeSchedule, pickupDate: string, now: Date = new Date()): string | null {
  if (pickupDate < todayStr(now) || pickupDate > maxPickupDateStr(now)) return tr(`最遠只能預訂 ${liveConfig().bookingRangeDays} 天內`, `You can book up to ${liveConfig().bookingRangeDays} days ahead`);
  const closed = vendorClosedReason(vendor, pickupDate);
  if (closed) return closed;
  if (isPastCutoff(pickupDate, vendor, now)) {
    return tr(`已在前一天 ${vendorCutoffTime(vendor)} 截單`, `Orders closed at ${vendorCutoffTime(vendor)} the day before`);
  }
  return null;
}

/** 時段已經開始（或已過）。截單早於取餐日，正常下單不會碰到；給已下單的顯示用。 */
export function isSlotStarted(pickupDate: string, pickupWindow: string, now: Date = new Date()): boolean {
  const start = pickupWindow.split("-")[0];
  return new Date(`${pickupDate}T${start}:00+08:00`).getTime() <= now.getTime();
}

/** 時段已經結束：已經不可能去取餐（例如過期的免費領取不該再列出來） */
export function isSlotEnded(pickupDate: string, pickupWindow: string, now: Date = new Date()): boolean {
  const end = pickupWindow.split("-")[1] || pickupWindow.split("-")[0];
  return new Date(`${pickupDate}T${end}:00+08:00`).getTime() <= now.getTime();
}

/** 這天還能訂的時段（不能訂回傳空陣列）；給 item／period 會限縮到品項供應的餐期。 */
export function openWindowsOn(
  vendor: MaybeSchedule,
  pickupDate: string,
  now: Date = new Date(),
  item?: Pick<MenuItem, "meal_periods"> | null,
  period?: MealPeriod | null
): string[] {
  if (bookingProblem(vendor, pickupDate, now)) return [];
  return itemWindows(vendor, item, period);
}

/** 可預訂的日期清單（今天～30 天後，只含營業日；不管截單，截單的由 bookingProblem 標示） */
export function bookableDateRange(now: Date = new Date()): string[] {
  const out: string[] = [];
  const last = maxPickupDateStr(now);
  for (let d = todayStr(now); d <= last; d = addDaysStr(d, 1)) {
    if (liveConfig().businessWeekdays.includes(weekdayOf(d))) out.push(d);
  }
  return out;
}

/** 最近一個還能訂的日期＋時段（會跳過截單、公休）。整個預約範圍都訂不到時回傳 null。 */
export function nextAvailablePickup(vendor?: MaybeSchedule, now: Date = new Date()): { date: string; window: string } | null {
  for (const date of bookableDateRange(now)) {
    const open = openWindowsOn(vendor, date, now);
    if (open.length > 0) return { date, window: open[0] };
  }
  return null;
}

/**
 * 計畫型（多日方案）的取餐日：從 startDate 起、同一個時段，跳過不能訂的日子（遇公休順延），湊滿 days 天。
 * 跟 functions/src/pricing.js 的 planPickupDates 同一套規則，這裡只給確認視窗預覽用。
 * 起始日不能訂、或到 30 天後湊不滿時回傳 null。postponed＝因公休往後順延的日期。
 */
export function planPickupDates(
  vendor: MaybeSchedule,
  startDate: string,
  pickupWindow: string,
  days: number,
  now: Date = new Date()
): string[] | null {
  return planPickupSchedule(vendor, startDate, pickupWindow, days, now)?.dates ?? null;
}

export function planPickupSchedule(
  vendor: MaybeSchedule,
  startDate: string,
  pickupWindow: string,
  days: number,
  now: Date = new Date()
): { dates: string[]; postponed: string[] } | null {
  if (!vendorWindows(vendor).includes(pickupWindow) || bookingProblem(vendor, startDate, now)) return null;
  const last = maxPickupDateStr(now);
  const dates: string[] = [];
  const postponed: string[] = [];
  let skipped = false;
  for (let date = startDate; dates.length < days; date = addDaysStr(date, 1)) {
    if (date > last) return null;
    if (!bookingProblem(vendor, date, now)) {
      dates.push(date);
      if (skipped) postponed.push(date);
    } else if (liveConfig().businessWeekdays.includes(weekdayOf(date))) {
      skipped = true;
    }
  }
  return { dates, postponed };
}

export function toMinutes(hhmm: string): number {
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

/** 取餐時段整段長度（分鐘），店家設定每個餐期要 ≤ 2 小時；回傳各餐期中最長的那段 */
export function pickupRangeMinutes(windows: string[]): number {
  const valid = windows.filter(isValidWindow);
  if (valid.length === 0) return 0;
  let longest = 0;
  for (const period of MEAL_PERIODS) {
    const mine = valid.filter((w) => mealPeriodOf(w) === period);
    if (mine.length === 0) continue;
    const starts = mine.map((w) => toMinutes(w.split("-")[0]));
    const ends = mine.map((w) => toMinutes(w.split("-")[1]));
    longest = Math.max(longest, Math.max(...ends) - Math.min(...starts));
  }
  return longest;
}

/** 價格日期列（§4.5）：明天起 30 天，每天的早鳥折數、能不能訂 */
export interface PriceDay {
  date: string;
  discountPercent: number;
  problem: string | null;
}
export function priceDays(vendor: MaybeSchedule, now: Date = new Date()): PriceDay[] {
  const out: PriceDay[] = [];
  const today = todayStr(now);
  const last = maxPickupDateStr(now);
  for (let d = addDaysStr(today, 1); d <= last; d = addDaysStr(d, 1)) {
    const days = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    const tier = EARLY_BIRD_TIERS.find((t) => days >= t.minDays && days <= t.maxDays);
    out.push({ date: d, discountPercent: tier?.discountPercent ?? 0, problem: bookingProblem(vendor, d, now) });
  }
  return out;
}

// 首頁先選的日期／時段，帶到品項頁（hash router 不方便帶 query string）
let preferred: { date: string; window: string } | null = null;
export function setPreferredPickup(p: { date: string; window: string } | null) {
  preferred = p;
}
export function getPreferredPickup() {
  return preferred;
}

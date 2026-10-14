import { tr } from "@/lib/i18n";
import type { BusinessHour, MealPeriod, MenuItem, Vendor } from "@/types";
import { DEFAULT_PLATFORM_CONFIG, liveConfig } from "@/lib/platformConfig";
import { EARLY_BIRD_TIERS } from "@/lib/pricing";

// Pickup slots: the same rules as functions/src/pricing.js (the server validates again); change both together.
// three meal periods, breakfast / lunch / dinner (classified by slot start time), pickup only, business days Monday to Friday,
// cut-off at 20:00 the day before pickup (vendors can set it earlier), bookings up to 30 days ahead. Vendors can customize in the portal's "Store settings"
// pickup_windows (one range per meal period, in 30-minute steps, each up to 2 hours) / business_hours / holidays.
// window uses an ASCII hyphen (written to locks.pickup_window); slotLabel() swaps it for an en dash on screen.
// Dates are always in Taipei time.
export const DEFAULT_PICKUP_WINDOWS = ["11:00-11:30", "11:30-12:00", "12:00-12:30", "12:30-13:00"];

export function slotLabel(window: string): string {
  return window.replace("-", "–");
}

// Upper limits configurable in the vendor portal, matching firestore.rules
export const MAX_PICKUP_WINDOWS = 12;
export const MAX_HOLIDAYS = 100;
export const MAX_PICKUP_RANGE_MINUTES = DEFAULT_PLATFORM_CONFIG.maxPickupWindowMinutes;

const WINDOW_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Format like "11:30-12:00", with the end after the start. */
export function isValidWindow(window: string): boolean {
  if (!WINDOW_PATTERN.test(window)) return false;
  const [start, end] = window.split("-");
  return toMinutes(start) < toMinutes(end);
}

type ScheduleSource = Pick<Vendor, "pickup_windows" | "business_hours" | "holidays"> & Partial<Pick<Vendor, "cutoff_time" | "disaster_dates">>;
export type MaybeSchedule = ScheduleSource | null | undefined;

/** This store's pickup slots (sorted by start time); defaults if not set. */
export function vendorWindows(vendor: MaybeSchedule): string[] {
  const own = vendor?.pickup_windows?.filter(isValidWindow) ?? [];
  const list = own.length > 0 ? own : DEFAULT_PICKUP_WINDOWS;
  return [...list].sort((a, b) => toMinutes(a.split("-")[0]) - toMinutes(b.split("-")[0]));
}

// ── Meal periods ──
export const MEAL_PERIODS: MealPeriod[] = ["breakfast", "lunch", "dinner"];

export function mealPeriodLabel(period: MealPeriod): string {
  return { breakfast: tr("早餐", "Breakfast"), lunch: tr("午餐", "Lunch"), dinner: tr("晚餐", "Dinner") }[period];
}

/** Which meal period a pickup slot belongs to: by start time; if none matches, the nearest one */
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

/** Meal periods an item is served in; not set (legacy data) = all of the vendor's slots */
export function itemMealPeriods(item: Pick<MenuItem, "meal_periods"> | null | undefined): MealPeriod[] {
  return (item?.meal_periods || []).filter((p): p is MealPeriod => MEAL_PERIODS.includes(p));
}

/** Pickup slots selectable for an item (limited to the item's meal periods; with period, narrowed to that period) */
export function itemWindows(vendor: MaybeSchedule, item?: Pick<MenuItem, "meal_periods"> | null, period?: MealPeriod | null): string[] {
  const periods = itemMealPeriods(item);
  return vendorWindows(vendor).filter((w) => {
    const p = mealPeriodOf(w);
    return (periods.length === 0 || periods.includes(p)) && (!period || p === period);
  });
}

/** Whether an item is served in a given meal period (the home page groups by meal period) */
export function servesPeriod(vendor: MaybeSchedule, item: Pick<MenuItem, "meal_periods"> | null | undefined, period: MealPeriod): boolean {
  return itemWindows(vendor, item, period).length > 0;
}

/** Cut-off time: vendors can only set it earlier than the platform's */
export function vendorCutoffTime(vendor: MaybeSchedule): string {
  const own = vendor?.cutoff_time;
  const platform = liveConfig().cutoffTime;
  return typeof own === "string" && TIME_PATTERN.test(own) && own < platform ? own : platform;
}

/** Cut-off moment for a pickup date (20:00 the day before, Taipei time) */
export function cutoffAt(pickupDate: string, vendor?: MaybeSchedule): Date {
  return new Date(`${addDaysStr(pickupDate, -1)}T${vendorCutoffTime(vendor)}:00+08:00`);
}

export function isPastCutoff(pickupDate: string, vendor?: MaybeSchedule, now: Date = new Date()): boolean {
  return now.getTime() >= cutoffAt(pickupDate, vendor).getTime();
}

/** 0 = Sun … 6 = Sat */
export function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** Business-day text: 週一至週五 / Mon–Fri (from platform settings) */
export function businessDaysText(): string {
  const days = [...liveConfig().businessWeekdays].sort();
  const zh = ["日", "一", "二", "三", "四", "五", "六"];
  const en = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const contiguous = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  if (contiguous && days.length > 2) return tr(`週${zh[days[0]]}至週${zh[days[days.length - 1]]}`, `${en[days[0]]}–${en[days[days.length - 1]]}`);
  return tr(days.map((d) => `週${zh[d]}`).join("、"), days.map((d) => en[d]).join(", "));
}

/** Whether the vendor is closed that day: non-business day (weekend), a specific closed day, not open that day in the weekly hours, or a work-suspension day. */
export function vendorClosedReason(vendor: MaybeSchedule, pickupDate: string): string | null {
  const weekday = weekdayOf(pickupDate);
  if (!liveConfig().businessWeekdays.includes(weekday)) return tr(`營業日是${businessDaysText()}`, `Open ${businessDaysText()} only`);
  if (vendor?.disaster_dates?.includes(pickupDate)) return tr("這天因停班停課暫停供餐", "No service (work suspension)");
  if (vendor?.holidays?.includes(pickupDate)) return tr("這天是店家公休日", "The vendor is closed on this day");
  const hours: BusinessHour | undefined = vendor?.business_hours?.find((h) => h.weekday === weekday);
  if (hours && !hours.open) return tr("店家這天沒有營業", "The vendor isn't open on this day");
  return null;
}

/** Today in Taipei time, YYYY-MM-DD */
export function todayStr(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of that week */
export function mondayOf(dateStr: string): string {
  const wd = weekdayOf(dateStr);
  return addDaysStr(dateStr, wd === 0 ? -6 : 1 - wd);
}

/** Furthest bookable date: 30 days out */
export function maxPickupDateStr(now: Date = new Date()): string {
  return addDaysStr(todayStr(now), liveConfig().bookingRangeDays);
}

/** Whether the day can still be booked (open, before cut-off, within the booking window); returns the reason when it can't */
export function bookingProblem(vendor: MaybeSchedule, pickupDate: string, now: Date = new Date()): string | null {
  if (pickupDate < todayStr(now) || pickupDate > maxPickupDateStr(now)) return tr(`最遠只能預訂 ${liveConfig().bookingRangeDays} 天內`, `You can book up to ${liveConfig().bookingRangeDays} days ahead`);
  const closed = vendorClosedReason(vendor, pickupDate);
  if (closed) return closed;
  if (isPastCutoff(pickupDate, vendor, now)) {
    return tr(`已在前一天 ${vendorCutoffTime(vendor)} 截單`, `Orders closed at ${vendorCutoffTime(vendor)} the day before`);
  }
  return null;
}

/** The slot has started (or passed). Cut-off is before the pickup date, so normal ordering never hits this; it's for displaying existing orders. */
export function isSlotStarted(pickupDate: string, pickupWindow: string, now: Date = new Date()): boolean {
  const start = pickupWindow.split("-")[0];
  return new Date(`${pickupDate}T${start}:00+08:00`).getTime() <= now.getTime();
}

/** The slot has ended: pickup is no longer possible (e.g. expired free claims shouldn't be listed any more) */
export function isSlotEnded(pickupDate: string, pickupWindow: string, now: Date = new Date()): boolean {
  const end = pickupWindow.split("-")[1] || pickupWindow.split("-")[0];
  return new Date(`${pickupDate}T${end}:00+08:00`).getTime() <= now.getTime();
}

/** Slots still bookable that day (empty array if not bookable); with item / period, narrowed to the item's meal periods. */
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

/** Bookable dates (today to 30 days out, business days only; ignores cut-off, which bookingProblem flags) */
export function bookableDateRange(now: Date = new Date()): string[] {
  const out: string[] = [];
  const last = maxPickupDateStr(now);
  for (let d = todayStr(now); d <= last; d = addDaysStr(d, 1)) {
    if (liveConfig().businessWeekdays.includes(weekdayOf(d))) out.push(d);
  }
  return out;
}

/** The nearest date + slot that can still be booked (skips cut-off and closed days). Returns null if nothing in the booking window can be booked. */
export function nextAvailablePickup(vendor?: MaybeSchedule, now: Date = new Date()): { date: string; window: string } | null {
  for (const date of bookableDateRange(now)) {
    const open = openWindowsOn(vendor, date, now);
    if (open.length > 0) return { date, window: open[0] };
  }
  return null;
}

/**
 * Pickup dates for a meal plan (multi-day plan): from startDate, same slot, skipping unbookable days (postponed past closed days), until days days are filled.
 * Same rules as planPickupDates in functions/src/pricing.js; this is only for the confirmation dialog preview.
 * Returns null if the start date can't be booked or the days can't be filled within 30 days. postponed = dates pushed back because of closed days.
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

/** Whether two slots overlap, e.g. legacy 12:00-13:00 and 12:00-12:30 overlap. */
export function windowsOverlap(a: string, b: string): boolean {
  const [aStart, aEnd] = a.split(/[-–]/);
  const [bStart, bEnd] = b.split(/[-–]/);
  if (!aEnd || !bEnd) return a === b;
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

/** Full length of a pickup slot (minutes); vendor settings require ≤ 2 hours per meal period; returns the longest across meal periods */
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

/** Price date strip: 30 days from tomorrow, each day's early-bird discount and whether it's bookable */
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

// Date / slot chosen first on the home page, carried to the item page (the hash router makes passing a query string awkward)
let preferred: { date: string; window: string } | null = null;
export function setPreferredPickup(p: { date: string; window: string } | null) {
  preferred = p;
}
export function getPreferredPickup() {
  return preferred;
}

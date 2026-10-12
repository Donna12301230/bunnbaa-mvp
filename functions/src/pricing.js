// Server-side copy of web/src/lib/pricing.ts + web/src/lib/pickupSlots.ts.
// Phase 1 spec (doc/BunnBaa 飯飽｜第一階段技術規格1002.md):
//   - Three meal periods: breakfast / lunch / dinner (classified by pickup slot start time); pickup only, business days Monday to Friday
//   - Cut-off at cutoffTime (default 20:00) the day before pickup; vendors can move it earlier (vendors.cutoff_time) but not later
//   - Booking window: at most 30 days ahead
//   - Early-bird discount: 5% off for tomorrow, 20% off for 2–30 days ahead (30% off for 14+ days ahead is deferred to a later release; the tier table reserves a third tier)
// Vendor pickup schedule: vendors.pickup_windows (sub-slots within the pickup slot), business_hours, holidays,
// slot_capacity. Unset fields fall back to defaults. Prices are always computed by the server from menu_items; the frontend is never trusted.
// Keep the tiers and slots in sync with the web copies by hand.

const { t } = require("./i18n");
const { DEFAULT_PLATFORM_CONFIG } = require("./config");
const { taipeiToday, addDays, daysBetween, weekdayOf, lastBookableDate, at, toMinutes, splitWindow } = require("./calendar");

const EARLY_BIRD_TIERS = [
  { minDays: 0, maxDays: 1, discountPercent: 5 },
  { minDays: 2, maxDays: 30, discountPercent: 20 },
  // Third tier (later release): { minDays: 14, maxDays: 30, discountPercent: 30 }, and change the previous tier's maxDays to 13
];

const MEAL_PERIODS = ["breakfast", "lunch", "dinner"];
const MEAL_PERIOD_LABELS = { breakfast: ["早餐", "Breakfast"], lunch: ["午餐", "Lunch"], dinner: ["晚餐", "Dinner"] };

/** Which meal period a pickup slot belongs to: the period whose range contains its start time; if none, the nearest one */
function mealPeriodOf(window, config = DEFAULT_PLATFORM_CONFIG) {
  const start = toMinutes(splitWindow(window).start);
  const ranges = config.mealPeriods || DEFAULT_PLATFORM_CONFIG.mealPeriods;
  let best = "lunch";
  let bestDistance = Infinity;
  for (const period of MEAL_PERIODS) {
    const { start: from, end: to } = splitWindow(ranges[period]);
    const a = toMinutes(from);
    const b = toMinutes(to);
    if (start >= a && start < b) return period;
    const distance = Math.min(Math.abs(start - a), Math.abs(start - b));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = period;
    }
  }
  return best;
}

function mealPeriodLabel(period) {
  const [zh, en] = MEAL_PERIOD_LABELS[period] || MEAL_PERIOD_LABELS.lunch;
  return t(zh, en);
}

/** Meal periods an item is served in; unset (legacy data) = all of the vendor's pickup slots */
function itemMealPeriods(item) {
  const list = Array.isArray(item?.meal_periods) ? item.meal_periods.map((p) => (typeof p === "string" ? p : p?.period)) : [];
  return list.filter((p) => MEAL_PERIODS.includes(p));
}

const DEFAULT_PICKUP_WINDOWS = ["11:00-11:30", "11:30-12:00", "12:00-12:30", "12:30-13:00"];
const WINDOW_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isValidWindow(window) {
  if (typeof window !== "string" || !WINDOW_PATTERN.test(window)) return false;
  const [start, end] = window.split("-");
  return start < end; // zero-padded HH:MM compares correctly as strings
}

function vendorWindows(vendor) {
  const own = Array.isArray(vendor?.pickup_windows) ? vendor.pickup_windows.filter(isValidWindow) : [];
  return own.length > 0 ? own : DEFAULT_PICKUP_WINDOWS;
}

/** Pickup slots selectable for an item: the vendor's slots that fall in the item's meal periods */
function itemWindows(vendor, item, config = DEFAULT_PLATFORM_CONFIG) {
  const windows = vendorWindows(vendor);
  const periods = itemMealPeriods(item);
  if (periods.length === 0) return windows;
  return windows.filter((w) => periods.includes(mealPeriodOf(w, config)));
}

function rangeOf(windows) {
  const starts = windows.map((w) => splitWindow(w).start).sort();
  const ends = windows.map((w) => splitWindow(w).end).sort();
  return `${starts[0]}-${ends[ends.length - 1]}`;
}

/** The whole pickup range (earliest start to latest end), e.g. "11:00-13:00"; only for legacy callers without meal periods */
function vendorPickupRange(vendor) {
  return rangeOf(vendorWindows(vendor));
}

/**
 * Pickup slot range per meal period, e.g. { breakfast: "07:30-08:30", lunch: "11:00-13:00" }.
 * Charity meal conversion, pickup reminders and the prep timeline are all computed per meal period (§5.2, §7).
 */
function vendorPeriodRanges(vendor, config = DEFAULT_PLATFORM_CONFIG) {
  const byPeriod = {};
  for (const w of vendorWindows(vendor)) {
    const period = mealPeriodOf(w, config);
    (byPeriod[period] = byPeriod[period] || []).push(w);
  }
  return Object.fromEntries(MEAL_PERIODS.filter((p) => byPeriod[p]).map((p) => [p, rangeOf(byPeriod[p])]));
}

/** Vendor cut-off time: can only be earlier than the platform's, never later */
function vendorCutoffTime(vendor, config = DEFAULT_PLATFORM_CONFIG) {
  const own = vendor?.cutoff_time;
  if (typeof own === "string" && TIME_PATTERN.test(own) && own < config.cutoffTime) return own;
  return config.cutoffTime;
}

/** Cut-off instant for a pickup date (the day before pickup) */
function cutoffAt(pickupDate, vendor, config = DEFAULT_PLATFORM_CONFIG) {
  return at(addDays(pickupDate, -1), vendorCutoffTime(vendor, config));
}

function isPastCutoff(pickupDate, vendor, config = DEFAULT_PLATFORM_CONFIG, now = new Date()) {
  return now.getTime() >= cutoffAt(pickupDate, vendor, config).getTime();
}

/** Deadline for diners to cancel: cancelHoursBefore hours before the pickup slot starts (default 48) */
function cancelDeadlineAt(pickupDate, pickupWindow, config = DEFAULT_PLATFORM_CONFIG) {
  const start = splitWindow(pickupWindow).start || "00:00";
  return new Date(at(pickupDate, start).getTime() - (config.cancelHoursBefore ?? 48) * 3600000);
}

/**
 * Coupon value issued on cancellation: original price (item price + add-ons) × cancelCouponRate (default 30%), rounded to the dollar;
 * capped at the payer's amount paid (no coupon for NT$0 orders paid with a free-meal coupon).
 */
function cancelCouponAmount(lock, config = DEFAULT_PLATFORM_CONFIG) {
  const original = Math.max(0, (Number(lock.list_price) || 0) + (Number(lock.adjust_amount) || 0));
  const paid = Number.isFinite(lock.paid_amount) ? lock.paid_amount : Number(lock.locked_price) || 0;
  return Math.max(0, Math.min(Math.round(original * (config.cancelCouponRate ?? 0.3)), paid));
}

// Revenue/payout basis (unified 2026-10-09, based on actual payouts): fully prepaid orders count at the amount paid (including no-shows and charity conversions);
// money kept when a customer cancels for a coupon (kept_amount) also counts; refunds to points for work-suspension days or vendor failures to serve don't.
// Same as revenueOf in web/src/lib/lockOutcome.ts.
const PAID_STATUSES = ["locked", "for_resale", "for_gift", "fulfilled", "resold_and_fulfilled", "charity", "no_show"];
function revenueOf(lock) {
  if (lock?.status === "cancelled") return Number(lock.kept_amount) || 0;
  return PAID_STATUSES.includes(lock?.status) ? Number(lock.locked_price) || 0 : 0;
}

/** Platform commission (NT$): revenue per meal × commission rate, rounded per portion then summed (shared by the earnings dashboard and payouts) */
function commissionOf(locks, rate = DEFAULT_PLATFORM_CONFIG.commissionRate) {
  return locks.reduce((sum, l) => sum + Math.round(revenueOf(l) * rate), 0);
}

/** 0 / missing / invalid = unlimited (returns null). */
function vendorSlotCapacity(vendor) {
  const cap = vendor?.slot_capacity;
  return Number.isInteger(cap) && cap > 0 ? cap : null;
}

/** Whether the vendor is open on this day (platform business days + vendor closed days / weekly opening settings) */
function closedReason(pickupDate, vendor, config = DEFAULT_PLATFORM_CONFIG) {
  const name = vendor?.name ?? t("這家店", "This vendor");
  const weekday = weekdayOf(pickupDate);
  if (!config.businessWeekdays.includes(weekday)) {
    return t(`${pickupDate} 不是營業日`, `${pickupDate} isn't a business day`);
  }
  // Work-suspension days (written by disaster.js): single orders have a separate check; this also makes meal plans and the pre-order assistant skip them
  if (Array.isArray(vendor?.disaster_dates) && vendor.disaster_dates.includes(pickupDate)) {
    return t(`${pickupDate} 因停班停課暫停供餐`, `No service on ${pickupDate} (work suspension)`);
  }
  if (Array.isArray(vendor?.holidays) && vendor.holidays.includes(pickupDate)) {
    return t(`「${name}」${pickupDate} 公休`, `${name} is closed on ${pickupDate}`);
  }
  const hours = Array.isArray(vendor?.business_hours) ? vendor.business_hours.find((h) => h?.weekday === weekday) : null;
  if (hours && hours.open === false) {
    return t(`「${name}」${pickupDate} 沒有營業`, `${name} isn't open on ${pickupDate}`);
  }
  return null;
}

/**
 * Returns a problem message (caller wraps it in HttpsError), or null when the
 * date/window can still be booked: business day, vendor open, within
 * [today, today + 30], window is one of the vendor's (and in the item's meal
 * periods when an item is given), and the cutoff hasn't passed.
 */
function validatePickup(pickupDate, pickupWindow, vendor, config = DEFAULT_PLATFORM_CONFIG, now = new Date(), item = null) {
  if (typeof pickupDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    return t("取餐日期格式不正確", "Invalid pickup date");
  }
  const windows = item ? itemWindows(vendor, item, config) : vendorWindows(vendor);
  if (!windows.includes(pickupWindow)) {
    if (item && vendorWindows(vendor).includes(pickupWindow)) {
      const label = mealPeriodLabel(mealPeriodOf(pickupWindow, config));
      return t(`「${item.name}」沒有供應${label}`, `${item.name} isn't served at ${label}`);
    }
    return t(`「${vendor?.name ?? "這家店"}」沒有 ${pickupWindow} 這個取餐時段`, `${vendor?.name ?? "This vendor"} doesn't offer the ${pickupWindow} pickup time`);
  }
  const closed = closedReason(pickupDate, vendor, config);
  if (closed) return closed;
  const today = taipeiToday(now);
  const last = lastBookableDate(today, config.bookingRangeDays);
  if (pickupDate < today || pickupDate > last) {
    return t(`最遠只能預訂到 ${last}（${config.bookingRangeDays} 天內）`, `You can book up to ${last} (${config.bookingRangeDays} days ahead)`);
  }
  if (isPastCutoff(pickupDate, vendor, config, now)) {
    return t(
      `${pickupDate} 的訂單已在前一天 ${vendorCutoffTime(vendor, config)} 截單，請改選其他日期`,
      `Orders for ${pickupDate} closed at ${vendorCutoffTime(vendor, config)} the day before. Please pick another date.`
    );
  }
  return null;
}

/**
 * Meal-plan pickup dates: `days` bookable dates from startDate onward, all at
 * the same pickupWindow (closed days are skipped and pushed back). Returns { dates, postponed } or { problem };
 * postponed = dates pushed back because of closed days (marked "postponed" in the confirmation dialog).
 */
function planPickupDates(startDate, pickupWindow, vendor, days, config = DEFAULT_PLATFORM_CONFIG, now = new Date(), item = null) {
  const first = validatePickup(startDate, pickupWindow, vendor, config, now, item);
  if (first) return { problem: first };
  const last = lastBookableDate(taipeiToday(now), config.bookingRangeDays);
  const dates = [];
  const postponed = [];
  let skipped = false;
  for (let date = startDate; dates.length < days; date = addDays(date, 1)) {
    if (date > last) {
      return { problem: t(`從 ${startDate} 起到 ${last} 湊不滿 ${days} 個營業日，請提早開始日期`, `There aren't ${days} open days between ${startDate} and ${last}. Please start earlier.`) };
    }
    if (!validatePickup(date, pickupWindow, vendor, config, now, item)) {
      dates.push(date);
      if (skipped) postponed.push(date);
    } else if (config.businessWeekdays.includes(weekdayOf(date))) {
      skipped = true; // a weekday that can't be booked (closed day, work suspension) → every later date counts as postponed
    }
  }
  return { dates, postponed };
}

function earlyBirdPercent(pickupDate, now = new Date()) {
  const days = Math.max(0, daysBetween(taipeiToday(now), pickupDate));
  return EARLY_BIRD_TIERS.find((tier) => days >= tier.minDays && days <= tier.maxDays)?.discountPercent ?? 0;
}

function applyEarlyBirdPrice(originalPrice, pickupDate, now = new Date()) {
  const discountPercent = earlyBirdPercent(pickupDate, now);
  return { discountPercent, lockedPrice: Math.round(originalPrice * (1 - discountPercent / 100)) };
}

function windowMinutes(window) {
  const { start, end } = splitWindow(window);
  return toMinutes(end) - toMinutes(start);
}

module.exports = {
  EARLY_BIRD_TIERS, DEFAULT_PICKUP_WINDOWS, MEAL_PERIODS, mealPeriodOf, mealPeriodLabel, itemMealPeriods, itemWindows,
  vendorPeriodRanges, isValidWindow, vendorWindows, vendorPickupRange, vendorCutoffTime,
  cutoffAt, isPastCutoff, cancelDeadlineAt, cancelCouponAmount, commissionOf, revenueOf, PAID_STATUSES, closedReason, validatePickup, planPickupDates, applyEarlyBirdPrice, earlyBirdPercent,
  vendorSlotCapacity, windowMinutes,
};

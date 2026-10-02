// Server-side copy of web/src/lib/pricing.ts + web/src/lib/pickupSlots.ts.
// 第一階段規格（doc/BunnBaa 飯飽｜第一階段技術規格1002.md）：
//   - 早／中／晚三個餐期（依取餐時段開始時間歸類），只做自取、營業日週一至週五
//   - 取餐日前一天 cutoffTime（預設 20:00）截單；店家可提前（vendors.cutoff_time），不可延後
//   - 預訂開放範圍：最遠提前 30 天
//   - 早鳥折扣：明天 95 折、提前 2–30 天 8 折（提前 14 天以上 7 折列為後續改版，級距表預留第三階）
// 店家取餐排程：vendors.pickup_windows（取餐時段內再切的小時段）、business_hours、holidays、
// slot_capacity。沒設的欄位退回預設。價格一律由伺服器依 menu_items 計算，不信任前端。
// Keep the tiers and slots in sync with the web copies by hand.

const { t } = require("./i18n");
const { DEFAULT_PLATFORM_CONFIG } = require("./config");
const { taipeiToday, addDays, daysBetween, weekdayOf, lastBookableDate, at, toMinutes, splitWindow } = require("./calendar");

const EARLY_BIRD_TIERS = [
  { minDays: 0, maxDays: 1, discountPercent: 5 },
  { minDays: 2, maxDays: 30, discountPercent: 20 },
  // 第三階（後續改版）：{ minDays: 14, maxDays: 30, discountPercent: 30 }，同時把上一階 maxDays 改成 13
];

const MEAL_PERIODS = ["breakfast", "lunch", "dinner"];
const MEAL_PERIOD_LABELS = { breakfast: ["早餐", "Breakfast"], lunch: ["午餐", "Lunch"], dinner: ["晚餐", "Dinner"] };

/** 取餐時段屬於哪個餐期：依開始時間落在哪個餐期範圍；都不在就歸最近的那一個 */
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

/** 品項供應的餐期；沒設（舊資料）＝店家所有時段都可以 */
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

/** 品項可選的取餐時段：店家時段裡屬於品項供應餐期的那些 */
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

/** 整個取餐時段（最早開始～最晚結束），例 "11:00-13:00"；只給沒分餐期的舊呼叫端用 */
function vendorPickupRange(vendor) {
  return rangeOf(vendorWindows(vendor));
}

/**
 * 各餐期的取餐時段範圍，例 { breakfast: "07:30-08:30", lunch: "11:00-13:00" }。
 * 轉愛心餐、取餐提醒、備料時間軸都依餐期分開算（§5.2、§7）。
 */
function vendorPeriodRanges(vendor, config = DEFAULT_PLATFORM_CONFIG) {
  const byPeriod = {};
  for (const w of vendorWindows(vendor)) {
    const period = mealPeriodOf(w, config);
    (byPeriod[period] = byPeriod[period] || []).push(w);
  }
  return Object.fromEntries(MEAL_PERIODS.filter((p) => byPeriod[p]).map((p) => [p, rangeOf(byPeriod[p])]));
}

/** 店家截單時間：只能比平台早，不能晚 */
function vendorCutoffTime(vendor, config = DEFAULT_PLATFORM_CONFIG) {
  const own = vendor?.cutoff_time;
  if (typeof own === "string" && TIME_PATTERN.test(own) && own < config.cutoffTime) return own;
  return config.cutoffTime;
}

/** 某個取餐日的截單時間點（取餐日前一天） */
function cutoffAt(pickupDate, vendor, config = DEFAULT_PLATFORM_CONFIG) {
  return at(addDays(pickupDate, -1), vendorCutoffTime(vendor, config));
}

function isPastCutoff(pickupDate, vendor, config = DEFAULT_PLATFORM_CONFIG, now = new Date()) {
  return now.getTime() >= cutoffAt(pickupDate, vendor, config).getTime();
}

/** 0 / missing / invalid = unlimited (returns null). */
function vendorSlotCapacity(vendor) {
  const cap = vendor?.slot_capacity;
  return Number.isInteger(cap) && cap > 0 ? cap : null;
}

/** 這天店家有沒有營業（平台營業日＋店家公休／每週營業設定） */
function closedReason(pickupDate, vendor, config = DEFAULT_PLATFORM_CONFIG) {
  const name = vendor?.name ?? t("這家店", "This vendor");
  const weekday = weekdayOf(pickupDate);
  if (!config.businessWeekdays.includes(weekday)) {
    return t(`${pickupDate} 不是營業日（第一階段只做週一至週五）`, `${pickupDate} isn't a business day (weekdays only)`);
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
 * the same pickupWindow（遇公休自動順延）. Returns { dates, postponed } or { problem }；
 * postponed＝因公休往後順延的日期（確認視窗標示「順延」）。
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
      skipped = true; // 平日卻不能訂（公休、停班）→ 之後的日期都算順延
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
  cutoffAt, isPastCutoff, closedReason, validatePickup, planPickupDates, applyEarlyBirdPrice, earlyBirdPercent,
  vendorSlotCapacity, windowMinutes,
};

// Server-side copy of web/src/lib/pricing.ts + web/src/lib/pickupSlots.ts.
// 第一階段規格（doc/BunnBaa 飯飽｜第一階段技術規格.md）：
//   - 只做午餐自取、營業日週一至週五（platformConfig.businessWeekdays）
//   - 取餐日前一天 cutoffTime（預設 20:00）截單；店家可提前（vendors.cutoff_time），不可延後
//   - 預訂開放到下週五
//   - 仍保留「鎖定早鳥折扣」：越早訂越便宜（使用者 2026-09-30 決定）
// 店家取餐排程：vendors.pickup_windows（取餐時段內再切的小時段）、business_hours、holidays、
// slot_capacity。沒設的欄位退回預設。價格一律由伺服器依 menu_items 計算，不信任前端。
// Keep the tiers and slots in sync with the web copies by hand.

const { t } = require("./i18n");
const { DEFAULT_PLATFORM_CONFIG } = require("./config");
const { taipeiToday, addDays, daysBetween, weekdayOf, lastBookableDate, at, toMinutes, splitWindow } = require("./calendar");

const EARLY_BIRD_TIERS = [
  { minDays: 0, maxDays: 1, discountPercent: 5 },
  { minDays: 2, maxDays: 13, discountPercent: 20 },
  { minDays: 14, maxDays: 30, discountPercent: 30 },
];

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

/** 整個取餐時段（最早開始～最晚結束），例 "11:00-13:00"；轉愛心餐、提醒都以結束時間起算 */
function vendorPickupRange(vendor) {
  const windows = vendorWindows(vendor);
  const starts = windows.map((w) => splitWindow(w).start).sort();
  const ends = windows.map((w) => splitWindow(w).end).sort();
  return `${starts[0]}-${ends[ends.length - 1]}`;
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
    return t(`${pickupDate} 不是營業日（第一階段只做週一至週五午餐）`, `${pickupDate} isn't a business day (weekday lunches only)`);
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
 * [today, 下週五], window is one of the vendor's, and the cutoff hasn't passed.
 */
function validatePickup(pickupDate, pickupWindow, vendor, config = DEFAULT_PLATFORM_CONFIG, now = new Date()) {
  if (typeof pickupDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    return t("取餐日期格式不正確", "Invalid pickup date");
  }
  const windows = vendorWindows(vendor);
  if (!windows.includes(pickupWindow)) {
    return t(`「${vendor?.name ?? "這家店"}」沒有 ${pickupWindow} 這個取餐時段`, `${vendor?.name ?? "This vendor"} doesn't offer the ${pickupWindow} pickup time`);
  }
  const closed = closedReason(pickupDate, vendor, config);
  if (closed) return closed;
  const today = taipeiToday(now);
  const last = lastBookableDate(today);
  if (pickupDate < today || pickupDate > last) {
    return t(`目前只能預訂到 ${last}（下週五）`, `You can book up to ${last} (next Friday)`);
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
 * the same pickupWindow. Returns { dates } or { problem }.
 */
function planPickupDates(startDate, pickupWindow, vendor, days, config = DEFAULT_PLATFORM_CONFIG, now = new Date()) {
  const first = validatePickup(startDate, pickupWindow, vendor, config, now);
  if (first) return { problem: first };
  const last = lastBookableDate(taipeiToday(now));
  const dates = [];
  for (let date = startDate; dates.length < days; date = addDays(date, 1)) {
    if (date > last) {
      return { problem: t(`從 ${startDate} 起到下週五湊不滿 ${days} 個營業日，請提早開始日期`, `There aren't ${days} open days between ${startDate} and next Friday. Please start earlier.`) };
    }
    if (!validatePickup(date, pickupWindow, vendor, config, now)) dates.push(date);
  }
  return { dates };
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
  EARLY_BIRD_TIERS, DEFAULT_PICKUP_WINDOWS, isValidWindow, vendorWindows, vendorPickupRange, vendorCutoffTime,
  cutoffAt, isPastCutoff, closedReason, validatePickup, planPickupDates, applyEarlyBirdPrice, earlyBirdPercent,
  vendorSlotCapacity, windowMinutes,
};

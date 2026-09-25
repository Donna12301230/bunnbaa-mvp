// Server-side copy of web/src/lib/pricing.ts + web/src/lib/pickupSlots.ts.
// Pickup schedule is per vendor (vendors/{id}.pickup_windows / business_hours /
// holidays / slot_capacity, edited in the vendor portal); unset fields fall
// back to DEFAULT_PICKUP_WINDOWS, open every day, unlimited capacity.
// Prices are computed here from menu_items, never taken from the client —
// otherwise a tampered request could lock a meal at any price it likes.
// Keep the tiers and slots in sync with the web copies by hand.

const EARLY_BIRD_TIERS = [
  { minDays: 0, maxDays: 1, discountPercent: 5 },
  { minDays: 2, maxDays: 13, discountPercent: 20 },
  { minDays: 14, maxDays: 30, discountPercent: 30 },
];

// Farthest pickup date a buyer may book (last early-bird tier's upper bound).
const MAX_ADVANCE_DAYS = 30;

const DEFAULT_PICKUP_WINDOWS = ["11:30-12:00", "12:00-12:30", "12:30-13:00"];
const WINDOW_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;

function isValidWindow(window) {
  if (typeof window !== "string" || !WINDOW_PATTERN.test(window)) return false;
  const [start, end] = window.split("-");
  return start < end; // zero-padded HH:MM compares correctly as strings
}

function vendorWindows(vendor) {
  const own = Array.isArray(vendor?.pickup_windows) ? vendor.pickup_windows.filter(isValidWindow) : [];
  return own.length > 0 ? own : DEFAULT_PICKUP_WINDOWS;
}

/** 0 / missing / invalid = unlimited (returns null). */
function vendorSlotCapacity(vendor) {
  const cap = vendor?.slot_capacity;
  return Number.isInteger(cap) && cap > 0 ? cap : null;
}

function taipeiToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }); // YYYY-MM-DD
}

function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/**
 * Returns a problem message (caller wraps it in HttpsError), or null when
 * pickupDate is YYYY-MM-DD within [today, today + MAX_ADVANCE_DAYS] in
 * Asia/Taipei, the vendor is open that day, the window is one of the vendor's
 * windows, and that window hasn't already started.
 */
function validatePickup(pickupDate, pickupWindow, vendor, now = new Date()) {
  if (typeof pickupDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    return "取餐日期格式不正確";
  }
  const windows = vendorWindows(vendor);
  if (!windows.includes(pickupWindow)) {
    return `「${vendor?.name ?? "這家店"}」沒有 ${pickupWindow} 這個取餐時段`;
  }
  if (Array.isArray(vendor?.holidays) && vendor.holidays.includes(pickupDate)) {
    return `「${vendor?.name ?? "這家店"}」${pickupDate} 公休`;
  }
  const weekday = new Date(`${pickupDate}T00:00:00Z`).getUTCDay();
  const hours = Array.isArray(vendor?.business_hours) ? vendor.business_hours.find((h) => h?.weekday === weekday) : null;
  if (hours && hours.open === false) {
    return `「${vendor?.name ?? "這家店"}」${pickupDate} 沒有營業`;
  }
  const days = daysBetween(taipeiToday(), pickupDate);
  if (Number.isNaN(days) || days < 0 || days > MAX_ADVANCE_DAYS) {
    return `取餐日期只能選今天到 ${MAX_ADVANCE_DAYS} 天後`;
  }
  const start = new Date(`${pickupDate}T${pickupWindow.split("-")[0]}:00+08:00`);
  if (start.getTime() <= now.getTime()) {
    return "這個取餐時段已經開始，請改選其他時段";
  }
  return null;
}

function applyEarlyBirdPrice(originalPrice, pickupDate) {
  const days = Math.max(0, daysBetween(taipeiToday(), pickupDate));
  const tier = EARLY_BIRD_TIERS.find((t) => days >= t.minDays && days <= t.maxDays);
  const discountPercent = tier?.discountPercent ?? 0;
  return { discountPercent, lockedPrice: Math.round(originalPrice * (1 - discountPercent / 100)) };
}

module.exports = { MAX_ADVANCE_DAYS, validatePickup, applyEarlyBirdPrice, vendorSlotCapacity };

// Server-side copy of web/src/lib/pricing.ts + web/src/lib/pickupSlots.ts.
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

const PICKUP_WINDOWS = ["11:30-12:00", "12:00-12:30", "12:30-13:00"];

function taipeiToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }); // YYYY-MM-DD
}

function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/**
 * Throws a message string (caller wraps it in HttpsError) unless pickupDate is
 * YYYY-MM-DD within [today, today + MAX_ADVANCE_DAYS] in Asia/Taipei, the
 * window is one of PICKUP_WINDOWS, and that window hasn't already started.
 */
function validatePickup(pickupDate, pickupWindow, now = new Date()) {
  if (typeof pickupDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) {
    return "pickup_date must be YYYY-MM-DD";
  }
  if (!PICKUP_WINDOWS.includes(pickupWindow)) {
    return `pickup_window must be one of: ${PICKUP_WINDOWS.join(", ")}`;
  }
  const days = daysBetween(taipeiToday(), pickupDate);
  if (Number.isNaN(days) || days < 0 || days > MAX_ADVANCE_DAYS) {
    return `pickup_date must be between today and ${MAX_ADVANCE_DAYS} days from now`;
  }
  const start = new Date(`${pickupDate}T${pickupWindow.split("-")[0]}:00+08:00`);
  if (start.getTime() <= now.getTime()) {
    return "This pickup window has already started";
  }
  return null;
}

function applyEarlyBirdPrice(originalPrice, pickupDate) {
  const days = Math.max(0, daysBetween(taipeiToday(), pickupDate));
  const tier = EARLY_BIRD_TIERS.find((t) => days >= t.minDays && days <= t.maxDays);
  const discountPercent = tier?.discountPercent ?? 0;
  return { discountPercent, lockedPrice: Math.round(originalPrice * (1 - discountPercent / 100)) };
}

module.exports = { PICKUP_WINDOWS, MAX_ADVANCE_DAYS, validatePickup, applyEarlyBirdPrice };

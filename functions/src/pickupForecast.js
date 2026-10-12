// AI feature 4: prep forecast range (doc/AI功能設計.md, strengthening the existing calibration).
// "42 locked; based on past pickups, 38–41 expected to be picked up". The range uses plain statistics:
// the daily ratio "actually picked up ÷ locked portions"; with enough data, the 10%/90% percentiles, otherwise mean ± 1.28 standard deviations.
// Numbers are never handed to the LLM; the plain-language explanation reuses the daily calibration report (Gemini), and follow-ups go through askCalibrationScenario.
// Under prepayment every portion is made; this range tells vendors roughly how many will become charity meals, it doesn't tell them to make fewer.
const { db, onCall, HttpsError, t, callerVendorId } = require("./common");
const { taipeiToday, addDays, weekdayOf } = require("./calendar");

const LOOKBACK_DAYS = 60;
const MIN_LOCKS_PER_DAY = 3; // days with too few portions have jumpy ratios, so they're excluded
const MIN_DAYS = 3;
const QUANTILE_MIN_DAYS = 8;
const SAME_WEEKDAY_MIN_DAYS = 4;

const PICKED = new Set(["fulfilled", "resold_and_fulfilled"]);
const NOT_PICKED = new Set(["no_show", "charity"]); // converted after a no-show or voluntarily donated; either way not picked up by the original buyer
const PENDING = new Set(["locked", "for_resale", "for_gift"]);

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * rates: past daily pickup rates (0–1); locked: locked portions for this day.
 * Returns { low, high, expected, rate_low, rate_high, mean_rate, method }.
 */
function pickupRange(rates, locked) {
  const sorted = [...rates].sort((a, b) => a - b);
  const mean = sorted.reduce((s, r) => s + r, 0) / sorted.length;
  let rateLow;
  let rateHigh;
  let method;
  if (sorted.length >= QUANTILE_MIN_DAYS) {
    rateLow = quantile(sorted, 0.1);
    rateHigh = quantile(sorted, 0.9);
    method = "quantile_10_90";
  } else {
    const sd = Math.sqrt(sorted.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, sorted.length - 1));
    rateLow = mean - 1.28 * sd;
    rateHigh = mean + 1.28 * sd;
    method = "mean_1.28sd";
  }
  rateLow = Math.min(1, Math.max(0, rateLow));
  rateHigh = Math.min(1, Math.max(rateLow, rateHigh));
  return {
    low: Math.floor(locked * rateLow),
    high: Math.min(locked, Math.ceil(locked * rateHigh)),
    expected: Math.round(locked * mean),
    rate_low: Math.round(rateLow * 1000) / 1000,
    rate_high: Math.round(rateHigh * 1000) / 1000,
    mean_rate: Math.round(mean * 1000) / 1000,
    method,
  };
}

/** Past daily pickup rates: [{ date, weekday, locked, picked, rate }] */
function dailyRates(locks, today) {
  const since = addDays(today, -LOOKBACK_DAYS);
  const byDate = new Map();
  for (const lock of locks) {
    const date = lock.pickup_date;
    if (!date || date >= today || date < since) continue;
    if (!PICKED.has(lock.status) && !NOT_PICKED.has(lock.status)) continue;
    const day = byDate.get(date) ?? { date, weekday: weekdayOf(date), locked: 0, picked: 0 };
    day.locked += 1;
    if (PICKED.has(lock.status)) day.picked += 1;
    byDate.set(date, day);
  }
  return [...byDate.values()]
    .filter((d) => d.locked >= MIN_LOCKS_PER_DAY)
    .map((d) => ({ ...d, rate: d.picked / d.locked }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * data: { vendor_id?, date }. Returns this day's locked portions, the forecast pickup range and how it was computed.
 * With too little data enough=false, and the frontend shows only the locked portions.
 */
exports.getPickupForecast = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const date = String(request.data?.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpsError("invalid-argument", "date is required (YYYY-MM-DD)");

  const [daySnap, historySnap] = await Promise.all([
    db().collection("locks").where("vendor_id", "==", vendorId).where("pickup_date", "==", date).get(),
    db().collection("locks").where("vendor_id", "==", vendorId).orderBy("created_at", "desc").limit(1500).get(),
  ]);
  const dayLocks = daySnap.docs.map((d) => d.data()).filter((l) => PENDING.has(l.status) || PICKED.has(l.status) || NOT_PICKED.has(l.status));
  const locked = dayLocks.length;

  const days = dailyRates(historySnap.docs.map((d) => d.data()), taipeiToday());
  const weekday = weekdayOf(date);
  const sameWeekday = days.filter((d) => d.weekday === weekday);
  const basis = sameWeekday.length >= SAME_WEEKDAY_MIN_DAYS ? sameWeekday : days;

  const base = {
    date,
    locked,
    days_used: basis.length,
    same_weekday: basis === sameWeekday,
    disclaimer: t("依過去取餐紀錄的統計區間，僅供參考，不是備貨建議", "A statistical range from past pickups — for reference only, not a stocking instruction"),
  };
  if (basis.length < MIN_DAYS || locked === 0) return { ...base, enough: basis.length >= MIN_DAYS };
  return { ...base, enough: true, ...pickupRange(basis.map((d) => d.rate), locked) };
});

module.exports.helpers = { pickupRange, dailyRates };

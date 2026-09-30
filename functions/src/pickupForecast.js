// AI 功能 4：備料預測區間（doc/AI功能設計.md，強化現有校準）。
// 「已鎖定 42 份，依過去的取餐紀錄，預估實際取餐 38–41 份」——區間用一般統計算：
// 過去每天「實際取餐 ÷ 鎖定份數」的比率，資料夠就取 10%／90% 分位數，不夠就用平均 ± 1.28 標準差。
// 數字不交給 LLM；白話說明沿用每日校準報告（Gemini），追問走 askCalibrationScenario。
// 預付制下每一份都要做，這個區間是讓店家預期大概有幾份會轉成愛心餐，不是叫店家少做。
const { db, onCall, HttpsError, t, callerVendorId } = require("./common");
const { taipeiToday, addDays, weekdayOf } = require("./calendar");

const LOOKBACK_DAYS = 60;
const MIN_LOCKS_PER_DAY = 3; // 份數太少的日子比率太跳，不列入
const MIN_DAYS = 3;
const QUANTILE_MIN_DAYS = 8;
const SAME_WEEKDAY_MIN_DAYS = 4;

const PICKED = new Set(["fulfilled", "resold_and_fulfilled"]);
const NOT_PICKED = new Set(["no_show", "charity"]); // 未取餐轉入或主動捐出，都不是原買家取走
const PENDING = new Set(["locked", "for_resale", "for_gift"]);

function quantile(sorted, q) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * rates：過去每天的取餐率（0–1）；locked：這天鎖定份數。
 * 回傳 { low, high, expected, rate_low, rate_high, mean_rate, method }。
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

/** 過去每天的取餐率：[{ date, weekday, locked, picked, rate }] */
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
 * data: { vendor_id?, date }。回傳這天鎖定份數、預估實際取餐區間與計算依據。
 * 資料不足時 enough=false，前端只顯示鎖定份數。
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

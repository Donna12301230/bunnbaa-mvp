// 採購與備料兩區（規格 §5）：每週進料（週六 12:00 鎖定）、每日備料（截單後，orders.js）。
// 米、油、調味料、乾貨、包材等久放品項（frequency: monthly）也併入每週進料，低於安全庫存才列入叫貨單，
// 一次補足 LONG_LIVED_WEEKS 週的量。每月備料列入第二階段（purchaseLists.type 預留）。
//
// 進料量 = 已確定用量 + 預測用量 × (1 + 安全庫存) − 目前庫存，依採購單位進位。
// 預測：過去 4 週同星期幾平均份數，排除停班日、國定假日（店家公休）與店家標記的異常週；
// 新店家前 4 週用店家自填預估（vendors.forecast_daily: { menu_item_id: 份數 }）。
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { REGION, db, onCall, FieldValue, callerVendorId, notifyVendor, loadVendorCatalog, forEachVendor } = require("./common");
const { loadPlatformConfig } = require("./config");
const { componentPortions, rawNeeds, roundToPurchaseUnit, splitDeliveries, ACTIVE_LOCK_STATUSES } = require("./prep");
const { taipeiToday, addDays, mondayOf, weekdayOf } = require("./calendar");

const HISTORY_STATUSES = [...ACTIVE_LOCK_STATUSES, "fulfilled", "resold_and_fulfilled", "charity"];
const LONG_LIVED_WEEKS = 4;

function safetyRate(vendor, config) {
  const own = Number(vendor.safety_stock_rate);
  return own >= 0 && own <= 1 ? own : config.safetyStockRate;
}

// 停班日只看這家店的 disaster_dates（停班事件處理時只寫給受影響縣市／區的店）；
// 不能拿 disasterEvents 全部的日期，否則別縣市停班、颱風警報都會讓這家店被當成沒營業、預測變 0。
function excludedDates(vendor) {
  const set = new Set([...(vendor.holidays || []), ...(vendor.disaster_dates || [])]);
  for (const week of vendor.anomaly_weeks || []) for (let i = 0; i < 7; i++) set.add(addDays(week, i));
  return set;
}

/**
 * 各品項在某個星期幾的預測份數：過去 4 週同星期幾平均；歷史不足 4 週時用店家自填預估。
 * 報廢（愛心餐報廢）份數從歷史扣掉，避免下週多做（§7.5）。
 */
async function forecastByWeekday(vendor, referenceMonday) {
  const excluded = excludedDates(vendor);
  const from = addDays(referenceMonday, -28);
  const snap = await db().collection("locks").where("vendor_id", "==", vendor.id)
    .where("pickup_date", ">=", from).where("pickup_date", "<", referenceMonday).get();
  const plans = await db().collection("vendors").doc(vendor.id).collection("prepPlans")
    .where("date", ">=", from).where("date", "<", referenceMonday).get();
  const wasteByDate = new Map(plans.docs.map((d) => [d.id, d.data().charity_result?.wasted || 0]));
  const counts = new Map(); // weekday -> Map(item -> total)
  const daysSeen = new Map(); // weekday -> Set(date)
  const byDate = new Map(); // date -> Map(item -> n)
  snap.docs.forEach((d) => {
    const lock = d.data();
    if (!HISTORY_STATUSES.includes(lock.status) || excluded.has(lock.pickup_date) || !lock.menu_item_id) return;
    const m = byDate.get(lock.pickup_date) ?? new Map();
    m.set(lock.menu_item_id, (m.get(lock.menu_item_id) || 0) + 1);
    byDate.set(lock.pickup_date, m);
  });
  for (const [date, m] of byDate) {
    const wd = weekdayOf(date);
    const total = [...m.values()].reduce((s, n) => s + n, 0);
    const waste = Math.min(wasteByDate.get(date) || 0, total);
    const keep = total > 0 ? (total - waste) / total : 1;
    const wm = counts.get(wd) ?? new Map();
    for (const [item, n] of m) wm.set(item, (wm.get(item) || 0) + n * keep);
    counts.set(wd, wm);
    daysSeen.set(wd, (daysSeen.get(wd) ?? new Set()).add(date));
  }
  const weeksOfHistory = Math.max(0, ...[...daysSeen.values()].map((s) => s.size));
  const selfEstimate = vendor.forecast_daily || {};
  return (weekday) => {
    if (weeksOfHistory < 4 && Object.keys(selfEstimate).length > 0) return new Map(Object.entries(selfEstimate).map(([k, v]) => [k, Number(v) || 0]));
    const wm = counts.get(weekday);
    const seen = daysSeen.get(weekday)?.size || 0;
    if (!wm || seen === 0) return new Map();
    return new Map([...wm].map(([item, n]) => [item, n / seen]));
  };
}

/** 預測的「還沒確定」那部分：預測份數扣掉已確定份數，當成預設配菜、一般飯量 */
function forecastLocks(forecast, confirmedCounts) {
  const out = [];
  for (const [itemId, n] of forecast) {
    const extra = Math.max(0, Math.round(n - (confirmedCounts.get(itemId) || 0)));
    for (let i = 0; i < extra; i++) out.push({ menu_item_id: itemId, rice: "normal", slots: [] });
  }
  return out;
}

/** 目前理論庫存：本週盤點值；沒盤點就用上週盤點 + 上週叫貨 − 上週用量，並標示「未盤點」 */
async function currentStock(vendorId, weekStart) {
  const vendorRef = db().collection("vendors").doc(vendorId);
  const countedWeek = addDays(weekStart, -7); // 週六盤點記在「本週」（下週叫貨的前一週）
  const inv = await vendorRef.collection("inventory").doc(countedWeek).get();
  if (inv.exists && inv.data().counted) return { stock: new Map(Object.entries(inv.data().counts || {})), counted: true };
  const prevWeek = addDays(countedWeek, -7);
  const [prevInv, prevList, prevPlans] = await Promise.all([
    vendorRef.collection("inventory").doc(prevWeek).get(),
    vendorRef.collection("purchaseLists").doc(`weekly_${countedWeek}`).get(),
    vendorRef.collection("prepPlans").where("week", "==", countedWeek).get(),
  ]);
  const stock = new Map(Object.entries(prevInv.exists ? prevInv.data().counts || {} : {}));
  for (const line of prevList.exists ? prevList.data().lines || [] : []) stock.set(line.ingredient_id, (stock.get(line.ingredient_id) || 0) + (line.order_amount || 0));
  for (const plan of prevPlans.docs) {
    for (const [id, amount] of Object.entries(plan.data().raw_needs || {})) stock.set(id, (stock.get(id) || 0) - amount);
  }
  for (const [k, v] of stock) stock.set(k, Math.max(0, v));
  return { stock, counted: false };
}

async function buildWeekly(vendor, weekStart) {
  const config = await loadPlatformConfig(db());
  const catalog = await loadVendorCatalog(vendor.id);
  const forecast = await forecastByWeekday(vendor, mondayOf(taipeiToday()));
  const safety = safetyRate(vendor, config);
  const days = [0, 1, 2, 3, 4].map((i) => addDays(weekStart, i)).filter((d) => config.businessWeekdays.includes(weekdayOf(d)));
  const excluded = excludedDates(vendor);
  const perDay = [];
  const board = [];
  for (const date of days) {
    const snap = await db().collection("locks").where("vendor_id", "==", vendor.id).where("pickup_date", "==", date).get();
    const locks = snap.docs.map((d) => d.data()).filter((l) => ACTIVE_LOCK_STATUSES.includes(l.status));
    const confirmedCounts = new Map();
    locks.forEach((l) => l.menu_item_id && confirmedCounts.set(l.menu_item_id, (confirmedCounts.get(l.menu_item_id) || 0) + 1));
    const closed = excluded.has(date);
    const predicted = closed ? [] : forecastLocks(forecast(weekdayOf(date)), confirmedCounts);
    const confirmedNeeds = rawNeeds(componentPortions(locks, catalog.itemsById, catalog.componentsById, config), catalog.componentsById, catalog.ingredientsById);
    const forecastNeeds = rawNeeds(componentPortions(predicted, catalog.itemsById, catalog.componentsById, config), catalog.componentsById, catalog.ingredientsById);
    perDay.push({ date, confirmedNeeds, forecastNeeds });
    board.push({ date, closed, confirmed: locks.length, forecast: predicted.length });
  }
  const { stock, counted } = await currentStock(vendor.id, weekStart);
  const lines = [];
  for (const ing of Object.values(catalog.ingredientsById)) {
    const longLived = ing.frequency === "monthly";
    const byDay = perDay.map((d) => {
      const confirmed = d.confirmedNeeds.get(ing.id) || 0;
      const fc = d.forecastNeeds.get(ing.id) || 0;
      return { date: d.date, confirmed: Math.round(confirmed * 10) / 10, forecast: Math.round(fc * (1 + safety) * 10) / 10, amount: confirmed + fc * (1 + safety) };
    });
    const need = byDay.reduce((s, d) => s + d.amount, 0);
    if (need <= 0) continue;
    const have = Math.max(0, Number(stock.get(ing.id)) || 0);
    // 久放品項：庫存撐得過本週（含安全庫存）就不叫；不夠時一次補 4 週
    if (longLived && have >= need) continue;
    const want = longLived ? need * LONG_LIVED_WEEKS : need;
    const { units, amount } = roundToPurchaseUnit(Math.max(0, want - have), ing);
    // 分日到貨：只把要叫的量按每日需求比例分配；久放品項週一一次到
    const scale = need > 0 ? Math.max(0, want - have) / need : 0;
    const deliveries = longLived
      ? [{ date: byDay[0]?.date, units }]
      : splitDeliveries(byDay.map((d) => ({ date: d.date, amount: d.amount * scale })), ing)
        .map((d) => ({ date: d.date, units: roundToPurchaseUnit(d.amount, ing).units }));
    lines.push({
      ingredient_id: ing.id, name: ing.name, unit: ing.unit || "g", purchase_unit_label: ing.purchase_unit_label || ing.unit || "",
      purchase_unit_size: Number(ing.purchase_unit_size) || 1, supplier_id: ing.supplier_id || null, frequency: ing.frequency || "weekly", long_lived: longLived,
      by_day: byDay.map(({ date, confirmed, forecast: f }) => ({ date, confirmed, forecast: f })),
      need: Math.round(need), stock: Math.round(have), order_units: units, order_amount: amount,
      deliveries: deliveries.filter((d) => d.units > 0), unit_price: Number(ing.unit_price) || 0,
      est_cost: Math.round(units * (Number(ing.unit_price) || 0)),
    });
  }
  lines.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  const ref = db().collection("vendors").doc(vendor.id).collection("purchaseLists").doc(`weekly_${weekStart}`);
  await ref.set({
    type: "weekly", week_start: weekStart, safety_rate: safety, lines, board, uncounted: !counted,
    est_total: lines.reduce((s, l) => s + l.est_cost, 0), generated_at: FieldValue.serverTimestamp(),
  });
  // 週六 12:00 後下週主菜鎖定（§16 暫定：只能等值替換配菜）
  await db().collection("vendors").doc(vendor.id).set({ menu_locked_week: weekStart }, { merge: true });
  return { lines: lines.length, uncounted: !counted };
}

exports.buildWeeklyPurchase = onSchedule({ schedule: "0 12 * * 6", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const weekStart = mondayOf(addDays(taipeiToday(), 7));
  await forEachVendor("buildWeeklyPurchase", async (vendor) => {
    const r = await buildWeekly(vendor, weekStart);
    await notifyVendor(vendor.id, {
      title: "下週叫貨單已產生",
      body: `${r.lines} 項原物料${r.uncounted ? "（本週未盤點，以理論庫存計算）" : ""}，可一鍵傳給小盤商。`,
      link: "/vendor-portal/purchasing",
    });
  });
});

/** 店家在後台按「重新產生」：週叫貨單（預設下週，週六前可先試算） */
exports.triggerPurchaseListNow = onCall({ timeoutSeconds: 120 }, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const vendor = { id: vendorId, ...(await db().collection("vendors").doc(vendorId).get()).data() };
  const weekStart = request.data?.week_start || mondayOf(addDays(taipeiToday(), 7));
  return { week_start: weekStart, ...(await buildWeekly(vendor, weekStart)) };
});

module.exports.helpers = { forecastByWeekday, forecastLocks, excludedDates, HISTORY_STATUSES };

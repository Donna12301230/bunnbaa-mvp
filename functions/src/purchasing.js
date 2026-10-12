// Purchasing and prep (spec §5): weekly stock-in (locked Saturday 12:00) and daily prep (after cut-off, orders.js).
// Long-lived items such as rice, oil, seasonings, dry goods and packaging (frequency: monthly) are folded into the weekly stock-in, added to the supplier order only below safety stock,
// and topped up with LONG_LIVED_WEEKS weeks' worth at once. Monthly prep is deferred to phase 2 (purchaseLists.type is reserved for it).
//
// Stock-in amount = confirmed usage + forecast usage × (1 + safety stock) − current stock, rounded up to the purchase unit.
// Forecast: average portions on the same weekday over the past 4 weeks, excluding work-suspension days, national holidays (vendor closed days) and vendor-flagged anomaly weeks;
// for a new vendor's first 4 weeks, the vendor's self-reported forecast (vendors.forecast_daily: { menu_item_id: portions }).
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

// Work-suspension days come only from this vendor's disaster_dates (suspension events are written only to vendors in the affected counties/districts);
// we can't use every date in disasterEvents, or suspensions elsewhere and typhoon warnings would make this vendor look closed and zero out its forecast.
function excludedDates(vendor) {
  const set = new Set([...(vendor.holidays || []), ...(vendor.disaster_dates || [])]);
  for (const week of vendor.anomaly_weeks || []) for (let i = 0; i < 7; i++) set.add(addDays(week, i));
  return set;
}

/**
 * Forecast portions per item for a given weekday: average of the same weekday over the past 4 weeks; with under 4 weeks of history, the vendor's self-reported forecast.
 * Wasted portions (unclaimed charity meals) are subtracted from history so next week isn't overproduced (§7.5).
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

/** The "not yet confirmed" part of the forecast: forecast portions minus confirmed portions, treated as default sides and normal rice */
function forecastLocks(forecast, confirmedCounts) {
  const out = [];
  for (const [itemId, n] of forecast) {
    const extra = Math.max(0, Math.round(n - (confirmedCounts.get(itemId) || 0)));
    for (let i = 0; i < extra; i++) out.push({ menu_item_id: itemId, rice: "normal", slots: [] });
  }
  return out;
}

/** Current theoretical stock: this week's stocktake; without one, last week's stocktake + last week's order − last week's usage, flagged "not counted" */
async function currentStock(vendorId, weekStart) {
  const vendorRef = db().collection("vendors").doc(vendorId);
  const countedWeek = addDays(weekStart, -7); // the Saturday stocktake is recorded under "this week" (the week before next week's order)
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
  const sources = new Map(); // menu_item_id → { confirmed, forecast portions, confirmedNeeds, forecastNeeds: Map(ingredient_id → amount) }
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
    // Demand sources: how much of each ingredient each item uses that day (the purchasing page expands "why so much this week")
    for (const [list, kind] of [[locks, "confirmed"], [predicted, "forecast"]]) {
      const byItem = new Map();
      list.forEach((l) => l.menu_item_id && byItem.set(l.menu_item_id, [...(byItem.get(l.menu_item_id) || []), l]));
      for (const [itemId, itemLocks] of byItem) {
        const src = sources.get(itemId) || { confirmed: 0, forecast: 0, confirmedNeeds: new Map(), forecastNeeds: new Map() };
        src[kind] += itemLocks.length;
        const needs = rawNeeds(componentPortions(itemLocks, catalog.itemsById, catalog.componentsById, config), catalog.componentsById, catalog.ingredientsById);
        for (const [ingId, amount] of needs) src[`${kind}Needs`].set(ingId, (src[`${kind}Needs`].get(ingId) || 0) + amount);
        sources.set(itemId, src);
      }
    }
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
    // Long-lived items: don't order if stock lasts the week (including safety stock); when short, top up 4 weeks at once
    if (longLived && have >= need) continue;
    const want = longLived ? need * LONG_LIVED_WEEKS : need;
    const { units, amount } = roundToPurchaseUnit(Math.max(0, want - have), ing);
    // Split-day delivery: only the amount to order is split in proportion to daily demand; long-lived items arrive once on Monday
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
      sources: [...sources].flatMap(([itemId, src]) => {
        const amount = (src.confirmedNeeds.get(ing.id) || 0) + (src.forecastNeeds.get(ing.id) || 0) * (1 + safety);
        if (!(amount > 0)) return [];
        return [{ menu_item_id: itemId, name: catalog.itemsById[itemId]?.name || itemId, confirmed: src.confirmed, forecast: src.forecast, amount: Math.round(amount * 10) / 10 }];
      }).sort((a, b) => b.amount - a.amount),
    });
  }
  lines.sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  const ref = db().collection("vendors").doc(vendor.id).collection("purchaseLists").doc(`weekly_${weekStart}`);
  await ref.set({
    type: "weekly", week_start: weekStart, safety_rate: safety, lines, board, uncounted: !counted,
    est_total: lines.reduce((s, l) => s + l.est_cost, 0), generated_at: FieldValue.serverTimestamp(),
  });
  // After Saturday 12:00 next week's mains are locked (§16 provisional: only equivalent side substitutions allowed)
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

/** Vendor presses "Regenerate" in the vendor portal: weekly supplier order (next week by default; can be trial-run before Saturday) */
exports.triggerPurchaseListNow = onCall({ timeoutSeconds: 120 }, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const vendor = { id: vendorId, ...(await db().collection("vendors").doc(vendorId).get()).data() };
  const weekStart = request.data?.week_start || mondayOf(addDays(taipeiToday(), 7));
  return { week_start: weekStart, ...(await buildWeekly(vendor, weekStart)) };
});

module.exports.helpers = { forecastByWeekday, forecastLocks, excludedDates, HISTORY_STATUSES };

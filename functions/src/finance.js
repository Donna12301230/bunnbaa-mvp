// 店家財務（規格 §1、§9.3）：平台維護費（月費、寬限、暫停接單）、基本工資、本月收益看板。
// 金額、份數一律由程式計算（AI 不參與）。純函式放 module.exports.helpers，給測試用。
//
// vendors/{id} 相關欄位：
//   subscription_status / subscription_end_date   既有月費訂閱（web/src/lib/subscription.ts）：首月免費 30 天、之後每 30 天一期
//   billing { status: active|grace|suspended, due_at, grace_until, reminded_on }   billingCycle 每天寫
//   hourly_wage（備料人工時薪，只能調高）、staff_salaries[]（正職月薪）、fixed_costs（其他固定成本／月）
//   owner_hours_per_day（老闆每天工時，算老闆實際時薪）、linepay_fee_rate（LINE Pay 合約費率）
// vendors/{id}/revenueForecast/{YYYY-MM}：buildRevenueForecast 每天 21:00 寫
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { Timestamp } = require("firebase-admin/firestore");
const {
  REGION, db, onCall, HttpsError, FieldValue, t, logger, callerVendorId, notifyVendor, loadVendorCatalog, forEachVendor,
} = require("./common");
const { loadPlatformConfig, loadMinimumWage, wageOn, DEFAULT_PLATFORM_CONFIG } = require("./config");
const { componentPortions, rawNeeds, buildTimeline } = require("./prep");
const { mealPeriodOf, vendorPeriodRanges, MEAL_PERIODS } = require("./pricing");
const { taipeiToday, addDays, weekdayOf, mondayOf, splitWindow, toMinutes } = require("./calendar");
const { helpers: purchasing } = require("./purchasing");

const DAY_MS = 86400000;
const DEFAULT_LINEPAY_FEE_RATE = 0.0275;
const PAID_STATUSES = ["locked", "for_resale", "for_gift", "fulfilled", "resold_and_fulfilled", "charity"];

/* ------------------------------------------------------------------ *
 * 平台維護費（§1）：首月免費；逾期寬限 7 天並每天提醒；仍未繳暫停接新訂單（已成立訂單照常出餐）
 * ------------------------------------------------------------------ */

function toMillis(v) {
  if (!v) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
}

/**
 * 依既有訂閱欄位算出計費狀態。沒有任何訂閱欄位的舊資料當成 active（不擋）。
 * 申請取消的店家到期就暫停（不給寬限）。
 */
function billingStateOf(vendor, now = Date.now(), config = DEFAULT_PLATFORM_CONFIG) {
  const due = toMillis(vendor?.subscription_end_date);
  if (!vendor?.subscription_status || due == null) return { status: "active", due_at: null, grace_until: null, trial: false };
  const graceUntil = due + (config.billingGraceDays ?? 7) * DAY_MS;
  const trial = vendor.subscription_status === "trial";
  if (now < due) return { status: "active", due_at: due, grace_until: graceUntil, trial };
  if (vendor.subscription_status === "cancelled" || vendor.subscription_status === "expired") {
    return { status: "suspended", due_at: due, grace_until: due, trial: false };
  }
  if (now < graceUntil) return { status: "grace", due_at: due, grace_until: graceUntil, trial, days_left: Math.ceil((graceUntil - now) / DAY_MS) };
  return { status: "suspended", due_at: due, grace_until: graceUntil, trial };
}

exports.billingCycle = onSchedule({ schedule: "0 9 * * *", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const config = await loadPlatformConfig(db());
  const today = taipeiToday();
  const snap = await db().collection("vendors").get();
  for (const doc of snap.docs) {
    const vendor = { id: doc.id, ...doc.data() };
    try {
      const state = billingStateOf(vendor, Date.now(), config);
      const prev = vendor.billing?.status || "active";
      const patch = {
        "billing.status": state.status,
        "billing.due_at": state.due_at ? Timestamp.fromMillis(state.due_at) : null,
        "billing.grace_until": state.grace_until ? Timestamp.fromMillis(state.grace_until) : null,
        "billing.fee": config.maintenanceFee,
      };
      if (state.status === "grace" && vendor.billing?.reminded_on !== today) {
        patch["billing.reminded_on"] = today;
        await notifyVendor(vendor.id, {
          title: t("平台維護費已到期", "Platform fee is due"),
          body: t(
            `本期維護費 NT$ ${config.maintenanceFee}（含稅）尚未繳，寬限期還剩 ${state.days_left} 天；逾期將暫停接新訂單（已成立訂單照常出餐）。`,
            `Your NT$ ${config.maintenanceFee} platform fee is overdue. ${state.days_left} day(s) left before new orders are paused.`
          ),
          link: "/vendor-portal/settings",
        });
      }
      if (state.status === "suspended" && prev !== "suspended") {
        await notifyVendor(vendor.id, {
          title: t("已暫停接新訂單", "New orders paused"),
          body: t("維護費逾期超過寬限期，已暫停接新訂單；已成立的訂單請照常出餐。繳清後立即恢復。", "The platform fee is past the grace period. Existing orders still need to be served; paying restores ordering right away."),
          link: "/vendor-portal/settings",
        });
      }
      if (state.status === "active" && prev === "suspended") {
        await notifyVendor(vendor.id, { title: t("已恢復接單", "Ordering restored"), body: t("謝謝，維護費已繳清。", "Thanks — your fee is paid."), link: "/vendor-portal" });
      }
      await doc.ref.update(patch);
    } catch (err) {
      logger.error(`billingCycle failed for ${vendor.id}`, err);
    }
  }
});

/* ------------------------------------------------------------------ *
 * 基本工資（§9.3）：平台自動更新（以勞動部公告為準、生效日套用）；
 * 店家輸入低於基本工資會被擋下，調漲時自動上調並通知
 * ------------------------------------------------------------------ */

/** 把店家薪資設定拉到不低於基本工資；回傳 { patch, raised[] } */
function raiseToMinimum(vendor, wage) {
  const patch = {};
  const raised = [];
  const hourly = Number(vendor.hourly_wage) || 0;
  if (hourly < wage.hourly) {
    patch.hourly_wage = wage.hourly;
    if (hourly > 0) raised.push(t(`備料時薪 ${hourly} → ${wage.hourly}`, `hourly ${hourly} → ${wage.hourly}`));
  }
  const salaries = Array.isArray(vendor.staff_salaries) ? vendor.staff_salaries.map(Number) : [];
  if (salaries.some((s) => s < wage.monthly)) {
    patch.staff_salaries = salaries.map((s) => Math.max(s, wage.monthly));
    raised.push(t(`正職月薪調到至少 ${wage.monthly}`, `staff salaries raised to at least ${wage.monthly}`));
  }
  return { patch, raised };
}

exports.syncMinimumWage = onSchedule({ schedule: "10 0 * * *", timeZone: "Asia/Taipei", region: REGION }, async () => {
  // 第一階段資料來源：平台管理者在 platformConfig/minimumWage 填勞動部公告（含未來生效的 history）；
  // 這支每天依生效日套用。自動抓勞動部資料待確認（規格 §16）。
  const today = taipeiToday();
  const doc = await loadMinimumWage(db());
  const wage = wageOn(doc, today);
  if (doc.hourly !== wage.hourly || doc.monthly !== wage.monthly) {
    await db().collection("platformConfig").doc("minimumWage").set({ hourly: wage.hourly, monthly: wage.monthly, effectiveFrom: wage.effectiveFrom, history: doc.history || [] }, { merge: true });
  }
  await forEachVendor("syncMinimumWage", async (vendor) => {
    const { patch, raised } = raiseToMinimum(vendor, wage);
    if (Object.keys(patch).length === 0) return;
    await db().collection("vendors").doc(vendor.id).update(patch);
    if (raised.length > 0) {
      await notifyVendor(vendor.id, {
        title: t("基本工資調整", "Minimum wage updated"),
        body: t(`${wage.effectiveFrom} 起基本工資為時薪 ${wage.hourly}、月薪 ${wage.monthly}，已自動調整：${raised.join("、")}。`, `From ${wage.effectiveFrom} the minimum wage is ${wage.hourly}/h, ${wage.monthly}/month. Adjusted: ${raised.join(", ")}.`),
        link: "/vendor-portal",
      });
    }
  });
});

/** 店家設定成本參數（收益看板用）。薪資不得低於基本工資，由後端檢查後寫入 */
exports.updateVendorCosts = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const wage = wageOn(await loadMinimumWage(db()), taipeiToday());
  const d = request.data || {};
  const patch = {};
  const num = (v) => (v === "" || v == null ? null : Number(v));
  if ("hourly_wage" in d) {
    const v = num(d.hourly_wage);
    if (v != null && !(v >= wage.hourly)) throw new HttpsError("invalid-argument", t(`備料時薪不得低於基本工資 ${wage.hourly} 元`, `Hourly wage can't be below the minimum (${wage.hourly})`));
    patch.hourly_wage = v ?? wage.hourly;
  }
  if ("staff_salaries" in d) {
    const list = Array.isArray(d.staff_salaries) ? d.staff_salaries.map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
    if (list.length > 50) throw new HttpsError("invalid-argument", "too many staff");
    if (list.some((s) => s < wage.monthly)) throw new HttpsError("invalid-argument", t(`正職月薪不得低於基本工資 ${wage.monthly} 元`, `Monthly salary can't be below the minimum (${wage.monthly})`));
    patch.staff_salaries = list;
  }
  for (const [key, max] of [["fixed_costs", 10000000], ["owner_hours_per_day", 24]]) {
    if (!(key in d)) continue;
    const v = num(d[key]);
    if (v != null && !(v >= 0 && v <= max)) throw new HttpsError("invalid-argument", `${key} out of range`);
    patch[key] = v ?? 0;
  }
  if ("linepay_fee_rate" in d) {
    const v = num(d.linepay_fee_rate);
    if (v != null && !(v >= 0 && v <= 0.1)) throw new HttpsError("invalid-argument", t("LINE Pay 費率請填 0–10%", "Fee rate must be 0–10%"));
    patch.linepay_fee_rate = v ?? DEFAULT_LINEPAY_FEE_RATE;
  }
  if (Object.keys(patch).length === 0) throw new HttpsError("invalid-argument", "nothing to update");
  await db().collection("vendors").doc(vendorId).update(patch);
  return { ok: true, minimum_wage: wage };
});

/* ------------------------------------------------------------------ *
 * 本月收益看板（§9.3）：營收（已確定＋預估）、材料、人工、手續費、維護費、薪資、固定成本 → 預估淨利
 * ------------------------------------------------------------------ */

function monthDays(month) {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/** 原物料用量 → 材料成本（元）：用量 ÷ 採購單位大小 × 最新單價 */
function needsCost(needs, ingredientsById) {
  let cost = 0;
  for (const [id, amount] of needs) {
    const ing = ingredientsById[id];
    if (!ing) continue;
    const size = Number(ing.purchase_unit_size) > 0 ? Number(ing.purchase_unit_size) : 1;
    cost += (amount / size) * (Number(ing.unit_price) || 0);
  }
  return cost;
}

/** 時間軸工時（分鐘）：每批任務時間＋前一晚任務（以半成品製程時間計）＋裝盒 */
function timelineMinutes(timeline, componentsById) {
  if (!timeline) return 0;
  let minutes = 0;
  for (const s of timeline.slots || []) minutes += Math.max(0, toMinutes(s.end) - toMinutes(s.start));
  for (const o of timeline.overnight || []) minutes += Number(componentsById[o.component_id]?.prep_minutes) || 20;
  if ((timeline.slots || []).length > 0 || (timeline.overnight || []).length > 0) minutes += 20; // 裝盒、貼標籤
  return minutes;
}

/** 一天的人工分鐘：依餐期分開排時間軸再加總 */
function dayLaborMinutes(locks, catalog, vendor, config) {
  const ranges = vendorPeriodRanges(vendor, config);
  let minutes = 0;
  for (const period of MEAL_PERIODS) {
    const mine = locks.filter((l) => (l.meal_period || (l.pickup_window ? mealPeriodOf(l.pickup_window, config) : "lunch")) === period);
    if (mine.length === 0) continue;
    const start = splitWindow(ranges[period] || ranges.lunch || Object.values(ranges)[0] || "11:00-13:00").start;
    const portions = componentPortions(mine, catalog.itemsById, catalog.componentsById, config);
    minutes += timelineMinutes(buildTimeline(portions, catalog.componentsById, start), catalog.componentsById);
  }
  return minutes;
}

/** 每份毛利（§9.3）：8 折後售價 − 單份材料成本；毛利低於材料成本 30% 標紅 */
function itemMargins(catalog, config) {
  const out = [];
  for (const item of Object.values(catalog.itemsById)) {
    if (item.is_available === false) continue;
    const mains = Array.isArray(item.mains) && item.mains.length > 0 ? item.mains : [{ name: item.main?.name || "", component_id: item.main?.component_id, price: item.price }];
    for (const main of mains) {
      const price = Number(main.price) || 0;
      if (!(price > 0)) continue;
      const lock = { menu_item_id: item.id, rice: "normal", slots: [], main_component_id: main.component_id || null };
      const needs = rawNeeds(componentPortions([lock], catalog.itemsById, catalog.componentsById, config), catalog.componentsById, catalog.ingredientsById);
      const material = needsCost(needs, catalog.ingredientsById);
      const discounted = Math.round(price * 0.8);
      const margin = discounted - material;
      out.push({
        menu_item_id: item.id, name: mains.length > 1 && main.name ? `${item.name}（${main.name}）` : item.name,
        price, discounted_price: discounted, material_cost: Math.round(material * 10) / 10, margin: Math.round(margin * 10) / 10,
        warn: material > 0 && margin < material * 0.3,
      });
    }
  }
  return out.sort((a, b) => a.margin - b.margin);
}

async function buildForecast(vendor, month, { today = taipeiToday() } = {}) {
  const config = await loadPlatformConfig(db());
  const wageDoc = await loadMinimumWage(db());
  const catalog = await loadVendorCatalog(vendor.id);
  const days = monthDays(month);
  const first = days[0];
  const last = days[days.length - 1];
  const snap = await db().collection("locks").where("vendor_id", "==", vendor.id)
    .where("pickup_date", ">=", addDays(first, -28)).where("pickup_date", "<=", last).get();
  const all = snap.docs.map((d) => d.data()).filter((l) => PAID_STATUSES.includes(l.status));
  const inMonth = all.filter((l) => l.pickup_date >= first);

  // 近 4 週平均實付（預估營收用）
  const recent = all.filter((l) => l.pickup_date < today && l.pickup_date >= addDays(today, -28));
  const avgPaid = recent.length > 0 ? recent.reduce((s, l) => s + (l.locked_price || 0), 0) / recent.length
    : (inMonth.length > 0 ? inMonth.reduce((s, l) => s + (l.locked_price || 0), 0) / inMonth.length : 0);

  const forecast = await purchasing.forecastByWeekday(vendor, mondayOf(today));
  const excluded = purchasing.excludedDates(vendor);
  const ownHourly = Number(vendor.hourly_wage) || 0;
  const feeRate = Number(vendor.linepay_fee_rate) >= 0 && vendor.linepay_fee_rate != null ? Number(vendor.linepay_fee_rate) : DEFAULT_LINEPAY_FEE_RATE;

  let confirmedRevenue = 0;
  let forecastRevenue = 0;
  let materialCost = 0;
  let laborCost = 0;
  let laborMinutes = 0;
  let confirmedQty = 0;
  let forecastQty = 0;
  let businessDays = 0;
  const monthNeeds = new Map();
  const byPeriod = Object.fromEntries(MEAL_PERIODS.map((p) => [p, { revenue: 0, qty: 0, material_cost: 0 }]));
  const daily = [];

  for (const date of days) {
    const wd = weekdayOf(date);
    const open = config.businessWeekdays.includes(wd) && !excluded.has(date);
    if (open) businessDays++;
    const locks = inMonth.filter((l) => l.pickup_date === date);
    const revenue = locks.reduce((s, l) => s + (l.locked_price || 0), 0);
    confirmedRevenue += revenue;
    confirmedQty += locks.length;
    // 還沒到截單的日期補上預測份數（預設配菜、一般飯量）
    let predicted = [];
    if (open && date > today) {
      const counts = new Map();
      locks.forEach((l) => l.menu_item_id && counts.set(l.menu_item_id, (counts.get(l.menu_item_id) || 0) + 1));
      predicted = purchasing.forecastLocks(forecast(wd), counts);
    }
    forecastQty += predicted.length;
    forecastRevenue += predicted.length * avgPaid;
    const dayLocks = [...locks, ...predicted];
    const needs = rawNeeds(componentPortions(dayLocks, catalog.itemsById, catalog.componentsById, config), catalog.componentsById, catalog.ingredientsById);
    for (const [k, v] of needs) monthNeeds.set(k, (monthNeeds.get(k) || 0) + v);
    const dayMaterial = needsCost(needs, catalog.ingredientsById);
    materialCost += dayMaterial;
    const minutes = dayLaborMinutes(dayLocks, catalog, vendor, config);
    laborMinutes += minutes;
    // 每天的人工用當天生效的基本工資（店家設定較高時用店家的）
    const hourly = Math.max(ownHourly, wageOn(wageDoc, date).hourly);
    laborCost += (minutes / 60) * hourly;
    for (const l of locks) {
      const p = byPeriod[l.meal_period || mealPeriodOf(l.pickup_window || "11:00-11:30", config)];
      if (!p) continue;
      p.revenue += l.locked_price || 0;
      p.qty += 1;
    }
    if (locks.length > 0) {
      for (const period of MEAL_PERIODS) {
        const mine = locks.filter((l) => (l.meal_period || mealPeriodOf(l.pickup_window || "11:00-11:30", config)) === period);
        if (mine.length === 0) continue;
        const n = rawNeeds(componentPortions(mine, catalog.itemsById, catalog.componentsById, config), catalog.componentsById, catalog.ingredientsById);
        byPeriod[period].material_cost += needsCost(n, catalog.ingredientsById);
      }
    }
    daily.push({ date, revenue, material_cost: Math.round(dayMaterial), forecast_qty: predicted.length, confirmed_qty: locks.length });
  }

  const revenue = confirmedRevenue + forecastRevenue;
  const paymentFee = revenue * feeRate;
  const state = billingStateOf(vendor, Date.parse(`${first}T00:00:00+08:00`), config);
  // 首月免費：本月第一天還在試用期內就不收
  const maintenanceFee = state.trial && state.due_at && state.due_at >= Date.parse(`${last}T23:59:59+08:00`) ? 0 : config.maintenanceFee;
  const salaries = (Array.isArray(vendor.staff_salaries) ? vendor.staff_salaries : []).reduce((s, n) => s + (Number(n) || 0), 0);
  const otherFixed = Number(vendor.fixed_costs) || 0;
  const netProfit = revenue - materialCost - laborCost - paymentFee - maintenanceFee - salaries - otherFixed;
  const ownerHours = (Number(vendor.owner_hours_per_day) || 0) * businessDays;

  // 損益兩平：本月還要賣幾份才打平固定成本（每份貢獻 = 平均實付 − 平均材料 − 平均人工 − 手續費）
  const qty = confirmedQty + forecastQty;
  const perServing = qty > 0 ? (revenue - materialCost - laborCost - paymentFee) / qty : 0;
  const fixed = maintenanceFee + salaries + otherFixed;
  const confirmedContribution = confirmedQty > 0 && qty > 0 ? perServing * confirmedQty : 0;
  const breakEvenQty = perServing > 0 ? Math.max(0, Math.ceil((fixed - confirmedContribution) / perServing)) : null;

  const topNeeds = [...monthNeeds]
    .map(([id, amount]) => {
      const ing = catalog.ingredientsById[id];
      return { ingredient_id: id, name: ing?.name || id, unit: ing?.unit || "", amount: Math.round(amount), cost: Math.round(needsCost(new Map([[id, amount]]), catalog.ingredientsById)) };
    })
    .sort((a, b) => b.cost - a.cost || b.amount - a.amount)
    .slice(0, 10);

  const round = (n) => Math.round(n);
  const result = {
    month,
    confirmed_revenue: round(confirmedRevenue),
    forecast_revenue: round(forecastRevenue),
    revenue: round(revenue),
    confirmed_qty: confirmedQty,
    forecast_qty: forecastQty,
    avg_paid: round(avgPaid),
    material_cost: round(materialCost),
    labor_cost: round(laborCost),
    labor_hours: Math.round((laborMinutes / 60) * 10) / 10,
    hourly_wage: Math.max(ownHourly, wageOn(wageDoc, today).hourly),
    payment_fee: round(paymentFee),
    payment_fee_rate: feeRate,
    maintenance_fee: maintenanceFee,
    staff_salary: round(salaries),
    other_fixed_costs: round(otherFixed),
    net_profit: round(netProfit),
    owner_hours: ownerHours,
    owner_hourly: ownerHours > 0 ? round(netProfit / ownerHours) : null,
    break_even_qty: breakEvenQty,
    business_days: businessDays,
    by_meal_period: Object.fromEntries(Object.entries(byPeriod).map(([k, v]) => [k, { revenue: round(v.revenue), qty: v.qty, material_cost: round(v.material_cost) }])),
    top_needs: topNeeds,
    item_margins: itemMargins(catalog, config),
    daily,
    minimum_wage: wageOn(wageDoc, today),
  };
  return result;
}

/** 最近 15 天每日收入與材料成本（訂單統計報表折線圖） */
async function dailySeries(vendor, today) {
  const config = await loadPlatformConfig(db());
  const catalog = await loadVendorCatalog(vendor.id);
  const from = addDays(today, -14);
  const snap = await db().collection("locks").where("vendor_id", "==", vendor.id)
    .where("pickup_date", ">=", from).where("pickup_date", "<=", today).get();
  const locks = snap.docs.map((d) => d.data()).filter((l) => PAID_STATUSES.includes(l.status));
  const out = [];
  for (let i = 0; i < 15; i++) {
    const date = addDays(from, i);
    const mine = locks.filter((l) => l.pickup_date === date);
    const needs = rawNeeds(componentPortions(mine, catalog.itemsById, catalog.componentsById, config), catalog.componentsById, catalog.ingredientsById);
    out.push({ date, revenue: mine.reduce((s, l) => s + (l.locked_price || 0), 0), material_cost: Math.round(needsCost(needs, catalog.ingredientsById)), qty: mine.length });
  }
  return out;
}

async function writeForecast(vendor, month) {
  const result = await buildForecast(vendor, month);
  await db().collection("vendors").doc(vendor.id).collection("revenueForecast").doc(month).set({
    ...result, generated_at: FieldValue.serverTimestamp(),
  });
  return result;
}

exports.buildRevenueForecast = onSchedule({ schedule: "0 21 * * *", timeZone: "Asia/Taipei", region: REGION, timeoutSeconds: 540 }, async () => {
  const month = taipeiToday().slice(0, 7);
  await forEachVendor("buildRevenueForecast", (vendor) => writeForecast(vendor, month));
});

/** 店家後台按「重新計算」，或打開看板時資料太舊 */
exports.refreshRevenueForecast = onCall({ timeoutSeconds: 120 }, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const vendor = { id: vendorId, ...(await db().collection("vendors").doc(vendorId).get()).data() };
  const month = /^\d{4}-\d{2}$/.test(request.data?.month || "") ? request.data.month : taipeiToday().slice(0, 7);
  return writeForecast(vendor, month);
});

/** 訂單統計報表：最近 15 天每日收入＋材料成本 */
exports.getDailyRevenueSeries = onCall({ timeoutSeconds: 60 }, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const vendor = { id: vendorId, ...(await db().collection("vendors").doc(vendorId).get()).data() };
  return { days: await dailySeries(vendor, taipeiToday()) };
});

module.exports.helpers = { billingStateOf, raiseToMinimum, needsCost, timelineMinutes, itemMargins, monthDays };

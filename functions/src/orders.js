// Order lifecycle (still stored as locks): pricing → LINE Pay → cut-off wish decisions → QR pickup.
// Keeps the "lock the early-bird discount + resale" model.
//
// Fields added to locks:
//   menu_item_id, slots[{ category, default_dish, default_component_id, removed, wished,
//     wished_component_id, candidate_index, resolved, portion_level }], rice: add|normal|less
//   list_price (item list price), adjust_amount (adjustments), early_bird_amount, coupon_discount,
//   locked_price (amount paid), coupon_id, payer_uid (payer; owns the draw tickets; becomes the taker after a paid takeover)
//   paid_amount (what the payer actually paid in transaction_id; refunds are based on it; a free claim sets locked_price to 0 but leaves this alone)
//   resale_hold{ uid, intent_id, expires_at } (someone is paying to take it over), transfers[] (paid takeover history)
//   payment_intent_id, transaction_id, pickup_code (4 digits), phone_last3, qr_nonce, share_token
//   cutoff_done (cut-off decision made), charity_source: noshow|donated
// Status: locked → for_resale / for_gift → fulfilled / resold_and_fulfilled / charity / cancelled
const crypto = require("crypto");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { Timestamp } = require("firebase-admin/firestore");
const {
  REGION, db, onCall, HttpsError, logger, FieldValue, t, isEmulator, assertSignedInUser, assertAdminOrVendorOwner,
  callerVendorId, notifyUser, notifyVendor, loadVendorCatalog, forEachVendor,
} = require("./common");
const { inLang } = require("./i18n");
const { loadPlatformConfig } = require("./config");
const { requestPayment, confirmPayment, refundPayment } = require("./linePay");
const {
  validatePickup, planPickupDates, applyEarlyBirdPrice, vendorSlotCapacity, cutoffAt, isPastCutoff,
  cancelDeadlineAt, cancelCouponAmount, mealPeriodOf, mealPeriodLabel, vendorPeriodRanges, rangeOf, MEAL_PERIODS,
} = require("./pricing");
const { isBento, resolveChoices, resolveMain, resolveExtraSide, resolveCustomPicks, adjustAmount, RICE_OPTIONS } = require("./bento");
const { ACTIVE_LOCK_STATUSES, componentPortions, rawNeeds, buildTimeline, buildLabels } = require("./prep");
const { taipeiToday, taipeiTime, addDays, mondayOf, at, splitWindow } = require("./calendar");
const { recordMatchedClaim } = require("./resaleMatch").helpers;
const wallet = require("./wallet").helpers;

// LINE Pay sends the buyer back to the site they paid from (bunnbaa.com or web.app); unknown origins fall back to APP_BASE_URL
const APP_ORIGINS = new Set([
  "https://bunnbaa.com", "https://www.bunnbaa.com",
  "https://bunnbaa-mvp-5474.web.app", "https://bunnbaa-mvp-5474.firebaseapp.com",
]);
const appBaseUrl = (request) => {
  const origin = request?.rawRequest?.headers?.origin;
  return APP_ORIGINS.has(origin) ? origin : (process.env.APP_BASE_URL || "https://bunnbaa-mvp-5474.web.app");
};
const MAX_CART_UNITS = 50;

// Repeated no-shows used to set users/{uid}.orderBanned (old scheme; no-shows now become charity meals
// and nobody is banned); accounts banned under the old data are still blocked from ordering until an appeal is approved.
async function assertNotBanned(uid) {
  const snap = await db().collection("users").doc(uid).get();
  if (snap.exists && snap.data().orderBanned) {
    throw new HttpsError("permission-denied", t(
      "您的帳號已被限制下單，請至會員中心提交解封申訴",
      "Your account can't place orders. Please submit an appeal from My account."
    ));
  }
}

async function loadVendor(vendorId, cache) {
  if (cache?.has(vendorId)) return cache.get(vendorId);
  const snap = await db().collection("vendors").doc(vendorId).get();
  if (!snap.exists) throw new HttpsError("invalid-argument", `Unknown vendor_id: ${vendorId}`);
  const vendor = { id: snap.id, ...snap.data() };
  if (vendor.status === "disabled") {
    throw new HttpsError("failed-precondition", t(`「${vendor.name}」目前暫停營業`, `${vendor.name} is temporarily closed`));
  }
  cache?.set(vendorId, vendor);
  return vendor;
}

async function loadOrderableMenuItem(menuItemId) {
  if (typeof menuItemId !== "string" || !menuItemId) throw new HttpsError("invalid-argument", "menu_item_id is required");
  const snap = await db().collection("menu_items").doc(menuItemId).get();
  if (!snap.exists) throw new HttpsError("not-found", `No menu item ${menuItemId}`);
  const item = { id: snap.id, ...snap.data() };
  if (item.is_available === false) {
    throw new HttpsError("failed-precondition", t(`「${item.name}」目前暫停供應`, `${item.name} is currently unavailable`));
  }
  const hasMains = Array.isArray(item.mains) && item.mains.some((m) => Number(m?.price) > 0);
  if (!hasMains && (typeof item.price !== "number" || item.price <= 0)) {
    throw new HttpsError("failed-precondition", t(`「${item.name}」沒有設定價格`, `${item.name} has no price set`));
  }
  return item;
}

function sideWishId(vendorId, date, itemId, slot, candidate) {
  return `${vendorId}_${date}_${itemId}_${slot}_${candidate}`;
}

/** Wished portions of a candidate dish this week (for the weekly supply cap) */
async function weeklyWishCount(vendorId, week, itemId, slot, candidate) {
  const snap = await db().collection("sideWishes")
    .where("vendor_id", "==", vendorId).where("week", "==", week).get();
  return snap.docs
    .map((d) => d.data())
    .filter((d) => d.item_id === itemId && d.slot === slot && d.candidate === candidate)
    .reduce((s, d) => s + (d.count || 0), 0);
}

/** Usable coupon: held by the user, same vendor, not expired */
async function loadUsableCoupon(couponId, uid, vendorId) {
  const snap = await db().collection("coupons").doc(couponId).get();
  const c = snap.exists ? snap.data() : null;
  if (!c || c.user_id !== uid || c.status !== "owned") {
    throw new HttpsError("failed-precondition", t("這張折價券無法使用", "This coupon can't be used"));
  }
  if (c.vendor_id !== vendorId) {
    throw new HttpsError("failed-precondition", t("折價券只能在發券店家使用", "Coupons can only be used at the issuing vendor"));
  }
  if (c.expires_at?.toMillis?.() <= Date.now()) {
    throw new HttpsError("failed-precondition", t("這張折價券已過期", "This coupon has expired"));
  }
  return c;
}

/**
 * Validate and expand a bento's choices (main, rice, sides, fourth side, vendor custom fields); shared by ordering and pre-cut-off edits.
 * Returns { rice, resolved, extra, custom, main, listPrice, adjust }; throws HttpsError if invalid.
 * keptCustom: when a pre-cut-off edit doesn't touch the custom fields, reuse the choices and amounts recorded on the order (so later vendor edits to options don't affect old orders).
 */
function resolveOrderChoices(item, line, config, keptCustom = null) {
  const bento = isBento(item);
  const rice = bento && item.rice_component_id && RICE_OPTIONS.includes(line.rice) ? line.rice : "normal";
  const mainPick = resolveMain(item, line.main_index);
  if (mainPick.problem) throw new HttpsError("invalid-argument", mainPick.problem);
  const resolved = resolveChoices(item, line.slots);
  if (resolved.problem) throw new HttpsError("invalid-argument", resolved.problem);
  const extraPick = resolveExtraSide(item, line.extra_side, resolved.slots, config);
  if (extraPick.problem) throw new HttpsError("invalid-argument", extraPick.problem);
  const extra = extraPick.extra;
  const customPick = keptCustom
    ? { custom: keptCustom, amount: keptCustom.reduce((sum, c) => sum + (Number(c.price) || 0), 0) }
    : resolveCustomPicks(item, line.custom_picks);
  if (customPick.problem) throw new HttpsError("invalid-argument", customPick.problem);
  const adjust = adjustAmount({ rice, removedCount: resolved.removedCount, extraMode: extra?.mode }, config) + customPick.amount;
  return { rice, resolved, extra, custom: customPick.custom, main: mainPick.main, listPrice: mainPick.price, adjust };
}

/** This bento's wishes: candidate dishes chosen per slot + the fourth side (if a candidate). Used for sideWishes counts and the weekly cap */
function wishedEntries(slots, extra) {
  const out = [];
  (slots || []).forEach((slot, slotIdx) => {
    if (slot.wished != null) out.push({ slot: slotIdx, candidate: slot.candidate_index, dish: slot.wished });
  });
  if (extra?.wished && extra.candidate_index != null) out.push({ slot: extra.slot, candidate: extra.candidate_index, dish: extra.dish });
  return out;
}

/** Adjust sideWishes counts by ±delta (+1 on order, −1 on cancel/edit) */
function bumpWishes(batch, lock, delta) {
  for (const w of wishedEntries(lock.slots, lock.extra_side)) {
    batch.set(db().collection("sideWishes").doc(sideWishId(lock.vendor_id, lock.pickup_date, lock.menu_item_id, w.slot, w.candidate)), {
      vendor_id: lock.vendor_id, date: lock.pickup_date, week: mondayOf(lock.pickup_date), item_id: lock.menu_item_id,
      slot: w.slot, candidate: w.candidate, dish: w.dish, count: FieldValue.increment(delta),
    }, { merge: true });
  }
}

/**
 * One cart line → one (or more) lock drafts. Price:
 *   (item list price × early-bird rate) + adjustments − coupon (one per lock, discount ≤ subtotal)
 */
async function buildDrafts(line, ctx) {
  const quantity = Number.isInteger(line?.quantity) && line.quantity > 0 ? line.quantity : 1;
  const item = await loadOrderableMenuItem(line?.menu_item_id);
  const vendor = await loadVendor(item.vendor_id, ctx.vendorCache);
  if (ctx.vendorId && ctx.vendorId !== vendor.id) {
    throw new HttpsError("invalid-argument", t("一次只能跟一家店家預購", "One vendor per checkout"));
  }
  ctx.vendorId = vendor.id;
  const pickupDate = line.pickup_date;
  const pickupWindow = line.pickup_window;
  const problem = validatePickup(pickupDate, pickupWindow, vendor, ctx.config, new Date(), item);
  if (problem) throw new HttpsError("invalid-argument", problem);
  if (Array.isArray(item.weekdays) && item.weekdays.length > 0) {
    const wd = new Date(`${pickupDate}T00:00:00Z`).getUTCDay();
    if (!item.weekdays.includes(wd)) {
      throw new HttpsError("invalid-argument", t(`「${item.name}」${pickupDate} 沒有供應`, `${item.name} isn't served on ${pickupDate}`));
    }
  }
  if (Array.isArray(vendor.disaster_dates) && vendor.disaster_dates.includes(pickupDate)) {
    throw new HttpsError("failed-precondition", t(`${pickupDate} 因停班停課暫停供餐`, `No service on ${pickupDate} (work suspension)`));
  }

  const choice = resolveOrderChoices(item, line, ctx.config);
  const { rice, resolved, extra, custom, main, listPrice, adjust } = choice;

  // Weekly supply cap for candidate dishes; a candidate chosen as the fourth side counts too
  const week = mondayOf(pickupDate);
  for (const w of wishedEntries(resolved.slots, extra)) {
    const cand = item.slots[w.slot].candidates[w.candidate];
    if (!(cand.weekly_cap > 0)) continue;
    const key = `${item.id}|${w.slot}|${w.candidate}|${week}`;
    const already = ctx.wishTaken.get(key) ?? (await weeklyWishCount(vendor.id, week, item.id, w.slot, w.candidate));
    if (already + quantity > cand.weekly_cap) {
      throw new HttpsError("resource-exhausted", t(`「${cand.name}」本週已滿，請改選其他配菜`, `${cand.name} is full this week. Please choose another side.`));
    }
    ctx.wishTaken.set(key, already + quantity);
  }

  const { discountPercent, lockedPrice: earlyPrice } = applyEarlyBirdPrice(listPrice, pickupDate);
  const subtotal = Math.max(0, earlyPrice + adjust);
  const drafts = [];
  for (let i = 0; i < quantity; i++) {
    let couponDiscount = 0;
    let couponId = null;
    if (i === 0 && line.coupon_id) {
      if (ctx.usedCoupons.has(line.coupon_id)) {
        throw new HttpsError("invalid-argument", t("同一張折價券只能用一次", "Each coupon can only be used once"));
      }
      const coupon = await loadUsableCoupon(line.coupon_id, ctx.uid, vendor.id);
      ctx.usedCoupons.add(line.coupon_id);
      couponId = line.coupon_id;
      couponDiscount = Math.min(coupon.discount, subtotal);
    }
    const note = typeof line.note === "string" ? line.note.trim().slice(0, 100) : "";
    drafts.push({
      vendor_id: vendor.id,
      menu_item_id: item.id,
      item_name: item.name,
      item_name_en: item.name_en ?? null,
      // English names of the dishes / side categories / custom options in this order (zh -> en), for the English UI
      dish_names_en: item.dish_names_en ?? null,
      pickup_window: pickupWindow,
      pickup_date: pickupDate,
      meal_period: mealPeriodOf(pickupWindow, ctx.config),
      slots: resolved.slots,
      extra_side: extra,
      custom_options: custom,
      main_dish: main?.name || null,
      main_component_id: main?.component_id || null,
      main_index: main?.index ?? null,
      rice,
      list_price: listPrice,
      discount_percent: discountPercent,
      early_bird_amount: listPrice - earlyPrice,
      adjust_amount: adjust,
      coupon_id: couponId,
      coupon_discount: couponDiscount,
      locked_price: subtotal - couponDiscount,
      resellable: true,
      ...(note ? { note } : {}),
    });
  }
  return drafts;
}

function groupDraftsBySlot(drafts) {
  const groups = new Map();
  for (const d of drafts) {
    const key = `${d.vendor_id}__${d.pickup_date}__${d.pickup_window}`;
    const g = groups.get(key) ?? { vendorId: d.vendor_id, pickupDate: d.pickup_date, pickupWindow: d.pickup_window, count: 0 };
    g.count += 1;
    groups.set(key, g);
  }
  return [...groups.values()];
}

function slotCounterRef(vendorId, pickupDate, pickupWindow) {
  return db().collection("slot_counters").doc(`${vendorId}__${pickupDate}__${pickupWindow}`);
}

async function assertSlotsHaveRoom(drafts, vendorCache) {
  for (const g of groupDraftsBySlot(drafts)) {
    const vendor = vendorCache.get(g.vendorId);
    const capacity = vendorSlotCapacity(vendor);
    if (capacity === null) continue;
    const snap = await slotCounterRef(g.vendorId, g.pickupDate, g.pickupWindow).get();
    const booked = snap.exists ? snap.data().count ?? 0 : 0;
    if (booked + g.count > capacity) {
      const left = Math.max(0, capacity - booked);
      const where = t(`「${vendor?.name ?? "這家店"}」${g.pickupDate} ${g.pickupWindow}`, `${vendor?.name ?? "This vendor"} on ${g.pickupDate} ${g.pickupWindow}`);
      throw new HttpsError("resource-exhausted", left > 0
        ? t(`${where} 只剩 ${left} 份，請減少數量或改選其他時段`, `${where} has only ${left} left.`)
        : t(`${where} 已額滿，請改選其他時段`, `${where} is full. Please choose another slot.`));
    }
  }
}

/**
 * Create a payment intent; use_points = apply platform points first (wallet.js), and only the rest goes through LINE Pay.
 * When the cash due is 0 (fully covered by coupons or points), LINE Pay is skipped and the confirmation page creates the locks directly.
 */
async function reserve(request, drafts, productName) {
  const total = drafts.reduce((s, d) => s + d.locked_price, 0);
  const intentRef = db().collection("payment_intents").doc();
  const orderId = intentRef.id;
  const points = request.data?.use_points ? await wallet.holdPoints(request.auth.uid, orderId, total) : { used: 0, sources: [] };
  const amount = total - points.used;
  let transactionId = null;
  let paymentUrl = `${appBaseUrl(request)}/#/payment/confirm/${orderId}`;
  if (amount > 0) {
    // LINE Pay's products must sum to amount; lines with the same price are merged. When points are applied, everything becomes one "amount after points" line
    const byPrice = new Map();
    for (const d of drafts) {
      const key = `${productName(d)}|${d.locked_price}`;
      const p = byPrice.get(key) ?? { name: productName(d), quantity: 0, price: d.locked_price };
      p.quantity += 1;
      byPrice.set(key, p);
    }
    const products = points.used > 0
      ? [{ name: t(`飯飽預購（已折抵 ${points.used} 點）`, `BunnBaa pre-order (${points.used} points applied)`), quantity: 1, price: amount }]
      : [...byPrice.values()].filter((p) => p.price > 0);
    let info;
    try {
      // orderId goes in the path, not a query string: LINE Pay appends
      // ?transactionId=... by plain string concatenation (see App.tsx).
      info = await requestPayment({
        orderId, amount, products,
        confirmUrl: `${appBaseUrl(request)}/#/payment/confirm/${orderId}`,
        cancelUrl: `${appBaseUrl(request)}/#/payment/cancel/${orderId}`,
      });
    } catch (err) {
      logger.error("LINE Pay request failed", err);
      await wallet.releaseHold(request.auth.uid, orderId, "failed").catch(() => undefined);
      throw new HttpsError("internal", t("LINE Pay 付款請求失敗，請稍後再試", "The LINE Pay request failed. Please try again later."));
    }
    transactionId = String(info.transactionId);
    paymentUrl = info.paymentUrl.web;
  }
  await intentRef.set({
    status: "pending",
    buyer_uid: request.auth.uid,
    transaction_id: transactionId,
    amount,
    total,
    points_used: points.used,
    points_sources: points.sources,
    lock_drafts: drafts,
    created_at: FieldValue.serverTimestamp(),
  });
  return { order_id: orderId, payment_url: paymentUrl, free: amount === 0, points_used: points.used };
}

const holdExpired = () =>
  t("付款逾時，折抵的點數已退回，這筆沒有扣款，請重新結帳", "This payment timed out. Your points were returned and you weren't charged — please check out again.");

async function newContext(request) {
  return {
    uid: request.auth.uid,
    config: await loadPlatformConfig(db()),
    vendorCache: new Map(),
    wishTaken: new Map(),
    usedCoupons: new Set(),
    vendorId: null,
  };
}

/**
 * Cart checkout. lines: [{ menu_item_id, pickup_date, pickup_window, slots:[{choice}], rice,
 * quantity, note, coupon_id }]. Lines may have different pickup dates (bookable up to bookingRangeDays, 30 days, ahead).
 */
exports.createCartLinePayReservation = onCall({}, async (request) => {
  assertSignedInUser(request, "結帳", "check out");
  await assertNotBanned(request.auth.uid);
  const lines = request.data?.lines ?? request.data?.items;
  if (!Array.isArray(lines) || lines.length === 0) throw new HttpsError("invalid-argument", "lines must be a non-empty array");
  const ctx = await newContext(request);
  // Older carts send pickup_date/window only at the top level
  const drafts = [];
  for (const line of lines) {
    drafts.push(...(await buildDrafts({
      pickup_date: request.data.pickup_date, pickup_window: request.data.pickup_window, ...line,
    }, ctx)));
  }
  if (drafts.length > MAX_CART_UNITS) throw new HttpsError("invalid-argument", `Too many items total (max ${MAX_CART_UNITS})`);
  await assertSlotsHaveRoom(drafts, ctx.vendorCache);
  return reserve(request, drafts, (d) => `${d.item_name} ${d.pickup_date}`);
});

/**
 * Meal plans (multi-day plans): N consecutive business days in the same pickup slot (closed days are pushed back). Each day is a separate lock;
 * early-bird pricing is computed per day (plan price price_per_meal is the list price); each day's slot can be changed later under "My meals".
 * preview=true only returns each day's date and price (for the confirmation dialog) without creating a payment.
 */
exports.createPlanLinePayReservation = onCall({}, async (request) => {
  assertSignedInUser(request, "加入計畫", "join a plan");
  await assertNotBanned(request.auth.uid);
  const { plan_id: planId, start_date: startDate, pickup_window: pickupWindow } = request.data || {};
  if (typeof planId !== "string" || !planId) throw new HttpsError("invalid-argument", "plan_id is required");
  const planSnap = await db().collection("meal_plans").doc(planId).get();
  if (!planSnap.exists) throw new HttpsError("not-found", `No meal plan ${planId}`);
  const plan = planSnap.data();
  if (!Number.isInteger(plan.days) || plan.days <= 0 || plan.days > MAX_CART_UNITS) {
    throw new HttpsError("failed-precondition", t(`「${plan.name}」的供餐天數設定有誤`, `${plan.name} has an invalid number of days`));
  }
  if (typeof plan.price_per_meal !== "number" || plan.price_per_meal <= 0) {
    throw new HttpsError("failed-precondition", t(`「${plan.name}」沒有設定價格`, `${plan.name} has no price set`));
  }
  const ctx = await newContext(request);
  const vendor = await loadVendor(plan.vendor_id, ctx.vendorCache);
  let item = null;
  if (plan.menu_item_id) {
    const itemSnap = await db().collection("menu_items").doc(plan.menu_item_id).get();
    item = itemSnap.exists ? { id: itemSnap.id, ...itemSnap.data() } : null;
  }
  const { dates, postponed, problem } = planPickupDates(startDate, pickupWindow, vendor, plan.days, ctx.config, new Date(), item);
  if (problem) throw new HttpsError("invalid-argument", problem);
  const planLabel = `${plan.label}：${plan.name}`;
  const planLabelEn = plan.name_en ? `${plan.label_en || plan.label}: ${plan.name_en}` : null;
  const draftId = db().collection("payment_intents").doc().id;
  const drafts = dates.map((date, i) => {
    const { discountPercent, lockedPrice } = applyEarlyBirdPrice(plan.price_per_meal, date);
    return {
      vendor_id: plan.vendor_id,
      menu_item_id: plan.menu_item_id || null,
      item_name: `${planLabel}・第${i + 1}/${plan.days}天`,
      item_name_en: planLabelEn ? `${planLabelEn} · Day ${i + 1}/${plan.days}` : null,
      pickup_window: pickupWindow,
      pickup_date: date,
      meal_period: mealPeriodOf(pickupWindow, ctx.config),
      slots: [],
      extra_side: null,
      rice: "normal",
      list_price: plan.price_per_meal,
      discount_percent: discountPercent,
      early_bird_amount: plan.price_per_meal - lockedPrice,
      adjust_amount: 0,
      coupon_id: null,
      coupon_discount: 0,
      locked_price: lockedPrice,
      resellable: true,
      plan_id: draftId,
      plan_label: planLabel,
      plan_day: i + 1,
      meal_plan_id: planId,
    };
  });
  if (request.data?.preview) {
    return {
      days: drafts.map((d) => ({
        date: d.pickup_date, list_price: d.list_price, discount_percent: d.discount_percent, price: d.locked_price,
        postponed: postponed.includes(d.pickup_date),
      })),
      total: drafts.reduce((s, d) => s + d.locked_price, 0),
    };
  }
  await assertSlotsHaveRoom(drafts, ctx.vendorCache);
  return reserve(request, drafts, () => planLabel);
});

const soldOutDuringPayment = () =>
  t("你選的取餐時段在付款期間額滿了，這筆沒有扣款，請重新選擇時段下單", "Your pickup slot filled up during payment. You weren't charged.");
const couponGoneDuringPayment = () =>
  t("折價券在付款期間已被使用或過期，這筆沒有扣款，請重新結帳", "Your coupon was used or expired during payment. You weren't charged.");

function randomCode(digits) {
  return String(crypto.randomInt(0, 10 ** digits)).padStart(digits, "0");
}

/** 4-digit pickup number, unique per vendor per day */
async function allocatePickupCodes(drafts) {
  const taken = new Map();
  const codes = [];
  for (const d of drafts) {
    const key = `${d.vendor_id}__${d.pickup_date}`;
    if (!taken.has(key)) {
      const snap = await db().collection("locks").where("vendor_id", "==", d.vendor_id).where("pickup_date", "==", d.pickup_date).get();
      taken.set(key, new Set(snap.docs.map((x) => x.data().pickup_code).filter(Boolean)));
    }
    const set = taken.get(key);
    let code;
    do code = randomCode(4); while (set.has(code));
    set.add(code);
    codes.push(code);
  }
  return codes;
}

async function phoneLast3(request) {
  const tokenPhone = request.auth?.token?.phone_number;
  let phone = tokenPhone;
  if (!phone) {
    const snap = await db().collection("users").doc(request.auth.uid).get();
    phone = snap.exists ? snap.data().phone : null;
  }
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(-3) : null;
}

exports.confirmLinePayPayment = onCall({}, async (request) => {
  assertSignedInUser(request, "確認付款", "confirm payment");
  const { order_id: orderId } = request.data || {};
  if (!orderId) throw new HttpsError("invalid-argument", "order_id is required");
  const intentRef = db().collection("payment_intents").doc(orderId);
  const intentSnap = await intentRef.get();
  if (!intentSnap.exists) throw new HttpsError("not-found", `No payment_intent found for order ${orderId}`);
  const intent = intentSnap.data();
  if (intent.buyer_uid !== request.auth.uid) throw new HttpsError("permission-denied", "This payment doesn't belong to you");
  // Idempotent: the confirm redirect can legitimately fire twice.
  if (intent.status === "confirmed") return { lock_ids: intent.lock_ids, ...(intent.kind === "resale" ? { kind: "resale" } : {}) };
  if (intent.status === "gone") throw new HttpsError("failed-precondition", intent.gone_reason || t("這份已經被接走了，這筆沒有扣款", "Someone else got it first. You weren't charged."));
  if (intent.kind === "resale") return confirmResale(request, intentRef, intent);
  if (intent.status === "sold_out") throw new HttpsError("resource-exhausted", soldOutDuringPayment());
  if (intent.status === "coupon_gone") throw new HttpsError("failed-precondition", couponGoneDuringPayment());
  if (intent.status !== "pending") throw new HttpsError("failed-precondition", `This payment is ${intent.status}, not pending`);

  const drafts = intent.lock_drafts;
  const lockRefs = drafts.map(() => db().collection("locks").doc());
  const couponIds = drafts.map((d) => d.coupon_id).filter(Boolean);

  // 1) Inside a transaction, reserve portions, lock coupons and set the intent to confirming (prevents double confirmation). Not charged yet.
  const slots = groupDraftsBySlot(drafts);
  const counterRefs = slots.map((g) => slotCounterRef(g.vendorId, g.pickupDate, g.pickupWindow));
  const outcome = await db().runTransaction(async (tx) => {
    const fresh = await tx.get(intentRef);
    if (fresh.data().status !== "pending") {
      throw new HttpsError("failed-precondition", t("這筆付款正在處理中，請稍候重新整理", "This payment is still being processed."));
    }
    const vendorSnaps = await Promise.all(slots.map((g) => tx.get(db().collection("vendors").doc(g.vendorId))));
    const counterSnaps = await Promise.all(counterRefs.map((ref) => tx.get(ref)));
    const couponSnaps = await Promise.all(couponIds.map((id) => tx.get(db().collection("coupons").doc(id))));
    const booked = counterSnaps.map((s) => (s.exists ? s.data().count ?? 0 : 0));
    const full = slots.some((g, i) => {
      const capacity = vendorSlotCapacity(vendorSnaps[i].data());
      return capacity !== null && booked[i] + g.count > capacity;
    });
    if (full) {
      tx.update(intentRef, { status: "sold_out" });
      return "sold_out";
    }
    const couponOk = couponSnaps.every((s) => s.exists && s.data().status === "owned"
      && s.data().user_id === request.auth.uid && s.data().expires_at?.toMillis?.() > Date.now());
    if (!couponOk) {
      tx.update(intentRef, { status: "coupon_gone" });
      return "coupon_gone";
    }
    slots.forEach((g, i) => {
      tx.set(counterRefs[i], {
        vendor_id: g.vendorId, pickup_date: g.pickupDate, pickup_window: g.pickupWindow,
        count: booked[i] + g.count, updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    drafts.forEach((d, i) => {
      if (d.coupon_id) {
        tx.update(db().collection("coupons").doc(d.coupon_id), {
          status: "redeemed", lock_id: lockRefs[i].id, redeemed_at: FieldValue.serverTimestamp(),
        });
      }
    });
    tx.update(intentRef, { status: "confirming" });
    return "ok";
  });
  if (outcome === "sold_out" || outcome === "coupon_gone") {
    await wallet.releaseHold(request.auth.uid, orderId, outcome).catch(() => undefined);
    if (outcome === "sold_out") throw new HttpsError("resource-exhausted", soldOutDuringPayment());
    throw new HttpsError("failed-precondition", couponGoneDuringPayment());
  }

  // 2) Charge; on failure, release the portions and coupons (and the points hold) so the buyer can retry the same intent
  const rollbackReservation = async (status) => {
    const rollback = db().batch();
    slots.forEach((g, i) => rollback.update(counterRefs[i], { count: FieldValue.increment(-g.count) }));
    couponIds.forEach((id) => rollback.update(db().collection("coupons").doc(id), {
      status: "owned", lock_id: FieldValue.delete(), redeemed_at: FieldValue.delete(),
    }));
    rollback.update(intentRef, { status });
    await rollback.commit().catch((e) => logger.error("Rollback failed", e));
  };
  if (!(await wallet.lockHold(request.auth.uid, orderId))) {
    await rollbackReservation("expired");
    throw new HttpsError("deadline-exceeded", holdExpired());
  }
  if (intent.amount > 0) {
    try {
      await confirmPayment({ transactionId: intent.transaction_id, amount: intent.amount });
    } catch (err) {
      logger.error("LINE Pay confirm failed", err);
      await wallet.unlockHold(request.auth.uid, orderId).catch(() => undefined);
      await rollbackReservation("pending");
      throw new HttpsError("internal", t("LINE Pay 付款確認失敗，請稍後再試或聯絡客服", "LINE Pay couldn't confirm the payment. Please try again later."));
    }
  }
  await wallet.commitHold(request.auth.uid, orderId);
  // Points applied are allocated across portions in order; each portion records where its refundable money came from (funding, wallet.js)
  const shares = wallet.splitFunding(drafts.map((d) => d.locked_price), intent.transaction_id, intent.points_sources || []);

  // 3) Create locks and candidate-dish wish counts
  const codes = await allocatePickupCodes(drafts);
  const last3 = await phoneLast3(request);
  const config = await loadPlatformConfig(db());
  const vendorCache = new Map();
  const batch = db().batch();
  for (const [i, draft] of drafts.entries()) {
    if (!vendorCache.has(draft.vendor_id)) {
      const v = await db().collection("vendors").doc(draft.vendor_id).get();
      vendorCache.set(draft.vendor_id, v.data());
    }
    batch.set(lockRefs[i], {
      ...draft,
      status: "locked",
      buyer_uid: request.auth.uid,
      payer_uid: request.auth.uid,
      paid_amount: draft.locked_price,
      points_used: shares[i].points,
      funding: shares[i].funding,
      payment_intent_id: orderId,
      transaction_id: intent.transaction_id,
      pickup_code: codes[i],
      phone_last3: last3,
      share_token: crypto.randomBytes(12).toString("hex"),
      cutoff_at: cutoffAt(draft.pickup_date, vendorCache.get(draft.vendor_id), config),
      cutoff_done: false,
      created_at: FieldValue.serverTimestamp(),
    });
    bumpWishes(batch, draft, 1);
  }
  batch.update(intentRef, { status: "confirmed", lock_ids: lockRefs.map((r) => r.id) });
  await batch.commit();
  return { lock_ids: lockRefs.map((r) => r.id) };
});

/* ------------------------------------------------------------------ *
 * Cancel/edit before cut-off; donate as a charity meal during the pickup slot
 * ------------------------------------------------------------------ */

/** What the payer actually paid in this transaction; legacy data without paid_amount uses locked_price */
function paidAmountOf(lock) {
  return Number.isFinite(lock.paid_amount) ? lock.paid_amount : lock.locked_price || 0;
}

/**
 * Cancel with a full refund (used for automatic refunds on work-suspension days; diner-initiated cancels go through cancelForCoupon, which issues a coupon).
 * Since 2026-10-09 all refunds go to the payer as platform points (wallet.js); members can refund them to LINE Pay themselves.
 * The coupon is returned with its original expiry (not returned if already expired); portions and wish counts are rolled back.
 */
async function cancelAndRefund(lockRef, reason) {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const lock = snap.data();
    if (!ACTIVE_LOCK_STATUSES.includes(lock.status)) return false;
    const couponRef = lock.coupon_id ? db().collection("coupons").doc(lock.coupon_id) : null;
    const coupon = couponRef ? (await tx.get(couponRef)).data() : null;
    const { sources, funding, amount } = wallet.refundSources(lock, Infinity);
    wallet.writeCredit(tx, lock.payer_uid || lock.buyer_uid, sources, { reason, lockId: lockRef.id, text: lock.item_name || "", textEn: lock.item_name_en || "" });
    tx.update(lockRef, {
      status: "cancelled", cancel_reason: reason, refunded_amount: (lock.refunded_amount || 0) + amount, refunded_as: "points", funding,
      cancelled_at: FieldValue.serverTimestamp(),
    });
    if (couponRef) {
      const expired = coupon?.expires_at?.toMillis?.() <= Date.now();
      tx.update(couponRef, expired
        ? { status: "expired", lock_id: FieldValue.delete() }
        : { status: "owned", lock_id: FieldValue.delete(), redeemed_at: FieldValue.delete() });
    }
    tx.set(slotCounterRef(lock.vendor_id, lock.pickup_date, lock.pickup_window), { count: FieldValue.increment(-1) }, { merge: true });
    bumpWishes(tx, lock, -1);
    return true;
  });
}

async function loadOwnLock(request, lockId) {
  if (typeof lockId !== "string" || !lockId) throw new HttpsError("invalid-argument", "lock_id is required");
  const ref = db().collection("locks").doc(lockId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", t("找不到這筆訂單", "Order not found"));
  const lock = { id: snap.id, ...snap.data() };
  if (lock.buyer_uid !== request.auth.uid) throw new HttpsError("permission-denied", t("這不是你的訂單", "This isn't your order"));
  return { ref, lock };
}

exports.cancelLock = onCall({}, async (request) => {
  assertSignedInUser(request, "取消訂單", "cancel an order");
  const { ref, lock } = await loadOwnLock(request, request.data?.lock_id);
  if (lock.status !== "locked") throw new HttpsError("failed-precondition", t("這筆訂單目前不能取消（轉讓中請先取消轉讓）", "This order can't be cancelled right now"));
  if ((lock.payer_uid || lock.buyer_uid) !== request.auth.uid) {
    throw new HttpsError("failed-precondition", t("轉讓取得的餐點不能退款，可以再轉讓或捐為愛心餐", "Transferred meals can't be refunded"));
  }
  const config = await loadPlatformConfig(db());
  if (Date.now() > cancelDeadlineAt(lock.pickup_date, lock.pickup_window, config).getTime()) {
    throw new HttpsError("failed-precondition", t(
      `取餐前 ${config.cancelHoursBefore} 小時內不能取消；可以轉讓或捐為愛心餐`,
      `Orders can't be cancelled within ${config.cancelHoursBefore} hours of pickup. You can transfer or donate it instead.`
    ));
  }
  const coupon = await cancelForCoupon(ref, config);
  return { ok: true, coupon };
});

/**
 * Diner cancellation (revised 2026-10-05): no cash refund; instead a coupon for this vendor (30% of the list price, valid for couponValidDays days).
 * The money stays with the vendor (kept_amount); any coupon used on the order is still returned (not if expired); portions and wish counts are rolled back.
 * The whole thing runs in a transaction, so a double click issues only one coupon. Cancellations not caused by the diner (e.g. work-suspension days) still use cancelAndRefund for a full refund.
 * Stacking (decided 2026-10-13): like a regular coupon, one per meal, with early-bird pricing still applied.
 */
async function cancelForCoupon(lockRef, config) {
  const couponRef = db().collection("coupons").doc();
  return db().runTransaction(async (tx) => {
    const lock = (await tx.get(lockRef)).data();
    if (lock.status !== "locked") throw new HttpsError("failed-precondition", t("這筆訂單目前不能取消", "This order can't be cancelled right now"));
    const vendor = (await tx.get(db().collection("vendors").doc(lock.vendor_id))).data() || {};
    const usedRef = lock.coupon_id ? db().collection("coupons").doc(lock.coupon_id) : null;
    const used = usedRef ? (await tx.get(usedRef)).data() : null;
    const amount = cancelCouponAmount(lock, config);
    const expiresAt = Timestamp.fromMillis(Date.now() + config.couponValidDays * 86400000);
    if (amount > 0) {
      tx.set(couponRef, {
        vendor_id: lock.vendor_id, vendor_name: vendor.name || "", vendor_name_en: vendor.name_en || null, tier: "refund",
        label: "取消補償券", label_en: "Cancellation coupon", discount: amount,
        status: "owned", user_id: lock.buyer_uid, owned_at: FieldValue.serverTimestamp(), expires_at: expiresAt,
        source_lock_id: lockRef.id, issued_at: FieldValue.serverTimestamp(),
      });
    }
    tx.update(lockRef, {
      status: "cancelled", cancel_reason: "customer", refunded_amount: 0, kept_amount: paidAmountOf(lock),
      refund_coupon_id: amount > 0 ? couponRef.id : null, refund_coupon_amount: amount, cancelled_at: FieldValue.serverTimestamp(),
    });
    if (used) {
      const expired = used.expires_at?.toMillis?.() <= Date.now();
      tx.update(usedRef, expired
        ? { status: "expired", lock_id: FieldValue.delete() }
        : { status: "owned", lock_id: FieldValue.delete(), redeemed_at: FieldValue.delete() });
    }
    tx.set(slotCounterRef(lock.vendor_id, lock.pickup_date, lock.pickup_window), { count: FieldValue.increment(-1) }, { merge: true });
    bumpWishes(tx, lock, -1);
    return amount > 0 ? { id: couponRef.id, discount: amount, expires_at: expiresAt.toMillis(), vendor_name: vendor.name || "" } : null;
  });
}

/* ------------------------------------------------------------------ *
 * Paid takeover in the resale market
 * The taker pays the "resale price" via LINE Pay: set by the seller when listing (locks.resale_price, 0 to list price); if unset, the early-bird price (before coupons).
 * On success the original payer is refunded automatically, the smaller of what they paid and the resale price (a LINE Pay refund can't exceed the original payment):
 *   - Sold below what they paid: the seller absorbs the difference; sold above: the excess stays with the vendor, so the seller can't profit.
 * The vendor still receives at least the original amount for the meal; only the payer changes. Coupons used by the original payer are not returned.
 * Draw tickets follow whoever actually paid: after a takeover, payer_uid becomes the taker.
 * If nobody takes it over in time, firestore.rules still opens a $0 free claim (the original payer isn't refunded).
 * ------------------------------------------------------------------ */

const RESALE_HOLD_MS = 15 * 60 * 1000;

/** Default takeover price = early-bird price + adjustments (before coupons); legacy data without split fields uses amount paid + coupon discount */
function defaultResalePriceOf(lock) {
  if (Number.isFinite(lock.list_price) && Number.isFinite(lock.early_bird_amount)) {
    return Math.max(0, lock.list_price - lock.early_bird_amount + (lock.adjust_amount || 0));
  }
  return Math.max(0, (lock.locked_price || 0) + (lock.coupon_discount || 0));
}

/** Resale price cap = list price (item list price + adjustments, excluding the early-bird discount); legacy data without a list price uses the default takeover price */
function resaleCapOf(lock) {
  return Number.isFinite(lock.list_price) ? Math.max(0, lock.list_price + (lock.adjust_amount || 0)) : defaultResalePriceOf(lock);
}

/** Takeover price: the seller's resale_price (clamped to 0 to list price), or the default takeover price if unset. Same logic as web/src/lib/transfers.ts */
function resalePriceOf(lock) {
  if (Number.isInteger(lock.resale_price) && lock.resale_price >= 0) return Math.min(lock.resale_price, resaleCapOf(lock));
  return defaultResalePriceOf(lock);
}

const millisOf = (ts) => (ts && typeof ts.toMillis === "function" ? ts.toMillis() : 0);

/** Whether uid can still pay to take this over; returns an error message or null */
function resaleProblem(lock, uid, now = Date.now()) {
  if (!lock || lock.status !== "for_resale") return t("這份已經被接走或取消轉讓了", "This meal is no longer up for transfer");
  if (lock.buyer_uid === uid) return t("不能接手自己轉讓的餐點", "You can't take over your own listing");
  const deadline = millisOf(lock.resale_deadline);
  if (deadline && deadline <= now) return t("轉讓已逾時，現在可以免費領取", "The listing has expired — it's free to claim now");
  const hold = lock.resale_hold;
  if (hold && hold.uid !== uid && millisOf(hold.expires_at) > now) {
    return t("有人正在付款接手這份，請稍後再看看", "Someone is paying for this one right now. Check back shortly.");
  }
  return null;
}

/** "Take over" (我要接手): hold this meal for 15 minutes, then request payment from LINE Pay (NT$0 goes straight to the confirmation page) */
exports.createResaleLinePayReservation = onCall({}, async (request) => {
  assertSignedInUser(request, "接手轉讓", "take over a transferred meal");
  await assertNotBanned(request.auth.uid);
  const lockId = request.data?.lock_id;
  if (typeof lockId !== "string" || !lockId) throw new HttpsError("invalid-argument", "lock_id is required");
  const lockRef = db().collection("locks").doc(lockId);
  const intentRef = db().collection("payment_intents").doc();
  const orderId = intentRef.id;

  const lock = await db().runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    const data = snap.exists ? snap.data() : null;
    const problem = resaleProblem(data, request.auth.uid);
    if (problem) throw new HttpsError("failed-precondition", problem);
    tx.update(lockRef, {
      resale_hold: { uid: request.auth.uid, intent_id: orderId, expires_at: Timestamp.fromMillis(Date.now() + RESALE_HOLD_MS) },
    });
    return data;
  });

  const total = resalePriceOf(lock);
  const points = request.data?.use_points ? await wallet.holdPoints(request.auth.uid, orderId, total) : { used: 0, sources: [] };
  const amount = total - points.used;
  let transactionId = null;
  let paymentUrl = `${appBaseUrl(request)}/#/payment/confirm/${orderId}`;
  if (amount > 0) {
    try {
      const info = await requestPayment({
        orderId, amount,
        products: [{ name: t(`接手：${lock.item_name}`, `Take over: ${lock.item_name_en || lock.item_name}`), quantity: 1, price: amount }],
        confirmUrl: `${appBaseUrl(request)}/#/payment/confirm/${orderId}`,
        cancelUrl: `${appBaseUrl(request)}/#/payment/cancel/${orderId}`,
      });
      transactionId = String(info.transactionId);
      paymentUrl = info.paymentUrl.web;
    } catch (err) {
      logger.error("LINE Pay request failed (resale)", err);
      await lockRef.update({ resale_hold: FieldValue.delete() }).catch(() => {});
      await wallet.releaseHold(request.auth.uid, orderId, "failed").catch(() => undefined);
      throw new HttpsError("internal", t("LINE Pay 付款請求失敗，請稍後再試", "The LINE Pay request failed. Please try again later."));
    }
  }
  await intentRef.set({
    kind: "resale",
    status: "pending",
    buyer_uid: request.auth.uid,
    lock_id: lockId,
    seller_uid: lock.buyer_uid,
    transaction_id: transactionId,
    amount,
    total,
    points_used: points.used,
    points_sources: points.sources,
    created_at: FieldValue.serverTimestamp(),
  });
  return { order_id: orderId, payment_url: paymentUrl, free: amount === 0, amount, total, points_used: points.used };
});

/** Takeover branch of confirmLinePayPayment: change holder first (so the seller can no longer cancel the listing) → charge → refund the original payer */
async function confirmResale(request, intentRef, intent) {
  const orderId = intentRef.id;
  const lockRef = db().collection("locks").doc(intent.lock_id);
  const uid = request.auth.uid;

  // 1) Inside a transaction, check it can still be taken over, switch the holder to the taker and mark it "paying"; not charged yet
  const prev = await db().runTransaction(async (tx) => {
    const fresh = (await tx.get(intentRef)).data();
    if (fresh.status !== "pending") {
      throw new HttpsError("failed-precondition", t("這筆付款正在處理中，請稍候重新整理", "This payment is still being processed."));
    }
    const lock = (await tx.get(lockRef)).data();
    // If our own hold expired but nobody else claimed it, we can still take it over; not if someone else is paying (hold not expired)
    const problem = resaleProblem(lock, uid);
    if (problem) {
      tx.update(intentRef, { status: "gone", gone_reason: problem });
      return { gone: problem };
    }
    const snapshot = {
      buyer_uid: lock.buyer_uid,
      payer_uid: lock.payer_uid || lock.buyer_uid,
      transaction_id: lock.transaction_id || null,
      paid_amount: paidAmountOf(lock),
      funding: wallet.fundingOf(lock),
      resale_deadline: lock.resale_deadline || null,
      resale_price: Number.isInteger(lock.resale_price) ? lock.resale_price : null,
      transferred_from_uids: lock.transferred_from_uids || [],
    };
    tx.update(lockRef, {
      status: "locked",
      buyer_uid: uid,
      transferred_from_uids: FieldValue.arrayUnion(lock.buyer_uid),
      resale_deadline: FieldValue.delete(),
      resale_price: FieldValue.delete(),
      resale_hold: FieldValue.delete(),
      resale_payment_pending: orderId,
    });
    tx.update(intentRef, { status: "confirming", prev: snapshot });
    return snapshot;
  });
  if (prev.gone) {
    await wallet.releaseHold(uid, orderId, "gone").catch(() => undefined);
    throw new HttpsError("failed-precondition", prev.gone);
  }

  // 2) Charge; on failure, return the meal to the seller and set the intent back to pending (also releasing the points hold) so the taker can retry
  const rollbackTakeover = async (status) => {
    const rollback = db().batch();
    rollback.update(lockRef, {
      status: "for_resale",
      buyer_uid: prev.buyer_uid,
      transferred_from_uids: prev.transferred_from_uids,
      ...(prev.resale_deadline ? { resale_deadline: prev.resale_deadline } : {}),
      ...(prev.resale_price != null ? { resale_price: prev.resale_price } : {}),
      resale_payment_pending: FieldValue.delete(),
    });
    rollback.update(intentRef, { status });
    await rollback.commit().catch((e) => logger.error("Resale rollback failed", e));
  };
  if (!(await wallet.lockHold(uid, orderId))) {
    await rollbackTakeover("expired");
    throw new HttpsError("deadline-exceeded", holdExpired());
  }
  if (intent.amount > 0) {
    try {
      await confirmPayment({ transactionId: intent.transaction_id, amount: intent.amount });
    } catch (err) {
      logger.error("LINE Pay confirm failed (resale)", err);
      await wallet.unlockHold(uid, orderId).catch(() => undefined);
      const rollback = db().batch();
      rollback.update(lockRef, {
        status: "for_resale",
        buyer_uid: prev.buyer_uid,
        transferred_from_uids: prev.transferred_from_uids,
        ...(prev.resale_deadline ? { resale_deadline: prev.resale_deadline } : {}),
        ...(prev.resale_price != null ? { resale_price: prev.resale_price } : {}),
        resale_payment_pending: FieldValue.delete(),
      });
      rollback.update(intentRef, { status: "pending" });
      await rollback.commit().catch((e) => logger.error("Resale rollback failed", e));
      throw new HttpsError("internal", t("LINE Pay 付款確認失敗，請稍後再試或聯絡客服", "LINE Pay couldn't confirm the payment. Please try again later."));
    }
  }

  await wallet.commitHold(uid, orderId);

  // 3) The taker becomes the payer; replace the proxy pickup link and QR so screenshots held by the previous holder stop working immediately
  const lock = (await lockRef.get()).data();
  const price = Number.isFinite(intent.total) ? intent.total : intent.amount; // older intents have no total (no points applied)
  // Refund to the original payer: the smaller of what they paid and the resale price (a custom resale price may be lower or higher than what they paid); refunded as points since 2026-10-09
  const refund = wallet.refundSources({ funding: prev.funding || [] }, Math.min(prev.paid_amount, price));
  const refundAmount = refund.amount;
  const [share] = wallet.splitFunding([price], intent.transaction_id, intent.points_sources || []);
  const batch = db().batch();
  batch.update(lockRef, {
    payer_uid: uid,
    transaction_id: intent.transaction_id,
    payment_intent_id: orderId,
    paid_amount: price,
    points_used: share.points,
    funding: share.funding,
    locked_price: price,
    coupon_id: null,
    coupon_discount: 0,
    share_token: crypto.randomBytes(12).toString("hex"),
    qr_nonce: FieldValue.delete(),
    resale_payment_pending: FieldValue.delete(),
    transfers: FieldValue.arrayUnion({
      intent_id: orderId, from_uid: prev.buyer_uid, to_uid: uid, price,
      refund_uid: prev.payer_uid, refund_amount: refundAmount, at: Timestamp.now(),
    }),
  });
  batch.delete(db().collection("lock_tokens").doc(intent.lock_id)); // previous holder's pickup reminder
  batch.update(intentRef, { status: "confirmed", lock_ids: [intent.lock_id] });
  await batch.commit();

  // 4) Refund the original payer as platform points (usable at checkout or refundable to LINE Pay from the member center)
  let refundStatus = "none";
  if (refundAmount > 0) {
    try {
      await wallet.creditPoints(prev.payer_uid, refund.sources, { reason: "transfer", lockId: intent.lock_id, text: lock.item_name || "", textEn: lock.item_name_en || "" });
      refundStatus = "done";
    } catch (err) {
      logger.error(`resale points refund failed for lock ${intent.lock_id}`, err);
      refundStatus = "failed";
    }
  }
  await lockRef.update({
    transfer_refund: { intent_id: orderId, uid: prev.payer_uid, amount: refundAmount, as: "points", status: refundStatus, at: Timestamp.now() },
  });
  // Recipients are the previous holder/payer, not the caller: the text follows each one's users.lang
  const itemEn = lock.item_name_en || lock.item_name;
  const pointsText = (n) => t(`${n} 點已存入你的平台點數，可結帳折抵或到會員中心退回 LINE Pay。`, `${n} points were added to your BunnBaa balance — use them at checkout or send them back to LINE Pay from My account.`);
  await notifyUser(prev.buyer_uid, () => ({
    kind: "transfer",
    title: t("你轉讓的餐點已被接手", "Your listed meal was taken over"),
    body: refundStatus === "done" && prev.payer_uid === prev.buyer_uid
      ? `${t(`「${lock.item_name}」已由別人付款接手。`, `${itemEn} was taken over. `)}${pointsText(refundAmount)}`
      : t(`「${lock.item_name}」已由別人付款接手。`, `${itemEn} was taken over.`),
    link: refundStatus === "done" && prev.payer_uid === prev.buyer_uid ? "/profile?tab=points" : "/my-bookings",
  })).catch((err) => logger.warn("notify seller failed", err));
  // Reselling a meal that was itself gifted or claimed for free: refund whoever originally paid
  if (refundStatus === "done" && prev.payer_uid !== prev.buyer_uid) {
    await notifyUser(prev.payer_uid, () => ({
      kind: "transfer",
      title: t("餐點款項已退成點數", "Your payment came back as points"),
      body: `${t(`你付款的「${lock.item_name}」已由別人付款接手。`, `Someone took over ${itemEn}, which you paid for. `)}${pointsText(refundAmount)}`,
      link: "/profile?tab=points",
    })).catch((err) => logger.warn("notify payer failed", err));
  }
  // Impact metric for AI resale matching: was the taker a notified member (failures don't affect the takeover)
  await recordMatchedClaim(intent.lock_id, uid).catch((err) => logger.warn(`recordMatchedClaim ${intent.lock_id}`, err));
  return { lock_ids: [intent.lock_id], kind: "resale", refund_status: refundStatus };
}

/** A lock's current choices → the format resolveOrderChoices takes (fields not sent keep their current values) */
function currentChoices(lock) {
  return {
    rice: lock.rice || "normal",
    main_index: lock.main_index ?? null,
    slots: (lock.slots || []).map((s) => ({ choice: s.removed ? "none" : s.wished != null ? s.candidate_index : "default" })),
    extra_side: lock.extra_side ? { slot: lock.extra_side.slot, candidate: lock.extra_side.candidate_index, mode: lock.extra_side.mode } : null,
  };
}

/**
 * Edit before cut-off: main, sides, rice, fourth side and pickup slot (same day).
 * The amount is recomputed at the early-bird rate from the original order: if cheaper, refund the difference (LINE Pay partial refund); if more expensive,
 * phase 1 requires cancelling and re-ordering. Each day of a meal plan also changes its slot through this.
 */
exports.updateLockChoices = onCall({}, async (request) => {
  assertSignedInUser(request, "修改訂單", "change an order");
  const { ref, lock } = await loadOwnLock(request, request.data?.lock_id);
  if (lock.status !== "locked") throw new HttpsError("failed-precondition", t("這筆訂單目前不能修改", "This order can't be changed"));
  const [vendorSnap, itemSnap] = await Promise.all([
    db().collection("vendors").doc(lock.vendor_id).get(),
    db().collection("menu_items").doc(lock.menu_item_id || "_").get(),
  ]);
  const vendor = { id: vendorSnap.id, ...vendorSnap.data() };
  const config = await loadPlatformConfig(db());
  if (isPastCutoff(lock.pickup_date, vendor, config)) throw new HttpsError("failed-precondition", t("已經截單，不能修改", "Past cutoff"));
  const item = itemSnap.exists ? { id: itemSnap.id, ...itemSnap.data() } : null;
  const data = request.data || {};

  // Pickup slot
  const newWindow = typeof data.pickup_window === "string" && data.pickup_window ? data.pickup_window : lock.pickup_window;
  if (newWindow !== lock.pickup_window) {
    const problem = validatePickup(lock.pickup_date, newWindow, vendor, config, new Date(), item);
    if (problem) throw new HttpsError("invalid-argument", problem);
  }

  // Bento contents (daily meals in a meal plan have no options; only the slot can change)
  const changesChoices = ["slots", "rice", "main_index", "extra_side", "custom_picks"].some((k) => k in data);
  const patch = { pickup_window: newWindow, meal_period: mealPeriodOf(newWindow, config) };
  let newLocked = lock.locked_price;
  let next = lock;
  if (changesChoices) {
    if (!item || lock.plan_id) throw new HttpsError("failed-precondition", t("這筆餐點沒有可修改的選項，只能改取餐時段", "Only the pickup time can be changed for this meal"));
    const merged = { ...currentChoices(lock), ...Object.fromEntries(["slots", "rice", "main_index", "extra_side", "custom_picks"].filter((k) => k in data).map((k) => [k, data[k]])) };
    const choice = resolveOrderChoices(item, merged, config, "custom_picks" in data ? null : lock.custom_options || []);
    const early = Math.round(choice.listPrice * (1 - (lock.discount_percent || 0) / 100));
    const subtotal = Math.max(0, early + choice.adjust);
    let couponDiscount = 0;
    if (lock.coupon_id) {
      const coupon = (await db().collection("coupons").doc(lock.coupon_id).get()).data();
      couponDiscount = Math.min(coupon?.discount || lock.coupon_discount || 0, subtotal);
    }
    newLocked = subtotal - couponDiscount;
    if (newLocked > lock.locked_price) {
      throw new HttpsError("failed-precondition", t(
        `這樣改要多 NT$${newLocked - lock.locked_price}，目前還不能線上補差額，請保留原本的選項`,
        `This change costs NT$${newLocked - lock.locked_price} more, and topping up isn't supported yet — please keep your current choices`
      ));
    }
    Object.assign(patch, {
      dish_names_en: item?.dish_names_en ?? lock.dish_names_en ?? null,
      slots: choice.resolved.slots,
      extra_side: choice.extra,
      custom_options: choice.custom,
      rice: choice.rice,
      main_dish: choice.main?.name || null,
      main_component_id: choice.main?.component_id || null,
      main_index: choice.main?.index ?? null,
      list_price: choice.listPrice,
      early_bird_amount: choice.listPrice - early,
      adjust_amount: choice.adjust,
      coupon_discount: couponDiscount,
      locked_price: newLocked,
    });
    next = { ...lock, ...patch };
  }

  // Cheaper: refund the difference to the payer as platform points (wallet.js), in the same transaction
  const refund = lock.locked_price - newLocked;
  let refundCredit = null;
  if (refund > 0) {
    refundCredit = wallet.refundSources(lock, refund);
    if (refundCredit.amount > 0) {
      patch.refunded_amount = (lock.refunded_amount || 0) + refundCredit.amount;
      patch.paid_amount = paidAmountOf(lock) - refundCredit.amount;
      patch.funding = refundCredit.funding;
    }
  }

  // Changing slots moves the portion count (for vendors with a cap, first check the new slot has room)
  await db().runTransaction(async (tx) => {
    if (newWindow !== lock.pickup_window) {
      const toRef = slotCounterRef(lock.vendor_id, lock.pickup_date, newWindow);
      const capacity = vendorSlotCapacity(vendor);
      const toSnap = await tx.get(toRef);
      const booked = toSnap.exists ? toSnap.data().count ?? 0 : 0;
      if (capacity !== null && booked + 1 > capacity) {
        throw new HttpsError("resource-exhausted", t(`${newWindow} 已額滿，請改選其他時段`, `${newWindow} is full`));
      }
      tx.set(toRef, { vendor_id: lock.vendor_id, pickup_date: lock.pickup_date, pickup_window: newWindow, count: booked + 1, updated_at: FieldValue.serverTimestamp() }, { merge: true });
      tx.set(slotCounterRef(lock.vendor_id, lock.pickup_date, lock.pickup_window), { count: FieldValue.increment(-1) }, { merge: true });
    }
    tx.update(ref, patch);
    if (refundCredit?.amount > 0) {
      wallet.writeCredit(tx, lock.payer_uid || lock.buyer_uid, refundCredit.sources, { reason: "price_change", lockId: ref.id, text: lock.item_name || "", textEn: lock.item_name_en || "" });
    }
  });
  if (changesChoices) {
    const batch = db().batch();
    bumpWishes(batch, lock, -1);
    bumpWishes(batch, next, 1);
    await batch.commit();
  }
  return { ok: true, locked_price: newLocked, refunded: Math.max(0, refund) };
});

/* ------------------------------------------------------------------ *
 * QR pickup: server-signed one-time token (id + expiry + nonce + HMAC)
 * ------------------------------------------------------------------ */

const QR_TTL_MS = 10 * 60 * 1000;

function qrSecret() {
  const secret = process.env.PICKUP_QR_SECRET;
  if (secret) return secret;
  if (isEmulator()) return "local-dev-secret";
  // Falling back to a fixed string would make forgery easier; production must set it
  logger.error("PICKUP_QR_SECRET is not set; using a derived fallback");
  return `bunnbaa:${process.env.GCLOUD_PROJECT || "local"}:qr`;
}

function signQr(kind, id, exp, nonce) {
  return crypto.createHmac("sha256", qrSecret()).update(`${kind}.${id}.${exp}.${nonce}`).digest("base64url").slice(0, 22);
}

function makeQrToken(kind, id, nonce) {
  const exp = Date.now() + QR_TTL_MS;
  return `BB1.${kind}.${id}.${exp}.${nonce}.${signQr(kind, id, exp, nonce)}`;
}

function parseQrToken(token) {
  const parts = String(token || "").trim().split(".");
  if (parts.length !== 6 || parts[0] !== "BB1") return null;
  const [, kind, id, expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  const expected = signQr(kind, id, exp, nonce);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return { kind, id, exp, nonce };
}

/**
 * Generate a pickup QR. Either the holder, or anyone with the proxy pickup link (share_token), can do this.
 * Each call issues a new nonce, so old screenshots stop working immediately. Charity meal reservations (kind=R) also go through here.
 */
// Proxy pickup codes (2026-10-09): opening a proxy pickup link often asked for login and then navigated away, so we switched to an 8-character code that can be typed in.
// Stored in proxyCodes/{code} (rules deny everything; only the Admin SDK reads/writes; it can't live on locks, since locks being resold/gifted are publicly readable),
// recording the share_token at creation time: a resale/gift takeover changes share_token, so the old proxy pickup code dies along with the old link.
// The alphabet drops easily confused 0/O and 1/I/L.
const PROXY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PROXY_CODE_LENGTH = 8;

function normalizeProxyCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function randomProxyCode() {
  const bytes = crypto.randomBytes(PROXY_CODE_LENGTH);
  return Array.from(bytes, (b) => PROXY_CODE_ALPHABET[b % PROXY_CODE_ALPHABET.length]).join("");
}

/** The holder gets (or generates for the first time) the proxy pickup code for this meal */
exports.getProxyPickupCode = onCall({}, async (request) => {
  assertSignedInUser(request, "產生代領碼", "create a proxy pickup code");
  const lockId = request.data?.lock_id;
  if (typeof lockId !== "string" || !lockId) throw new HttpsError("invalid-argument", "lock_id is required");
  const ref = db().collection("locks").doc(lockId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().buyer_uid !== request.auth.uid) throw new HttpsError("permission-denied", t("這不是你的訂單", "This isn't your order"));
  const lock = snap.data();
  if (lock.status !== "locked") throw new HttpsError("failed-precondition", t("轉讓中、贈送中的餐點不能代領", "Meals listed for transfer or gift can't be picked up by someone else"));
  let shareToken = lock.share_token;
  if (!shareToken) {
    shareToken = crypto.randomBytes(12).toString("hex");
    await ref.update({ share_token: shareToken });
  }
  const existing = await db().collection("proxyCodes").where("lock_id", "==", lockId).limit(20).get();
  const current = existing.docs.find((d) => d.data().share_token === shareToken);
  if (current) return { code: current.id, share_token: shareToken };
  for (let i = 0; i < 5; i++) {
    const code = randomProxyCode();
    try {
      await db().collection("proxyCodes").doc(code).create({ lock_id: lockId, share_token: shareToken, created_at: FieldValue.serverTimestamp() });
      return { code, share_token: shareToken };
    } catch (err) {
      if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS: on collision, try another code
    }
  }
  throw new HttpsError("internal", t("代領碼產生失敗，請再試一次", "Couldn't create a proxy code. Please try again."));
});

exports.issuePickupQr = onCall({}, async (request) => {
  const { share_token: shareToken, reservation_id: reservationId, proxy_code: proxyCode } = request.data || {};
  let { lock_id: lockId } = request.data || {};
  const nonce = crypto.randomBytes(6).toString("hex");
  if (reservationId) {
    assertSignedInUser(request, "領取愛心餐", "claim a charity meal");
    const ref = db().collection("charityReservations").doc(reservationId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().user_id !== request.auth.uid) throw new HttpsError("permission-denied", t("找不到這筆預約", "Reservation not found"));
    if (snap.data().status !== "reserved") throw new HttpsError("failed-precondition", t("這筆預約已結束", "This reservation has ended"));
    await ref.update({ qr_nonce: nonce });
    return { token: makeQrToken("R", reservationId, nonce), expires_in: QR_TTL_MS / 1000 };
  }
  let codeToken = null;
  if (proxyCode != null) {
    // Proxy pickup codes need no login; a wrong code and an already transferred meal get the same message, so we don't reveal whether the order exists
    const normalized = normalizeProxyCode(proxyCode);
    const codeSnap = normalized.length === PROXY_CODE_LENGTH ? await db().collection("proxyCodes").doc(normalized).get() : null;
    if (!codeSnap?.exists) throw new HttpsError("not-found", t("代領碼不正確或已失效，請跟朋友確認", "That proxy code is wrong or no longer valid. Check with your friend."));
    lockId = codeSnap.data().lock_id;
    codeToken = codeSnap.data().share_token;
  }
  if (typeof lockId !== "string" || !lockId) throw new HttpsError("invalid-argument", "lock_id is required");
  const ref = db().collection("locks").doc(lockId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", t("找不到這筆訂單", "Order not found"));
  const lock = snap.data();
  const owner = request.auth && lock.buyer_uid === request.auth.uid;
  const presented = codeToken || shareToken;
  // Proxy pickup only for meals not being resold/gifted: for_resale / for_gift locks are publicly readable (including share_token), so they can't be used for proxy pickup
  const proxy = !!presented && !!lock.share_token && presented === lock.share_token && lock.status === "locked";
  if (!owner && !proxy) {
    if (codeToken) throw new HttpsError("not-found", t("代領碼不正確或已失效，請跟朋友確認", "That proxy code is wrong or no longer valid. Check with your friend."));
    throw new HttpsError("permission-denied", t("沒有這筆訂單的取餐權限", "You can't pick up this order"));
  }
  if (!["locked", "for_resale", "for_gift"].includes(lock.status)) {
    throw new HttpsError("failed-precondition", t("這筆訂單已經不能取餐", "This order can no longer be picked up"));
  }
  await ref.update({ qr_nonce: nonce });
  return {
    token: makeQrToken("L", lockId, nonce),
    expires_in: QR_TTL_MS / 1000,
    pickup_code: lock.pickup_code,
    item_name: lock.item_name,
    pickup_date: lock.pickup_date,
    pickup_window: lock.pickup_window,
    // The proxy pickup screen shows which meal and which vendor (no holder personal data)
    ...(proxy && !owner ? { item_name_en: lock.item_name_en || null, vendor_id: lock.vendor_id } : {}),
  };
});

function lockSummary(id, lock, extra = {}) {
  return {
    kind: "lock",
    lock_id: id,
    pickup_code: lock.pickup_code,
    item_name: lock.item_name,
    item_name_en: lock.item_name_en || null,
    dish_names_en: lock.dish_names_en || null,
    pickup_date: lock.pickup_date,
    pickup_window: lock.pickup_window,
    main_dish: lock.main_dish || null,
    slots: (lock.slots || []).map((s) => ({
      category: s.category, removed: !!s.removed, dish: s.removed ? null : s.resolved || s.default_dish, wished: s.wished,
      backup_used: !!s.backup_used,
    })),
    extra_side: lock.extra_side ? { dish: lock.extra_side.resolved || lock.extra_side.dish, mode: lock.extra_side.mode, used: lock.extra_side.used_for_slot != null } : null,
    custom_options: (lock.custom_options || []).map((c) => ({ label: c.label, choice: c.choice, price: c.price })),
    adjust_amount: lock.adjust_amount || 0,
    rice: lock.rice || "normal",
    coupon_discount: lock.coupon_discount || 0,
    paid: lock.locked_price,
    status: lock.status,
    note: lock.note || null,
    ...extra,
  };
}

/**
 * Vendor scans the code (or fallback: 4-digit pickup number + last 3 phone digits) to confirm pickup. Only that vendor's owner / admins can redeem.
 * preview=true only returns the content without redeeming (the screen shows it first, then "Complete pickup" is pressed).
 */
exports.completePickup = onCall({}, async (request) => {
  const { token, pickup_code: code, phone_last3: last3, preview, vendor_id: requestedVendor, lock_id: lockId } = request.data || {};
  const vendorId = await callerVendorId(request, requestedVendor);
  const today = taipeiToday();

  // Vendor checks in person in today's order list and presses "Confirm pickup" directly (own vendor, today's orders only)
  if (lockId) return completeLock(db().collection("locks").doc(String(lockId)), vendorId, today, preview, null);

  if (token) {
    const parsed = parseQrToken(token);
    if (!parsed) throw new HttpsError("invalid-argument", t("這不是有效的 BunnBaa 取餐 QR Code", "This isn't a valid BunnBaa pickup QR code"));
    if (parsed.exp < Date.now()) throw new HttpsError("failed-precondition", t("QR Code 已過期，請顧客重新開啟取餐頁", "This QR code has expired. Ask the customer to reopen it."));
    if (parsed.kind === "R") return completeCharityReservation(parsed, vendorId, preview);
    return completeLock(db().collection("locks").doc(parsed.id), vendorId, today, preview, parsed.nonce);
  }

  if (!/^\d{4}$/.test(String(code || "")) || !/^\d{3}$/.test(String(last3 || ""))) {
    throw new HttpsError("invalid-argument", t("請輸入 4 碼取餐號與手機末三碼", "Enter the 4-digit pickup code and the last 3 phone digits"));
  }
  const snap = await db().collection("locks")
    .where("vendor_id", "==", vendorId).where("pickup_date", "==", today).where("pickup_code", "==", String(code)).limit(1).get();
  if (snap.empty || snap.docs[0].data().phone_last3 !== String(last3)) {
    throw new HttpsError("not-found", t("取餐號或手機末三碼不符", "Pickup code or phone digits don't match"));
  }
  return completeLock(snap.docs[0].ref, vendorId, today, preview, null);
});

async function completeLock(ref, vendorId, today, preview, nonce) {
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", t("找不到這筆訂單", "Order not found"));
    const lock = snap.data();
    if (lock.vendor_id !== vendorId) throw new HttpsError("permission-denied", t("這張取餐碼不是本店的訂單", "This order isn't for your store"));
    if (nonce && lock.qr_nonce !== nonce) throw new HttpsError("failed-precondition", t("這張 QR Code 已失效（可能是舊截圖），請顧客重新開啟", "This QR code is no longer valid (old screenshot?)"));
    if (!["locked", "for_resale", "for_gift"].includes(lock.status)) {
      throw new HttpsError("failed-precondition", t(`這筆訂單已是「${lock.status}」，不能重複取餐`, `This order is already "${lock.status}"`));
    }
    if (lock.pickup_date !== today) {
      throw new HttpsError("failed-precondition", t(`這筆是 ${lock.pickup_date} 的訂單，不是今天`, `This order is for ${lock.pickup_date}, not today`));
    }
    const summary = lockSummary(ref.id, lock);
    if (preview) return summary;
    // Transferred meals: free claim / gift (payer is still the original buyer) or paid takeover (recorded in transfers, payer switched to the taker)
    const transferred = (lock.payer_uid || lock.buyer_uid) !== lock.buyer_uid || (lock.transfers || []).length > 0;
    const status = transferred ? "resold_and_fulfilled" : "fulfilled";
    tx.update(ref, { status, qr_nonce: FieldValue.delete(), fulfilled_at: FieldValue.serverTimestamp() });
    return { ...summary, status, completed: true };
  });
}

async function completeCharityReservation(parsed, vendorId, preview) {
  const resRef = db().collection("charityReservations").doc(parsed.id);
  return db().runTransaction(async (tx) => {
    const resSnap = await tx.get(resRef);
    if (!resSnap.exists) throw new HttpsError("not-found", t("找不到這筆愛心餐預約", "Reservation not found"));
    const res = resSnap.data();
    if (res.vendor_id !== vendorId) throw new HttpsError("permission-denied", t("這筆愛心餐不是本店的", "Not your store's charity meal"));
    if (res.qr_nonce !== parsed.nonce) throw new HttpsError("failed-precondition", t("這張 QR Code 已失效", "This QR code is no longer valid"));
    if (res.status !== "reserved" || res.expires_at.toMillis() < Date.now()) {
      throw new HttpsError("failed-precondition", t("這筆愛心餐預約已逾時或已領取", "This reservation has expired or was already used"));
    }
    const mealRef = db().collection("charityMeals").doc(res.meal_id);
    const meal = (await tx.get(mealRef)).data();
    const summary = { kind: "charity", reservation_id: parsed.id, pickup_code: meal?.pickup_code, item_name: meal?.item_name, item_name_en: meal?.item_name_en || null, dish_names_en: meal?.dish_names_en || null, sides: meal?.sides || [] };
    if (preview) return summary;
    tx.update(resRef, { status: "claimed", claimed_at: FieldValue.serverTimestamp(), qr_nonce: FieldValue.delete() });
    tx.update(mealRef, { status: "claimed", claimed_at: FieldValue.serverTimestamp() });
    return { ...summary, completed: true };
  });
}

/* ------------------------------------------------------------------ *
 * Cut-off: decide candidate-dish wishes, generate daily prep and pickup labels, shortage warnings
 * ------------------------------------------------------------------ */

/**
 * Demand for the day after cut-off vs this week's theoretical stock → shortage list.
 * Opening stock = last Saturday's stocktake (stored at inventory/{last Monday}, same meaning as currentStock in purchasing.js);
 * without a stocktake, the stock used when this week's supplier order was generated (lines[].stock). Then add this week's deliveries and subtract prep usage before this day.
 * web/src/hooks/useStockOnHand.ts uses the same algorithm; change both together.
 */
async function shortageFor(vendorId, date, needs, ingredientsById) {
  const week = mondayOf(date);
  const vendorRef = db().collection("vendors").doc(vendorId);
  const [invSnap, weeklySnap, plansSnap] = await Promise.all([
    vendorRef.collection("inventory").doc(addDays(week, -7)).get(),
    vendorRef.collection("purchaseLists").doc(`weekly_${week}`).get(),
    vendorRef.collection("prepPlans").where("week", "==", week).get(),
  ]);
  const lines = weeklySnap.exists ? weeklySnap.data().lines || [] : [];
  const counted = invSnap.exists && invSnap.data().counted;
  const stock = counted
    ? new Map(Object.entries(invSnap.data().counts || {}))
    : new Map(lines.map((line) => [line.ingredient_id, Number(line.stock) || 0]));
  for (const line of lines) stock.set(line.ingredient_id, (stock.get(line.ingredient_id) || 0) + (line.order_amount || 0));
  for (const plan of plansSnap.docs) {
    if (plan.id >= date) continue;
    for (const [id, amount] of Object.entries(plan.data().raw_needs || {})) stock.set(id, (stock.get(id) || 0) - amount);
  }
  const shortages = [];
  for (const [id, need] of needs) {
    const have = Math.max(0, stock.get(id) || 0);
    if (need > have + 1e-6) {
      const ing = ingredientsById[id];
      shortages.push({ ingredient_id: id, name: ing?.name || id, unit: ing?.unit || "", need: Math.round(need), have: Math.round(have), short: Math.ceil(need - have) });
    }
  }
  return shortages;
}

/**
 * Cut off and generate prepPlans/{date}. Idempotent: skipped if prepPlans already has locked_at (keyed by date).
 */
async function runLockOrders(vendor, date, { force = false } = {}) {
  const vendorRef = db().collection("vendors").doc(vendor.id);
  const planRef = vendorRef.collection("prepPlans").doc(date);
  const existing = await planRef.get();
  if (existing.exists && existing.data().locked_at && !force) return null;
  const config = await loadPlatformConfig(db());

  const locksSnap = await db().collection("locks").where("vendor_id", "==", vendor.id).where("pickup_date", "==", date).get();
  const locks = locksSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })).filter((l) => ACTIVE_LOCK_STATUSES.includes(l.status));
  const wishSnap = await db().collection("sideWishes").where("vendor_id", "==", vendor.id).where("date", "==", date).get();
  const wishCounts = new Map(wishSnap.docs.map((d) => [d.id, d.data().count || 0]));
  const catalog = await loadVendorCatalog(vendor.id);
  const minDefault = Number(vendor.candidate_min_qty) > 0 ? Number(vendor.candidate_min_qty) : config.candidateMinQty;

  // Decide wishes: candidates that reach the minimum quantity are served; those that don't switch to the backup if there is one, otherwise back to the default dish with a notification (the default dish is made as usual)
  const batch = db().batch();
  const failedWishes = new Map(); // uid -> [message]
  const wishResults = {};
  const judge = (item, slotIdx, candIdx, dish) => {
    const key = sideWishId(vendor.id, date, item?.id, slotIdx, candIdx);
    const cand = item?.slots?.[slotIdx]?.candidates?.[candIdx];
    const minQty = Number(cand?.min_qty) > 0 ? Number(cand.min_qty) : minDefault;
    const count = wishCounts.get(key) || 0;
    // Candidate dish disabled (disaster, ingredient price spike: not allowed as a candidate) = not served
    const ok = !cand?.disabled && count >= minQty;
    wishResults[key] = { dish, count, min_qty: minQty, ok };
    return { ok, count, minQty, cand };
  };
  for (const lock of locks) {
    const item = catalog.itemsById[lock.menu_item_id];
    const extra = lock.extra_side || null;
    const extraJudge = extra?.wished ? judge(item, extra.slot, extra.candidate_index, extra.dish) : { ok: true };
    let backupFree = extra?.mode === "backup" && extraJudge.ok;
    let backupUsedFor = null;
    // Notes are builders: they're turned into text later inside notifyUser, in the buyer's language
    const notes = [];
    const dishEn = (name) => item?.dish_names_en?.[name] || name;
    const slots = (lock.slots || []).map((slot, slotIdx) => {
      if (slot.removed) return slot;
      if (slot.wished == null) return { ...slot, resolved: slot.default_dish };
      const { ok, count, minQty, cand } = judge(item, slotIdx, slot.candidate_index, slot.wished);
      // Portion level is taken from the item settings at cut-off time (recomputed after price changes) and locked after cut-off
      if (ok) return { ...slot, resolved: slot.wished, portion_level: cand?.portion_level ?? slot.portion_level ?? 1 };
      const short = Math.max(0, minQty - count);
      if (backupFree) {
        backupFree = false;
        backupUsedFor = slotIdx;
        notes.push(() => t(`「${slot.wished}」這次差 ${short} 人未成立，已幫你換成備案「${extra.dish}」`, `${dishEn(slot.wished)} needed ${short} more orders — swapped to your backup ${dishEn(extra.dish)}`));
        return { ...slot, resolved: extra.dish, resolved_component_id: extra.component_id || null, backup_used: true, portion_level: extra.portion_level ?? 1 };
      }
      notes.push(() => t(`「${slot.wished}」這次差 ${short} 人未成立，已幫你換回「${slot.default_dish}」`, `${dishEn(slot.wished)} needed ${short} more orders — swapped back to ${dishEn(slot.default_dish)}`));
      return { ...slot, resolved: slot.default_dish, portion_level: 1 };
    });
    let extraSide = extra;
    if (extra) {
      if (extra.mode === "addon") {
        // Add-on candidate didn't go ahead: use that slot's default dish instead (still the fourth side, no price difference refunded)
        const fallback = item?.slots?.[extra.slot]?.default;
        extraSide = extraJudge.ok
          ? { ...extra, resolved: extra.dish }
          : { ...extra, resolved: fallback?.name || null, resolved_component_id: fallback?.component_id || null, portion_level: 1 };
        if (!extraJudge.ok) notes.push(() => t(`加菜「${extra.dish}」未成立，已改為「${fallback?.name || "預設菜"}」`, `Add-on ${dishEn(extra.dish)} didn't make it — you'll get ${fallback?.name ? dishEn(fallback.name) : "the default side"}`));
      } else {
        extraSide = { ...extra, resolved: backupUsedFor != null ? extra.dish : null, used_for_slot: backupUsedFor };
      }
    }
    if (notes.length > 0) failedWishes.set(lock.buyer_uid, [...(failedWishes.get(lock.buyer_uid) || []), ...notes]);
    lock.slots = slots;
    lock.extra_side = extraSide;
    batch.update(lock.ref, { slots, extra_side: extraSide, cutoff_done: true });
  }

  const portions = componentPortions(locks, catalog.itemsById, catalog.componentsById, config);
  const needs = rawNeeds(portions, catalog.componentsById, catalog.ingredientsById);
  // The timeline is worked backwards separately from each meal period's pickup start time
  const periodRanges = vendorPeriodRanges(vendor, config);
  const timelines = {};
  for (const period of MEAL_PERIODS) {
    const periodLocks = locks.filter((l) => (l.meal_period || mealPeriodOf(l.pickup_window, config)) === period);
    if (periodLocks.length === 0) continue;
    // A period the vendor has since removed from its settings still has locks: span them by their own pickup slots (same as lockPeriodRangesOn)
    if (!periodRanges[period]) {
      const windows = periodLocks.map((l) => l.pickup_window).filter(Boolean);
      if (windows.length === 0) continue;
      periodRanges[period] = rangeOf(windows);
    }
    const periodPortions = componentPortions(periodLocks, catalog.itemsById, catalog.componentsById, config);
    timelines[period] = { ...buildTimeline(periodPortions, catalog.componentsById, splitWindow(periodRanges[period]).start), range: periodRanges[period], order_count: periodLocks.length };
  }
  const firstPeriod = MEAL_PERIODS.find((p) => timelines[p]);
  const range = firstPeriod ? periodRanges[firstPeriod] : Object.values(periodRanges)[0] || "";
  const timeline = firstPeriod ? timelines[firstPeriod] : buildTimeline(portions, catalog.componentsById, splitWindow(range).start);
  const labels = buildLabels(locks, catalog.itemsById);
  const shortages = await shortageFor(vendor.id, date, needs, catalog.ingredientsById);
  const componentList = [...portions].map(([id, n]) => ({
    component_id: id, name: catalog.componentsById[id]?.name || id, portions: Math.round(n * 100) / 100,
  })).sort((a, b) => b.portions - a.portions);
  const itemCounts = {};
  for (const lock of locks) itemCounts[lock.menu_item_id || lock.item_name] = (itemCounts[lock.menu_item_id || lock.item_name] || 0) + 1;

  batch.set(planRef, {
    date,
    week: mondayOf(date),
    pickup_range: range,
    order_count: locks.length,
    item_counts: itemCounts,
    components: componentList,
    raw_needs: Object.fromEntries([...needs].map(([k, v]) => [k, Math.round(v * 10) / 10])),
    timeline,
    timelines,
    period_ranges: periodRanges,
    labels,
    shortages,
    wish_results: wishResults,
    done: existing.exists ? existing.data().done || {} : {},
    locked_at: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  for (const [uid, notes] of failedWishes) {
    await notifyUser(uid, () => ({
      kind: "wish",
      title: t("配菜許願未成立", "Side-dish wish didn't make it"),
      body: t(`${date}：${notes.map((n) => n()).join("；")}。訂單照常成立。`, `${date}: ${notes.map((n) => n()).join("; ")}. Your order still stands.`),
      link: "/my-bookings",
    }));
  }
  await notifyVendor(vendor.id, () => ({
    title: t(`${date} 備料清單已產生`, `Prep list for ${date} is ready`),
    body: t(`共 ${locks.length} 份${shortages.length ? `，有 ${shortages.length} 項缺料需臨時補貨` : ""}`, `${locks.length} meals${shortages.length ? `, ${shortages.length} shortages` : ""}`),
    link: "/vendor-portal/prep",
  }));
  return { order_count: locks.length, shortages: shortages.length };
}

/** Every 10 minutes, per vendor: cut off when tomorrow's (or the next pickup date's) cut-off time arrives */
exports.lockOrders = onSchedule({ schedule: "every 10 minutes", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const config = await loadPlatformConfig(db());
  const today = taipeiToday();
  await forEachVendor("lockOrders", async (vendor) => {
    // Today and tomorrow: today is usually cut off last night; catch up if a run was missed
    for (const date of [today, addDays(today, 1)]) {
      if (!config.businessWeekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) continue;
      if (isPastCutoff(date, vendor, config)) await runLockOrders(vendor, date);
    }
  });
});

/** Manual cut-off (demo / missed runs); can force a recompute */
exports.triggerLockOrdersNow = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const date = request.data?.date || addDays(taipeiToday(), 1);
  const vendor = { id: vendorId, ...(await db().collection("vendors").doc(vendorId).get()).data() };
  return (await runLockOrders(vendor, date, { force: !!request.data?.force })) || { skipped: true };
});

/* ------------------------------------------------------------------ *
 * Pickup reminders (30 minutes before the pickup slot ends)
 * ------------------------------------------------------------------ */

/** Locks a vendor still has to serve on a given day; with period, only that meal period */
async function activeLocksOn(vendorId, date, period = null, config = null) {
  const snap = await db().collection("locks").where("vendor_id", "==", vendorId).where("pickup_date", "==", date).get();
  return snap.docs.filter((d) => {
    const lock = d.data();
    if (!ACTIVE_LOCK_STATUSES.includes(lock.status)) return false;
    return !period || (lock.meal_period || mealPeriodOf(lock.pickup_window, config || undefined)) === period;
  });
}

/** Start/end instants of each meal period's pickup slot today for this vendor: [{ period, label, start, end }] (breakfast, lunch and dinner computed separately) */
function periodRangesOn(vendor, date, config) {
  return Object.entries(vendorPeriodRanges(vendor, config || undefined)).map(([period, range]) => {
    const { start, end } = splitWindow(range);
    return { period, label: mealPeriodLabel(period), start: at(date, start), end: at(date, end), endText: end };
  });
}

/**
 * periodRangesOn plus meal periods that only exist in the day's active locks (2026-10-13: a vendor that dropped dinner slots
 * still had dinner locks, which never got reminders or charity conversion); those periods span the locks' own pickup slots.
 * Charity locks count too, so closeCharity still sees the period after convertToCharity has moved its locks out of active
 */
async function lockPeriodRangesOn(vendor, date, config) {
  const ranges = periodRangesOn(vendor, date, config);
  const known = new Set(ranges.map((r) => r.period));
  const extra = {};
  const snap = await db().collection("locks").where("vendor_id", "==", vendor.id).where("pickup_date", "==", date).get();
  for (const doc of snap.docs) {
    const lock = doc.data();
    if (!lock.pickup_window || !(ACTIVE_LOCK_STATUSES.includes(lock.status) || lock.status === "charity")) continue;
    const period = lock.meal_period || mealPeriodOf(lock.pickup_window, config || undefined);
    if (!known.has(period)) (extra[period] = extra[period] || []).push(splitWindow(lock.pickup_window));
  }
  for (const [period, windows] of Object.entries(extra)) {
    const start = windows.map((w) => w.start).sort()[0];
    const end = windows.map((w) => w.end).sort().pop();
    ranges.push({ period, label: mealPeriodLabel(period), start: at(date, start), end: at(date, end), endText: end });
  }
  return ranges;
}

/** Start/end instants of the meal period a pickup slot belongs to (used to judge donations and charity conversions) */
function todayRange(vendor, date, window = null, config = null) {
  const ranges = periodRangesOn(vendor, date, config);
  const period = window ? mealPeriodOf(window, config || undefined) : null;
  const hit = ranges.find((r) => r.period === period) || ranges[ranges.length - 1];
  return { start: hit.start, end: hit.end, period: hit.period };
}

exports.pickupReminder = onSchedule({ schedule: "every 5 minutes", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const today = taipeiToday();
  const config = await loadPlatformConfig(db());
  await forEachVendor("pickupReminder", async (vendor) => {
    for (const { period, end, endText } of await lockPeriodRangesOn(vendor, today, config)) {
      const minutesLeft = (end.getTime() - Date.now()) / 60000;
      if (minutesLeft > 30 || minutesLeft < 0) continue;
      const planRef = db().collection("vendors").doc(vendor.id).collection("prepPlans").doc(today);
      const plan = await planRef.get();
      const flag = `reminder_sent_${period}`;
      if (plan.exists && (plan.data()[flag] || (period === "lunch" && plan.data().reminder_sent))) continue;
      await planRef.set({ [flag]: true }, { merge: true });
      const endsAt = endText;
      for (const doc of await activeLocksOn(vendor.id, today, period, config)) {
        const lock = doc.data();
        // Schedules aren't inside a request, so the language follows the recipient's users.lang
        const lang = (await db().collection("users").doc(lock.buyer_uid).get()).data()?.lang;
        await inLang(lang, () => notifyUser(lock.buyer_uid, {
          kind: "pickup",
          title: t("還沒取餐喔", "You haven't picked up yet"),
          body: t(`「${lock.item_name}」取餐到 ${endsAt}，來不了可以按「捐為愛心餐」。`, `${lock.item_name_en || lock.item_name} — pickup ends at ${endsAt}. Can't make it? Tap "Donate" to give it to someone in need.`),
          link: "/my-bookings",
        }));
      }
    }
  });
});

module.exports.helpers = {
  cancelAndRefund, activeLocksOn, todayRange, periodRangesOn, lockPeriodRangesOn, runLockOrders, sideWishId, taipeiTime,
  resalePriceOf, resaleCapOf,
};

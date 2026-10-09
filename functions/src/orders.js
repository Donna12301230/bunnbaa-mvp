// 訂單（沿用 locks）生命週期：下單計價 → LINE Pay → 截單判定許願 → QR 取餐。
// 規格 §4、§6；保留既有「鎖定早鳥折扣＋轉讓」（使用者 2026-09-30 決定）。
//
// locks 新增欄位：
//   menu_item_id, slots[{ category, default_dish, default_component_id, removed, wished,
//     wished_component_id, candidate_index, resolved, portion_level }], rice: add|normal|less
//   list_price（品項原價）, adjust_amount（加減）, early_bird_amount, coupon_discount,
//   locked_price（實付）, coupon_id, payer_uid（付款人，抽獎券歸他；付費接手後換成接手者）
//   paid_amount（payer 在 transaction_id 實付的金額，退款以它為準；免費領取把 locked_price 改 0 也不動它）
//   resale_hold{ uid, intent_id, expires_at }（有人正在付款接手）, transfers[]（付費接手紀錄）
//   payment_intent_id, transaction_id, pickup_code（4 碼）, phone_last3, qr_nonce, share_token
//   cutoff_done（截單已判定）, charity_source: noshow|donated
// 狀態：locked → for_resale / for_gift → fulfilled / resold_and_fulfilled / charity / cancelled
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
  cancelDeadlineAt, cancelCouponAmount, mealPeriodOf, mealPeriodLabel, vendorPeriodRanges, MEAL_PERIODS,
} = require("./pricing");
const { isBento, resolveChoices, resolveMain, resolveExtraSide, resolveCustomPicks, adjustAmount, RICE_OPTIONS } = require("./bento");
const { ACTIVE_LOCK_STATUSES, componentPortions, rawNeeds, buildTimeline, buildLabels } = require("./prep");
const { taipeiToday, taipeiTime, addDays, mondayOf, at, splitWindow } = require("./calendar");
const { recordMatchedClaim } = require("./resaleMatch").helpers;

const APP_BASE_URL = () => process.env.APP_BASE_URL || "https://bunnbaa-mvp-5474.web.app";
const MAX_CART_UNITS = 50;

// Repeated no-shows used to set users/{uid}.orderBanned (舊制，現在未取餐改轉愛心餐、
// 不再停權)；舊資料被停權的帳號仍擋下單，申訴核准後解除。
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

/** 候選菜本週已許願份數（週供應上限用） */
async function weeklyWishCount(vendorId, week, itemId, slot, candidate) {
  const snap = await db().collection("sideWishes")
    .where("vendor_id", "==", vendorId).where("week", "==", week).get();
  return snap.docs
    .map((d) => d.data())
    .filter((d) => d.item_id === itemId && d.slot === slot && d.candidate === candidate)
    .reduce((s, d) => s + (d.count || 0), 0);
}

/** 可用的折價券：本人持有、同一家店、未過期 */
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
 * 驗證並展開一份便當的選擇（主菜、飯量、配菜、第四道、店家自訂欄位），下單與截單前修改共用。
 * 回傳 { rice, resolved, extra, custom, main, listPrice, adjust }；不合法丟 HttpsError。
 * keptCustom：截單前修改沒動自訂欄位時，直接沿用訂單上記錄的選擇與金額（店家之後刪改選項也不影響舊訂單）。
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

/** 這份便當的許願：每格選的候選菜＋第四道（候選菜）。sideWishes 計數、週上限都用這份 */
function wishedEntries(slots, extra) {
  const out = [];
  (slots || []).forEach((slot, slotIdx) => {
    if (slot.wished != null) out.push({ slot: slotIdx, candidate: slot.candidate_index, dish: slot.wished });
  });
  if (extra?.wished && extra.candidate_index != null) out.push({ slot: extra.slot, candidate: extra.candidate_index, dish: extra.dish });
  return out;
}

/** sideWishes 計數 ±delta（下單 +1、取消／修改 −1） */
function bumpWishes(batch, lock, delta) {
  for (const w of wishedEntries(lock.slots, lock.extra_side)) {
    batch.set(db().collection("sideWishes").doc(sideWishId(lock.vendor_id, lock.pickup_date, lock.menu_item_id, w.slot, w.candidate)), {
      vendor_id: lock.vendor_id, date: lock.pickup_date, week: mondayOf(lock.pickup_date), item_id: lock.menu_item_id,
      slot: w.slot, candidate: w.candidate, dish: w.dish, count: FieldValue.increment(delta),
    }, { merge: true });
  }
}

/**
 * 購物車一行 → 一份（或多份）鎖定草稿。價格：
 *   (品項原價 × 早鳥折數) ＋ 加減金額 − 折價券（每筆限一張，折抵 ≤ 小計）
 */
async function buildDrafts(line, ctx) {
  const quantity = Number.isInteger(line?.quantity) && line.quantity > 0 ? line.quantity : 1;
  const item = await loadOrderableMenuItem(line?.menu_item_id);
  const vendor = await loadVendor(item.vendor_id, ctx.vendorCache);
  if (ctx.vendorId && ctx.vendorId !== vendor.id) {
    throw new HttpsError("invalid-argument", t("一次只能跟一家商家預購", "One vendor per checkout"));
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

  // 候選菜週供應上限（§4.3）；第四道選候選菜也算
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

/** 建立付款意圖；金額為 0（折價券全額折抵）時不經 LINE Pay，確認頁直接建立鎖定 */
async function reserve(request, drafts, productName) {
  const amount = drafts.reduce((s, d) => s + d.locked_price, 0);
  const intentRef = db().collection("payment_intents").doc();
  const orderId = intentRef.id;
  let transactionId = null;
  let paymentUrl = `${APP_BASE_URL()}/#/payment/confirm/${orderId}`;
  if (amount > 0) {
    // LINE Pay 的 products 金額加總要等於 amount；同價的合併成一行
    const byPrice = new Map();
    for (const d of drafts) {
      const key = `${productName(d)}|${d.locked_price}`;
      const p = byPrice.get(key) ?? { name: productName(d), quantity: 0, price: d.locked_price };
      p.quantity += 1;
      byPrice.set(key, p);
    }
    const products = [...byPrice.values()].filter((p) => p.price > 0);
    let info;
    try {
      // orderId goes in the path, not a query string: LINE Pay appends
      // ?transactionId=... by plain string concatenation (see App.tsx).
      info = await requestPayment({
        orderId, amount, products,
        confirmUrl: `${APP_BASE_URL()}/#/payment/confirm/${orderId}`,
        cancelUrl: `${APP_BASE_URL()}/#/payment/cancel/${orderId}`,
      });
    } catch (err) {
      logger.error("LINE Pay request failed", err);
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
    lock_drafts: drafts,
    created_at: FieldValue.serverTimestamp(),
  });
  return { order_id: orderId, payment_url: paymentUrl, free: amount === 0 };
}

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
 * 購物車結帳。lines: [{ menu_item_id, pickup_date, pickup_window, slots:[{choice}], rice,
 * quantity, note, coupon_id }]。一行可以是不同取餐日（預訂到下週五）。
 */
exports.createCartLinePayReservation = onCall({}, async (request) => {
  assertSignedInUser(request, "結帳");
  await assertNotBanned(request.auth.uid);
  const lines = request.data?.lines ?? request.data?.items;
  if (!Array.isArray(lines) || lines.length === 0) throw new HttpsError("invalid-argument", "lines must be a non-empty array");
  const ctx = await newContext(request);
  // 舊版購物車只送 pickup_date/window 在外層
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
 * 計畫型（多日方案，§4.4）：同一時段連續 N 個營業日（遇公休順延）。每一天是獨立的 locks，
 * 早鳥依各自天數計算（方案價 price_per_meal 當原價）；之後可在「我的餐點」個別改時段。
 * preview=true 只回傳每天日期與價格（確認視窗用），不建立付款。
 */
exports.createPlanLinePayReservation = onCall({}, async (request) => {
  assertSignedInUser(request, "加入計畫");
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

/** 4 碼取餐號，同一家店同一天不重複（§6.2 備援核對） */
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
  assertSignedInUser(request, "確認付款");
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

  // 1) 在交易內預留份數、鎖住折價券，並把意圖改成 confirming（避免重複確認）。還沒扣款。
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
  if (outcome === "sold_out") throw new HttpsError("resource-exhausted", soldOutDuringPayment());
  if (outcome === "coupon_gone") throw new HttpsError("failed-precondition", couponGoneDuringPayment());

  // 2) 扣款；失敗就把份數、折價券還回去，讓買家可以重試同一筆
  if (intent.amount > 0) {
    try {
      await confirmPayment({ transactionId: intent.transaction_id, amount: intent.amount });
    } catch (err) {
      logger.error("LINE Pay confirm failed", err);
      const rollback = db().batch();
      slots.forEach((g, i) => rollback.update(counterRefs[i], { count: FieldValue.increment(-g.count) }));
      couponIds.forEach((id) => rollback.update(db().collection("coupons").doc(id), {
        status: "owned", lock_id: FieldValue.delete(), redeemed_at: FieldValue.delete(),
      }));
      rollback.update(intentRef, { status: "pending" });
      await rollback.commit().catch((e) => logger.error("Rollback failed", e));
      throw new HttpsError("internal", t("LINE Pay 付款確認失敗，請稍後再試或聯絡客服", "LINE Pay couldn't confirm the payment. Please try again later."));
    }
  }

  // 3) 建立鎖定、候選菜許願計數
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
 * 截單前取消／修改；取餐時段內捐為愛心餐
 * ------------------------------------------------------------------ */

/** 付款人在這筆交易實付的金額；舊資料沒有 paid_amount 就用 locked_price */
function paidAmountOf(lock) {
  return Number.isFinite(lock.paid_amount) ? lock.paid_amount : lock.locked_price || 0;
}

async function refundLockMoney(lock) {
  const amount = paidAmountOf(lock);
  if (!(amount > 0) || !lock.transaction_id) return;
  await refundPayment({ transactionId: lock.transaction_id, refundAmount: amount });
}

/**
 * 取消並全額退款（停班停課自動退款用；消費者自己取消改走 cancelForCoupon 發折價券）。
 * 折價券退回並保留原到期日，已過期則不退；份數與許願計數扣回。
 */
async function cancelAndRefund(lockRef, reason) {
  const snap = await lockRef.get();
  const lock = snap.data();
  if (!ACTIVE_LOCK_STATUSES.includes(lock.status)) return false;
  // 先標記避免重複退款，退款失敗再還原
  await lockRef.update({ status: "cancelling" });
  try {
    await refundLockMoney(lock);
  } catch (err) {
    await lockRef.update({ status: lock.status });
    throw err;
  }
  const batch = db().batch();
  batch.update(lockRef, {
    status: "cancelled", cancel_reason: reason, refunded_amount: paidAmountOf(lock), cancelled_at: FieldValue.serverTimestamp(),
  });
  if (lock.coupon_id) {
    const couponRef = db().collection("coupons").doc(lock.coupon_id);
    const coupon = (await couponRef.get()).data();
    const expired = coupon?.expires_at?.toMillis?.() <= Date.now();
    batch.update(couponRef, expired
      ? { status: "expired", lock_id: FieldValue.delete() }
      : { status: "owned", lock_id: FieldValue.delete(), redeemed_at: FieldValue.delete() });
  }
  batch.set(slotCounterRef(lock.vendor_id, lock.pickup_date, lock.pickup_window), { count: FieldValue.increment(-1) }, { merge: true });
  bumpWishes(batch, lock, -1);
  await batch.commit();
  return true;
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
  assertSignedInUser(request, "取消訂單");
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
 * 消費者取消（2026-10-05 改版）：不退現金，改發一張本店折價券（原價 30%、效期 couponValidDays 天）。
 * 款項留在店家（kept_amount）；下單時用掉的折價券照舊退回（已過期不退），份數與許願計數扣回。
 * 整段在交易內，連按兩次只會發一張。停班停課等非消費者因素的取消仍走 cancelAndRefund 全額退款。
 * 這張券能不能跟其他折扣疊加還沒定案（doc/TODO.md）：目前跟一般折價券一樣，每份餐點限用一張、早鳥照算。
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
        vendor_id: lock.vendor_id, vendor_name: vendor.name || "", tier: "refund", label: "取消退款券", discount: amount,
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
 * 轉讓市集付費接手（規格 §4.1：接手者付款後成為新持有人）
 * 接手者付「轉讓價」給 LINE Pay：轉讓人上架時自訂（locks.resale_price，0 ～ 原價），沒填就是早鳥價（折價券前）。
 * 成功後原付款人自動退款，金額＝他實付與轉讓價取小的（LINE Pay 退款不能超過原付款額）：
 *   - 賣得比實付低：差額由轉讓人吸收；賣得比實付高：多的留在店家，轉讓人不會因此獲利。
 * 同一份餐店家至少收到原本那筆錢，只是付錢的人換了。原付款人用掉的折價券不退回。
 * 抽獎券跟著真正付錢的人走：接手後 payer_uid 換成接手者。
 * 逾時沒人接手仍照 firestore.rules 開放 $0 免費領取（原付款人不退款）。
 * ------------------------------------------------------------------ */

const RESALE_HOLD_MS = 15 * 60 * 1000;

/** 預設接手價＝早鳥價＋加減（折價券前）；舊資料沒有拆欄位就用實付＋券折抵 */
function defaultResalePriceOf(lock) {
  if (Number.isFinite(lock.list_price) && Number.isFinite(lock.early_bird_amount)) {
    return Math.max(0, lock.list_price - lock.early_bird_amount + (lock.adjust_amount || 0));
  }
  return Math.max(0, (lock.locked_price || 0) + (lock.coupon_discount || 0));
}

/** 轉讓價上限＝原價（品項原價＋加減項，不含早鳥折扣）；舊資料沒有原價就用預設接手價 */
function resaleCapOf(lock) {
  return Number.isFinite(lock.list_price) ? Math.max(0, lock.list_price + (lock.adjust_amount || 0)) : defaultResalePriceOf(lock);
}

/** 接手價：轉讓人自訂的 resale_price（夾在 0 ～ 原價），沒填用預設接手價。web/src/lib/transfers.ts 同一套 */
function resalePriceOf(lock) {
  if (Number.isInteger(lock.resale_price) && lock.resale_price >= 0) return Math.min(lock.resale_price, resaleCapOf(lock));
  return defaultResalePriceOf(lock);
}

const millisOf = (ts) => (ts && typeof ts.toMillis === "function" ? ts.toMillis() : 0);

/** 這份還能不能由 uid 付款接手；回傳錯誤訊息或 null */
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

/** 「我要接手」：先保留這份 15 分鐘，再向 LINE Pay 請款（0 元直接到確認頁） */
exports.createResaleLinePayReservation = onCall({}, async (request) => {
  assertSignedInUser(request, "接手轉讓");
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

  const amount = resalePriceOf(lock);
  let transactionId = null;
  let paymentUrl = `${APP_BASE_URL()}/#/payment/confirm/${orderId}`;
  if (amount > 0) {
    try {
      const info = await requestPayment({
        orderId, amount,
        products: [{ name: t(`接手：${lock.item_name}`, `Take over: ${lock.item_name_en || lock.item_name}`), quantity: 1, price: amount }],
        confirmUrl: `${APP_BASE_URL()}/#/payment/confirm/${orderId}`,
        cancelUrl: `${APP_BASE_URL()}/#/payment/cancel/${orderId}`,
      });
      transactionId = String(info.transactionId);
      paymentUrl = info.paymentUrl.web;
    } catch (err) {
      logger.error("LINE Pay request failed (resale)", err);
      await lockRef.update({ resale_hold: FieldValue.delete() }).catch(() => {});
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
    created_at: FieldValue.serverTimestamp(),
  });
  return { order_id: orderId, payment_url: paymentUrl, free: amount === 0, amount };
});

/** confirmLinePayPayment 的接手分支：先換人（賣家就不能再取消轉讓）→ 扣款 → 退款給原付款人 */
async function confirmResale(request, intentRef, intent) {
  const orderId = intentRef.id;
  const lockRef = db().collection("locks").doc(intent.lock_id);
  const uid = request.auth.uid;

  // 1) 交易內檢查還能接手，先把持有人換成接手者並標記「付款中」；還沒扣款
  const prev = await db().runTransaction(async (tx) => {
    const fresh = (await tx.get(intentRef)).data();
    if (fresh.status !== "pending") {
      throw new HttpsError("failed-precondition", t("這筆付款正在處理中，請稍候重新整理", "This payment is still being processed."));
    }
    const lock = (await tx.get(lockRef)).data();
    // 自己的保留過期了但沒人搶，照樣可以接手；別人正在付款（保留未過期）就不行
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
  if (prev.gone) throw new HttpsError("failed-precondition", prev.gone);

  // 2) 扣款；失敗就把餐點還給賣家、意圖回 pending，接手者可以重試
  if (intent.amount > 0) {
    try {
      await confirmPayment({ transactionId: intent.transaction_id, amount: intent.amount });
    } catch (err) {
      logger.error("LINE Pay confirm failed (resale)", err);
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

  // 3) 接手者成為付款人；換掉代領連結與 QR，原持有人手上的截圖立即失效
  const lock = (await lockRef.get()).data();
  // 退給原付款人的金額：實付與轉讓價取小的（自訂轉讓價可能低於或高於他實付）
  const refundAmount = prev.transaction_id ? Math.min(prev.paid_amount, intent.amount) : 0;
  const batch = db().batch();
  batch.update(lockRef, {
    payer_uid: uid,
    transaction_id: intent.transaction_id,
    payment_intent_id: orderId,
    paid_amount: intent.amount,
    locked_price: intent.amount,
    coupon_id: null,
    coupon_discount: 0,
    share_token: crypto.randomBytes(12).toString("hex"),
    qr_nonce: FieldValue.delete(),
    resale_payment_pending: FieldValue.delete(),
    transfers: FieldValue.arrayUnion({
      intent_id: orderId, from_uid: prev.buyer_uid, to_uid: uid, price: intent.amount,
      refund_uid: prev.payer_uid, refund_amount: refundAmount, at: Timestamp.now(),
    }),
  });
  batch.delete(db().collection("lock_tokens").doc(intent.lock_id)); // 原持有人的取餐提醒
  batch.update(intentRef, { status: "confirmed", lock_ids: [intent.lock_id] });
  await batch.commit();

  // 4) 退款給原付款人。扣款已成功、餐點已換人，退款失敗不回滾，記下來讓管理員補退
  let refundStatus = "none";
  if (refundAmount > 0) {
    try {
      await refundPayment({ transactionId: prev.transaction_id, refundAmount });
      refundStatus = "done";
    } catch (err) {
      logger.error(`resale refund failed for lock ${intent.lock_id}`, err);
      refundStatus = "failed";
    }
  }
  await lockRef.update({
    transfer_refund: { intent_id: orderId, uid: prev.payer_uid, amount: refundAmount, transaction_id: prev.transaction_id, status: refundStatus, at: Timestamp.now() },
  });
  await notifyUser(prev.buyer_uid, {
    kind: "transfer",
    title: t("你轉讓的餐點已被接手", "Your listed meal was taken over"),
    body: refundStatus === "done" && prev.payer_uid === prev.buyer_uid
      ? t(`「${lock.item_name}」已由別人付款接手，NT$ ${refundAmount} 已退回原付款方式。`, `${lock.item_name} was taken over; NT$ ${refundAmount} is on its way back to you.`)
      : t(`「${lock.item_name}」已由別人付款接手。`, `${lock.item_name} was taken over.`),
    link: "/my-bookings",
  }).catch((err) => logger.warn("notify seller failed", err));
  // 贈送或免費領取來的餐點再轉讓：錢退給當初真正付款的人
  if (refundStatus === "done" && prev.payer_uid !== prev.buyer_uid) {
    await notifyUser(prev.payer_uid, {
      kind: "transfer",
      title: t("餐點款項已退回", "Your payment was refunded"),
      body: t(`你付款的「${lock.item_name}」已由別人付款接手，NT$ ${refundAmount} 已退回原付款方式。`, `Someone paid for ${lock.item_name}; NT$ ${refundAmount} is on its way back to you.`),
      link: "/my-bookings",
    }).catch((err) => logger.warn("notify payer failed", err));
  }
  // AI 轉讓媒合的影響指標：接手的人是不是被通知的會員（失敗不影響接手）
  await recordMatchedClaim(intent.lock_id, uid).catch((err) => logger.warn(`recordMatchedClaim ${intent.lock_id}`, err));
  return { lock_ids: [intent.lock_id], kind: "resale", refund_status: refundStatus };
}

/** 鎖定目前的選擇 → resolveOrderChoices 吃的格式（沒送的欄位沿用原本的） */
function currentChoices(lock) {
  return {
    rice: lock.rice || "normal",
    main_index: lock.main_index ?? null,
    slots: (lock.slots || []).map((s) => ({ choice: s.removed ? "none" : s.wished != null ? s.candidate_index : "default" })),
    extra_side: lock.extra_side ? { slot: lock.extra_side.slot, candidate: lock.extra_side.candidate_index, mode: lock.extra_side.mode } : null,
  };
}

/**
 * 截單前修改（§4.1）：主菜、配菜、飯量、第四道與取餐時段（同一天）。
 * 金額以下單時的早鳥折數重算：變便宜就退差額（LINE Pay 部分退款）；變貴要補差額，
 * 第一階段請取消後重訂。計畫的每一天也用這支改時段。
 */
exports.updateLockChoices = onCall({}, async (request) => {
  assertSignedInUser(request, "修改訂單");
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

  // 取餐時段
  const newWindow = typeof data.pickup_window === "string" && data.pickup_window ? data.pickup_window : lock.pickup_window;
  if (newWindow !== lock.pickup_window) {
    const problem = validatePickup(lock.pickup_date, newWindow, vendor, config, new Date(), item);
    if (problem) throw new HttpsError("invalid-argument", problem);
  }

  // 便當內容（計畫的每日餐點沒有選項，只能改時段）
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
        `這樣改要補 NT$ ${newLocked - lock.locked_price}，第一階段請取消後重新下單`,
        `This change costs NT$ ${newLocked - lock.locked_price} more — please cancel and re-order`
      ));
    }
    Object.assign(patch, {
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

  const refund = lock.locked_price - newLocked;
  if (refund > 0 && lock.transaction_id) {
    try {
      await refundPayment({ transactionId: lock.transaction_id, refundAmount: refund });
    } catch (err) {
      logger.error("partial refund failed", err);
      throw new HttpsError("internal", t("退差額失敗，請稍後再試", "Refunding the difference failed. Please try again later."));
    }
    patch.refunded_amount = (lock.refunded_amount || 0) + refund;
    patch.paid_amount = paidAmountOf(lock) - refund;
  }

  // 換時段要搬份數（有上限的店家先檢查新時段還有沒有位子）
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
 * QR 取餐（§6）：伺服器簽章一次性憑證（id + 到期 + nonce + HMAC）
 * ------------------------------------------------------------------ */

const QR_TTL_MS = 10 * 60 * 1000;

function qrSecret() {
  const secret = process.env.PICKUP_QR_SECRET;
  if (secret) return secret;
  if (isEmulator()) return "local-dev-secret";
  // 沒設就用固定字串會讓偽造變容易；正式環境一定要設
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
 * 產生取餐 QR。持有人本人，或拿到代領連結（share_token）的人都可以。
 * 每次產生都換 nonce，舊截圖立即失效。愛心餐預約（kind=R）也走這裡。
 */
// 代領碼（2026-10-09）：代領連結點開常被要求登入、登入後又跳走，改成可以輸入的 8 碼代領碼。
// 存在 proxyCodes/{code}（規則全擋，只有 Admin SDK 讀寫；不能放在 locks 上——轉讓中／贈送中的 locks 是公開可讀的），
// 記下產生當時的 share_token：轉讓／贈送接手會換 share_token，舊代領碼跟舊連結一起失效。
// 字母表去掉容易看錯的 0/O、1/I/L。
const PROXY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const PROXY_CODE_LENGTH = 8;

function normalizeProxyCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function randomProxyCode() {
  const bytes = crypto.randomBytes(PROXY_CODE_LENGTH);
  return Array.from(bytes, (b) => PROXY_CODE_ALPHABET[b % PROXY_CODE_ALPHABET.length]).join("");
}

/** 持有人取得（或第一次產生）這份餐點的代領碼 */
exports.getProxyPickupCode = onCall({}, async (request) => {
  assertSignedInUser(request, "產生代領碼");
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
      if (err.code !== 6) throw err; // 6 = ALREADY_EXISTS：撞碼就換一組
    }
  }
  throw new HttpsError("internal", t("代領碼產生失敗，請再試一次", "Couldn't create a proxy code. Please try again."));
});

exports.issuePickupQr = onCall({}, async (request) => {
  const { share_token: shareToken, reservation_id: reservationId, proxy_code: proxyCode } = request.data || {};
  let { lock_id: lockId } = request.data || {};
  const nonce = crypto.randomBytes(6).toString("hex");
  if (reservationId) {
    assertSignedInUser(request, "領取愛心餐");
    const ref = db().collection("charityReservations").doc(reservationId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().user_id !== request.auth.uid) throw new HttpsError("permission-denied", t("找不到這筆預約", "Reservation not found"));
    if (snap.data().status !== "reserved") throw new HttpsError("failed-precondition", t("這筆預約已結束", "This reservation has ended"));
    await ref.update({ qr_nonce: nonce });
    return { token: makeQrToken("R", reservationId, nonce), expires_in: QR_TTL_MS / 1000 };
  }
  let codeToken = null;
  if (proxyCode != null) {
    // 代領碼不用登入；碼錯、已轉手一律同一句話，不透露訂單存不存在
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
  // 代領只限沒在轉讓／贈送的餐點：for_resale／for_gift 的 locks 公開可讀（含 share_token），不能拿來代領
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
    // 代領畫面要顯示是哪一份、哪家店（不含任何持有人個資）
    ...(proxy && !owner ? { item_name_en: lock.item_name_en || null, vendor_id: lock.vendor_id } : {}),
  };
});

function lockSummary(id, lock, extra = {}) {
  return {
    kind: "lock",
    lock_id: id,
    pickup_code: lock.pickup_code,
    item_name: lock.item_name,
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
 * 店家掃碼（或備援：4 碼取餐號＋手機末三碼）確認取餐。只有該店店主／管理員能核銷。
 * preview=true 只回傳內容不核銷（畫面先顯示再按「完成取餐」）。
 */
exports.completePickup = onCall({}, async (request) => {
  const { token, pickup_code: code, phone_last3: last3, preview, vendor_id: requestedVendor, lock_id: lockId } = request.data || {};
  const vendorId = await callerVendorId(request, requestedVendor);
  const today = taipeiToday();

  // 店家在今日訂單列表當面核對後直接按「確認取餐」（只限本店、今天的單）
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
    // 轉讓過的餐點：免費領取／贈送（付款人還是原訂購人）或付費接手（transfers 有紀錄、付款人已換成接手者）
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
    const summary = { kind: "charity", reservation_id: parsed.id, pickup_code: meal?.pickup_code, item_name: meal?.item_name, sides: meal?.sides || [] };
    if (preview) return summary;
    tx.update(resRef, { status: "claimed", claimed_at: FieldValue.serverTimestamp(), qr_nonce: FieldValue.delete() });
    tx.update(mealRef, { status: "claimed", claimed_at: FieldValue.serverTimestamp() });
    return { ...summary, completed: true };
  });
}

/* ------------------------------------------------------------------ *
 * 截單（§4.3、§5.4）：判定候選菜許願、產生每日備料與出餐標籤、缺料警示
 * ------------------------------------------------------------------ */

/**
 * 截單後的當日需求 vs 本週理論庫存 → 缺料清單。
 * 期初庫存＝上週六的盤點（記在 inventory/{上週一}，跟 purchasing.js currentStock 同一個語意）；
 * 沒盤點就用本週叫貨單產生時採用的庫存（lines[].stock）。再加本週到貨、扣掉這天之前的備料用量。
 * web/src/hooks/useStockOnHand.ts 用同一套算法，要一起改。
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
 * 截單並產生 prepPlans/{date}。冪等：prepPlans 已有 locked_at 就跳過（以日期為鍵）。
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

  // 判定許願（§4.3）：達最低量者拿到許願菜；未達者有備案換備案，沒有則換回預設菜並通知（預設菜照做）
  const batch = db().batch();
  const failedWishes = new Map(); // uid -> [message]
  const wishResults = {};
  const judge = (item, slotIdx, candIdx, dish) => {
    const key = sideWishId(vendor.id, date, item?.id, slotIdx, candIdx);
    const cand = item?.slots?.[slotIdx]?.candidates?.[candIdx];
    const minQty = Number(cand?.min_qty) > 0 ? Number(cand.min_qty) : minDefault;
    const count = wishCounts.get(key) || 0;
    // 候選菜被停用（天災、菜價暴漲不得列為候選）＝沒供應
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
    const notes = [];
    const slots = (lock.slots || []).map((slot, slotIdx) => {
      if (slot.removed) return slot;
      if (slot.wished == null) return { ...slot, resolved: slot.default_dish };
      const { ok, count, minQty, cand } = judge(item, slotIdx, slot.candidate_index, slot.wished);
      // 份量級距以截單當下的品項設定為準（菜價變動後會重算，§11），截單後鎖定
      if (ok) return { ...slot, resolved: slot.wished, portion_level: cand?.portion_level ?? slot.portion_level ?? 1 };
      const short = Math.max(0, minQty - count);
      if (backupFree) {
        backupFree = false;
        backupUsedFor = slotIdx;
        notes.push(t(`「${slot.wished}」這次差 ${short} 人未成立，已幫你換成備案「${extra.dish}」`, `${slot.wished} was ${short} short — swapped to your backup ${extra.dish}`));
        return { ...slot, resolved: extra.dish, resolved_component_id: extra.component_id || null, backup_used: true, portion_level: extra.portion_level ?? 1 };
      }
      notes.push(t(`「${slot.wished}」這次差 ${short} 人未成立，已幫你換回「${slot.default_dish}」`, `${slot.wished} was ${short} short — swapped back to ${slot.default_dish}`));
      return { ...slot, resolved: slot.default_dish, portion_level: 1 };
    });
    let extraSide = extra;
    if (extra) {
      if (extra.mode === "addon") {
        // 加菜選的候選菜沒成立：改放那一格的預設菜（一樣是第四道，不退價差）
        const fallback = item?.slots?.[extra.slot]?.default;
        extraSide = extraJudge.ok
          ? { ...extra, resolved: extra.dish }
          : { ...extra, resolved: fallback?.name || null, resolved_component_id: fallback?.component_id || null, portion_level: 1 };
        if (!extraJudge.ok) notes.push(t(`加菜「${extra.dish}」未成立，已改為「${fallback?.name || "預設菜"}」`, `Add-on ${extra.dish} didn't make it — you'll get ${fallback?.name || "the default"}`));
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
  // 時間軸依每個餐期的取餐開始時間分別往回推（§5.2）
  const periodRanges = vendorPeriodRanges(vendor, config);
  const timelines = {};
  for (const period of MEAL_PERIODS) {
    const periodLocks = locks.filter((l) => (l.meal_period || mealPeriodOf(l.pickup_window, config)) === period);
    if (periodLocks.length === 0 || !periodRanges[period]) continue;
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
    await notifyUser(uid, {
      kind: "wish",
      title: t("配菜許願未成立", "Side-dish wish didn't make it"),
      body: t(`${date}：${notes.join("；")}。訂單照常成立。`, `${date}: ${notes.join("; ")}. Your order stands.`),
      link: "/my-bookings",
    });
  }
  await notifyVendor(vendor.id, {
    title: t(`${date} 備料清單已產生`, `Prep list for ${date} is ready`),
    body: t(`共 ${locks.length} 份${shortages.length ? `，有 ${shortages.length} 項缺料需臨時補貨` : ""}`, `${locks.length} meals${shortages.length ? `, ${shortages.length} shortages` : ""}`),
    link: "/vendor-portal/prep",
  });
  return { order_count: locks.length, shortages: shortages.length };
}

/** 每 10 分鐘看每家店：明天（或最近的取餐日）截單時間到了就截單 */
exports.lockOrders = onSchedule({ schedule: "every 10 minutes", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const config = await loadPlatformConfig(db());
  const today = taipeiToday();
  await forEachVendor("lockOrders", async (vendor) => {
    // 今天與明天：今天通常在昨晚就截過，漏跑時補做
    for (const date of [today, addDays(today, 1)]) {
      if (!config.businessWeekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) continue;
      if (isPastCutoff(date, vendor, config)) await runLockOrders(vendor, date);
    }
  });
});

/** 手動截單（demo／漏跑時），可強制重算 */
exports.triggerLockOrdersNow = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const date = request.data?.date || addDays(taipeiToday(), 1);
  const vendor = { id: vendorId, ...(await db().collection("vendors").doc(vendorId).get()).data() };
  return (await runLockOrders(vendor, date, { force: !!request.data?.force })) || { skipped: true };
});

/* ------------------------------------------------------------------ *
 * 取餐提醒（取餐時段結束前 30 分）
 * ------------------------------------------------------------------ */

/** 某天、某店還要出餐的鎖定；給 period 就只取那個餐期的 */
async function activeLocksOn(vendorId, date, period = null, config = null) {
  const snap = await db().collection("locks").where("vendor_id", "==", vendorId).where("pickup_date", "==", date).get();
  return snap.docs.filter((d) => {
    const lock = d.data();
    if (!ACTIVE_LOCK_STATUSES.includes(lock.status)) return false;
    return !period || (lock.meal_period || mealPeriodOf(lock.pickup_window, config || undefined)) === period;
  });
}

/** 這家店今天各餐期的取餐時段起訖時間點：[{ period, label, start, end }]（早、中、晚各自計算，§7） */
function periodRangesOn(vendor, date, config) {
  return Object.entries(vendorPeriodRanges(vendor, config || undefined)).map(([period, range]) => {
    const { start, end } = splitWindow(range);
    return { period, label: mealPeriodLabel(period), start: at(date, start), end: at(date, end), endText: end };
  });
}

/** 某個取餐時段所屬餐期的起訖時間點（捐出、轉愛心餐依這個判斷） */
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
    for (const { period, end, endText } of periodRangesOn(vendor, today, config)) {
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
        // 排程不在請求內，依收件人的 users.lang 決定語言
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
  cancelAndRefund, activeLocksOn, todayRange, periodRangesOn, runLockOrders, sideWishId, taipeiTime,
  resalePriceOf, resaleCapOf,
};

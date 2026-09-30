// 訂單（沿用 locks）生命週期：下單計價 → LINE Pay → 截單判定許願 → QR 取餐。
// 規格 §4、§6；保留既有「鎖定早鳥折扣＋轉讓」（使用者 2026-09-30 決定）。
//
// locks 新增欄位：
//   menu_item_id, slots[{ category, default_dish, default_component_id, removed, wished,
//     wished_component_id, candidate_index, resolved, portion_level }], rice: add|normal|less
//   list_price（品項原價）, adjust_amount（加減）, early_bird_amount, coupon_discount,
//   locked_price（實付）, coupon_id, payer_uid（付款人，轉讓後不變，抽獎券歸他）
//   payment_intent_id, transaction_id, pickup_code（4 碼）, phone_last3, qr_nonce, share_token
//   cutoff_done（截單已判定）, charity_source: noshow|donated
// 狀態：locked → for_resale / for_gift → fulfilled / resold_and_fulfilled / charity / cancelled
const crypto = require("crypto");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const {
  REGION, db, onCall, HttpsError, logger, FieldValue, t, isEmulator, assertSignedInUser, assertAdminOrVendorOwner,
  callerVendorId, notifyUser, notifyVendor, loadVendorCatalog, forEachVendor,
} = require("./common");
const { loadPlatformConfig } = require("./config");
const { requestPayment, confirmPayment, refundPayment } = require("./linePay");
const {
  validatePickup, planPickupDates, applyEarlyBirdPrice, vendorSlotCapacity, vendorPickupRange, cutoffAt, isPastCutoff,
} = require("./pricing");
const { isBento, resolveChoices, adjustAmount, RICE_OPTIONS } = require("./bento");
const { ACTIVE_LOCK_STATUSES, componentPortions, rawNeeds, buildTimeline, buildLabels } = require("./prep");
const { taipeiToday, taipeiTime, addDays, mondayOf, at, splitWindow } = require("./calendar");

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
  if (typeof item.price !== "number" || item.price <= 0) {
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
  const problem = validatePickup(pickupDate, pickupWindow, vendor, ctx.config);
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

  const rice = isBento(item) && item.rice_component_id && RICE_OPTIONS.includes(line.rice) ? line.rice : "normal";
  const resolved = resolveChoices(item, line.slots);
  if (resolved.problem) throw new HttpsError("invalid-argument", resolved.problem);
  const adjust = adjustAmount({ rice, removedCount: resolved.removedCount }, ctx.config);

  // 候選菜週供應上限（§4.3）
  const week = mondayOf(pickupDate);
  for (const [slotIdx, slot] of resolved.slots.entries()) {
    if (slot.wished == null) continue;
    const cand = item.slots[slotIdx].candidates[slot.candidate_index];
    if (!(cand.weekly_cap > 0)) continue;
    const key = `${item.id}|${slotIdx}|${slot.candidate_index}|${week}`;
    const already = ctx.wishTaken.get(key) ?? (await weeklyWishCount(vendor.id, week, item.id, slotIdx, slot.candidate_index));
    if (already + quantity > cand.weekly_cap) {
      throw new HttpsError("resource-exhausted", t(`「${cand.name}」本週已滿，請改選其他配菜`, `${cand.name} is full this week. Please choose another side.`));
    }
    ctx.wishTaken.set(key, already + quantity);
  }

  const { discountPercent, lockedPrice: earlyPrice } = applyEarlyBirdPrice(item.price, pickupDate);
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
      slots: resolved.slots,
      rice,
      list_price: item.price,
      discount_percent: discountPercent,
      early_bird_amount: item.price - earlyPrice,
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

/** 計畫型（多日方案）：同一時段連續 N 個營業日，價格用方案價，不再疊早鳥 */
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
  const { dates, problem } = planPickupDates(startDate, pickupWindow, vendor, plan.days, ctx.config);
  if (problem) throw new HttpsError("invalid-argument", problem);
  const planLabel = `${plan.label}：${plan.name}`;
  const planLabelEn = plan.name_en ? `${plan.label_en || plan.label}: ${plan.name_en}` : null;
  const draftId = db().collection("payment_intents").doc().id;
  const drafts = dates.map((date, i) => ({
    vendor_id: plan.vendor_id,
    menu_item_id: plan.menu_item_id || null,
    item_name: `${planLabel}・第${i + 1}/${plan.days}天`,
    item_name_en: planLabelEn ? `${planLabelEn} · Day ${i + 1}/${plan.days}` : null,
    pickup_window: pickupWindow,
    pickup_date: date,
    slots: [],
    rice: "normal",
    list_price: plan.price_per_meal,
    discount_percent: 0,
    early_bird_amount: 0,
    adjust_amount: 0,
    coupon_id: null,
    coupon_discount: 0,
    locked_price: plan.price_per_meal,
    resellable: true,
    plan_id: draftId,
    plan_label: planLabel,
    meal_plan_id: planId,
  }));
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
  if (intent.status === "confirmed") return { lock_ids: intent.lock_ids };
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
      payment_intent_id: orderId,
      transaction_id: intent.transaction_id,
      pickup_code: codes[i],
      phone_last3: last3,
      share_token: crypto.randomBytes(12).toString("hex"),
      cutoff_at: cutoffAt(draft.pickup_date, vendorCache.get(draft.vendor_id), config),
      cutoff_done: false,
      created_at: FieldValue.serverTimestamp(),
    });
    (draft.slots || []).forEach((slot, slotIdx) => {
      if (slot.wished == null) return;
      const id = sideWishId(draft.vendor_id, draft.pickup_date, draft.menu_item_id, slotIdx, slot.candidate_index);
      batch.set(db().collection("sideWishes").doc(id), {
        vendor_id: draft.vendor_id, date: draft.pickup_date, week: mondayOf(draft.pickup_date),
        item_id: draft.menu_item_id, slot: slotIdx, candidate: slot.candidate_index, dish: slot.wished,
        count: FieldValue.increment(1),
      }, { merge: true });
    });
  }
  batch.update(intentRef, { status: "confirmed", lock_ids: lockRefs.map((r) => r.id) });
  await batch.commit();
  return { lock_ids: lockRefs.map((r) => r.id) };
});

/* ------------------------------------------------------------------ *
 * 截單前取消／修改；取餐時段內捐為愛心餐
 * ------------------------------------------------------------------ */

async function refundLockMoney(lock) {
  if (!(lock.locked_price > 0) || !lock.transaction_id) return;
  await refundPayment({ transactionId: lock.transaction_id, refundAmount: lock.locked_price });
}

/**
 * 取消並退款（截單前的消費者取消、停班停課自動退款共用）。
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
    status: "cancelled", cancel_reason: reason, refunded_amount: lock.locked_price || 0, cancelled_at: FieldValue.serverTimestamp(),
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
  (lock.slots || []).forEach((slot, slotIdx) => {
    if (slot.wished == null) return;
    batch.set(db().collection("sideWishes").doc(sideWishId(lock.vendor_id, lock.pickup_date, lock.menu_item_id, slotIdx, slot.candidate_index)),
      { count: FieldValue.increment(-1) }, { merge: true });
  });
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
  const vendor = (await db().collection("vendors").doc(lock.vendor_id).get()).data();
  const config = await loadPlatformConfig(db());
  if (isPastCutoff(lock.pickup_date, vendor, config)) {
    throw new HttpsError("failed-precondition", t("已經截單，店家已依訂單備料，不能免費取消；可以轉讓或捐為愛心餐", "Past cutoff — the vendor has already prepared. You can transfer or donate it instead."));
  }
  try {
    await cancelAndRefund(ref, "customer");
  } catch (err) {
    logger.error("refund failed", err);
    throw new HttpsError("internal", t("退款失敗，請稍後再試或聯絡客服", "Refund failed. Please try again later."));
  }
  return { ok: true };
});

/** 截單前修改配菜選擇（許願／預設）。會改變金額的（加減飯、某格不要）請取消後重訂 */
exports.updateLockChoices = onCall({}, async (request) => {
  assertSignedInUser(request, "修改訂單");
  const { ref, lock } = await loadOwnLock(request, request.data?.lock_id);
  if (lock.status !== "locked") throw new HttpsError("failed-precondition", t("這筆訂單目前不能修改", "This order can't be changed"));
  const [vendorSnap, itemSnap] = await Promise.all([
    db().collection("vendors").doc(lock.vendor_id).get(),
    db().collection("menu_items").doc(lock.menu_item_id || "_").get(),
  ]);
  const config = await loadPlatformConfig(db());
  if (isPastCutoff(lock.pickup_date, vendorSnap.data(), config)) throw new HttpsError("failed-precondition", t("已經截單，不能修改", "Past cutoff"));
  if (!itemSnap.exists) throw new HttpsError("failed-precondition", t("這個品項沒有配菜可選", "No sides to change"));
  const item = { id: itemSnap.id, ...itemSnap.data() };
  const resolved = resolveChoices(item, request.data?.slots);
  if (resolved.problem) throw new HttpsError("invalid-argument", resolved.problem);
  const sameRemoved = resolved.slots.every((s, i) => !!s.removed === !!lock.slots?.[i]?.removed);
  if (!sameRemoved) throw new HttpsError("invalid-argument", t("「不要」會改變金額，請取消後重新下單", "Removing a side changes the price — cancel and re-order instead"));
  const batch = db().batch();
  const bump = (slots, delta) => slots.forEach((slot, slotIdx) => {
    if (slot.wished == null) return;
    batch.set(db().collection("sideWishes").doc(sideWishId(lock.vendor_id, lock.pickup_date, lock.menu_item_id, slotIdx, slot.candidate_index)), {
      vendor_id: lock.vendor_id, date: lock.pickup_date, week: mondayOf(lock.pickup_date), item_id: lock.menu_item_id,
      slot: slotIdx, candidate: slot.candidate_index, dish: slot.wished, count: FieldValue.increment(delta),
    }, { merge: true });
  });
  bump(lock.slots || [], -1);
  bump(resolved.slots, 1);
  batch.update(ref, { slots: resolved.slots });
  await batch.commit();
  return { ok: true };
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
exports.issuePickupQr = onCall({}, async (request) => {
  const { lock_id: lockId, share_token: shareToken, reservation_id: reservationId } = request.data || {};
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
  if (typeof lockId !== "string" || !lockId) throw new HttpsError("invalid-argument", "lock_id is required");
  const ref = db().collection("locks").doc(lockId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", t("找不到這筆訂單", "Order not found"));
  const lock = snap.data();
  const owner = request.auth && lock.buyer_uid === request.auth.uid;
  const proxy = shareToken && lock.share_token && shareToken === lock.share_token;
  if (!owner && !proxy) throw new HttpsError("permission-denied", t("沒有這筆訂單的取餐權限", "You can't pick up this order"));
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
    slots: (lock.slots || []).map((s) => ({
      category: s.category, removed: !!s.removed, dish: s.removed ? null : s.resolved || s.default_dish, wished: s.wished,
    })),
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
    const transferred = (lock.payer_uid || lock.buyer_uid) !== lock.buyer_uid;
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

/** 截單後的當日需求 vs 本週理論庫存 → 缺料清單 */
async function shortageFor(vendorId, date, needs, ingredientsById) {
  const week = mondayOf(date);
  const vendorRef = db().collection("vendors").doc(vendorId);
  const [invSnap, weeklySnap, plansSnap] = await Promise.all([
    vendorRef.collection("inventory").doc(week).get(),
    vendorRef.collection("purchaseLists").doc(`weekly_${week}`).get(),
    vendorRef.collection("prepPlans").where("week", "==", week).get(),
  ]);
  const stock = new Map(Object.entries(invSnap.exists ? invSnap.data().counts || {} : {}));
  if (weeklySnap.exists) {
    for (const line of weeklySnap.data().lines || []) stock.set(line.ingredient_id, (stock.get(line.ingredient_id) || 0) + (line.order_amount || 0));
  }
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

  // 判定許願：達最低量者拿到許願菜；未達自動改預設菜並通知（預設菜照做）
  const batch = db().batch();
  const failedWishes = new Map(); // uid -> [dish]
  const wishResults = {};
  for (const lock of locks) {
    const item = catalog.itemsById[lock.menu_item_id];
    const slots = (lock.slots || []).map((slot, slotIdx) => {
      if (slot.removed) return slot;
      if (slot.wished == null) return { ...slot, resolved: slot.default_dish };
      const key = sideWishId(vendor.id, date, lock.menu_item_id, slotIdx, slot.candidate_index);
      const cand = item?.slots?.[slotIdx]?.candidates?.[slot.candidate_index];
      const minQty = Number(cand?.min_qty) > 0 ? Number(cand.min_qty) : minDefault;
      const ok = (wishCounts.get(key) || 0) >= minQty;
      wishResults[key] = { dish: slot.wished, count: wishCounts.get(key) || 0, min_qty: minQty, ok };
      if (!ok) failedWishes.set(lock.buyer_uid, [...(failedWishes.get(lock.buyer_uid) || []), slot.wished]);
      // 份量級距以截單當下的品項設定為準（菜價變動後會重算，§11），截單後鎖定
      return { ...slot, resolved: ok ? slot.wished : slot.default_dish, portion_level: ok ? cand?.portion_level ?? slot.portion_level ?? 1 : 1 };
    });
    lock.slots = slots;
    batch.update(lock.ref, { slots, cutoff_done: true });
  }

  const portions = componentPortions(locks, catalog.itemsById, catalog.componentsById, config);
  const needs = rawNeeds(portions, catalog.componentsById, catalog.ingredientsById);
  const range = vendorPickupRange(vendor);
  const timeline = buildTimeline(portions, catalog.componentsById, splitWindow(range).start);
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
    labels,
    shortages,
    wish_results: wishResults,
    done: existing.exists ? existing.data().done || {} : {},
    locked_at: FieldValue.serverTimestamp(),
  }, { merge: true });
  await batch.commit();

  for (const [uid, dishes] of failedWishes) {
    await notifyUser(uid, {
      kind: "wish",
      title: t("配菜許願未成立", "Side-dish wish didn't make it"),
      body: t(`${date} 的「${dishes.join("、")}」未達最低份數，已改為預設配菜，訂單照常成立。`, `Your wish for ${dishes.join(", ")} on ${date} didn't reach the minimum; you'll get the default side.`),
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

async function activeLocksOn(vendorId, date) {
  const snap = await db().collection("locks").where("vendor_id", "==", vendorId).where("pickup_date", "==", date).get();
  return snap.docs.filter((d) => ACTIVE_LOCK_STATUSES.includes(d.data().status));
}

/** 取餐時段的起訖時間點（今天） */
function todayRange(vendor, date) {
  const { start, end } = splitWindow(vendorPickupRange(vendor));
  return { start: at(date, start), end: at(date, end) };
}

exports.pickupReminder = onSchedule({ schedule: "every 5 minutes", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const today = taipeiToday();
  await forEachVendor("pickupReminder", async (vendor) => {
    const { end } = todayRange(vendor, today);
    const minutesLeft = (end.getTime() - Date.now()) / 60000;
    if (minutesLeft > 30 || minutesLeft < 0) return;
    const planRef = db().collection("vendors").doc(vendor.id).collection("prepPlans").doc(today);
    const plan = await planRef.get();
    if (plan.exists && plan.data().reminder_sent) return;
    await planRef.set({ reminder_sent: true }, { merge: true });
    for (const doc of await activeLocksOn(vendor.id, today)) {
      const lock = doc.data();
      await notifyUser(lock.buyer_uid, {
        kind: "pickup",
        title: t("還沒取餐喔", "You haven't picked up yet"),
        body: t(`「${lock.item_name}」取餐到 ${splitWindow(vendorPickupRange(vendor)).end}，來不了可以按「捐為愛心餐」。`, `${lock.item_name} — pickup ends at ${splitWindow(vendorPickupRange(vendor)).end}.`),
        link: "/my-bookings",
      });
    }
  });
});

module.exports.helpers = {
  cancelAndRefund, activeLocksOn, todayRange, runLockOrders, sideWishId, taipeiTime,
};

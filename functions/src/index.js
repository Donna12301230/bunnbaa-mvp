const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();

const { generateVendorCalibrationReport } = require("./vendorCalibration");
const { generateDiscountExplanation } = require("./consumerExplanation");
const { requestPayment, confirmPayment } = require("./linePay");
const { validatePickup, planPickupDates, applyEarlyBirdPrice, vendorSlotCapacity } = require("./pricing");

// ISO 27001 A.5.15/A.8.3: privileged and cost-bearing callables fail closed in
// deployed environments. Callers must be a platform admin, or (for anything
// scoped to one vendor) the vendor's owner — the account whose Auth uid an admin
// stored in vendors/{id}.owner_uid. The emulator is exempt so local demos keep
// working. Keep the admin list in sync with firestore.rules isAdmin() and
// web/src/lib/adminAuth.ts.
const ADMIN_EMAILS = ["suw192336@gmail.com", "ckchildlikekid@gmail.com"];

function isEmulator() {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function assertAdminOrEmulator(request) {
  if (isEmulator()) return;
  const email = request.auth?.token?.email;
  if (!email || !ADMIN_EMAILS.includes(email)) {
    throw new HttpsError("permission-denied", "This action is restricted to platform admins.");
  }
}

// Consumer actions (locking, checkout, resale claims, draws) need a real
// account since 2026-09-24 — anonymous sign-in is no longer used anywhere,
// so an anonymous token here means a stale or hand-crafted client.
function assertSignedInUser(request, action) {
  if (!request.auth || request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", `Please log in to ${action}`);
  }
}

// Repeated no-shows (see markLockOutcome) set users/{uid}.orderBanned. Checked
// at reservation time (single item, cart, meal plan) so a banned buyer never
// reaches LINE Pay; clients can't create locks directly (firestore.rules).
// Missing doc/field = not banned.
async function assertNotBanned(uid) {
  const snap = await db.collection("users").doc(uid).get();
  if (snap.exists && snap.data().orderBanned) {
    throw new HttpsError(
      "permission-denied",
      "您的帳號因多次未取餐已被限制下單，請至會員中心提交解封申訴"
    );
  }
}

async function assertAdminOrVendorOwner(request, vendorId) {
  if (isEmulator()) return;
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const email = request.auth.token?.email;
  if (email && ADMIN_EMAILS.includes(email)) return;
  const vendorSnap = await db.collection("vendors").doc(vendorId).get();
  if (vendorSnap.exists && vendorSnap.data().owner_uid === request.auth.uid) return;
  throw new HttpsError("permission-denied", "Only this vendor's owner or a platform admin can do this.");
}

/* ------------------------------------------------------------------ *
 * 1. Vendor calibration — scheduled, batched per vendor (spec 4.4)
 * ------------------------------------------------------------------ */

/**
 * Pulls the last N rounds of locks for a vendor, grouped into a simple
 * period bucket (per day, for the MVP single-café pilot), and turns them
 * into the `history` array the calibration agent expects.
 */
async function buildVendorHistory(vendorId, { maxPeriods = 14 } = {}) {
  const snap = await db
    .collection("locks")
    .where("vendor_id", "==", vendorId)
    .where("status", "in", ["fulfilled", "no_show", "resold_and_fulfilled"])
    .orderBy("created_at", "desc")
    .limit(500) // MVP-scale cap; revisit if a vendor's volume grows
    .get();

  const byPeriod = new Map(); // period (YYYY-MM-DD) -> aggregate

  snap.forEach((doc) => {
    const d = doc.data();
    const period = (d.pickup_date || d.created_at?.toDate?.().toISOString().slice(0, 10)) ?? "unknown";
    if (!byPeriod.has(period)) {
      byPeriod.set(period, {
        period,
        locked_qty: 0,
        fulfilled_qty: 0,
        no_show_notes: [],
        consumer_feedback: [],
      });
    }
    const bucket = byPeriod.get(period);
    bucket.locked_qty += 1;
    if (d.status === "fulfilled" || d.status === "resold_and_fulfilled") {
      bucket.fulfilled_qty += 1;
    }
    if (d.no_show_note) bucket.no_show_notes.push(d.no_show_note);
    if (d.consumer_feedback) bucket.consumer_feedback.push(d.consumer_feedback);
  });

  return Array.from(byPeriod.values())
    .sort((a, b) => (a.period > b.period ? 1 : -1))
    .slice(-maxPeriods);
}

// Spec ref: README "尚未實作" — reliability_tone was a hand-set field;
// this ties it to the same accuracy_rate the calibration report already
// computes, so the badge on the consumer page stays in sync automatically.
const STABLE_ACCURACY_THRESHOLD = 0.8;

async function runCalibrationForVendor(vendorId) {
  const history = await buildVendorHistory(vendorId);
  if (history.length === 0) {
    logger.info(`No fulfilled/no_show locks yet for vendor ${vendorId}, skipping.`);
    return null;
  }

  const report = await generateVendorCalibrationReport({ history });

  const docRef = await db.collection("accuracy_reports").add({
    vendor_id: vendorId,
    horizon: "daily",
    ...report,
    generated_at: FieldValue.serverTimestamp(),
  });

  await db.collection("vendors").doc(vendorId).update({
    reliability_tone: report.accuracy_rate >= STABLE_ACCURACY_THRESHOLD ? "stable" : "variable",
  });

  logger.info(`Calibration report ${docRef.id} generated for vendor ${vendorId}`, {
    accuracy_rate: report.accuracy_rate,
  });
  return docRef.id;
}

/**
 * Runs once a day. MVP pilot has a handful of vendors, so this simply loops
 * through all of them sequentially — batch/queue if the vendor count grows
 * (see spec 4.4).
 */
exports.dailyCalibration = onSchedule(
  { schedule: "every day 23:30", timeZone: "Asia/Taipei", region: "asia-east1" },
  async () => {
    const vendorsSnap = await db.collection("vendors").get();
    for (const vendorDoc of vendorsSnap.docs) {
      try {
        await runCalibrationForVendor(vendorDoc.id);
      } catch (err) {
        logger.error(`Calibration failed for vendor ${vendorDoc.id}`, err);
        // continue to next vendor rather than failing the whole run
      }
    }
  }
);

/**
 * Manual trigger for local testing / demo, e.g. via the Firebase console
 * or `firebase functions:shell`, so you don't have to wait for the
 * schedule while developing.
 */
exports.triggerCalibrationNow = onCall({ region: "asia-east1" }, async (request) => {
  const vendorId = request.data?.vendor_id;
  if (!vendorId) throw new HttpsError("invalid-argument", "vendor_id is required");
  await assertAdminOrVendorOwner(request, vendorId);
  const reportId = await runCalibrationForVendor(vendorId);
  return { report_id: reportId };
});

/* ------------------------------------------------------------------ *
 * 1a. Vendor marks pickup outcome (fulfilled / no-show)
 * ------------------------------------------------------------------ */

const VALID_OUTCOMES = ["fulfilled", "resold_and_fulfilled", "no_show"];
// Same set VendorRedeemPage lets the counter act on.
const OPEN_LOCK_STATUSES = ["locked", "for_resale"];
// Membership terms (LoginPage.tsx 會員須知): "累計超過一次" no-show loses
// order privileges, i.e. banned starting on the 2nd no-show.
const NO_SHOW_BAN_THRESHOLD = 2;

/**
 * Vendor-side pickup counter action: mark a lock as picked up or not.
 * Runs with admin rights because `firestore.rules` deliberately blocks
 * clients from writing lock status transitions directly (see rules
 * comment) — the calibration agent's accuracy numbers depend on this
 * data being vendor-attested, not self-reported by the buyer.
 */
exports.markLockOutcome = onCall({ region: "asia-east1" }, async (request) => {
  const { lock_id: lockId, outcome, note } = request.data || {};
  if (!lockId || !VALID_OUTCOMES.includes(outcome)) {
    throw new HttpsError(
      "invalid-argument",
      `lock_id is required and outcome must be one of: ${VALID_OUTCOMES.join(", ")}`
    );
  }

  const lockRef = db.collection("locks").doc(lockId);
  const lockSnap = await lockRef.get();
  if (!lockSnap.exists) {
    throw new HttpsError("not-found", `No lock found with id ${lockId}`);
  }
  await assertAdminOrVendorOwner(request, lockSnap.data().vendor_id);

  // Only still-open locks can be redeemed. Without this a direct call could
  // flip an already fulfilled (and possibly already settled) lock to no_show,
  // or mark an unclaimed gift as picked up. Transaction so two counter
  // devices redeeming the same code can't both succeed.
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(lockRef);
    const current = fresh.data().status;
    if (!OPEN_LOCK_STATUSES.includes(current)) {
      throw new HttpsError("failed-precondition", `This lock is already "${current}" and can't be redeemed again`);
    }

    // Reads must come before writes in a transaction, so resolve the buyer's
    // no-show count now even though it's only used for a no_show outcome.
    const buyerUid = fresh.data().buyer_uid;
    const userRef = db.collection("users").doc(buyerUid);
    const userSnap = outcome === "no_show" ? await tx.get(userRef) : null;

    const update = { status: outcome };
    if (outcome === "no_show" && note) {
      update.no_show_note = note;
    }
    tx.update(lockRef, update);

    if (outcome === "no_show") {
      const noPickupCount = (userSnap.exists && userSnap.data().noPickupCount) || 0;
      const nextCount = noPickupCount + 1;
      const userUpdate = { noPickupCount: nextCount };
      if (nextCount >= NO_SHOW_BAN_THRESHOLD) userUpdate.orderBanned = true;
      // set+merge, not update: a phone/email signup always creates users/{uid}
      // (web/src/lib/auth.ts), but don't fail redemption if that's ever missing.
      tx.set(userRef, userUpdate, { merge: true });
    }
  });

  return { lock_id: lockId, status: outcome };
});

/**
 * A second buyer takes over a resold lock. Spec ref: 改造指南 §5.3 — resale
 * money never flows through the platform (B pays A directly, off-platform);
 * the platform's only job is reassigning `buyer_uid` in Firestore. Needs
 * admin rights because the existing rule only lets a lock's *current*
 * buyer transition their own lock to `for_resale`, not have a stranger
 * take it over.
 */
exports.claimResoldLock = onCall({ region: "asia-east1" }, async (request) => {
  assertSignedInUser(request, "claim a lock");
  const { lock_id: lockId } = request.data || {};
  if (!lockId) throw new HttpsError("invalid-argument", "lock_id is required");

  const lockRef = db.collection("locks").doc(lockId);
  const lockSnap = await lockRef.get();
  if (!lockSnap.exists) {
    throw new HttpsError("not-found", `No lock found with id ${lockId}`);
  }
  const lock = lockSnap.data();
  if (lock.status !== "for_resale") {
    throw new HttpsError("failed-precondition", "This lock isn't currently up for resale");
  }
  if (lock.buyer_uid === request.auth.uid) {
    throw new HttpsError("failed-precondition", "You can't claim your own resale listing");
  }

  // Back to "locked" so the lock leaves the marketplace instead of showing up
  // as the new owner's own listing; transferred_from_uids keeps it visible
  // under the seller's 「我的轉讓」 (same field the client-side claim rules
  // require in firestore.rules).
  await lockRef.update({
    status: "locked",
    buyer_uid: request.auth.uid,
    resale_deadline: FieldValue.delete(),
    transferred_from_uids: FieldValue.arrayUnion(lock.buyer_uid),
  });
  // The previous owner's device token must not keep receiving this lock's reminders.
  await db.collection("lock_tokens").doc(lockId).delete();
  return { lock_id: lockId };
});

/* ------------------------------------------------------------------ *
 * 1c. Consumer checkout — LINE Pay (spec ref: 金流串接(消費端), TODO.md
 * 卡點 3). Reserve → redirect to LINE Pay → confirm: the `locks` doc is
 * only created once confirmLinePayPayment succeeds, so a buyer who never
 * finishes paying never ends up with a "locked" doc. Point functions/.env's
 * LINE_PAY_CHANNEL_ID/LINE_PAY_CHANNEL_SECRET at a Sandbox channel from
 * https://pay.line.me/tw/developers (self-serve, no merchant review) to
 * test this end to end before the real 特約商店審核 clears; set
 * LINE_PAY_ENV=production and swap the credentials once it does.
 * ------------------------------------------------------------------ */

// Cart/single-item checkout both take a client-supplied vendor_id — a
// malicious client could otherwise attribute a lock (and the revenue it
// eventually settles as) to an arbitrary vendor_id string that doesn't
// correspond to a real vendor doc. Cache hits within one function
// invocation so a multi-item cart doesn't re-read the same vendor N times.
// Returns the vendor doc's data (its pickup schedule is needed for validation).
async function assertVendorExists(vendorId, cache) {
  if (cache?.has(vendorId)) return cache.get(vendorId);
  const snap = await db.collection("vendors").doc(vendorId).get();
  if (!snap.exists) {
    throw new HttpsError("invalid-argument", `Unknown vendor_id: ${vendorId}`);
  }
  const vendor = snap.data();
  cache?.set(vendorId, vendor);
  return vendor;
}

// Checkout prices come from menu_items, not the request — the client only
// says *which* item, the server decides what it costs.
async function loadOrderableMenuItem(menuItemId, vendorCache) {
  if (typeof menuItemId !== "string" || !menuItemId) {
    throw new HttpsError("invalid-argument", "menu_item_id is required");
  }
  const snap = await db.collection("menu_items").doc(menuItemId).get();
  if (!snap.exists) throw new HttpsError("not-found", `No menu item ${menuItemId}`);
  const item = snap.data();
  if (item.is_available === false) {
    throw new HttpsError("failed-precondition", `「${item.name}」目前暫停供應`);
  }
  if (typeof item.price !== "number" || item.price <= 0) {
    throw new HttpsError("failed-precondition", `「${item.name}」沒有設定價格`);
  }
  const vendor = await assertVendorExists(item.vendor_id, vendorCache);
  return { item, vendor };
}

function assertValidPickup(pickupDate, pickupWindow, vendor) {
  const problem = validatePickup(pickupDate, pickupWindow, vendor);
  if (problem) throw new HttpsError("invalid-argument", problem);
}

/* Per-slot capacity (vendors/{id}.slot_capacity = max meals per pickup date +
 * window, all items combined). Booked counts live in slot_counters/{key},
 * written only here: reserved inside a transaction in confirmLinePayPayment
 * *before* LINE Pay captures the money, so two buyers racing for the last
 * meal can't both get it and the loser is never charged. Locks created
 * before 2026-09-25 (and plan-join locks from before 2026-09-28, when that
 * path was still client-side) aren't counted. */
function slotCounterRef(vendorId, pickupDate, pickupWindow) {
  return db.collection("slot_counters").doc(`${vendorId}__${pickupDate}__${pickupWindow}`);
}

// Groups lock drafts by vendor + date + window, counting meals in each.
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

const SOLD_OUT_DURING_PAYMENT = "你選的取餐時段在付款期間額滿了，這筆沒有扣款，請重新選擇時段下單";

// Early, non-binding check at reservation time so a buyer doesn't go all the
// way to LINE Pay for a full slot. The binding check is in confirmLinePayPayment.
async function assertSlotsHaveRoom(drafts, vendorCache) {
  for (const g of groupDraftsBySlot(drafts)) {
    const vendor = vendorCache.get(g.vendorId);
    const capacity = vendorSlotCapacity(vendor);
    if (capacity === null) continue;
    const snap = await slotCounterRef(g.vendorId, g.pickupDate, g.pickupWindow).get();
    const booked = snap.exists ? snap.data().count ?? 0 : 0;
    if (booked + g.count > capacity) {
      const left = Math.max(0, capacity - booked);
      const where = `「${vendor?.name ?? "這家店"}」${g.pickupDate} ${g.pickupWindow}`;
      throw new HttpsError(
        "resource-exhausted",
        left > 0 ? `${where} 只剩 ${left} 份，請減少數量或改選其他時段` : `${where} 已額滿，請改選其他時段`
      );
    }
  }
}

function cleanNote(note) {
  return typeof note === "string" ? note.trim().slice(0, 100) : "";
}

exports.createLinePayReservation = onCall({ region: "asia-east1" }, async (request) => {
  assertSignedInUser(request, "check out");
  await assertNotBanned(request.auth.uid);
  const {
    menu_item_id: menuItemId,
    pickup_window: pickupWindow,
    pickup_date: pickupDate,
  } = request.data || {};
  const vendorCache = new Map();
  const { item, vendor } = await loadOrderableMenuItem(menuItemId, vendorCache);
  assertValidPickup(pickupDate, pickupWindow, vendor);
  await assertSlotsHaveRoom([{ vendor_id: item.vendor_id, pickup_date: pickupDate, pickup_window: pickupWindow }], vendorCache);
  const vendorId = item.vendor_id;
  const itemName = item.name;
  const { discountPercent, lockedPrice } = applyEarlyBirdPrice(item.price, pickupDate);

  const appBaseUrl = process.env.APP_BASE_URL || "https://bunnbaa-mvp-5474.web.app";
  const intentRef = db.collection("payment_intents").doc();
  const orderId = intentRef.id;
  const amount = lockedPrice;

  let info;
  try {
    info = await requestPayment({
      orderId,
      amount,
      products: [{ name: itemName, quantity: 1, price: amount }],
      // orderId goes in the path, not a query string: LINE Pay appends
      // ?transactionId=... (or &... if our URL already has a "?") by plain
      // string concatenation, with no awareness of the "#" hash-router
      // boundary. A query string here would land the appended param inside
      // the hash fragment and break wouter's route match (see App.tsx's
      // /payment/confirm/:orderId — the trailing junk gets absorbed into
      // the :orderId capture instead, harmlessly, since it's stripped in
      // PaymentConfirmPage).
      confirmUrl: `${appBaseUrl}/#/payment/confirm/${orderId}`,
      cancelUrl: `${appBaseUrl}/#/payment/cancel/${orderId}`,
    });
  } catch (err) {
    logger.error("LINE Pay request failed", err);
    throw new HttpsError("internal", "LINE Pay 付款請求失敗，請稍後再試");
  }

  await intentRef.set({
    status: "pending",
    buyer_uid: request.auth.uid,
    transaction_id: String(info.transactionId),
    amount,
    // Array of one — confirmLinePayPayment below always creates one Lock doc
    // per entry, shared with the multi-item cart checkout (createCartLinePayReservation).
    lock_drafts: [
      {
        vendor_id: vendorId,
        item_name: itemName,
        pickup_window: pickupWindow,
        pickup_date: pickupDate,
        discount_percent: discountPercent,
        resellable: true,
        locked_price: amount,
      },
    ],
    created_at: FieldValue.serverTimestamp(),
  });

  return { order_id: orderId, payment_url: info.paymentUrl.web };
});

/* ------------------------------------------------------------------ *
 * 1d. Cart checkout — LINE Pay, multi-item version of the above.
 * VendorPage/MenuItemPage/CartPage.tsx now read/write the real
 * vendors/menu_items collections, so each cart line carries its own real
 * vendor_id — no more hardcoded single-vendor attribution. Each cart
 * line's quantity expands into that many individual Lock docs (one pickup
 * QR code per meal), same convention as HomePage's plan-join.
 * ------------------------------------------------------------------ */

const MAX_CART_LINES = 50;
const MAX_CART_UNITS = 100; // bounds the Firestore batch confirmLinePayPayment writes

exports.createCartLinePayReservation = onCall({ region: "asia-east1" }, async (request) => {
  assertSignedInUser(request, "check out");
  await assertNotBanned(request.auth.uid);
  const { items, pickup_date: pickupDate, pickup_window: pickupWindow } = request.data || {};
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpsError("invalid-argument", "items must be a non-empty array");
  }
  if (items.length > MAX_CART_LINES) {
    throw new HttpsError("invalid-argument", `Too many cart lines (max ${MAX_CART_LINES})`);
  }

  const products = [];
  const lockDrafts = [];
  const checkedVendors = new Map();
  let amount = 0;
  for (const item of items) {
    const quantity = item?.quantity;
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new HttpsError("invalid-argument", "Each item needs a menu_item_id and a positive integer quantity");
    }
    const { item: menuItem, vendor } = await loadOrderableMenuItem(item?.menu_item_id, checkedVendors);
    assertValidPickup(pickupDate, pickupWindow, vendor);
    const { discountPercent, lockedPrice: price } = applyEarlyBirdPrice(menuItem.price, pickupDate);
    const note = cleanNote(item?.note);
    products.push({ name: menuItem.name, quantity, price });
    amount += price * quantity;
    for (let i = 0; i < quantity; i++) {
      lockDrafts.push({
        vendor_id: menuItem.vendor_id,
        item_name: menuItem.name,
        pickup_window: pickupWindow,
        pickup_date: pickupDate,
        discount_percent: discountPercent,
        resellable: true,
        locked_price: price,
        ...(note ? { note } : {}),
      });
    }
  }
  if (lockDrafts.length > MAX_CART_UNITS) {
    throw new HttpsError("invalid-argument", `Too many items total (max ${MAX_CART_UNITS})`);
  }
  await assertSlotsHaveRoom(lockDrafts, checkedVendors);

  const appBaseUrl = process.env.APP_BASE_URL || "https://bunnbaa-mvp-5474.web.app";
  const intentRef = db.collection("payment_intents").doc();
  const orderId = intentRef.id;

  let info;
  try {
    info = await requestPayment({
      orderId,
      amount,
      products,
      confirmUrl: `${appBaseUrl}/#/payment/confirm/${orderId}`,
      cancelUrl: `${appBaseUrl}/#/payment/cancel/${orderId}`,
    });
  } catch (err) {
    logger.error("LINE Pay cart request failed", err);
    throw new HttpsError("internal", "LINE Pay 付款請求失敗，請稍後再試");
  }

  await intentRef.set({
    status: "pending",
    buyer_uid: request.auth.uid,
    transaction_id: String(info.transactionId),
    amount,
    lock_drafts: lockDrafts,
    created_at: FieldValue.serverTimestamp(),
  });

  return { order_id: orderId, payment_url: info.paymentUrl.web };
});

/* ------------------------------------------------------------------ *
 * 1e. Meal-plan join — LINE Pay, one payment for a plan's N days.
 * Replaces HomePage's old client-side handleJoinPlan, which wrote N locks
 * straight to Firestore: unpaid, fixed 12:00-13:00, ignoring the vendor's
 * windows / holidays / slot capacity. Price comes from meal_plans (no
 * early-bird on top — the plan price is already the discount). Pickup dates
 * are the next N vendor-open days from start_date at one window. Locks are
 * created by confirmLinePayPayment like any other checkout; plan_id is this
 * order's id so each join groups separately.
 * ------------------------------------------------------------------ */

exports.createPlanLinePayReservation = onCall({ region: "asia-east1" }, async (request) => {
  assertSignedInUser(request, "join a meal plan");
  await assertNotBanned(request.auth.uid);
  const { plan_id: planId, start_date: startDate, pickup_window: pickupWindow } = request.data || {};
  if (typeof planId !== "string" || !planId) {
    throw new HttpsError("invalid-argument", "plan_id is required");
  }
  const planSnap = await db.collection("meal_plans").doc(planId).get();
  if (!planSnap.exists) throw new HttpsError("not-found", `No meal plan ${planId}`);
  const plan = planSnap.data();
  if (!Number.isInteger(plan.days) || plan.days <= 0 || plan.days > MAX_CART_UNITS) {
    throw new HttpsError("failed-precondition", `「${plan.name}」的供餐天數設定有誤`);
  }
  if (typeof plan.price_per_meal !== "number" || plan.price_per_meal <= 0) {
    throw new HttpsError("failed-precondition", `「${plan.name}」沒有設定價格`);
  }
  const vendorCache = new Map();
  const vendor = await assertVendorExists(plan.vendor_id, vendorCache);
  if (vendor.status === "disabled") {
    throw new HttpsError("failed-precondition", `「${vendor.name ?? "這家店"}」目前暫停營業`);
  }
  const { dates, problem } = planPickupDates(startDate, pickupWindow, vendor, plan.days);
  if (problem) throw new HttpsError("invalid-argument", problem);

  const planLabel = `${plan.label}：${plan.name}`;
  const price = plan.price_per_meal;
  const appBaseUrl = process.env.APP_BASE_URL || "https://bunnbaa-mvp-5474.web.app";
  const intentRef = db.collection("payment_intents").doc();
  const orderId = intentRef.id;
  const lockDrafts = dates.map((date, i) => ({
    vendor_id: plan.vendor_id,
    item_name: `${planLabel}・第${i + 1}/${plan.days}天`,
    pickup_window: pickupWindow,
    pickup_date: date,
    discount_percent: 0,
    resellable: true,
    locked_price: price,
    plan_id: orderId,
    plan_label: planLabel,
  }));
  await assertSlotsHaveRoom(lockDrafts, vendorCache);
  const amount = price * plan.days;

  let info;
  try {
    info = await requestPayment({
      orderId,
      amount,
      products: [{ name: planLabel, quantity: plan.days, price }],
      confirmUrl: `${appBaseUrl}/#/payment/confirm/${orderId}`,
      cancelUrl: `${appBaseUrl}/#/payment/cancel/${orderId}`,
    });
  } catch (err) {
    logger.error("LINE Pay plan request failed", err);
    throw new HttpsError("internal", "LINE Pay 付款請求失敗，請稍後再試");
  }

  await intentRef.set({
    status: "pending",
    buyer_uid: request.auth.uid,
    transaction_id: String(info.transactionId),
    amount,
    lock_drafts: lockDrafts,
    created_at: FieldValue.serverTimestamp(),
  });

  return { order_id: orderId, payment_url: info.paymentUrl.web };
});

exports.confirmLinePayPayment =onCall({ region: "asia-east1" }, async (request) => {
  assertSignedInUser(request, "confirm a payment");
  const { order_id: orderId } = request.data || {};
  if (!orderId) throw new HttpsError("invalid-argument", "order_id is required");

  const intentRef = db.collection("payment_intents").doc(orderId);
  const intentSnap = await intentRef.get();
  if (!intentSnap.exists) throw new HttpsError("not-found", `No payment_intent found for order ${orderId}`);
  const intent = intentSnap.data();

  if (intent.buyer_uid !== request.auth.uid) {
    throw new HttpsError("permission-denied", "This payment doesn't belong to you");
  }
  // Idempotent: the confirm redirect can legitimately fire twice (e.g. the
  // buyer double-taps back/refresh), so replay the stored result instead of
  // re-confirming with LINE Pay, which would reject a second confirm.
  if (intent.status === "confirmed") {
    return { lock_ids: intent.lock_ids };
  }
  if (intent.status === "sold_out") {
    throw new HttpsError("resource-exhausted", SOLD_OUT_DURING_PAYMENT);
  }
  if (intent.status !== "pending") {
    throw new HttpsError("failed-precondition", `This payment is ${intent.status}, not pending`);
  }

  // 1) Reserve capacity atomically and flip the intent to "confirming" so a
  //    concurrent double-confirm can't reserve twice. Nothing is charged yet.
  const slots = groupDraftsBySlot(intent.lock_drafts);
  const counterRefs = slots.map((g) => slotCounterRef(g.vendorId, g.pickupDate, g.pickupWindow));
  const soldOut = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(intentRef);
    if (fresh.data().status !== "pending") {
      throw new HttpsError("failed-precondition", "這筆付款正在處理中，請稍候重新整理");
    }
    const vendorSnaps = await Promise.all(slots.map((g) => tx.get(db.collection("vendors").doc(g.vendorId))));
    const counterSnaps = await Promise.all(counterRefs.map((ref) => tx.get(ref)));
    const booked = counterSnaps.map((snap) => (snap.exists ? snap.data().count ?? 0 : 0));
    const full = slots.some((g, i) => {
      const capacity = vendorSlotCapacity(vendorSnaps[i].data());
      return capacity !== null && booked[i] + g.count > capacity;
    });
    if (full) {
      tx.update(intentRef, { status: "sold_out" });
      return true;
    }
    slots.forEach((g, i) => {
      tx.set(counterRefs[i], {
        vendor_id: g.vendorId,
        pickup_date: g.pickupDate,
        pickup_window: g.pickupWindow,
        count: booked[i] + g.count,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
    tx.update(intentRef, { status: "confirming" });
    return false;
  });
  if (soldOut) throw new HttpsError("resource-exhausted", SOLD_OUT_DURING_PAYMENT);

  // 2) Capture the payment. On failure give the reserved meals back and let
  //    the buyer retry the same order.
  try {
    await confirmPayment({ transactionId: intent.transaction_id, amount: intent.amount });
  } catch (err) {
    logger.error("LINE Pay confirm failed", err);
    const rollback = db.batch();
    slots.forEach((g, i) => rollback.update(counterRefs[i], { count: FieldValue.increment(-g.count) }));
    rollback.update(intentRef, { status: "pending" });
    await rollback.commit().catch((e) => logger.error("Capacity rollback failed", e));
    throw new HttpsError("internal", "LINE Pay 付款確認失敗，請稍後再試或聯絡客服");
  }

  const batch = db.batch();
  const lockIds = [];
  for (const draft of intent.lock_drafts) {
    const lockRef = db.collection("locks").doc();
    batch.set(lockRef, {
      ...draft,
      status: "locked",
      buyer_uid: request.auth.uid,
      created_at: FieldValue.serverTimestamp(),
    });
    lockIds.push(lockRef.id);
  }
  batch.update(intentRef, { status: "confirmed", lock_ids: lockIds });
  await batch.commit();

  return { lock_ids: lockIds };
});

/* ------------------------------------------------------------------ *
 * 1b. Vendor payouts — platform collects, forwards in full, on a
 * schedule (spec ref: 改造指南 §5.1/§5.4 — "路線 A：平台代收、定期撥款
 * 商家". No platform cut: the doc is explicit that the full amount gets
 * forwarded, the platform isn't fronting or holding funds for anything
 * else. This scaffolds the aggregation + a payout record with mock
 * data; the actual LINE Pay/綠界 payout API call (or, per the doc's own
 * fallback, a manual reconciliation export) isn't wired up yet since
 * there's no merchant account to call it against.
 * ------------------------------------------------------------------ */

async function settleVendorPayout(vendorId) {
  // Reuses the same vendor_id index as buildVendorHistory/VendorRedeemPage
  // rather than adding a composite index for a status-in + not-yet-settled
  // filter — fine at pilot scale (one vendor, a few hundred locks).
  const snap = await db
    .collection("locks")
    .where("vendor_id", "==", vendorId)
    .orderBy("created_at", "desc")
    .limit(500)
    .get();

  const unsettled = snap.docs.filter((d) => {
    const data = d.data();
    return ["fulfilled", "resold_and_fulfilled"].includes(data.status) && !data.payout_settled;
  });

  if (unsettled.length === 0) {
    logger.info(`No unsettled fulfilled locks for vendor ${vendorId}, skipping payout.`);
    return null;
  }

  const amount = unsettled.reduce((sum, d) => sum + (d.data().locked_price || 0), 0);
  const lockIds = unsettled.map((d) => d.id);

  const payoutRef = await db.collection("payouts").add({
    vendor_id: vendorId,
    amount, // full amount, no platform fee — see comment above
    lock_ids: lockIds,
    lock_count: lockIds.length,
    // No LINE Pay/綠界 merchant payout API to call yet, so this is the
    // manual-reconciliation fallback the doc describes, not a real transfer.
    status: "pending_manual_export",
    created_at: FieldValue.serverTimestamp(),
  });

  const batch = db.batch();
  for (const d of unsettled) {
    batch.update(d.ref, { payout_settled: true, payout_id: payoutRef.id });
  }
  await batch.commit();

  logger.info(`Payout ${payoutRef.id} created for vendor ${vendorId}`, { amount, lock_count: lockIds.length });
  return payoutRef.id;
}

exports.settleVendorPayouts = onSchedule(
  { schedule: "every day 20:00", timeZone: "Asia/Taipei", region: "asia-east1" },
  async () => {
    const vendorsSnap = await db.collection("vendors").get();
    for (const vendorDoc of vendorsSnap.docs) {
      try {
        await settleVendorPayout(vendorDoc.id);
      } catch (err) {
        logger.error(`Payout settlement failed for vendor ${vendorDoc.id}`, err);
      }
      try {
        await syncGrowthUnlock(vendorDoc.id);
      } catch (err) {
        logger.error(`Growth unlock sync failed for vendor ${vendorDoc.id}`, err);
      }
    }
  }
);

/** Manual trigger for local testing / demo, same pattern as triggerCalibrationNow. */
exports.triggerSettlementNow = onCall({ region: "asia-east1" }, async (request) => {
  const vendorId = request.data?.vendor_id;
  if (!vendorId) throw new HttpsError("invalid-argument", "vendor_id is required");
  await assertAdminOrVendorOwner(request, vendorId);
  const payoutId = await settleVendorPayout(vendorId);
  const unlocked = await syncGrowthUnlock(vendorId);
  return { payout_id: payoutId, unlocked_milestones: unlocked };
});

/* ------------------------------------------------------------------ *
 * 2. Vendor what-if follow-up (spec 4.1a)
 * ------------------------------------------------------------------ */
exports.askCalibrationScenario = onCall({ region: "asia-east1" }, async (request) => {
  const { vendor_id: vendorId, question } = request.data || {};
  if (!vendorId || !question) {
    throw new HttpsError("invalid-argument", "vendor_id and question are required");
  }
  await assertAdminOrVendorOwner(request, vendorId);

  const history = await buildVendorHistory(vendorId);
  if (history.length === 0) {
    throw new HttpsError("failed-precondition", "No history yet for this vendor");
  }

  const report = await generateVendorCalibrationReport({ history, scenarioQuestion: question });
  // Not persisted by default — this is a lightweight, ad-hoc follow-up.
  // Persist to a `scenario_queries` subcollection if you want an audit trail.
  return report;
});

/* ------------------------------------------------------------------ *
 * 3. Consumer discount explanation — generate-on-lock-creation, cached
 * ------------------------------------------------------------------ */

function cacheKeyFor({ vendor_id, item_name, discount_percent, resellable, pickup_window }) {
  return [vendor_id, item_name, discount_percent, resellable, pickup_window]
    .join("|")
    .replace(/[^a-zA-Z0-9|_.:-]/g, "_")
    .slice(0, 200);
}

/**
 * Fires when a new lock document is created. Looks up (or generates once
 * and caches) the plain-language discount explanation, and writes it back
 * onto the lock so the frontend can read it directly — no extra round trip
 * needed from the client.
 */
exports.onLockCreated = onDocumentCreated(
  { document: "locks/{lockId}", region: "asia-east1" },
  async (event) => {
    const lock = event.data.data();
    const lockRef = event.data.ref;

    const vendorSnap = await db.collection("vendors").doc(lock.vendor_id).get();
    const vendor = vendorSnap.data();
    if (!vendor) {
      logger.warn(`Lock ${event.params.lockId} references unknown vendor ${lock.vendor_id}`);
      return;
    }

    const key = cacheKeyFor({
      vendor_id: lock.vendor_id,
      item_name: lock.item_name,
      discount_percent: lock.discount_percent,
      resellable: lock.resellable !== false,
      pickup_window: lock.pickup_window,
    });

    const cacheRef = db.collection("discount_explanations").doc(key);
    const cached = await cacheRef.get();

    let explanation;
    if (cached.exists) {
      explanation = cached.data();
    } else {
      explanation = await generateDiscountExplanation({
        discountPercent: lock.discount_percent,
        resellable: lock.resellable !== false,
        pickupWindow: lock.pickup_window,
        // Qualitative only, per spec 6.2 — never expose the raw accuracy
        // number to the consumer-facing agent.
        vendorReliabilityTone: vendor.reliability_tone || "new",
      });
      await cacheRef.set({
        ...explanation,
        generated_at: FieldValue.serverTimestamp(),
      });
    }

    await lockRef.update({ discount_explanation: explanation.explanation_text });
  }
);

/* ------------------------------------------------------------------ *
 * 4. Pickup-time reminder push (spec §3.7, README "尚未實作") — pure
 * UX, unrelated to the AI agents. Runs every 15 min looking for locks
 * whose pickup window starts within the next 30 min.
 * ------------------------------------------------------------------ */

const REMINDER_WINDOW_MINUTES = 30;

function pickupWindowStart(pickupDate, pickupWindow) {
  const startTime = pickupWindow.split("-")[0]?.trim(); // "12:00-13:00" -> "12:00"
  if (!startTime) return null;
  // pickup_date/pickup_window are both stored in Asia/Taipei local terms
  // (spec's single-location pilot), so this constructs the instant as UTC+8.
  return new Date(`${pickupDate}T${startTime}:00+08:00`);
}

async function sendPickupReminders() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }); // YYYY-MM-DD
  const snap = await db
    .collection("locks")
    .where("status", "==", "locked")
    .where("pickup_date", "==", today)
    .get();

  const now = Date.now();
  let sent = 0;

  for (const doc of snap.docs) {
    const lock = doc.data();
    if (lock.reminder_sent) continue;

    const start = pickupWindowStart(lock.pickup_date, lock.pickup_window);
    if (!start) continue;
    const minutesUntilPickup = (start.getTime() - now) / 60000;
    if (minutesUntilPickup < 0 || minutesUntilPickup > REMINDER_WINDOW_MINUTES) continue;

    // Tokens live in lock_tokens (owner/admin-readable), not on the public lock doc.
    const tokenSnap = await db.collection("lock_tokens").doc(doc.id).get();
    const fcmToken = tokenSnap.exists ? tokenSnap.data().fcm_token : null;
    if (!fcmToken) continue;

    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: "取餐時間快到了",
          body: `${lock.item_name} 預計 ${lock.pickup_window} 取餐，別忘記囉！`,
        },
      });
      await doc.ref.update({ reminder_sent: true });
      sent++;
    } catch (err) {
      logger.error(`Failed to send pickup reminder for lock ${doc.id}`, err);
      // Leave reminder_sent unset so a transient failure can retry next run;
      // an invalid/expired token will just keep failing harmlessly.
    }
  }

  logger.info(`Sent ${sent} pickup reminder(s) for ${today}`);
  return sent;
}

exports.pickupReminders = onSchedule(
  { schedule: "every 15 minutes", timeZone: "Asia/Taipei", region: "asia-east1" },
  async () => {
    await sendPickupReminders();
  }
);

/** Manual trigger for local testing, same pattern as triggerCalibrationNow. */
exports.triggerPickupRemindersNow = onCall({ region: "asia-east1" }, async (request) => {
  assertAdminOrEmulator(request);
  const sent = await sendPickupReminders();
  return { sent };
});

/* ------------------------------------------------------------------ *
 * 5. Growth rewards — a vendor unlocks consumer draws once its
 *    cumulative payouts cross a revenue threshold (spec ref:
 *    VendorDashboard.dc.html「成長獎勵」). The draw itself must run here,
 *    not on the client: a client could otherwise just claim it won the
 *    0-yuan tier. TODO.md 2026-09-22 待辦：growth_rewards/draws collection
 *    設計 + 抽獎邏輯，這裡是那個實作，還沒因 Blaze 部署到正式站測過。
 * ------------------------------------------------------------------ */

// price_percent = 中獎後要付的比例（80 = 8折，0 = 整份免費），weight 是抽中
// 機率的相對權重，不是百分比本身。
const GROWTH_REWARD_TIERS = [
  { price_percent: 80, weight: 40 },
  { price_percent: 60, weight: 25 },
  { price_percent: 50, weight: 15 },
  { price_percent: 30, weight: 10 },
  { price_percent: 10, weight: 7 },
  { price_percent: 0, weight: 3 },
];

const GROWTH_REWARD_MILESTONES = [
  { id: "tier1", label: "20 萬門檻・單抽", threshold: 200000 },
  { id: "tier2", label: "100 萬門檻・十連抽", threshold: 1000000 },
];

const DEFAULT_VOUCHER_TOTAL = 10;

function pickWeightedTier() {
  const totalWeight = GROWTH_REWARD_TIERS.reduce((sum, t) => sum + t.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const tier of GROWTH_REWARD_TIERS) {
    if (roll < tier.weight) return tier.price_percent;
    roll -= tier.weight;
  }
  return GROWTH_REWARD_TIERS[GROWTH_REWARD_TIERS.length - 1].price_percent;
}

// Reuses the payouts collection's existing vendor_id index rather than a
// separate running-total field, so there's nothing to keep in sync by hand.
async function vendorCumulativeRevenue(vendorId) {
  const snap = await db.collection("payouts").where("vendor_id", "==", vendorId).get();
  return snap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0);
}

/**
 * Consumers need to know whether a vendor's draw is unlocked, but payouts
 * (the revenue itself) is owner/admin-only (ISO 27001 A.5.34). So publish
 * only the milestone ids reached onto the public growth_rewards doc — never
 * the amount. Recomputed at every settlement (daily schedule + manual
 * trigger), which also backfills vendors that crossed a threshold earlier.
 */
async function syncGrowthUnlock(vendorId) {
  const revenue = await vendorCumulativeRevenue(vendorId);
  const unlocked = GROWTH_REWARD_MILESTONES.filter((m) => revenue >= m.threshold).map((m) => m.id);
  await db.collection("growth_rewards").doc(vendorId).set({ unlocked_milestones: unlocked }, { merge: true });
  return unlocked;
}

exports.drawGrowthReward = onCall({ region: "asia-east1" }, async (request) => {
  assertSignedInUser(request, "draw");
  const { vendor_id: vendorId, item_name: itemName } = request.data || {};
  if (!vendorId) throw new HttpsError("invalid-argument", "vendor_id is required");

  const cumulativeRevenue = await vendorCumulativeRevenue(vendorId);
  if (cumulativeRevenue < GROWTH_REWARD_MILESTONES[0].threshold) {
    throw new HttpsError("failed-precondition", "This vendor hasn't unlocked draws yet.");
  }

  const rewardRef = db.collection("growth_rewards").doc(vendorId);
  const pricePercent = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rewardRef);
    const voucherRemaining = snap.exists ? snap.data().voucher_remaining : DEFAULT_VOUCHER_TOTAL;
    const voucherTotal = snap.exists ? snap.data().voucher_total : DEFAULT_VOUCHER_TOTAL;

    let tier = pickWeightedTier();
    // 0 元券見底後自動降級為保底 1 折券，六級機制照樣運作，只是拿不到整份免費。
    if (tier === 0 && voucherRemaining <= 0) tier = 10;

    tx.set(
      rewardRef,
      { voucher_total: voucherTotal, voucher_remaining: tier === 0 ? voucherRemaining - 1 : voucherRemaining },
      { merge: true }
    );
    return tier;
  });

  // draws is publicly readable (winners ticker), so store only a short display
  // tag, never the full uid — it now belongs to a registered account.
  await db.collection("draws").add({
    vendor_id: vendorId,
    buyer_tag: request.auth.uid.slice(-6),
    item_name: itemName || null,
    price_percent: pricePercent,
    created_at: FieldValue.serverTimestamp(),
  });

  return { price_percent: pricePercent };
});

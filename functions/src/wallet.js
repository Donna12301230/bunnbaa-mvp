// Platform points (2026-10-09): every refund becomes points first, 1 point = NT$1, redeemable at
// checkout (any vendor, no expiry). Members can also press "Refund to LINE Pay" to send refundable
// points back to the original payment transaction.
//
// Data:
//   wallets/{uid}: balance (available points), updated_at
//   wallets/{uid}/lots/{id}: one lot of points. source_tx = the LINE Pay transaction that originally paid
//     this money (null = not refundable, e.g. test or legacy data), amount (when credited), remaining
//     (what's left), reason, lock_id, created_at
//   wallets/{uid}/holds/{orderId}: points held at checkout (payment succeeds = used; cancelled/timed out
//     = released back to the lots)
//   wallets/{uid}/entries/{id}: ledger (credit, spend at checkout, release of a hold, withdraw to LINE Pay)
//
// Refunds to LINE Pay always go to the original transaction recorded on the lot, never more than that
// transaction originally paid:
//   - When a refund is credited, it is split into lots by the order's funding sources: the cash part first
//     (the order's transaction_id), then the part originally paid with points (keeping those points'
//     original source transactions)
//   - Checkout records which lots were drawn on, so money from one transaction only ever exists once in the system
// funding on locks: [{ tx, amount }] = money still refundable on this order and which transaction each part
// came from; legacy data without it is derived from transaction_id / paid_amount.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { Timestamp } = require("firebase-admin/firestore");
const { REGION, db, onCall, HttpsError, logger, FieldValue, t, assertSignedInUser, assertAdminOrEmulator, notifyUser } = require("./common");
const { refundPayment } = require("./linePay");

const HOLD_TTL_MS = 40 * 60 * 1000; // The LINE Pay payment page expires after about 20 minutes; return the points if still unpaid after 40

const walletRef = (uid) => db().collection("wallets").doc(uid);
const lotsOf = (uid) => walletRef(uid).collection("lots");
const holdRef = (uid, orderId) => walletRef(uid).collection("holds").doc(orderId);
const entryRef = (uid) => walletRef(uid).collection("entries").doc();

const int = (n) => Math.max(0, Math.round(Number(n) || 0));

/** Money still refundable on the order, with its sources */
function fundingOf(lock) {
  if (Array.isArray(lock.funding)) return lock.funding.filter((f) => f && int(f.amount) > 0).map((f) => ({ tx: f.tx || null, amount: int(f.amount) }));
  const paid = Number.isFinite(lock.paid_amount) ? lock.paid_amount : lock.locked_price || 0;
  return int(paid) > 0 ? [{ tx: lock.transaction_id || null, amount: int(paid) }] : [];
}

/** Take amount from the funding sources (cash first, in order); returns { taken: source[], rest: remaining funding } */
function takeFunding(funding, amount) {
  let left = int(amount);
  const taken = [];
  const rest = [];
  for (const f of funding) {
    const use = Math.min(left, f.amount);
    if (use > 0) taken.push({ tx: f.tx, amount: use });
    if (f.amount - use > 0) rest.push({ tx: f.tx, amount: f.amount - use });
    left -= use;
  }
  return { taken, rest, short: left };
}

/**
 * Credit points, split into lots by source. Works inside an outer transaction (pass tx) or standalone.
 * text / textEn: the item name shown on the wallet entry (text_en falls back to text when there's no English name).
 */
function writeCredit(tx, uid, sources, { reason, lockId = null, text = "", textEn = "" }) {
  const total = sources.reduce((s, x) => s + int(x.amount), 0);
  if (total <= 0) return 0;
  for (const s of sources) {
    if (int(s.amount) <= 0) continue;
    tx.set(lotsOf(uid).doc(), {
      source_tx: s.tx || null, amount: int(s.amount), remaining: int(s.amount),
      reason, lock_id: lockId, created_at: FieldValue.serverTimestamp(),
    });
  }
  tx.set(walletRef(uid), { balance: FieldValue.increment(total), updated_at: FieldValue.serverTimestamp() }, { merge: true });
  tx.set(entryRef(uid), { type: "credit", amount: total, reason, lock_id: lockId, text, text_en: textEn || text,
    created_at: FieldValue.serverTimestamp(),
  });
  return total;
}

async function creditPoints(uid, sources, opts) {
  if (!uid) return 0;
  let total = 0;
  await db().runTransaction(async (tx) => {
    total = writeCredit(tx, uid, sources, opts);
  });
  return total;
}

/**
 * Refund = refund as points: take amount from the order's funding and credit it to the payer; returns
 * { credited, funding (what remains) }. The caller writes the remaining funding back to the lock (in the
 * same batch/transaction).
 */
function refundSources(lock, amount) {
  const { taken, rest } = takeFunding(fundingOf(lock), amount);
  return { sources: taken, funding: rest, amount: taken.reduce((s, x) => s + x.amount, 0) };
}

/**
 * Redeem at checkout: hold amount points (non-refundable lots first, then oldest first), recorded in
 * holds/{orderId}. Returns what was actually held, { used, sources:[{tx, amount}] } (down to 0 if the
 * balance is short).
 */
async function holdPoints(uid, orderId, amount) {
  const want = int(amount);
  if (want <= 0) return { used: 0, sources: [] };
  return db().runTransaction(async (tx) => {
    const wallet = await tx.get(walletRef(uid));
    const balance = int(wallet.data()?.balance);
    if (balance <= 0) return { used: 0, sources: [] };
    const lots = (await tx.get(lotsOf(uid).where("remaining", ">", 0))).docs
      .sort((a, b) => (a.data().source_tx ? 1 : 0) - (b.data().source_tx ? 1 : 0)
        || (a.data().created_at?.toMillis?.() ?? 0) - (b.data().created_at?.toMillis?.() ?? 0));
    let left = Math.min(want, balance);
    const taken = [];
    for (const lot of lots) {
      if (left <= 0) break;
      const use = Math.min(left, int(lot.data().remaining));
      if (use <= 0) continue;
      taken.push({ lot_id: lot.id, tx: lot.data().source_tx || null, amount: use });
      left -= use;
    }
    const used = taken.reduce((s, x) => s + x.amount, 0);
    if (used <= 0) return { used: 0, sources: [] };
    for (const x of taken) tx.update(lotsOf(uid).doc(x.lot_id), { remaining: FieldValue.increment(-x.amount) });
    tx.set(walletRef(uid), { balance: FieldValue.increment(-used), updated_at: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(holdRef(uid, orderId), { status: "held", amount: used, sources: taken, created_at: FieldValue.serverTimestamp() });
    return { used, sources: taken.map(({ tx: source, amount: a }) => ({ tx: source, amount: a })) };
  });
}

/** Payment didn't go through (cancelled, sold out, timed out): return held points to their lots. Safe to call repeatedly. */
async function releaseHold(uid, orderId, why = "released") {
  if (!uid || !orderId) return 0;
  return db().runTransaction(async (tx) => {
    const ref = holdRef(uid, orderId);
    const hold = await tx.get(ref);
    if (!hold.exists || hold.data().status !== "held") return 0;
    const { amount, sources = [] } = hold.data();
    for (const x of sources) tx.update(lotsOf(uid).doc(x.lot_id), { remaining: FieldValue.increment(int(x.amount)) });
    tx.set(walletRef(uid), { balance: FieldValue.increment(int(amount)), updated_at: FieldValue.serverTimestamp() }, { merge: true });
    tx.update(ref, { status: why, released_at: FieldValue.serverTimestamp() });
    tx.set(entryRef(uid), { type: "release", amount: int(amount), order_id: orderId, created_at: FieldValue.serverTimestamp() });
    return int(amount);
  });
}

/**
 * Payment confirmation takes three steps so "LINE Pay has charged" and "timeout returned the points"
 * can't both happen:
 *   lockHold: held → confirming (the schedule only releases held); false = already released on
 *     timeout, do not charge
 *   commitHold: confirming → used (charge succeeded)
 *   unlockHold: confirming → held (charge failed, let the buyer retry)
 * Orders that didn't use points have no hold; all three just return true.
 */
async function moveHold(uid, orderId, from, to, entry) {
  return db().runTransaction(async (tx) => {
    const ref = holdRef(uid, orderId);
    const hold = await tx.get(ref);
    if (!hold.exists) return true;
    const status = hold.data().status;
    if (status === to) return true;
    if (status !== from) return false;
    tx.update(ref, { status: to, [`${to}_at`]: FieldValue.serverTimestamp() });
    if (entry) tx.set(entryRef(uid), { type: entry, amount: int(hold.data().amount), order_id: orderId, created_at: FieldValue.serverTimestamp() });
    return true;
  });
}
const lockHold = (uid, orderId) => moveHold(uid, orderId, "held", "confirming");
const commitHold = (uid, orderId) => moveHold(uid, orderId, "confirming", "used", "spend");
const unlockHold = (uid, orderId) => moveHold(uid, orderId, "confirming", "held");

/** Split one payment's point sources across several orders in order (a cart checks out many at once); returns { points, funding } per order */
function splitFunding(prices, cashTx, pointSources) {
  const pool = pointSources.map((s) => ({ ...s }));
  return prices.map((price) => {
    let need = int(price);
    const fromPoints = [];
    for (const s of pool) {
      if (need <= 0) break;
      const use = Math.min(need, s.amount);
      if (use <= 0) continue;
      fromPoints.push({ tx: s.tx, amount: use });
      s.amount -= use;
      need -= use;
    }
    const points = int(price) - need;
    // Cash first: refunds return the cash part first
    const funding = [...(need > 0 ? [{ tx: cashTx || null, amount: need }] : []), ...fromPoints];
    return { points, funding };
  });
}

/* ------------------------------------------------------------------ *
 * callables
 * ------------------------------------------------------------------ */

/** Member center: refund to LINE Pay. Each lot goes back to its recorded original transaction; failed ones stay, and the result reports what didn't go through. */
exports.withdrawPoints = onCall({}, async (request) => {
  assertSignedInUser(request, "退回點數", "refund points");
  const uid = request.auth.uid;
  const lots = (await lotsOf(uid).where("remaining", ">", 0).get()).docs.filter((d) => d.data().source_tx);
  let withdrawn = 0;
  let failed = 0;
  for (const lot of lots) {
    // Deduct before refunding and add back on failure, so a double click can't refund twice
    const amount = await db().runTransaction(async (tx) => {
      const fresh = await tx.get(lot.ref);
      const remaining = int(fresh.data()?.remaining);
      if (remaining <= 0) return 0;
      tx.update(lot.ref, { remaining: 0, withdrawing: remaining });
      tx.set(walletRef(uid), { balance: FieldValue.increment(-remaining), updated_at: FieldValue.serverTimestamp() }, { merge: true });
      return remaining;
    });
    if (amount <= 0) continue;
    try {
      await refundPayment({ transactionId: lot.data().source_tx, refundAmount: amount });
      const batch = db().batch();
      batch.update(lot.ref, { withdrawing: FieldValue.delete(), withdrawn: FieldValue.increment(amount) });
      batch.set(entryRef(uid), { type: "withdraw", amount, source_tx: lot.data().source_tx, created_at: FieldValue.serverTimestamp() });
      await batch.commit();
      withdrawn += amount;
    } catch (err) {
      logger.error(`withdrawPoints refund failed (${lot.ref.path})`, err);
      const batch = db().batch();
      batch.update(lot.ref, { remaining: FieldValue.increment(amount), withdrawing: FieldValue.delete(), withdraw_error: String(err.message || err).slice(0, 200) });
      batch.set(walletRef(uid), { balance: FieldValue.increment(amount), updated_at: FieldValue.serverTimestamp() }, { merge: true });
      await batch.commit();
      failed += amount;
    }
  }
  return { withdrawn, failed };
});

/**
 * Admin: the vendor failed to serve the meal (or another platform-confirmed case) → refund this meal
 * in full as points to the payer. Status becomes cancelled / vendor_failed so payout skips the vendor.
 */
exports.refundLockAsPoints = onCall({}, async (request) => {
  assertAdminOrEmulator(request);
  const lockId = String(request.data?.lock_id || "");
  const note = String(request.data?.note || "").trim().slice(0, 200);
  if (!lockId) throw new HttpsError("invalid-argument", "lock_id is required");
  const ref = db().collection("locks").doc(lockId);
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "lock not found");
    const lock = snap.data();
    if (lock.status === "cancelled") throw new HttpsError("failed-precondition", t("這份已經取消／退款過了", "Already cancelled or refunded"));
    const payer = lock.payer_uid || lock.buyer_uid;
    const { sources, funding, amount } = refundSources(lock, Infinity);
    writeCredit(tx, payer, sources, { reason: "vendor_failed", lockId, text: lock.item_name || "", textEn: lock.item_name_en || "" });
    tx.update(ref, {
      status: "cancelled", cancel_reason: "vendor_failed", cancel_note: note || null,
      refunded_amount: (lock.refunded_amount || 0) + amount, funding, cancelled_at: FieldValue.serverTimestamp(),
    });
    return { payer, amount, item: lock.item_name, itemEn: lock.item_name_en || lock.item_name };
  });
  if (result.amount > 0) {
    // Admin action: the text follows the payer's language, not the admin's
    await notifyUser(result.payer, () => ({
      kind: "refund",
      title: t("已全額退成平台點數", "Refunded as BunnBaa points"),
      body: t(`「${result.item}」已全額退成 ${result.amount} 點，可在結帳時折抵，或到會員中心退回 LINE Pay。`, `${result.itemEn} was refunded as ${result.amount} points — use them at checkout or send them back to LINE Pay from My account.`),
      link: "/profile?tab=points",
    })).catch(() => undefined);
  }
  return { refunded_points: result.amount };
});

/** Cancelled on the payment page (redirected back from the LINE Pay cancel URL): return the held points */
exports.cancelPaymentIntent = onCall({}, async (request) => {
  assertSignedInUser(request, "取消付款", "cancel a payment");
  const orderId = String(request.data?.order_id || "");
  if (!orderId) throw new HttpsError("invalid-argument", "order_id is required");
  const ref = db().collection("payment_intents").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().buyer_uid !== request.auth.uid) return { released: 0 };
  if (snap.data().status !== "pending") return { released: 0 };
  await ref.update({ status: "cancelled" });
  // Resale take-over: release the 15-minute reservation
  if (snap.data().kind === "resale" && snap.data().lock_id) {
    const lockRef = db().collection("locks").doc(snap.data().lock_id);
    await db().runTransaction(async (tx) => {
      const lock = (await tx.get(lockRef)).data();
      if (lock?.resale_hold?.intent_id === orderId) tx.update(lockRef, { resale_hold: FieldValue.delete() });
    }).catch(() => undefined);
  }
  return { released: await releaseHold(request.auth.uid, orderId, "cancelled") };
});

/** Orders abandoned before payment: return held points after 40 minutes (confirmation sees they were released and blocks the charge) */
exports.releaseStalePointHolds = onSchedule({ schedule: "every 10 minutes", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const cutoff = Timestamp.fromMillis(Date.now() - HOLD_TTL_MS);
  const snap = await db().collectionGroup("holds").where("status", "==", "held").where("created_at", "<", cutoff).limit(200).get();
  for (const doc of snap.docs) {
    const uid = doc.ref.parent.parent.id;
    const intentRef = db().collection("payment_intents").doc(doc.id);
    const intent = await intentRef.get();
    if (intent.exists && !["pending", "sold_out", "coupon_gone", "gone", "cancelled"].includes(intent.data().status)) continue;
    if (intent.exists && intent.data().status === "pending") await intentRef.update({ status: "expired" });
    await releaseHold(uid, doc.id, "expired").catch((err) => logger.warn(`release hold ${doc.ref.path}`, err));
  }
});

module.exports.helpers = { fundingOf, takeFunding, refundSources, writeCredit, creditPoints, holdPoints, releaseHold, lockHold, commitHold, unlockHold, splitFunding };

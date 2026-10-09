// 平台點數（2026-10-09）：所有退款都先變成點數，1 點＝1 元，結帳時可以折抵（跨店、不過期），
// 會員也可以自己按「退回 LINE Pay」把可退的點數退回原付款交易。
//
// 資料：
//   wallets/{uid}：balance（可用點數）、updated_at
//   wallets/{uid}/lots/{id}：一批點數。source_tx＝這筆錢最早是哪一筆 LINE Pay 交易付的（null＝不能退回，
//     例如測試資料或舊資料），amount（入帳時）、remaining（還剩多少）、reason、lock_id、created_at
//   wallets/{uid}/holds/{orderId}：結帳時先扣住的點數（付款成功＝used，取消／逾時＝released 還回批次）
//   wallets/{uid}/entries/{id}：明細（credit 入帳、spend 折抵、release 退還扣住、withdraw 退回 LINE Pay）
//
// 退回 LINE Pay 一律退到批次記的原交易，金額不會超過那筆交易當初付的：
//   - 退款入帳時依訂單的資金來源（funding）拆批：先退現金部分（訂單的 transaction_id），再退當初用點數折抵的部分
//     （沿用那些點數原本的來源交易）
//   - 結帳折抵時記下扣了哪些批次，所以同一筆交易的錢在系統裡永遠只會有一份
// locks 上的 funding：[{ tx, amount }]＝這筆訂單還能退的錢、各自來自哪筆交易；舊資料沒有就由 transaction_id／paid_amount 推。
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { Timestamp } = require("firebase-admin/firestore");
const { REGION, db, onCall, HttpsError, logger, FieldValue, t, assertSignedInUser, assertAdminOrEmulator, notifyUser } = require("./common");
const { refundPayment } = require("./linePay");

const HOLD_TTL_MS = 40 * 60 * 1000; // LINE Pay 付款頁大約 20 分鐘失效；超過 40 分鐘還沒付款就把點數還回去

const walletRef = (uid) => db().collection("wallets").doc(uid);
const lotsOf = (uid) => walletRef(uid).collection("lots");
const holdRef = (uid, orderId) => walletRef(uid).collection("holds").doc(orderId);
const entryRef = (uid) => walletRef(uid).collection("entries").doc();

const int = (n) => Math.max(0, Math.round(Number(n) || 0));

/** 訂單目前還能退的錢與來源 */
function fundingOf(lock) {
  if (Array.isArray(lock.funding)) return lock.funding.filter((f) => f && int(f.amount) > 0).map((f) => ({ tx: f.tx || null, amount: int(f.amount) }));
  const paid = Number.isFinite(lock.paid_amount) ? lock.paid_amount : lock.locked_price || 0;
  return int(paid) > 0 ? [{ tx: lock.transaction_id || null, amount: int(paid) }] : [];
}

/** 從資金來源取出 amount（先現金、照順序），回傳 { taken: 來源[], rest: 剩下的 funding } */
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

/** 入帳：依來源拆成批次。可在外部 transaction 裡用（傳 tx），也可以自己開。 */
function writeCredit(tx, uid, sources, { reason, lockId = null, text = "" }) {
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
  tx.set(entryRef(uid), { type: "credit", amount: total, reason, lock_id: lockId, text, created_at: FieldValue.serverTimestamp() });
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
 * 退款＝退成點數：從訂單的 funding 取出 amount 入帳給付款人，回傳 { credited, funding（剩下的）}。
 * 呼叫端負責把剩下的 funding 寫回 lock（同一個 batch／transaction 裡）。
 */
function refundSources(lock, amount) {
  const { taken, rest } = takeFunding(fundingOf(lock), amount);
  return { sources: taken, funding: rest, amount: taken.reduce((s, x) => s + x.amount, 0) };
}

/**
 * 結帳折抵：扣住 amount 點（不能退回的批次先用，再用最舊的），記在 holds/{orderId}。
 * 回傳實際扣到的 { used, sources:[{tx, amount}] }（餘額不足就扣到 0 為止）。
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

/** 付款沒成功（取消、額滿、逾時）：把扣住的點數還回原批次。重複呼叫沒關係。 */
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
 * 確認付款分三步，避免「LINE Pay 已扣款」和「逾時把點數還回去」同時發生：
 *   lockHold：held → confirming（排程只會還 held 的）；回傳 false＝已經逾時還回去了，不能扣款
 *   commitHold：confirming → used（扣款成功）
 *   unlockHold：confirming → held（扣款失敗，讓買家重試）
 * 沒有用點數的訂單沒有 hold，三個都直接回 true。
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

/** 把一筆付款的點數來源依序分給多份訂單（購物車一次結很多份）；回傳每份的 { points, funding } */
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
    // 現金在前：退款時先退現金部分
    const funding = [...(need > 0 ? [{ tx: cashTx || null, amount: need }] : []), ...fromPoints];
    return { points, funding };
  });
}

/* ------------------------------------------------------------------ *
 * callables
 * ------------------------------------------------------------------ */

/** 會員中心：退回 LINE Pay。每一批退到它記的原交易；失敗的留著，回傳哪些沒退成功。 */
exports.withdrawPoints = onCall({}, async (request) => {
  assertSignedInUser(request, "退回點數");
  const uid = request.auth.uid;
  const lots = (await lotsOf(uid).where("remaining", ">", 0).get()).docs.filter((d) => d.data().source_tx);
  let withdrawn = 0;
  let failed = 0;
  for (const lot of lots) {
    // 先扣掉再退款，失敗再加回去，避免同時按兩次退兩次
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
 * 管理員：店家未如期出餐（或其他平台確認的狀況）→ 這份餐點全額退成點數給付款人。
 * 狀態改成 cancelled／vendor_failed，撥款時就不會撥給店家。
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
    writeCredit(tx, payer, sources, { reason: "vendor_failed", lockId, text: lock.item_name || "" });
    tx.update(ref, {
      status: "cancelled", cancel_reason: "vendor_failed", cancel_note: note || null,
      refunded_amount: (lock.refunded_amount || 0) + amount, funding, cancelled_at: FieldValue.serverTimestamp(),
    });
    return { payer, amount, item: lock.item_name };
  });
  if (result.amount > 0) {
    await notifyUser(result.payer, {
      kind: "refund",
      title: t("已全額退成平台點數", "Refunded as BunnBaa points"),
      body: t(`「${result.item}」已全額退成 ${result.amount} 點，可在結帳時折抵，或到會員中心退回 LINE Pay。`, `${result.item} was refunded as ${result.amount} points — use them at checkout or send them back to LINE Pay from My account.`),
      link: "/profile?tab=points",
    }).catch(() => undefined);
  }
  return { refunded_points: result.amount };
});

/** 付款頁取消（LINE Pay 取消網址導回來）：把這筆扣住的點數還回去 */
exports.cancelPaymentIntent = onCall({}, async (request) => {
  assertSignedInUser(request, "取消付款");
  const orderId = String(request.data?.order_id || "");
  if (!orderId) throw new HttpsError("invalid-argument", "order_id is required");
  const ref = db().collection("payment_intents").doc(orderId);
  const snap = await ref.get();
  if (!snap.exists || snap.data().buyer_uid !== request.auth.uid) return { released: 0 };
  if (snap.data().status !== "pending") return { released: 0 };
  await ref.update({ status: "cancelled" });
  // 轉讓接手：放掉 15 分鐘保留
  if (snap.data().kind === "resale" && snap.data().lock_id) {
    const lockRef = db().collection("locks").doc(snap.data().lock_id);
    await db().runTransaction(async (tx) => {
      const lock = (await tx.get(lockRef)).data();
      if (lock?.resale_hold?.intent_id === orderId) tx.update(lockRef, { resale_hold: FieldValue.delete() });
    }).catch(() => undefined);
  }
  return { released: await releaseHold(request.auth.uid, orderId, "cancelled") };
});

/** 沒付完款就離開的訂單：40 分鐘後把扣住的點數還回去（確認時發現已還回會擋下，不會扣款） */
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

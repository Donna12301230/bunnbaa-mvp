// Growth rewards and coupons.
//
// vendors/{v}/rewardPeriods/{Monday date} (readable by the vendor owner / admins):
//   net_revenue, refunds, tickets, carried_revenue, carried_tickets,
//   status: accumulating|carried|pooled|closed|paused, pool, allocation{code:n}, remaining{code:n},
//   draw_deadline, leftover, unclaimed_amount
// rewardStatus/{vendorId} (public, progress only, no amounts):
//   tickets_so_far, revenue_so_far, min_revenue, amount_to_open (NT$X more until the draw), pool_open, draw_deadline, pool_period
// userSpend/{vendorId}_{uid}: carry (remainder under NT$100, carried into the next period), cumulative, tickets_issued
// rewardTickets/{id}: vendor_id, user_id, period_id, status: pending|drawable|drawn|forfeited|revoked, pool_period, coupon_id
// coupons/{id}: vendor_id, tier, discount, status: issued|owned|redeemed|expired|unclaimed, pool_period,
//   user_id, owned_at, expires_at, lock_id
//   tier: "refund" is a coupon issued for a cancelled order (orders.js cancelLock issues it directly as owned, bypassing the reward pool; source_lock_id records the source order)
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { Timestamp } = require("firebase-admin/firestore");
const {
  REGION, db, onCall, HttpsError, FieldValue, logger, t, assertSignedInUser, assertAdminOrEmulator, callerVendorId,
  notifyUser, notifyVendor, forEachVendor, BatchWriter,
} = require("./common");
const { loadPlatformConfig, COUPON_TIERS, BASE_TIER } = require("./config");
const { allocatePool, pickTier, tierInfo } = require("./rewards");
const { taipeiToday, addDays, mondayOf } = require("./calendar");

const COUNTED_STATUSES = ["fulfilled", "resold_and_fulfilled", "charity"];

function periodRef(vendorId, periodId) {
  return db().collection("vendors").doc(vendorId).collection("rewardPeriods").doc(periodId);
}

/** Public progress: draw tickets accumulated this period (including carry-over from earlier periods) and how far from opening the pool */
async function refreshRewardStatus(vendorId) {
  const config = await loadPlatformConfig(db());
  const current = mondayOf(taipeiToday());
  const cur = (await periodRef(vendorId, current).get()).data() || {};
  const ticketsSoFar = (cur.tickets || 0) + (cur.carried_tickets || 0);
  const revenueSoFar = (cur.net_revenue || 0) + (cur.carried_revenue || 0);
  const pooled = await db().collection("vendors").doc(vendorId).collection("rewardPeriods").where("status", "==", "pooled").get();
  const open = pooled.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.id.localeCompare(a.id))[0];
  const vendor = (await db().collection("vendors").doc(vendorId).get()).data() || {};
  await db().collection("rewardStatus").doc(vendorId).set({
    vendor_name: vendor.name || "",
    tickets_so_far: ticketsSoFar,
    revenue_so_far: Math.max(0, revenueSoFar),
    min_revenue: config.minRevenueToOpen,
    amount_to_open: Math.max(0, config.minRevenueToOpen - revenueSoFar),
    pool_open: !!open,
    pool_period: open?.id || null,
    draw_deadline: open?.draw_deadline || null,
    remaining_total: open ? Object.values(open.remaining || {}).reduce((s, n) => s + n, 0) : 0,
    paused: !!vendor.rewards_paused_from && vendor.rewards_paused_from <= current,
    updated_at: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * onOrderCompleted / onOrderRefunded:
 * - Pickup completed or converted to a charity meal → add to net revenue, add to the payer's cumulative spend, one draw ticket per NT$100
 * - Refunded after being counted (work-suspension cancellation etc.) → subtract from the current period's revenue (may go negative, carried over) and revoke draw tickets whose pool hasn't opened
 */
exports.onLockWritten = onDocumentWritten({ document: "locks/{lockId}", region: REGION }, async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return;
  const lock = after.data();
  const lockRef = after.ref;
  if (COUNTED_STATUSES.includes(lock.status) && !lock.reward_counted) {
    await countLock(lockRef);
  } else if (lock.status === "cancelled" && lock.reward_counted && !lock.refund_counted) {
    await uncountLock(lockRef);
  }
});

async function countLock(lockRef) {
  const config = await loadPlatformConfig(db());
  const result = await db().runTransaction(async (tx) => {
    const lock = (await tx.get(lockRef)).data();
    if (lock.reward_counted || !COUNTED_STATUSES.includes(lock.status)) return null;
    const vendorId = lock.vendor_id;
    const payer = lock.payer_uid || lock.buyer_uid;
    const periodId = mondayOf(lock.pickup_date || taipeiToday());
    const vendor = (await tx.get(db().collection("vendors").doc(vendorId))).data() || {};
    const paused = vendor.rewards_paused_from && vendor.rewards_paused_from <= periodId;
    const paid = Math.max(0, Number(lock.locked_price) || 0);
    const spendRef = db().collection("userSpend").doc(`${vendorId}_${payer}`);
    const spend = (await tx.get(spendRef)).data() || {};
    const pRef = periodRef(vendorId, periodId);
    let tickets = 0;
    if (!paused) {
      const total = (spend.carry || 0) + paid;
      tickets = Math.floor(total / config.ticketUnit);
      tx.set(spendRef, {
        vendor_id: vendorId, user_id: payer, carry: total - tickets * config.ticketUnit,
        cumulative: (spend.cumulative || 0) + paid, tickets_issued: (spend.tickets_issued || 0) + tickets,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
      for (let i = 0; i < tickets; i++) {
        tx.set(db().collection("rewardTickets").doc(), {
          vendor_id: vendorId, vendor_name: vendor.name || "", user_id: payer, period_id: periodId, lock_id: lockRef.id,
          status: "pending", created_at: FieldValue.serverTimestamp(),
        });
      }
      tx.set(pRef, {
        period_id: periodId, net_revenue: FieldValue.increment(paid), tickets: FieldValue.increment(tickets),
        status_hint: "accumulating",
      }, { merge: true });
    }
    tx.update(lockRef, { reward_counted: true, tickets_issued: tickets, reward_period: periodId });
    return { vendorId, payer, tickets, name: vendor.name };
  });
  if (result) {
    await refreshRewardStatus(result.vendorId);
    if (result.tickets > 0) {
      await notifyUser(result.payer, {
        kind: "reward",
        title: t(`獲得 ${result.tickets} 張抽獎券`, `You got ${result.tickets} draw ticket(s)`),
        body: t(`「${result.name}」的回饋池開池後就能抽，人人有獎。`, `Draw once ${result.name}'s reward pool opens — everyone wins something.`),
        link: "/rewards",
      });
    }
  }
}

async function uncountLock(lockRef) {
  const lock = (await lockRef.get()).data();
  const periodId = mondayOf(taipeiToday());
  const paid = Math.max(0, Number(lock.refunded_amount ?? lock.locked_price) || 0);
  await periodRef(lock.vendor_id, periodId).set({
    period_id: periodId, net_revenue: FieldValue.increment(-paid), refunds: FieldValue.increment(paid),
  }, { merge: true });
  // Revoke the draw tickets issued for this order whose pool hasn't opened
  const tickets = await db().collection("rewardTickets").where("lock_id", "==", lockRef.id).where("status", "==", "pending").get();
  const batch = db().batch();
  tickets.docs.forEach((d) => batch.update(d.ref, { status: "revoked" }));
  batch.update(lockRef, { refund_counted: true });
  await batch.commit();
  await refreshRewardStatus(lock.vendor_id);
}

/**
 * Settle the previous period: the pool opens only when cumulative net revenue (including carry-over) reaches minRevenueToOpen (NT$10,000);
 * reward pool = revenue × rewardRate (5%); otherwise revenue and draw tickets carry over to the next period (no forced opening).
 * Idempotent: periods already pooled / carried / paused are not recomputed.
 */
async function closePeriodFor(vendor, periodId, config) {
  const ref = periodRef(vendor.id, periodId);
  const snap = await ref.get();
  const p = snap.exists ? snap.data() : {};
  if (["pooled", "carried", "closed", "paused"].includes(p.status)) return p.status;
  const nextId = addDays(periodId, 7);
  const totalRevenue = (p.net_revenue || 0) + (p.carried_revenue || 0);
  if (vendor.rewards_paused_from && vendor.rewards_paused_from <= periodId) {
    await ref.set({ status: "paused" }, { merge: true });
    return "paused";
  }
  // Draw tickets accumulated this period and in earlier periods whose pool hasn't opened (excluding next-period tickets created after settlement)
  const pendingAll = await db().collection("rewardTickets").where("vendor_id", "==", vendor.id).where("status", "==", "pending").get();
  const pending = { docs: pendingAll.docs.filter((d) => (d.data().period_id || "") <= periodId) };
  const N = pending.docs.length;
  if (totalRevenue < config.minRevenueToOpen || N === 0) {
    await ref.set({ period_id: periodId, status: "carried", total_revenue: totalRevenue, total_tickets: N, closed_at: FieldValue.serverTimestamp() }, { merge: true });
    await periodRef(vendor.id, nextId).set({ period_id: nextId, carried_revenue: totalRevenue, carried_tickets: N }, { merge: true });
    return "carried";
  }
  const pool = Math.floor(Math.max(0, totalRevenue) * config.rewardRate);
  const { counts, spent, leftover } = allocatePool(pool, N);
  const drawDeadline = Timestamp.fromMillis(Date.now() + config.drawWindowDays * 86400000);
  const writer = new BatchWriter();
  for (const [code, n] of Object.entries(counts)) {
    const tier = tierInfo(code);
    for (let i = 0; i < n; i++) {
      await writer.set(db().collection("coupons").doc(), {
        vendor_id: vendor.id, vendor_name: vendor.name || "", tier: code, label: tier.label, discount: tier.discount,
        status: "issued", pool_period: periodId, issued_at: FieldValue.serverTimestamp(),
      });
    }
  }
  for (const d of pending.docs) await writer.update(d.ref, { status: "drawable", pool_period: periodId, draw_deadline: drawDeadline });
  await writer.set(ref, {
    period_id: periodId, status: "pooled", total_revenue: totalRevenue, total_tickets: N, pool, allocation: counts,
    remaining: counts, spent, leftover, draw_deadline: drawDeadline, opened_at: FieldValue.serverTimestamp(),
  }, { merge: true });
  await writer.flush();
  // Negative revenue never opens a pool, so totalRevenue ≥ 0 here; the next period starts from 0
  const holders = new Set(pending.docs.map((d) => d.data().user_id));
  for (const uid of holders) {
    await notifyUser(uid, {
      kind: "reward",
      title: t(`「${vendor.name}」開獎了！`, `${vendor.name}'s reward pool is open!`),
      body: t(`${config.drawWindowDays} 天內可以抽，人人有獎。`, `Draw within ${config.drawWindowDays} days — everyone wins.`),
      link: "/rewards",
    });
  }
  await notifyVendor(vendor.id, {
    title: t("本期回饋池已開池", "This period's reward pool is open"),
    body: t(`回饋池 ${pool} 元，${N} 張抽獎券。`, `Pool NT$${pool}, ${N} tickets.`),
    link: "/vendor-portal/growth",
  });
  return "pooled";
}

async function closeRewardPeriods(onlyVendorId) {
  const config = await loadPlatformConfig(db());
  const lastPeriod = addDays(mondayOf(taipeiToday()), -7);
  const results = {};
  await forEachVendor("closeRewardPeriod", async (vendor) => {
    if (onlyVendorId && vendor.id !== onlyVendorId) return;
    results[vendor.id] = await closePeriodFor(vendor, lastPeriod, config);
    await refreshRewardStatus(vendor.id);
  });
  return results;
}

exports.closeRewardPeriod = onSchedule({ schedule: "10 0 * * 1", timeZone: "Asia/Taipei", region: REGION }, async () => {
  await closeRewardPeriods();
});

/** For demos / missed runs: settle the previous period now; admins may pass period_id to settle any period (e.g. the current one) */
exports.triggerRewardPeriodNow = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  if (request.data?.period_id) {
    assertAdminOrEmulator(request);
    const config = await loadPlatformConfig(db());
    const vendor = { id: vendorId, ...(await db().collection("vendors").doc(vendorId).get()).data() };
    const status = await closePeriodFor(vendor, request.data.period_id, config);
    await refreshRewardStatus(vendorId);
    return { [vendorId]: status };
  }
  return closeRewardPeriods(vendorId);
});

/** Draw: sampling without replacement inside a transaction, weighted by remaining count per tier */
exports.drawTicket = onCall({}, async (request) => {
  assertSignedInUser(request, "抽獎");
  const uid = request.auth.uid;
  const config = await loadPlatformConfig(db());
  let ticketRef;
  if (request.data?.ticket_id) {
    ticketRef = db().collection("rewardTickets").doc(String(request.data.ticket_id));
  } else {
    const q = await db().collection("rewardTickets").where("user_id", "==", uid).where("vendor_id", "==", String(request.data?.vendor_id || "_"))
      .where("status", "==", "drawable").limit(1).get();
    if (q.empty) throw new HttpsError("not-found", t("沒有可以抽的抽獎券", "No tickets to draw"));
    ticketRef = q.docs[0].ref;
  }
  const result = await db().runTransaction(async (tx) => {
    const ticket = (await tx.get(ticketRef)).data();
    if (!ticket || ticket.user_id !== uid) throw new HttpsError("permission-denied", t("這不是你的抽獎券", "Not your ticket"));
    if (ticket.status !== "drawable") throw new HttpsError("failed-precondition", t("這張抽獎券目前不能抽", "This ticket can't be drawn now"));
    const pRef = periodRef(ticket.vendor_id, ticket.pool_period);
    const period = (await tx.get(pRef)).data();
    if (!period || period.status !== "pooled" || period.draw_deadline.toMillis() < Date.now()) {
      throw new HttpsError("failed-precondition", t("抽獎期限已過", "The draw window has closed"));
    }
    const remaining = { ...period.remaining };
    const code = pickTier(remaining);
    if (!code) throw new HttpsError("resource-exhausted", t("獎項已抽完", "No prizes left"));
    const couponSnap = await tx.get(db().collection("coupons")
      .where("vendor_id", "==", ticket.vendor_id).where("pool_period", "==", ticket.pool_period)
      .where("tier", "==", code).where("status", "==", "issued").limit(1));
    if (couponSnap.empty) throw new HttpsError("internal", "coupon inventory mismatch");
    const couponRef = couponSnap.docs[0].ref;
    const expiresAt = Timestamp.fromMillis(Date.now() + config.couponValidDays * 86400000);
    remaining[code] -= 1;
    tx.update(pRef, { remaining });
    tx.update(couponRef, { status: "owned", user_id: uid, owned_at: FieldValue.serverTimestamp(), expires_at: expiresAt, ticket_id: ticketRef.id });
    tx.update(ticketRef, { status: "drawn", coupon_id: couponRef.id, drawn_at: FieldValue.serverTimestamp() });
    const tier = tierInfo(code);
    return { coupon_id: couponRef.id, tier: code, label: tier.label, discount: tier.discount, expires_at: expiresAt.toMillis(), vendor_id: ticket.vendor_id };
  });
  // Public winners ticker (no uid)
  await db().collection("draws").add({
    vendor_id: result.vendor_id, buyer_tag: uid.slice(-4), tier: result.tier, label: result.label, discount: result.discount,
    created_at: FieldValue.serverTimestamp(),
  }).catch((err) => logger.warn("draw ticker write failed", err));
  await refreshRewardStatus(result.vendor_id);
  return result;
});

/** Daily: expire coupons, void tickets not drawn by the end of the draw window, remind 3 days before expiry */
exports.expireCoupons = onSchedule({ schedule: "every day 00:20", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const now = Timestamp.now();
  const expired = await db().collection("coupons").where("status", "==", "owned").where("expires_at", "<=", now).get();
  const writer = new BatchWriter();
  for (const d of expired.docs) await writer.update(d.ref, { status: "expired" });
  await writer.flush();
});

exports.closeDrawWindow = onSchedule({ schedule: "every day 00:30", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const now = Date.now();
  await forEachVendor("closeDrawWindow", async (vendor) => {
    const pooled = await db().collection("vendors").doc(vendor.id).collection("rewardPeriods").where("status", "==", "pooled").get();
    for (const p of pooled.docs) {
      if (p.data().draw_deadline.toMillis() > now) continue;
      const writer = new BatchWriter();
      const tickets = await db().collection("rewardTickets").where("vendor_id", "==", vendor.id).where("pool_period", "==", p.id).where("status", "==", "drawable").get();
      for (const d of tickets.docs) await writer.update(d.ref, { status: "forfeited" });
      const coupons = await db().collection("coupons").where("vendor_id", "==", vendor.id).where("pool_period", "==", p.id).where("status", "==", "issued").get();
      let unclaimed = 0;
      for (const d of coupons.docs) {
        unclaimed += d.data().discount || 0;
        await writer.update(d.ref, { status: "unclaimed" });
      }
      await writer.update(p.ref, { status: "closed", unclaimed_amount: unclaimed, closed_at: FieldValue.serverTimestamp() });
      await writer.flush();
    }
    await refreshRewardStatus(vendor.id);
  });
});

exports.couponReminders = onSchedule({ schedule: "every day 10:00", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const soon = Timestamp.fromMillis(Date.now() + 3 * 86400000);
  const snap = await db().collection("coupons").where("status", "==", "owned").where("expires_at", "<=", soon).get();
  for (const d of snap.docs) {
    const c = d.data();
    if (c.reminded) continue;
    await notifyUser(c.user_id, {
      kind: "reward",
      title: t("折價券快到期了", "Your coupon expires soon"),
      body: t(`「${c.vendor_name}」折 ${c.discount} 元券 ${c.expires_at.toDate().toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })} 到期`, `${c.vendor_name} NT$${c.discount} off coupon expires soon`),
      link: "/rewards",
    });
    await d.ref.update({ reminded: true });
  }
});

/** Vendor pauses participation in the next period: needs 7 days' notice; from the week 7 days out, no draw tickets are issued and no pool opens; coupons already issued are still honored */
exports.setRewardPause = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const ref = db().collection("vendors").doc(vendorId);
  if (request.data?.paused) {
    const from = mondayOf(addDays(taipeiToday(), 7 + 6)); // the next Monday at least 7 days out
    await ref.update({ rewards_paused_from: from });
    await refreshRewardStatus(vendorId);
    return { paused_from: from };
  }
  await ref.update({ rewards_paused_from: FieldValue.delete() });
  await refreshRewardStatus(vendorId);
  return { paused_from: null };
});

/**
 * Anomaly detection: flag and notify the platform and vendor; no automatic penalties.
 * - Users with ≥ 3 refunds within 7 days
 * - A single user holding > 20% of a period's draw tickets
 * - > 2 accounts claiming coupons from the same device (users.device_id, written by the frontend at login)
 */
exports.detectAnomalies = onSchedule({ schedule: "every day 03:00", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const since = Timestamp.fromMillis(Date.now() - 7 * 86400000);
  const cancelled = await db().collection("locks").where("status", "==", "cancelled").where("cancelled_at", ">=", since).get();
  const byUser = new Map();
  cancelled.docs.forEach((d) => {
    const x = d.data();
    if (x.cancel_reason !== "customer") return;
    const k = `${x.payer_uid || x.buyer_uid}|${x.vendor_id}`;
    byUser.set(k, (byUser.get(k) || 0) + 1);
  });
  const findings = [];
  for (const [k, n] of byUser) {
    if (n < 3) continue;
    const [uid, vendorId] = k.split("|");
    findings.push({ type: "refunds", user_id: uid, vendor_id: vendorId, detail: `7 天內退款 ${n} 筆` });
  }
  const tickets = await db().collection("rewardTickets").where("created_at", ">=", Timestamp.fromMillis(Date.now() - 14 * 86400000)).get();
  const perPeriod = new Map();
  tickets.docs.forEach((d) => {
    const x = d.data();
    const key = `${x.vendor_id}|${x.period_id}`;
    const m = perPeriod.get(key) ?? new Map();
    m.set(x.user_id, (m.get(x.user_id) || 0) + 1);
    perPeriod.set(key, m);
  });
  for (const [key, m] of perPeriod) {
    const total = [...m.values()].reduce((s, n) => s + n, 0);
    for (const [uid, n] of m) {
      if (total >= 20 && n / total > 0.2) {
        const [vendorId, period] = key.split("|");
        findings.push({ type: "ticket_share", user_id: uid, vendor_id: vendorId, detail: `${period} 期占 ${Math.round((n / total) * 100)}%（${n}/${total} 張）` });
      }
    }
  }
  const owners = await db().collection("coupons").where("status", "in", ["owned", "redeemed"]).get();
  const uids = [...new Set(owners.docs.map((d) => d.data().user_id).filter(Boolean))];
  const byDevice = new Map();
  for (const uid of uids) {
    const u = await db().collection("users").doc(uid).get();
    const device = u.exists ? u.data().device_id : null;
    if (device) byDevice.set(device, [...(byDevice.get(device) || []), uid]);
  }
  for (const [device, list] of byDevice) {
    if (list.length > 2) findings.push({ type: "device", user_id: list.join(","), vendor_id: null, detail: `同一裝置 ${list.length} 個帳號領券（${device.slice(0, 8)}…）` });
  }
  const today = taipeiToday();
  for (const f of findings) {
    const id = `${today}_${f.type}_${f.user_id.slice(0, 40)}_${f.vendor_id || "all"}`.replace(/[^\w-]/g, "_");
    await db().collection("anomalies").doc(id).set({ ...f, date: today, status: "open", created_at: FieldValue.serverTimestamp() }, { merge: true });
    if (f.vendor_id) {
      await notifyVendor(f.vendor_id, { title: t("異常提醒", "Anomaly flagged"), body: f.detail, link: "/vendor-portal/growth" });
    }
  }
});

module.exports.COUPON_TIER_CODES = [...COUPON_TIERS.map((x) => x.code), BASE_TIER.code];

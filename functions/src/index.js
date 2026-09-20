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
  const reportId = await runCalibrationForVendor(vendorId);
  return { report_id: reportId };
});

/* ------------------------------------------------------------------ *
 * 1a. Vendor marks pickup outcome (fulfilled / no-show)
 * ------------------------------------------------------------------ */

const VALID_OUTCOMES = ["fulfilled", "resold_and_fulfilled", "no_show"];

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

  const update = { status: outcome };
  if (outcome === "no_show" && note) {
    update.no_show_note = note;
  }
  await lockRef.update(update);

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
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in (anonymous is fine) to claim a lock");
  }
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

  await lockRef.update({ buyer_uid: request.auth.uid });
  return { lock_id: lockId };
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
    }
  }
);

/** Manual trigger for local testing / demo, same pattern as triggerCalibrationNow. */
exports.triggerSettlementNow = onCall({ region: "asia-east1" }, async (request) => {
  const vendorId = request.data?.vendor_id;
  if (!vendorId) throw new HttpsError("invalid-argument", "vendor_id is required");
  const payoutId = await settleVendorPayout(vendorId);
  return { payout_id: payoutId };
});

/* ------------------------------------------------------------------ *
 * 2. Vendor what-if follow-up (spec 4.1a)
 * ------------------------------------------------------------------ */
exports.askCalibrationScenario = onCall({ region: "asia-east1" }, async (request) => {
  const { vendor_id: vendorId, question } = request.data || {};
  if (!vendorId || !question) {
    throw new HttpsError("invalid-argument", "vendor_id and question are required");
  }

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
    if (!lock.fcm_token || lock.reminder_sent) continue;

    const start = pickupWindowStart(lock.pickup_date, lock.pickup_window);
    if (!start) continue;
    const minutesUntilPickup = (start.getTime() - now) / 60000;
    if (minutesUntilPickup < 0 || minutesUntilPickup > REMINDER_WINDOW_MINUTES) continue;

    try {
      await admin.messaging().send({
        token: lock.fcm_token,
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
exports.triggerPickupRemindersNow = onCall({ region: "asia-east1" }, async () => {
  const sent = await sendPickupReminders();
  return { sent };
});

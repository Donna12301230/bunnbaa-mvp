const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");

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
    generated_at: admin.firestore.FieldValue.serverTimestamp(),
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
        generated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    await lockRef.update({ discount_explanation: explanation.explanation_text });
  }
);

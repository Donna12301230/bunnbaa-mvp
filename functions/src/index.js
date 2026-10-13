const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();

const { onCall, HttpsError, assertAdminOrEmulator, assertAdminOrVendorOwner, t } = require("./common");
const { generateVendorCalibrationReport, answerCalibrationScenario } = require("./vendorCalibration");
const { translateTexts, translationPatch, dishNamesPatch, TRANSLATED_FIELDS } = require("./translate");
const { loadPlatformConfig } = require("./config");
const { commissionOf, revenueOf } = require("./pricing");

// Phase 1 spec (doc/第一階段規格.md) features are split into modules:
//   orders.js     order pricing, LINE Pay, cut-off wish decisions, daily prep, QR pickup, cancellation refunds
//   charity.js    donating as charity meals, no-shows to charity meals, reservations/timeouts, waste logging
//   rewardsFns.js reward pool, draw tickets, coupons, anomaly detection
//   purchasing.js weekly/monthly supplier orders, forecasts, stocktaking
//   insights.js   open wishes, taste preferences, area insights, Gemini dish-name classification and recipe drafts
//   disaster.js   typhoon warnings, automatic refunds on work-suspension days, ingredient price changes, equivalent side substitution
// AI features (doc/AI與GoogleCloud設計.md):
//   menuVision.js        list menus from a photo (Gemini Vision)
//   resaleMatch.js       smart resale matching (Embeddings + Firestore vector search → push)
//   shoppingAssistant.js conversational pre-order assistant (Gemini function calling)
//   pickupForecast.js    forecast pickup time ranges on the prep page (plain statistics, no LLM for numbers)
// The Cloud Functions in each module's exports are all registered at the end of this file.

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
    .where("status", "in", ["fulfilled", "no_show", "resold_and_fulfilled", "charity"])
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
    if (d.status === "charity") {
      bucket.no_show_notes.push(d.charity_source === "donated" ? "消費者主動捐為愛心餐" : "未取餐，已轉愛心餐");
    }
    if (d.consumer_feedback) bucket.consumer_feedback.push(d.consumer_feedback);
  });

  return Array.from(byPeriod.values())
    .sort((a, b) => (a.period > b.period ? 1 : -1))
    .slice(-maxPeriods);
}

// Spec ref: README "Not yet implemented" — reliability_tone was a hand-set field;
// this ties it to the same accuracy_rate the calibration report already
// computes, so the badge on the consumer page stays in sync automatically.
// accuracy_rate is computed in code by vendorCalibration.calibrationStats (not an LLM), so the badge can be trusted.
const STABLE_ACCURACY_THRESHOLD = 0.8;

async function runCalibrationForVendor(vendorId) {
  const history = await buildVendorHistory(vendorId);
  if (history.length === 0) {
    logger.info(`No fulfilled/no_show locks yet for vendor ${vendorId}, skipping.`);
    return null;
  }

  const report = await generateVendorCalibrationReport({ history });
  // Translation for the English UI; a translation failure doesn't affect the report itself
  let english = {};
  try {
    const [explanationEn, patternNoteEn] = await translateTexts([report.explanation ?? "", report.pattern_note ?? ""]);
    english = { explanation_en: explanationEn, pattern_note_en: patternNoteEn };
  } catch (err) {
    logger.warn(`Couldn't translate calibration report for vendor ${vendorId}`, err);
  }

  const docRef = await db.collection("accuracy_reports").add({
    vendor_id: vendorId,
    horizon: "daily",
    ...report,
    ...english,
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

// Taking over in the resale market is now a paid takeover (spec §4.1): createResaleLinePayReservation + confirmLinePayPayment (orders.js)

/* ------------------------------------------------------------------ *
 * 1b. Vendor payouts — platform collects, then forwards on a schedule
 * (spec ref: refactoring guide §5.1/§5.4 — "Route A: platform collects payments and pays vendors periodically").
 * Partnership plan revised 2026-10-05: no monthly fee; a commission of commissionRate on the amount paid per meal
 * (default 5%, rounded per portion); payout amount = total paid − commission.
 * This scaffolds the aggregation + a payout record with mock
 * data; the actual LINE Pay/ECPay payout API call (or, per the doc's own
 * fallback, a manual reconciliation export) isn't wired up yet since
 * there's no merchant account to call it against.
 * ------------------------------------------------------------------ */

/** Amount to pay the vendor for this order (before commission): same basis as the earnings dashboard (pricing.js revenueOf) */
const payableOf = (lock) => revenueOf(lock);

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
    if (data.payout_settled) return false;
    // Charity meals (from no-shows or voluntary donations) still count toward vendor revenue (§7.1); under the old scheme no-shows were prepaid and non-refundable, and since 2026-10-09 they are paid out the same way
    if (["fulfilled", "resold_and_fulfilled", "charity", "no_show"].includes(data.status)) return true;
    // Diner cancellations only get a coupon, no cash refund (orders.js cancelForCoupon): the money kept is also paid to the vendor, who later honors that coupon
    return data.status === "cancelled" && payableOf(data) > 0;
  });

  if (unsettled.length === 0) {
    logger.info(`No unsettled fulfilled locks for vendor ${vendorId}, skipping payout.`);
    return null;
  }

  const { commissionRate } = await loadPlatformConfig(db);
  const rate = Number(commissionRate) || 0;
  const gross = unsettled.reduce((sum, d) => sum + payableOf(d.data()), 0);
  const commission = commissionOf(unsettled.map((d) => d.data()), rate);
  const amount = gross - commission;
  const lockIds = unsettled.map((d) => d.id);

  const payoutRef = await db.collection("payouts").add({
    vendor_id: vendorId,
    amount, // amount paid to the vendor = total paid − platform commission
    gross_amount: gross,
    commission_amount: commission,
    commission_rate: rate,
    lock_ids: lockIds,
    lock_count: lockIds.length,
    // No LINE Pay/ECPay merchant payout API to call yet, so this is the
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
  await assertAdminOrVendorOwner(request, vendorId);
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
  await assertAdminOrVendorOwner(request, vendorId);

  const history = await buildVendorHistory(vendorId);
  if (history.length === 0) {
    throw new HttpsError("failed-precondition", "No history yet for this vendor");
  }

  // Only answer the follow-up, don't regenerate the whole report (2026-10-09: saves the tokens of a full report)
  let report;
  try {
    report = await answerCalibrationScenario({ history, question });
  } catch (err) {
    logger.warn("askCalibrationScenario failed", err);
    throw new HttpsError("unavailable", t("AI 暫時無法回答，請稍後再試", "AI can't answer right now. Please try again shortly."));
  }
  if (request.data?.lang === "en" && report.scenario_answer) {
    try {
      [report.scenario_answer] = await translateTexts([report.scenario_answer]);
    } catch (err) {
      logger.warn("Couldn't translate scenario answer", err);
    }
  }
  // Not persisted by default — this is a lightweight, ad-hoc follow-up.
  // Persist to a `scenario_queries` subcollection if you want an audit trail.
  return report;
});

/* ------------------------------------------------------------------ *
 * 3. Consumer discount explanation: since 2026-10-09 generated on demand on the item page
 *    (consumerExplanation.js getDiscountExplanation). The old onLockCreated
 *    called Gemini + translation for every order but nothing displayed it, so it was removed.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 6. English copies of database content (translate.js) — vendors,
 *    menu items and meal plans get *_en fields whenever their Chinese
 *    text changes. Writing *_en re-fires the trigger; translationPatch
 *    compares against i18n_src and returns null, so it stops there.
 * ------------------------------------------------------------------ */

async function translateDoc(ref, data, collection) {
  const patch = await translationPatch(data, TRANSLATED_FIELDS[collection]);
  // Menu items also carry English names for the dishes inside a bento (dish_names_en)
  const dishes = collection === "menu_items" ? await dishNamesPatch(data) : null;
  if (!patch && !dishes) return false;
  const merged = { ...patch, ...dishes, i18n_src: { ...patch?.i18n_src, ...dishes?.i18n_src } };
  await ref.set(merged, { merge: true });
  return true;
}

function translationTrigger(collection, path = `${collection}/{docId}`) {
  return onDocumentWritten({ document: path, region: "asia-east1" }, async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    try {
      await translateDoc(after.ref, after.data(), collection);
    } catch (err) {
      // A translation failure doesn't affect the original write; the English UI shows Chinese first, and it's retried on the next content change or when an admin backfills translations
      logger.warn(`Translation failed for ${collection}/${after.id}`, err);
    }
  });
}

exports.translateVendor = translationTrigger("vendors");
exports.translateMenuItem = translationTrigger("menu_items");
exports.translateMealPlan = translationTrigger("meal_plans");
exports.translateReview = translationTrigger("reviews");
exports.translateDraw = translationTrigger("draws");
exports.translateComponent = translationTrigger("components", "vendors/{vendorId}/components/{docId}");

/**
 * Admin backfill: translate every existing vendor / menu item / meal plan /
 * review / draw,
 * then fill item_name_en on existing locks (distinct names translated once).
 * Triggers only fire on new writes, so data from before this feature needs this.
 */
exports.translateAllContent = onCall({ region: "asia-east1", timeoutSeconds: 540 }, async (request) => {
  assertAdminOrEmulator(request);
  const counts = { vendors: 0, menu_items: 0, meal_plans: 0, reviews: 0, draws: 0, components: 0, locks: 0, failed: 0 };
  for (const collection of Object.keys(TRANSLATED_FIELDS)) {
    // components is a subcollection under each vendor
    const snap = await (collection === "components" ? db.collectionGroup(collection) : db.collection(collection)).get();
    for (const doc of snap.docs) {
      try {
        if (await translateDoc(doc.ref, doc.data(), collection)) counts[collection]++;
      } catch (err) {
        counts.failed++;
        logger.warn(`Backfill translation failed for ${collection}/${doc.id}`, err);
      }
    }
  }

  const lockSnap = await db.collection("locks").get();
  const missing = lockSnap.docs.filter((d) => typeof d.data().item_name_en !== "string" && d.data().item_name);
  const names = [...new Set(missing.map((d) => d.data().item_name))];
  const english = new Map();
  for (let i = 0; i < names.length; i += 40) {
    const chunk = names.slice(i, i + 40);
    try {
      const out = await translateTexts(chunk);
      chunk.forEach((name, j) => english.set(name, out[j]));
    } catch (err) {
      counts.failed += chunk.length;
      logger.warn("Backfill translation failed for lock item names", err);
    }
  }
  let batch = db.batch();
  let pending = 0;
  for (const doc of missing) {
    const en = english.get(doc.data().item_name);
    if (!en) continue;
    batch.update(doc.ref, { item_name_en: en });
    counts.locks++;
    if (++pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending) await batch.commit();
  return counts;
});


/* ------------------------------------------------------------------ *
 * Phase 1 spec modules
 * ------------------------------------------------------------------ */
for (const mod of [
  "./orders", "./charity", "./rewardsFns", "./purchasing", "./insights", "./disaster",
  "./finance", "./menuVision", "./resaleMatch", "./shoppingAssistant", "./pickupForecast", "./consumerExplanation", "./wallet", "./bigqueryExport", "./demandForecast", "./customerInsights", "./platformDashboard",
]) {
  for (const [name, fn] of Object.entries(require(mod))) {
    // Register Cloud Functions only (module-internal shared things like helpers aren't functions or have no __trigger/run)
    if (typeof fn === "function" && (fn.__endpoint || fn.run)) exports[name] = fn;
  }
}

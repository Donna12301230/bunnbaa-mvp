const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();

const { onCall, HttpsError, assertAdminOrEmulator, assertSignedInUser, assertAdminOrVendorOwner } = require("./common");
const { generateVendorCalibrationReport } = require("./vendorCalibration");
const { generateDiscountExplanation } = require("./consumerExplanation");
const { translateTexts, translationPatch, TRANSLATED_FIELDS } = require("./translate");
const { recordMatchedClaim } = require("./resaleMatch").helpers;

// 第一階段規格（doc/BunnBaa 飯飽｜第一階段技術規格.md）的功能拆在各模組：
//   orders.js     下單計價、LINE Pay、截單判定許願、每日備料、QR 取餐、取消退款
//   charity.js    捐為愛心餐、未取餐轉愛心餐、預約／逾時、報廢登記
//   rewardsFns.js 回饋池、抽獎券、折價券、異常偵測
//   purchasing.js 週／月叫貨單、預測、盤點
//   insights.js   開放許願、口味偏好、區域洞察、Gemini 菜名歸類與配方草稿
//   disaster.js   颱風警報、停班停課自動退款、菜價變動、等值替換配菜
// AI 功能（doc/AI功能設計.md）：
//   menuVision.js        拍照上架菜單（Gemini Vision）
//   resaleMatch.js       轉讓智慧媒合（Embeddings + Firestore 向量搜尋 → 推播）
//   shoppingAssistant.js 對話式預購助理（Gemini function calling）
//   pickupForecast.js    備料頁的預估取餐區間（一般統計，不用 LLM 算數字）
// 各模組 exports 裡的 Cloud Functions 在檔案最後一次掛上。

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
  // 英文介面用的譯文；翻譯失敗不影響報告本身
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
  // Transaction so two buyers racing for the same listing can't both win —
  // the loser re-reads a "locked" doc and gets failed-precondition.
  await db.runTransaction(async (tx) => {
    const lockSnap = await tx.get(lockRef);
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
    tx.update(lockRef, {
      status: "locked",
      buyer_uid: request.auth.uid,
      resale_deadline: FieldValue.delete(),
      transferred_from_uids: FieldValue.arrayUnion(lock.buyer_uid),
      // 換掉代領連結與 QR nonce，原持有人手上的連結／截圖立即失效
      share_token: require("crypto").randomBytes(12).toString("hex"),
      qr_nonce: FieldValue.delete(),
    });
  });
  // AI 轉讓媒合的影響指標：接手的人是不是被通知的會員（失敗不影響接手）
  await recordMatchedClaim(lockId, request.auth.uid).catch((err) => logger.warn(`recordMatchedClaim ${lockId}`, err));
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
    // 愛心餐（未取餐轉入或主動捐出）照常計入店家營業額（§7.1）
    return ["fulfilled", "resold_and_fulfilled", "charity"].includes(data.status) && !data.payout_settled;
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

  const report = await generateVendorCalibrationReport({ history, scenarioQuestion: question });
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
      if (typeof explanation.explanation_text_en !== "string") {
        try {
          [explanation.explanation_text_en] = await translateTexts([explanation.explanation_text]);
          await cacheRef.update({ explanation_text_en: explanation.explanation_text_en });
        } catch (err) {
          logger.warn(`Couldn't translate cached explanation ${key}`, err);
        }
      }
    } else {
      explanation = await generateDiscountExplanation({
        discountPercent: lock.discount_percent,
        resellable: lock.resellable !== false,
        pickupWindow: lock.pickup_window,
        // Qualitative only, per spec 6.2 — never expose the raw accuracy
        // number to the consumer-facing agent.
        vendorReliabilityTone: vendor.reliability_tone || "new",
      });
      try {
        [explanation.explanation_text_en] = await translateTexts([explanation.explanation_text]);
      } catch (err) {
        logger.warn(`Couldn't translate explanation ${key}`, err);
      }
      await cacheRef.set({
        ...explanation,
        generated_at: FieldValue.serverTimestamp(),
      });
    }

    await lockRef.update({
      discount_explanation: explanation.explanation_text,
      discount_explanation_en: explanation.explanation_text_en ?? null,
    });
  }
);

/* ------------------------------------------------------------------ *
 * 6. English copies of database content (translate.js) — vendors,
 *    menu items and meal plans get *_en fields whenever their Chinese
 *    text changes. Writing *_en re-fires the trigger; translationPatch
 *    compares against i18n_src and returns null, so it stops there.
 * ------------------------------------------------------------------ */

async function translateDoc(ref, data, collection) {
  const patch = await translationPatch(data, TRANSLATED_FIELDS[collection]);
  if (patch) await ref.set(patch, { merge: true });
  return !!patch;
}

function translationTrigger(collection) {
  return onDocumentWritten({ document: `${collection}/{docId}`, region: "asia-east1" }, async (event) => {
    const after = event.data?.after;
    if (!after?.exists) return;
    try {
      await translateDoc(after.ref, after.data(), collection);
    } catch (err) {
      // 翻譯失敗不影響原本的寫入；英文介面會先顯示中文，下次改內容或管理員補翻時再試
      logger.warn(`Translation failed for ${collection}/${after.id}`, err);
    }
  });
}

exports.translateVendor = translationTrigger("vendors");
exports.translateMenuItem = translationTrigger("menu_items");
exports.translateMealPlan = translationTrigger("meal_plans");
exports.translateReview = translationTrigger("reviews");
exports.translateDraw = translationTrigger("draws");

/**
 * Admin backfill: translate every existing vendor / menu item / meal plan /
 * review / draw,
 * then fill item_name_en on existing locks (distinct names translated once).
 * Triggers only fire on new writes, so data from before this feature needs this.
 */
exports.translateAllContent = onCall({ region: "asia-east1", timeoutSeconds: 540 }, async (request) => {
  assertAdminOrEmulator(request);
  const counts = { vendors: 0, menu_items: 0, meal_plans: 0, reviews: 0, draws: 0, locks: 0, failed: 0 };
  for (const collection of Object.keys(TRANSLATED_FIELDS)) {
    const snap = await db.collection(collection).get();
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
 * 第一階段規格的各模組
 * ------------------------------------------------------------------ */
for (const mod of [
  "./orders", "./charity", "./rewardsFns", "./purchasing", "./insights", "./disaster",
  "./menuVision", "./resaleMatch", "./shoppingAssistant", "./pickupForecast",
]) {
  for (const [name, fn] of Object.entries(require(mod))) {
    // 只掛 Cloud Functions（helpers 等模組內部共用的東西不是函式或沒有 __trigger/run）
    if (typeof fn === "function" && (fn.__endpoint || fn.run)) exports[name] = fn;
  }
}

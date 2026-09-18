/**
 * Seeds a single demo vendor + several rounds of historical lock data,
 * matching the pilot scenario in the tech spec (v6 §1.1): one café,
 * ~50 locks/day, accuracy improving from ~60% to ~85% over a couple of
 * weeks as the calibration agent gets more rounds to compare against.
 *
 * This is scenario data for the Demo video — clearly not real transaction
 * history — per the spec's own disclosure requirement (§1.1, §9 risk table).
 *
 * Usage:
 *   node scripts/seed.js
 *
 * Requires a service account key. Either:
 *   - run via `firebase emulators:exec` against the local emulator, or
 *   - set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON
 *     for a real (test) Firebase project.
 */
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

const VENDOR_ID = "cafe-renheya-demo";
const ITEM_NAME = "招牌鮭魚御飯糰便當";
const PICKUP_WINDOW = "12:00-13:00";

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function seedVendor() {
  await db.collection("vendors").doc(VENDOR_ID).set({
    name: "仁和雅咖啡",
    item_focus: ITEM_NAME,
    reliability_tone: "stable", // updated by ops as accuracy stabilizes; "new" until enough rounds exist
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`Seeded vendor ${VENDOR_ID}`);
}

/**
 * Simulates 14 days of locks, with accuracy improving over time and a
 * deliberate "no-show spikes on rainy days" pattern for the AI's semantic
 * attribution (spec §4.1) to actually have something real to find.
 */
async function seedLocks() {
  const batchSize = 400; // stay well under Firestore's 500-writes-per-batch limit
  let batch = db.batch();
  let opsInBatch = 0;
  let total = 0;

  for (let day = 14; day >= 1; day--) {
    const date = daysAgo(day);
    const isRainyDay = day % 5 === 0; // arbitrary but consistent, so a pattern exists to find
    const lockedQty = 50;
    // Early days: noisier fulfillment (~60% accuracy). Later days: tighter (~85%).
    const progress = (14 - day) / 13; // 0 -> 1 over the window
    const baseAccuracy = 0.6 + progress * 0.25;
    const rainPenalty = isRainyDay ? 0.15 : 0;

    for (let i = 0; i < lockedQty; i++) {
      const willFulfill = Math.random() < baseAccuracy - rainPenalty;
      const willResell = !willFulfill && Math.random() < 0.4;

      const lockRef = db.collection("locks").doc();
      batch.set(lockRef, {
        vendor_id: VENDOR_ID,
        item_name: ITEM_NAME,
        pickup_window: PICKUP_WINDOW,
        pickup_date: date.toISOString().slice(0, 10),
        discount_percent: 20, // 八折
        resellable: true,
        locked_price: 96, // e.g. NT$120 item at 8折
        status: willFulfill
          ? "fulfilled"
          : willResell
          ? "resold_and_fulfilled"
          : "no_show",
        no_show_note:
          !willFulfill && !willResell
            ? isRainyDay
              ? "當天下大雨，客人説不想出門"
              : "客人臨時有事沒來"
            : null,
        consumer_feedback:
          willFulfill && Math.random() < 0.3 ? "東西很好吃，下次還會訂" : null,
        buyer_uid: `demo-user-${Math.floor(Math.random() * 500)}`,
        created_at: admin.firestore.Timestamp.fromDate(date),
      });

      opsInBatch++;
      total++;
      if (opsInBatch >= batchSize) {
        await batch.commit();
        batch = db.batch();
        opsInBatch = 0;
      }
    }
  }

  if (opsInBatch > 0) await batch.commit();
  console.log(`Seeded ${total} historical lock records across 14 days for ${VENDOR_ID}`);
}

async function main() {
  await seedVendor();
  await seedLocks();
  console.log("Seed complete. Run the `triggerCalibrationNow` callable (or wait for the daily schedule) to generate the first accuracy report.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Backfills locks.transferred_from_uids for locks that changed hands before
 * the field existed (TODO.md: "My resales" can't track items that were already
 * taken over / 「我的轉讓」無法追蹤已被接手的項目).
 *
 * Only source of the original owner is payment_intents: a confirmed intent
 * records the payer's buyer_uid + the lock_ids it created. If a lock's
 * current buyer_uid differs, the payer handed it over. Limits:
 *   - only the original payer is recoverable; middle owners in a chain
 *     (A → B → C) are lost, so B won't see it
 *   - locks created without LINE Pay (plan join in HomePage, ProfilePage)
 *     have no intent and can't be backfilled
 *
 * Dry run by default — prints what it would change. Pass --apply to write.
 *   node backfill-transfers.js           # dry run
 *   node backfill-transfers.js --apply
 */
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

admin.initializeApp();
const db = admin.firestore();
const apply = process.argv.includes("--apply");

async function main() {
  const intents = await db.collection("payment_intents").where("status", "==", "confirmed").get();
  let changed = 0;
  for (const intentDoc of intents.docs) {
    const { buyer_uid: payer, lock_ids: lockIds = [] } = intentDoc.data();
    if (!payer) continue;
    for (const lockId of lockIds) {
      const lockRef = db.collection("locks").doc(lockId);
      const snap = await lockRef.get();
      if (!snap.exists) continue;
      const lock = snap.data();
      if (lock.buyer_uid === payer) continue;
      if ((lock.transferred_from_uids || []).includes(payer)) continue;
      changed++;
      console.log(`${lockId}: ${payer} → ${lock.buyer_uid} (${lock.item_name}, ${lock.pickup_date})`);
      if (apply) await lockRef.update({ transferred_from_uids: FieldValue.arrayUnion(payer) });
    }
  }
  console.log(`${apply ? "Updated" : "Would update"} ${changed} lock(s) from ${intents.size} confirmed intent(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// AI feature 3: smart resale matching (doc/AI功能設計.md). When a lock becomes for_resale, find members likely to want it
// and push to them, so a bento whose owner can't pick it up finds a taker instead of becoming a charity meal or waste.
//
// menu_embeddings/{menuItemId}: vendor_id, embedding (Gemini vector, 768 dims), src (text the embedding was computed from)
//   Read/written only by the server (firestore.rules), so item pages don't load a long vector. Recomputed whenever menu_items content changes.
// resale_matches/{lockId}: who this listing notified (notified_uids) and whether a notified user took it over
//   (claimed_by_match, written by claimResoldLock). Readable only by the server and admins; used to compute "portions rescued by matching".
//
// Matching: Firestore native KNN finds similar items (vendors in the same county/city) → members who locked those items before →
// ranked by weighted item similarity, same vendor, nearby pickup slot and distance from their usual location → push to the top few.
// Excluded: the seller, anyone who has held this lock before, anyone who already ordered from this vendor that day, anyone who turned these notifications off,
// and anyone who already received 2 match notifications today.
const crypto = require("crypto");
const { onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const {
  REGION, db, onCall, logger, FieldValue, assertAdminOrEmulator, notifyUser, countyOf, distanceMeters, decodeGeohash,
} = require("./common");
const { embedText } = require("./gemini");
const { taipeiToday, toMinutes, splitWindow } = require("./calendar");

const NEIGHBOURS = 10; // how many similar items KNN returns (including itself; Firestore `in` allows at most 30)
const MAX_NOTIFY = 5;
const DAILY_CAP = 2;
const RELIST_COOLDOWN_MS = 12 * 3600 * 1000; // relisted after a cancel: don't notify again within 12 hours
const FAR_METERS = 10000; // don't notify if the usual location is more than 10 km from the vendor

/** Text for the embedding: name, category, description, main, sides and candidate dishes, dietary tags */
function embeddingSource(item) {
  const sides = (item.slots || []).flatMap((s) => [s.default?.name, ...(s.candidates || []).map((c) => c.name)]);
  return [
    item.name,
    item.category,
    item.description,
    item.main?.name && `主菜：${item.main.name}`,
    (item.fixed || []).length && `附餐：${item.fixed.map((f) => f.name).join("、")}`,
    sides.filter(Boolean).length && `配菜：${sides.filter(Boolean).join("、")}`,
    (item.dietary_tags || []).length && `標記：${item.dietary_tags.join("、")}`,
  ].filter((x) => typeof x === "string" && x.trim()).join("\n");
}

async function upsertEmbedding(itemId, item) {
  const ref = db().collection("menu_embeddings").doc(itemId);
  const src = embeddingSource(item);
  const prev = await ref.get();
  if (prev.exists && prev.data().src === src && prev.data().vendor_id === item.vendor_id) return false;
  const values = await embedText(src);
  await ref.set({
    vendor_id: item.vendor_id,
    src,
    embedding: FieldValue.vector(values),
    updated_at: FieldValue.serverTimestamp(),
  });
  return true;
}

exports.embedMenuItem = onDocumentWritten({ document: "menu_items/{itemId}", region: REGION }, async (event) => {
  const itemId = event.params.itemId;
  const after = event.data?.after;
  if (!after?.exists) {
    await db().collection("menu_embeddings").doc(itemId).delete().catch(() => undefined);
    return;
  }
  try {
    await upsertEmbedding(itemId, after.data());
  } catch (err) {
    // Without an embedding, matching falls back to same-item comparison; listing is unaffected
    logger.warn(`Embedding failed for menu_items/${itemId}`, err);
  }
});

/** Admin backfill: the trigger only runs on new writes, so this fills in existing items */
exports.backfillMenuEmbeddings = onCall({ timeoutSeconds: 540 }, async (request) => {
  assertAdminOrEmulator(request);
  const snap = await db().collection("menu_items").get();
  const counts = { updated: 0, unchanged: 0, failed: 0 };
  for (const doc of snap.docs) {
    try {
      if (await upsertEmbedding(doc.id, doc.data())) counts.updated++;
      else counts.unchanged++;
    } catch (err) {
      counts.failed++;
      logger.warn(`Backfill embedding failed for ${doc.id}`, err);
    }
  }
  return counts;
});

/** Similar items: Map<menu_item_id, similarity 0–1>, only vendors in the same county/city; the item itself is always included (similarity 1) */
async function similarItems(menuItemId, county) {
  const similar = new Map([[menuItemId, 1]]);
  const own = await db().collection("menu_embeddings").doc(menuItemId).get();
  if (!own.exists) return similar;
  try {
    const snap = await db().collection("menu_embeddings").findNearest({
      vectorField: "embedding",
      queryVector: own.data().embedding,
      limit: NEIGHBOURS,
      distanceMeasure: "COSINE",
      distanceResultField: "distance",
    }).get();
    const vendorIds = [...new Set(snap.docs.map((d) => d.data().vendor_id))];
    const vendorSnaps = await Promise.all(vendorIds.map((id) => db().collection("vendors").doc(id).get()));
    const countyOfVendor = new Map(vendorSnaps.map((s) => [s.id, countyOf(s.data()?.address)]));
    for (const d of snap.docs) {
      if (d.id === menuItemId) continue;
      const vendorCounty = countyOfVendor.get(d.data().vendor_id);
      if (county && vendorCounty && vendorCounty !== county) continue;
      const score = Math.max(0, 1 - (Number(d.data().distance) || 0)); // cosine distance → similarity
      if (score > 0.5) similar.set(d.id, score);
    }
  } catch (err) {
    logger.warn(`Vector search failed for ${menuItemId}`, err);
  }
  return similar;
}

function windowGapMinutes(a, b) {
  const sa = splitWindow(a).start;
  const sb = splitWindow(b).start;
  if (!sa || !sb) return Infinity;
  return Math.abs(toMinutes(sa) - toMinutes(sb));
}

/** Score by past locks: Map<uid, { score, sameDay }> */
function scoreCandidates(pastLocks, similar, resale) {
  const byUid = new Map();
  for (const lock of pastLocks) {
    if (lock.status === "cancelled" || lock.status === "cancelling") continue;
    for (const uid of new Set([lock.buyer_uid, lock.payer_uid].filter(Boolean))) {
      const entry = byUid.get(uid) ?? { score: 0, sameDay: false };
      if (lock.pickup_date === resale.pickup_date && lock.vendor_id === resale.vendor_id
          && ["locked", "for_resale", "for_gift"].includes(lock.status)) entry.sameDay = true;
      let s = similar.get(lock.menu_item_id) ?? 0;
      if (lock.vendor_id === resale.vendor_id) s += 0.5;
      const gap = windowGapMinutes(lock.pickup_window, resale.pickup_window);
      if (gap <= 30) s += 0.5;
      else if (gap <= 60) s += 0.25;
      entry.score += s;
      byUid.set(uid, entry);
    }
  }
  return byUid;
}

async function hasLockThatDay(uid, vendorId, date) {
  const snap = await db().collection("locks").where("buyer_uid", "==", uid).where("pickup_date", "==", date).limit(5).get();
  return snap.docs.some((d) => d.data().vendor_id === vendorId && ["locked", "for_resale", "for_gift"].includes(d.data().status));
}

/**
 * Reserve one of today's match notifications; returns null if notifications are off, today's limit is reached, or the usual location is too far from the vendor,
 * otherwise returns { lang } (the language for the push).
 */
async function takeDailySlot(uid, today, vendorPos) {
  const ref = db().collection("users").doc(uid);
  return db().runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data() || {};
    if ((data.muted_kinds || []).includes("resale_match")) return null;
    const home = decodeGeohash(data.home_geo);
    if (vendorPos && home && distanceMeters(home, vendorPos) > FAR_METERS) return null;
    const log = data.resale_match_log?.date === today ? data.resale_match_log : { date: today, count: 0 };
    if (log.count >= DAILY_CAP) return null;
    tx.set(ref, { resale_match_log: { date: today, count: log.count + 1 } }, { merge: true });
    return { lang: data.lang === "en" ? "en" : "zh" };
  });
}

async function matchResale(lockId, lock) {
  const today = taipeiToday();
  if (!lock.pickup_date || lock.pickup_date < today) return { notified: 0, reason: "past" };

  const matchRef = db().collection("resale_matches").doc(lockId);
  const prev = await matchRef.get();
  const prevAt = prev.exists ? prev.data().created_at?.toMillis?.() ?? 0 : 0;
  if (prevAt && Date.now() - prevAt < RELIST_COOLDOWN_MS) return { notified: 0, reason: "cooldown" };

  const vendorSnap = await db().collection("vendors").doc(lock.vendor_id).get();
  const vendor = vendorSnap.data() || {};
  const county = countyOf(vendor.address);

  const similar = lock.menu_item_id ? await similarItems(lock.menu_item_id, county) : new Map();
  // Always query the vendor's recent orders; when there are similar items, also query orders for those. Before 2026-10-12 it was one or the other,
  // but older orders (seed data included) have no menu_item_id, so after the embedding backfill only a few could be compared and there were 0 candidates
  const queries = [db().collection("locks").where("vendor_id", "==", lock.vendor_id).orderBy("created_at", "desc").limit(400)];
  if (similar.size > 0) queries.push(db().collection("locks").where("menu_item_id", "in", [...similar.keys()].slice(0, 30)).limit(400));
  const pastById = new Map();
  for (const snap of await Promise.all(queries.map((q) => q.get()))) {
    for (const d of snap.docs) if (d.id !== lockId) pastById.set(d.id, d.data());
  }
  const pastLocks = [...pastById.values()];

  const excluded = new Set([lock.buyer_uid, lock.payer_uid, ...(lock.transferred_from_uids || [])].filter(Boolean));
  const ranked = [...scoreCandidates(pastLocks, similar, lock)]
    .filter(([uid, e]) => !excluded.has(uid) && !e.sameDay && e.score > 0)
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, MAX_NOTIFY * 3);

  const vendorPos = Number.isFinite(vendor.lat) && Number.isFinite(vendor.lng) ? { lat: vendor.lat, lng: vendor.lng } : null;
  const picked = [];
  for (const [uid] of ranked) {
    if (picked.length >= MAX_NOTIFY) break;
    if (await hasLockThatDay(uid, lock.vendor_id, lock.pickup_date)) continue;
    const slot = await takeDailySlot(uid, today, vendorPos);
    if (!slot) continue;
    picked.push({ uid, lang: slot.lang });
  }

  const itemName = lock.item_name || "";
  const vendorName = vendor.name || "";
  for (const { uid, lang } of picked) {
    const en = lang === "en";
    await notifyUser(uid, {
      kind: "resale_match",
      title: en ? "A meal you might like is up for transfer" : "有一份你可能想接手的便當",
      body: en
        ? `${vendor.name_en || vendorName} · ${lock.item_name_en || itemName}, ${lock.pickup_date} ${lock.pickup_window}. Grab it before the pickup window ends.`
        : `「${vendorName}」${itemName}，${lock.pickup_date} ${lock.pickup_window}。取餐時段結束前都可以接手。`,
      link: "/marketplace",
    });
  }

  await matchRef.set({
    lock_id: lockId,
    vendor_id: lock.vendor_id,
    menu_item_id: lock.menu_item_id || null,
    pickup_date: lock.pickup_date,
    similar_item_ids: [...similar.keys()],
    candidate_count: ranked.length,
    notified_uids: picked.map((p) => p.uid),
    notified: picked.length,
    claimed_by_match: false,
    created_at: FieldValue.serverTimestamp(),
  });
  return { notified: picked.length };
}

exports.matchResaleLock = onDocumentUpdated({ document: "locks/{lockId}", region: REGION }, async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  // Resale/gift cancelled (taken back by the same person): while listed the lock was publicly readable and share_token may have been seen, so issue a new one;
  // the old proxy pickup link and proxy pickup code (proxyCodes stores the old token) are invalidated with it (orders.js issuePickupQr)
  if (["for_resale", "for_gift"].includes(before.status) && after.status === "locked" && before.buyer_uid === after.buyer_uid && after.share_token) {
    await event.data.after.ref.update({ share_token: crypto.randomBytes(12).toString("hex") }).catch((err) => logger.error("Rotate share_token failed", err));
    return;
  }
  if (before.status === "for_resale" || after.status !== "for_resale") return;
  try {
    const result = await matchResale(event.params.lockId, after);
    logger.info(`Resale match for lock ${event.params.lockId}`, result);
  } catch (err) {
    logger.error(`Resale match failed for lock ${event.params.lockId}`, err);
  }
});

/** Called after claimResoldLock succeeds: if the taker was a member notified by matching, record it (affects metrics) */
async function recordMatchedClaim(lockId, uid) {
  const ref = db().collection("resale_matches").doc(lockId);
  const snap = await ref.get();
  if (snap.exists && (snap.data().notified_uids || []).includes(uid)) {
    await ref.update({ claimed_by_match: true, claimed_at: FieldValue.serverTimestamp() });
  }
}

module.exports.helpers = { recordMatchedClaim, embeddingSource };

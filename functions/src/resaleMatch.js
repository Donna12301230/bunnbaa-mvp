// AI 功能 3：轉讓智慧媒合（doc/AI功能設計.md）。鎖定轉成 for_resale 時，找出可能想接手的
// 會員並推播，讓有人不能取餐的那份便當有人接手，不用變成愛心餐或浪費。
//
// menu_embeddings/{menuItemId}：vendor_id, embedding（Gemini 向量，768 維）, src（算向量用的文字）
//   只給伺服器讀寫（firestore.rules），品項頁不用多載一大串向量。menu_items 內容一變就重算。
// resale_matches/{lockId}：這次上架通知了誰（notified_uids）、是否由被通知的人接手
//   （claimed_by_match，claimResoldLock 寫）。只給伺服器與管理員讀，用來算「媒合救回幾份」。
//
// 比對：Firestore 原生 KNN 找出相似品項（同縣市的店）→ 過去鎖定過這些品項的會員 →
// 依品項相似度、同一家店、取餐時段相近、常用地點距離加權排序 → 取前幾名推播。
// 排除：轉讓者本人、曾經持有這份的人、當天已經有訂這家店的人、關掉這類通知的人、
// 今天已收過 2 則媒合通知的人。
const crypto = require("crypto");
const { onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const {
  REGION, db, onCall, logger, FieldValue, assertAdminOrEmulator, notifyUser, countyOf, distanceMeters, decodeGeohash,
} = require("./common");
const { embedText } = require("./gemini");
const { taipeiToday, toMinutes, splitWindow } = require("./calendar");

const NEIGHBOURS = 10; // KNN 取幾個相似品項（含自己；Firestore `in` 最多 30）
const MAX_NOTIFY = 5;
const DAILY_CAP = 2;
const RELIST_COOLDOWN_MS = 12 * 3600 * 1000; // 取消後重新上架，12 小時內不重複通知
const FAR_METERS = 10000; // 常用地點離店超過 10 公里就不通知

/** 算向量用的文字：品名、分類、說明、主菜、配菜與候選菜、飲食標記 */
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
    // 沒有向量時媒合退回「同品項」比對，不影響上架
    logger.warn(`Embedding failed for menu_items/${itemId}`, err);
  }
});

/** 管理員補算：觸發器只在新寫入時跑，既有品項用這支補 */
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

/** 相似品項：Map<menu_item_id, 相似度 0–1>，只留同縣市的店；自己一定在裡面（相似度 1） */
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
      const score = Math.max(0, 1 - (Number(d.data().distance) || 0)); // cosine distance → 相似度
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

/** 依過去鎖定打分：Map<uid, { score, sameDay }> */
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
 * 預扣今天的媒合通知額度；關掉通知、今天已達上限、常用地點離店太遠都回傳 null，
 * 否則回傳 { lang }（推播用哪種語言）。
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
  const pastQuery = similar.size > 0
    ? db().collection("locks").where("menu_item_id", "in", [...similar.keys()].slice(0, 30)).limit(400)
    : db().collection("locks").where("vendor_id", "==", lock.vendor_id).orderBy("created_at", "desc").limit(400);
  const pastLocks = (await pastQuery.get()).docs.filter((d) => d.id !== lockId).map((d) => d.data());

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
  // 取消轉讓／取消贈送（同一個人收回）：上架期間 lock 公開可讀、share_token 可能被看過，換一組新的，
  // 舊代領連結與代領碼（proxyCodes 記的是舊 token）一起失效（orders.js issuePickupQr）
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

/** claimResoldLock 接手成功後呼叫：接手的人是被媒合通知的會員就記下來（影響指標） */
async function recordMatchedClaim(lockId, uid) {
  const ref = db().collection("resale_matches").doc(lockId);
  const snap = await ref.get();
  if (snap.exists && (snap.data().notified_uids || []).includes(uid)) {
    await ref.update({ claimed_by_match: true, claimed_at: FieldValue.serverTimestamp() });
  }
}

module.exports.helpers = { recordMatchedClaim, embeddingSource };

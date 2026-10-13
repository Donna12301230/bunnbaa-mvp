// Open wishes, taste preferences, area insights (spec §4.4, §10), plus Gemini dish-name classification and recipe drafts (§3.1).
// Main data flow: recipe → auto tags → taste stats → find gaps → wishes → into prep → pickup completed → counted toward growth rewards.
//
// openWishes/{vendorId}_{uid}_{dishKey}: repeat wishes by the same person count once (deduped by doc id); created_at updates each time
// vendors/{v}/wishTally/{dishKey}: name, count (people in the last 30 days), notified, listed
// tasteProfiles/{uid}: prefs{spicy,no_beef,vegetarian}, allergies[] (written by the user); scores{tag: score} (written by the backend)
// areaInsights/{vendorId}_{Monday}: users, tag_shares, removal_rates, open_wishes, gaps (readable only by that vendor)
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { Timestamp } = require("firebase-admin/firestore");
const {
  REGION, db, onCall, HttpsError, FieldValue, logger, t, assertSignedInUser, callerVendorId, notifyUser, notifyVendor,
  loadVendorCatalog, allVendors, forEachVendor, distanceMeters,
} = require("./common");
const { loadPlatformConfig } = require("./config");
const { dishTags } = require("./bento");
const { generateJSON } = require("./gemini");
const { translateTexts } = require("./translate");
const { taipeiToday, addDays, mondayOf } = require("./calendar");

const HALF_LIFE_DAYS = 30;
const SIGNAL = { open_wish: 4, side_wish: 3, purchase: 2, view: 1, removed: -2 };

function dishKey(name) {
  return String(name || "").trim().replace(/\s+/g, "").replace(/[\/.#$[\]]/g, "_").slice(0, 60);
}

/** Weighted count for taste scores; old scores decay with a 30-day half-life */
async function bumpTaste(uid, deltas) {
  if (!uid || deltas.size === 0) return;
  const ref = db().collection("tasteProfiles").doc(uid);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const last = data.scores_updated_at?.toMillis?.() || Date.now();
    const decay = Math.pow(0.5, (Date.now() - last) / 86400000 / HALF_LIFE_DAYS);
    const scores = {};
    for (const [tag, s] of Object.entries(data.scores || {})) scores[tag] = Math.round(s * decay * 100) / 100;
    for (const [tag, d] of deltas) scores[tag] = Math.round(((scores[tag] || 0) + d) * 100) / 100;
    tx.set(ref, { scores, scores_updated_at: FieldValue.serverTimestamp() }, { merge: true });
  });
}

/**
 * New lock: compute this bento's tags, store them on lock.tags (for area insights), and update the payer's taste scores.
 * Purchase +2, candidate-dish wish +3, choosing "none" −2 (negative signal).
 */
exports.onLockCreatedTaste = onDocumentCreated({ document: "locks/{lockId}", region: REGION }, async (event) => {
  const lock = event.data.data();
  if (!lock.menu_item_id) return;
  const catalog = await loadVendorCatalog(lock.vendor_id);
  const item = catalog.itemsById[lock.menu_item_id];
  if (!item) return;
  const tagsOf = (componentId) => dishTags(catalog.componentsById[componentId], catalog.ingredientsById);
  const deltas = new Map();
  const add = (tags, w) => tags.forEach((tag) => deltas.set(tag, (deltas.get(tag) || 0) + w));
  const mainId = lock.main_component_id || item.main?.component_id;
  const lockTags = new Set(tagsOf(mainId));
  add(tagsOf(mainId), SIGNAL.purchase);
  (lock.slots || []).forEach((slot, i) => {
    const defaultTags = tagsOf(slot.default_component_id || item.slots?.[i]?.default?.component_id);
    if (slot.removed) {
      add(defaultTags, SIGNAL.removed);
      return;
    }
    if (slot.wished) {
      const w = tagsOf(slot.wished_component_id);
      add(w, SIGNAL.side_wish);
      w.forEach((x) => lockTags.add(x));
    } else {
      add(defaultTags, SIGNAL.purchase);
      defaultTags.forEach((x) => lockTags.add(x));
    }
  });
  // Fourth side (add-on / backup): choosing it counts as a positive signal; a candidate dish counts as a wish
  const extra = lock.extra_side;
  if (extra?.component_id) {
    const w = tagsOf(extra.component_id);
    add(w, extra.wished ? SIGNAL.side_wish : SIGNAL.purchase);
    if (extra.mode === "addon") w.forEach((x) => lockTags.add(x));
  }
  await event.data.ref.update({ tags: [...lockTags] });
  await bumpTaste(lock.payer_uid || lock.buyer_uid, deltas);
});

/**
 * Favoriting a vendor (Favorites, §4.5, §10): a positive signal equal to a purchase. +2 is spread evenly across the tags
 * of the vendor's currently served mains and default sides, so vendors with many dishes don't get flooded with points at once.
 */
exports.onFavoriteCreated = onDocumentCreated({ document: "users/{uid}/favorites/{vendorId}", region: REGION }, async (event) => {
  const { uid, vendorId } = event.params;
  const catalog = await loadVendorCatalog(vendorId);
  const items = Object.values(catalog.itemsById).filter((i) => i.is_available !== false);
  if (items.length === 0) return;
  const tagsOf = (componentId) => dishTags(catalog.componentsById[componentId], catalog.ingredientsById);
  const deltas = new Map();
  const share = SIGNAL.purchase / items.length;
  for (const item of items) {
    const mainIds = Array.isArray(item.mains) && item.mains.length > 0 ? item.mains.map((m) => m.component_id) : [item.main?.component_id || item.component_id];
    const tags = new Set(mainIds.flatMap((id) => tagsOf(id)));
    (item.slots || []).forEach((slot) => tagsOf(slot.default?.component_id).forEach((x) => tags.add(x)));
    tags.forEach((tag) => deltas.set(tag, (deltas.get(tag) || 0) + share));
  }
  await bumpTaste(uid, deltas);
});

/**
 * Viewing an item page (§10.1, the weakest signal, +1): only the tags of the main and default sides are added.
 * Counted once per person per item per day (users/{uid}.viewed_items records items viewed that day).
 */
exports.recordItemView = onCall({}, async (request) => {
  assertSignedInUser(request, "記錄瀏覽");
  const uid = request.auth.uid;
  const itemId = String(request.data?.menu_item_id || "");
  if (!itemId) throw new HttpsError("invalid-argument", "menu_item_id is required");
  const today = taipeiToday();
  const userRef = db().collection("users").doc(uid);
  const fresh = await db().runTransaction(async (tx) => {
    const log = (await tx.get(userRef)).data()?.viewed_items || {};
    const seen = log.date === today ? log.ids || [] : [];
    if (seen.includes(itemId)) return false;
    tx.set(userRef, { viewed_items: { date: today, ids: [...seen, itemId].slice(-50) } }, { merge: true });
    return true;
  });
  if (!fresh) return { ok: true };
  const item = await db().collection("menu_items").doc(itemId).get();
  if (!item.exists) return { ok: true };
  const catalog = await loadVendorCatalog(item.data().vendor_id);
  const menuItem = catalog.itemsById[itemId];
  if (!menuItem) return { ok: true };
  const tagsOf = (componentId) => dishTags(catalog.componentsById[componentId], catalog.ingredientsById);
  const deltas = new Map();
  const add = (tags) => tags.forEach((tag) => deltas.set(tag, (deltas.get(tag) || 0) + SIGNAL.view));
  add(tagsOf(menuItem.main?.component_id || menuItem.mains?.[0]?.component_id));
  (menuItem.slots || []).forEach((slot) => add(tagsOf(slot.default?.component_id)));
  await bumpTaste(uid, deltas);
  return { ok: true };
});

/**
 * Open wishes (§4.4): pick from the platform dish library first (dish_id); if not found, free text, which Gemini maps to a standard dish name.
 * Counted by people: repeat wishes by the same person count once; only the last 30 days count. The screen notes "wishes don't guarantee availability".
 */
exports.placeOpenWish = onCall({}, async (request) => {
  assertSignedInUser(request, "許願");
  const uid = request.auth.uid;
  const vendorId = String(request.data?.vendor_id || "");
  if (!vendorId) throw new HttpsError("invalid-argument", "vendor_id is required");
  let name = null;
  let dishId = null;
  let tags = [];
  if (request.data?.dish_id) {
    const d = await db().collection("dishLibrary").doc(String(request.data.dish_id)).get();
    if (!d.exists) throw new HttpsError("not-found", "dish not found");
    dishId = d.id;
    name = d.data().name;
    tags = d.data().tags || [];
  } else {
    const text = String(request.data?.text || "").trim().slice(0, 30);
    if (text.length < 1) throw new HttpsError("invalid-argument", t("請輸入想吃的菜", "Enter a dish"));
    const normalized = await normalizeDish(text);
    name = normalized.name;
    dishId = normalized.dish_id;
    tags = normalized.tags || [];
  }
  const key = dishKey(name);
  await db().collection("openWishes").doc(`${vendorId}_${uid}_${key}`).set({
    user_id: uid, vendor_id: vendorId, dish_id: dishId, dish_key: key, dish_name: name, created_at: FieldValue.serverTimestamp(),
  });
  await bumpTaste(uid, new Map(tags.map((tag) => [tag, SIGNAL.open_wish])));
  return { dish_name: name, dish_key: key };
});

/** Daily: people in the last 30 days; when the threshold is reached, notify the vendor and add it to the reference list */
async function tallyVendor(vendor, config) {
  const since = Timestamp.fromMillis(Date.now() - config.openWishWindowDays * 86400000);
  const snap = await db().collection("openWishes").where("vendor_id", "==", vendor.id).where("created_at", ">=", since).get();
  const groups = new Map();
  snap.docs.forEach((d) => {
    const w = d.data();
    const g = groups.get(w.dish_key) ?? { name: w.dish_name, users: new Set() };
    g.users.add(w.user_id);
    groups.set(w.dish_key, g);
  });
  const tallyRef = db().collection("vendors").doc(vendor.id).collection("wishTally");
  const existing = await tallyRef.get();
  const batch = db().batch();
  existing.docs.forEach((d) => { if (!groups.has(d.id)) batch.set(d.ref, { count: 0 }, { merge: true }); });
  const reached = [];
  for (const [key, g] of groups) {
    const prev = existing.docs.find((d) => d.id === key)?.data() || {};
    const count = g.users.size;
    const hit = count >= config.openWishThreshold && !prev.notified;
    if (hit) reached.push(`${g.name}（${count} 人）`);
    batch.set(tallyRef.doc(key), { name: g.name, count, notified: prev.notified || hit, updated_at: FieldValue.serverTimestamp() }, { merge: true });
  }
  await batch.commit();
  if (reached.length > 0) {
    await notifyVendor(vendor.id, {
      title: "開放許願達門檻，已列入參考名單",
      body: `${reached.join("、")}，要不要上架試試？`,
      link: "/vendor-portal/insights",
    });
  }
}

exports.tallyOpenWishes = onSchedule({ schedule: "every day 02:00", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const config = await loadPlatformConfig(db());
  await forEachVendor("tallyOpenWishes", (vendor) => tallyVendor(vendor, config));
});

exports.triggerTallyOpenWishesNow = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const config = await loadPlatformConfig(db());
  await tallyVendor({ id: vendorId, ...(await db().collection("vendors").doc(vendorId).get()).data() }, config);
  return { ok: true };
});

/** After a vendor lists a wished-for dish, notify the people who wished for it */
exports.notifyWishersListed = onCall({}, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const key = String(request.data?.dish_key || "");
  const snap = await db().collection("openWishes").where("vendor_id", "==", vendorId).where("dish_key", "==", key).get();
  const vendor = (await db().collection("vendors").doc(vendorId).get()).data();
  const users = [...new Set(snap.docs.map((d) => d.data().user_id))];
  for (const uid of users) {
    await notifyUser(uid, {
      kind: "wish",
      title: t("你許願的菜上架了！", "The dish you wished for is on the menu!"),
      body: t(`「${vendor.name}」開始供應「${snap.docs[0]?.data().dish_name}」`, `${vendor.name} now serves ${snap.docs[0]?.data().dish_name}`),
      link: `/vendor/${vendorId}`,
    });
  }
  await db().collection("vendors").doc(vendorId).collection("wishTally").doc(key).set({ listed: true }, { merge: true });
  return { notified: users.length };
});

/* ------------------------------------------------------------------ *
 * Gemini: dish-name classification and recipe drafts. AI plays no part in any portion, amount or draw calculation;
 * recipe draft numbers are only a starting point and are saved only after the vendor edits them.
 * ------------------------------------------------------------------ */

async function normalizeDish(text) {
  const lib = await db().collection("dishLibrary").get();
  const dishes = lib.docs.map((d) => ({ id: d.id, name: d.data().name, aliases: d.data().aliases || [] }));
  const exact = dishes.find((d) => d.name === text || d.aliases.includes(text));
  if (exact) return { dish_id: exact.id, name: exact.name, tags: lib.docs.find((d) => d.id === exact.id).data().tags || [] };
  try {
    const out = await generateJSON({
      systemInstruction: `你把台灣便當店的自由輸入菜名歸類成標準菜名。
若輸入和清單中某道菜是同一道菜（錯字、簡稱、地方叫法），回傳該菜的 id；否則 id 為 null，並給一個簡潔的標準菜名（繁體中文，不加形容詞）。
同時給這道菜的標籤，只能從這些值選：雞、豬、牛、海鮮、素、炸、滷、烤、炒、蒸、辣、清淡、甜、葉菜、根莖、瓜類。
輸出 JSON：{"id": string|null, "name": string, "category": "青菜類"|"肉類配菜"|"蛋豆類"|"主菜"|"其他", "tags": string[]}`,
      userPrompt: JSON.stringify({ input: text, library: dishes.map(({ id, name, aliases }) => ({ id, name, aliases })) }),
      temperature: 0.1,
    });
    const hit = out.id && dishes.find((d) => d.id === out.id);
    if (hit) return { dish_id: hit.id, name: hit.name, tags: lib.docs.find((d) => d.id === hit.id).data().tags || [] };
    return { dish_id: null, name: String(out.name || text).slice(0, 20), category: out.category || "其他", tags: Array.isArray(out.tags) ? out.tags : [] };
  } catch (err) {
    logger.warn("normalizeDish via Gemini failed, using raw text", err);
    return { dish_id: null, name: text, tags: [] };
  }
}

exports.normalizeDishName = onCall({}, async (request) => {
  assertSignedInUser(request, "查詢菜名");
  const text = String(request.data?.text || "").trim().slice(0, 30);
  if (!text) throw new HttpsError("invalid-argument", "text is required");
  return normalizeDish(text);
});

exports.draftRecipe = onCall({ timeoutSeconds: 60 }, async (request) => {
  await callerVendorId(request, request.data?.vendor_id);
  const name = String(request.data?.name || "").trim().slice(0, 30);
  if (!name) throw new HttpsError("invalid-argument", "name is required");
  const out = await generateJSON({
    systemInstruction: `你是台灣便當店的配方助手，幫店家把一道菜名變成「配方草稿」，店家會自己修改數字後才儲存。
只給合理的起始值，不要自稱精確。輸出 JSON：
{"component": {"name": string, "portion_grams": number（每份熟重 g）, "prep_minutes": number（每批製程分鐘）, "equipment": "炒鍋"|"電鍋"|"炸鍋"|"烤箱"|"滷鍋"|"蒸籠"|"工作台", "batch_capacity": number（每批份數）, "advance_hours": number（可提前幾小時做）, "method": "炸"|"滷"|"烤"|"炒"|"蒸"|"煮"|"涼拌", "flavors": string[]（從 辣、清淡、甜 選）},
 "ingredients": [{"name": string, "category": "雞"|"豬"|"牛"|"海鮮"|"素"|"蛋"|"豆"|"葉菜"|"根莖"|"瓜類"|"米"|"調味"|"乾貨"|"包材"|"其他", "grams": number（每份用到的熟重 g；以個計的填個數）, "unit": "g"|"個", "yield_rate": number（熟成率，熟重/生重）, "loss_rate": number（0-1）, "purchase_unit_label": string, "purchase_unit_size": number, "shelf_days": number, "frequency": "monthly"|"weekly"|"daily"}],
 "note": string（一句提醒店家要自己調整的地方）}`,
    userPrompt: JSON.stringify({ dish: name, template: request.data?.template || null }),
    temperature: 0.3,
  });
  return { ...out, disclaimer: "AI 產生的草稿，份量與數字請依店內實際狀況修改後再儲存" };
});

/* ------------------------------------------------------------------ *
 * Area insights (§10.2): within 1 km of the pickup point, last 30 days; not generated when fewer than 20 people are counted.
 * Charity meal reservations, claims and views never enter the stats (only locks and openWishes are read here).
 * ------------------------------------------------------------------ */

function itemTags(item, catalog) {
  const tags = new Set();
  const addC = (id) => dishTags(catalog.componentsById[id], catalog.ingredientsById).forEach((x) => tags.add(x));
  addC(item.main?.component_id);
  (item.slots || []).forEach((s) => {
    addC(s.default?.component_id);
    (s.candidates || []).forEach((c) => addC(c.component_id));
  });
  return tags;
}

async function buildInsightsFor(vendor, vendors, config, week) {
  if (!Number.isFinite(vendor.lat) || !Number.isFinite(vendor.lng)) return { skipped: "no_location" };
  const nearby = vendors.filter((v) => distanceMeters(vendor, v) <= config.insightRadiusMeters);
  const since = addDays(taipeiToday(), -30);
  const locks = [];
  for (const v of nearby) {
    const snap = await db().collection("locks").where("vendor_id", "==", v.id).where("pickup_date", ">=", since).get();
    snap.docs.forEach((d) => {
      const l = d.data();
      if (!["cancelled", "cancelling"].includes(l.status)) locks.push(l);
    });
  }
  const users = new Set(locks.map((l) => l.payer_uid || l.buyer_uid));
  const ref = db().collection("areaInsights").doc(`${vendor.id}_${week}`);
  if (users.size < config.insightMinUsers) {
    await ref.set({ vendor_id: vendor.id, week, insufficient: true, min_users: config.insightMinUsers, generated_at: FieldValue.serverTimestamp() });
    return { skipped: "too_few_users" };
  }
  const tagCount = new Map();
  locks.forEach((l) => (l.tags || []).forEach((tag) => tagCount.set(tag, (tagCount.get(tag) || 0) + 1)));
  const tagShares = [...tagCount].map(([tag, n]) => ({ tag, share: Math.round((n / locks.length) * 1000) / 10 })).sort((a, b) => b.share - a.share);
  const dishSeen = new Map();
  locks.forEach((l) => (l.slots || []).forEach((s) => {
    const k = s.default_dish;
    if (!k) return;
    const d = dishSeen.get(k) ?? { total: 0, removed: 0 };
    d.total++;
    if (s.removed) d.removed++;
    dishSeen.set(k, d);
  }));
  const removalRates = [...dishSeen].filter(([, d]) => d.total >= 10)
    .map(([dish, d]) => ({ dish, rate: Math.round((d.removed / d.total) * 1000) / 10, total: d.total }))
    .sort((a, b) => b.rate - a.rate).slice(0, 10);
  const wishSince = Timestamp.fromMillis(Date.now() - 30 * 86400000);
  const wishGroups = new Map();
  for (const v of nearby) {
    const snap = await db().collection("openWishes").where("vendor_id", "==", v.id).where("created_at", ">=", wishSince).get();
    snap.docs.forEach((d) => {
      const w = d.data();
      const g = wishGroups.get(w.dish_key) ?? { dish: w.dish_name, dish_key: w.dish_key, users: new Set() };
      g.users.add(w.user_id);
      wishGroups.set(w.dish_key, g);
    });
  }
  const openWishes = [...wishGroups.values()].map((g) => ({ dish: g.dish, dish_key: g.dish_key, people: g.users.size }))
    .sort((a, b) => b.people - a.people).slice(0, 10);
  // Supply gap: high demand share (≥ 15%) but few nearby vendors offering that tag (≤ 1)
  const supply = new Map();
  for (const v of nearby) {
    const catalog = await loadVendorCatalog(v.id);
    const tags = new Set();
    Object.values(catalog.itemsById).forEach((item) => itemTags(item, catalog).forEach((x) => tags.add(x)));
    tags.forEach((tag) => supply.set(tag, (supply.get(tag) || 0) + 1));
  }
  const gaps = tagShares.filter((x) => x.share >= 15 && (supply.get(x.tag) || 0) <= 1)
    .map((x) => ({ tag: x.tag, share: x.share, suppliers: supply.get(x.tag) || 0 }));
  // Wished and removed dish names are free text typed by diners; give the English UI a dish_en (a failed translation just falls back to Chinese)
  const names = [...new Set([...openWishes, ...removalRates].map((x) => x.dish).filter(Boolean))];
  try {
    const english = await translateTexts(names);
    const en = new Map(names.map((n, i) => [n, english[i]]));
    [...openWishes, ...removalRates].forEach((x) => { if (en.get(x.dish)) x.dish_en = en.get(x.dish); });
  } catch (err) {
    logger.warn("buildAreaInsights: dish translation failed", { vendor: vendor.id, error: err.message });
  }
  await ref.set({
    vendor_id: vendor.id, week, users: users.size, orders: locks.length, nearby_vendors: nearby.length,
    tag_shares: tagShares.slice(0, 15), removal_rates: removalRates, open_wishes: openWishes, gaps,
    generated_at: FieldValue.serverTimestamp(),
  });
  return { users: users.size };
}

exports.buildAreaInsights = onSchedule({ schedule: "0 4 * * 1", timeZone: "Asia/Taipei", region: REGION }, async () => {
  const config = await loadPlatformConfig(db());
  const vendors = await allVendors();
  const week = mondayOf(taipeiToday());
  await forEachVendor("buildAreaInsights", (vendor) => buildInsightsFor(vendor, vendors, config, week));
});

exports.triggerAreaInsightsNow = onCall({ timeoutSeconds: 120 }, async (request) => {
  const vendorId = await callerVendorId(request, request.data?.vendor_id);
  const config = await loadPlatformConfig(db());
  const vendors = await allVendors();
  const vendor = vendors.find((v) => v.id === vendorId);
  if (!vendor) throw new HttpsError("not-found", "vendor not found");
  return buildInsightsFor(vendor, vendors, config, mondayOf(taipeiToday()));
});

// Basket analysis and customer segments (doc/GoogleCloud改動建議.md P1): runs customerInsights.sql in BigQuery weekly
// (frequently-bought-together item pairs, ML.KMEANS member segments, AI.GENERATE segment descriptions), then writes each vendor's results back to Firestore:
//   vendors/{vendorId}/analytics/basket    { pairs: [{ item_a, item_b, buyers, confidence }] }
//   vendors/{vendorId}/analytics/segments  { segments: [{ segment_id, label, description, label_en, description_en, customers }] }
//   menu_items/{id}.often_with              ids of items often bought together at the same vendor (sorted by buyers, at most 5; used on the diner item page)
// Vendors only see aggregates (segment name, headcount), never which members are in them.
const fs = require("fs");
const path = require("path");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { BigQuery } = require("@google-cloud/bigquery");
const { REGION, db, onCall, logger, FieldValue, assertAdminOrEmulator, BatchWriter } = require("./common");
const { taipeiToday } = require("./calendar");

const DATASET = "bunnbaa_analytics";
const BQ_LOCATION = "asia-east1";
const TOP_PAIRS = 5;
const OFTEN_WITH_MAX = 5;
const INSIGHTS_SQL = fs.readFileSync(path.join(__dirname, "customerInsights.sql"), "utf8");

let bigquery;
const bq = () => (bigquery ??= new BigQuery());
const query = async (sql) => (await bq().query({ query: sql, location: BQ_LOCATION }))[0];

async function runCustomerInsights() {
  await query(INSIGHTS_SQL);
  const [pairs, profiles, mix] = await Promise.all([
    query(`SELECT vendor_id, item_a, item_b, buyers, confidence FROM ${DATASET}.basket_pairs
           ORDER BY vendor_id, buyers DESC, confidence DESC`),
    query(`SELECT segment_id, members, ai.label, ai.description, ai.label_en, ai.description_en, ai.status
           FROM ${DATASET}.segment_profiles`),
    query(`SELECT vendor_id, segment_id, customers FROM ${DATASET}.vendor_segment_mix`),
  ]);

  const profileById = new Map(profiles.map((p) => [p.segment_id, p]));
  for (const p of profiles) if (p.status) logger.warn(`customerInsights: segment ${p.segment_id} AI.GENERATE: ${p.status}`);

  const byVendor = new Map();
  const entry = (v) => byVendor.get(v) ?? byVendor.set(v, { pairs: [], segments: [] }).get(v);
  for (const r of pairs) {
    const v = entry(r.vendor_id);
    if (v.pairs.length < TOP_PAIRS) v.pairs.push({ item_a: r.item_a, item_b: r.item_b, buyers: r.buyers, confidence: r.confidence });
  }
  for (const r of mix) {
    const p = profileById.get(r.segment_id);
    if (!p) continue;
    entry(r.vendor_id).segments.push({
      segment_id: r.segment_id,
      // When AI.GENERATE fails, label is null and the frontend shows "Segment N" instead
      label: p.label ?? null, description: p.description ?? null,
      label_en: p.label_en ?? null, description_en: p.description_en ?? null,
      customers: r.customers,
    });
  }

  const generated = { generated_date: taipeiToday(), generated_at: FieldValue.serverTimestamp() };
  const writer = new BatchWriter();
  for (const [vendorId, v] of byVendor) {
    v.segments.sort((a, b) => b.customers - a.customers);
    await writer.set(db().doc(`vendors/${vendorId}/analytics/basket`), { pairs: v.pairs, ...generated });
    await writer.set(db().doc(`vendors/${vendorId}/analytics/segments`), { segments: v.segments, ...generated });
  }
  await writer.flush();
  const oftenWith = await writeOftenWith(pairs);
  return { vendors: byVendor.size, segments: profiles.length, often_with_updated: oftenWith };
}

/**
 * Basket pairs (by item name) → each item's often_with (ids of items at the same vendor, sorted by buyers then confidence, at most 5).
 * Locks only store the item name, so every item with that name at the same vendor counts; names that match no item (such as meal-plan "Day N" entries) are skipped.
 * items: [{ id, vendor_id, name }]; returns Map(itemId → array of ids); items without pairs are left out.
 */
function oftenWithByItem(pairs, items) {
  const idsByName = new Map(); // "vendor_id/品名" → [id]
  for (const it of items) {
    if (!it.vendor_id || !it.name) continue;
    const key = `${it.vendor_id}/${it.name}`;
    idsByName.set(key, [...(idsByName.get(key) || []), it.id]);
  }
  const sorted = [...pairs].sort((a, b) => b.buyers - a.buyers || b.confidence - a.confidence);
  const out = new Map();
  const add = (fromIds, toIds) => {
    for (const from of fromIds) {
      const list = out.get(from) ?? out.set(from, []).get(from);
      for (const to of toIds) if (to !== from && !list.includes(to) && list.length < OFTEN_WITH_MAX) list.push(to);
    }
  };
  for (const p of sorted) {
    const a = idsByName.get(`${p.vendor_id}/${p.item_a}`);
    const b = idsByName.get(`${p.vendor_id}/${p.item_b}`);
    if (!a || !b) continue;
    add(a, b);
    add(b, a);
  }
  for (const [id, list] of out) if (!list.length) out.delete(id);
  return out;
}

/**
 * Compares with the current often_with and returns only the changes: [{ id, often_with }]; often_with null means delete the field.
 * Unchanged content is not written (every menu_items write makes the translation and embedding triggers check it again).
 */
function oftenWithUpdates(pairs, items) {
  const next = oftenWithByItem(pairs, items);
  const updates = [];
  for (const it of items) {
    const want = next.get(it.id) || null;
    const have = Array.isArray(it.often_with) && it.often_with.length ? it.often_with : null;
    if (JSON.stringify(want) !== JSON.stringify(have)) updates.push({ id: it.id, often_with: want });
  }
  return updates;
}

/** Writes menu_items/{id}.often_with, deleting the field on items whose pairs disappeared. Returns the number of writes */
async function writeOftenWith(pairs) {
  const snap = await db().collection("menu_items").select("vendor_id", "name", "often_with").get();
  const updates = oftenWithUpdates(pairs, snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  const writer = new BatchWriter();
  for (const u of updates) {
    await writer.update(db().collection("menu_items").doc(u.id), { often_with: u.often_with ?? FieldValue.delete() });
  }
  await writer.flush();
  return updates.length;
}

exports.customerInsights = onSchedule(
  { schedule: "every monday 04:00", timeZone: "Asia/Taipei", region: REGION, timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const result = await runCustomerInsights();
    logger.info("customerInsights done", result);
  }
);

/** For demos/testing: recompute now without waiting for the schedule (admins only) */
exports.triggerCustomerInsightsNow = onCall({ timeoutSeconds: 540, memory: "512MiB" }, async (request) => {
  assertAdminOrEmulator(request);
  return runCustomerInsights();
});

exports.helpers = { runCustomerInsights, oftenWithByItem, oftenWithUpdates };

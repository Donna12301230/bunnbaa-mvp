// 購物籃與客戶分群（doc/GoogleCloud改動建議.md P1）：每週在 BigQuery 跑 customerInsights.sql
// （常一起買的品項配對、ML.KMEANS 會員分群、AI.GENERATE 寫群組描述），再把每家店的結果寫回 Firestore：
//   vendors/{vendorId}/analytics/basket    { pairs: [{ item_a, item_b, buyers, confidence }] }
//   vendors/{vendorId}/analytics/segments  { segments: [{ segment_id, label, description, label_en, description_en, customers }] }
// 商家只看得到彙總（群名、人數），看不到是哪些會員。
const fs = require("fs");
const path = require("path");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { BigQuery } = require("@google-cloud/bigquery");
const { REGION, db, onCall, logger, FieldValue, assertAdminOrEmulator, BatchWriter } = require("./common");
const { taipeiToday } = require("./calendar");

const DATASET = "bunnbaa_analytics";
const BQ_LOCATION = "asia-east1";
const TOP_PAIRS = 5;
const INSIGHTS_SQL = fs.readFileSync(path.join(__dirname, "customerInsights.sql"), "utf8");

let bigquery;
const bq = () => (bigquery ??= new BigQuery());
const query = async (sql) => (await bq().query({ query: sql, location: BQ_LOCATION }))[0];

async function runCustomerInsights() {
  await query(INSIGHTS_SQL);
  const [pairs, profiles, mix] = await Promise.all([
    query(`SELECT vendor_id, item_a, item_b, buyers, confidence FROM ${DATASET}.basket_pairs
           QUALIFY ROW_NUMBER() OVER (PARTITION BY vendor_id ORDER BY buyers DESC, confidence DESC) <= ${TOP_PAIRS}`),
    query(`SELECT segment_id, members, ai.label, ai.description, ai.label_en, ai.description_en, ai.status
           FROM ${DATASET}.segment_profiles`),
    query(`SELECT vendor_id, segment_id, customers FROM ${DATASET}.vendor_segment_mix`),
  ]);

  const profileById = new Map(profiles.map((p) => [p.segment_id, p]));
  for (const p of profiles) if (p.status) logger.warn(`customerInsights: segment ${p.segment_id} AI.GENERATE: ${p.status}`);

  const byVendor = new Map();
  const entry = (v) => byVendor.get(v) ?? byVendor.set(v, { pairs: [], segments: [] }).get(v);
  for (const r of pairs) {
    entry(r.vendor_id).pairs.push({ item_a: r.item_a, item_b: r.item_b, buyers: r.buyers, confidence: r.confidence });
  }
  for (const r of mix) {
    const p = profileById.get(r.segment_id);
    if (!p) continue;
    entry(r.vendor_id).segments.push({
      segment_id: r.segment_id,
      // AI.GENERATE 失敗時 label 是 null，前端改顯示「客群 N」
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
  return { vendors: byVendor.size, segments: profiles.length };
}

exports.customerInsights = onSchedule(
  { schedule: "every monday 04:00", timeZone: "Asia/Taipei", region: REGION, timeoutSeconds: 540, memory: "512MiB" },
  async () => {
    const result = await runCustomerInsights();
    logger.info("customerInsights done", result);
  }
);

/** 展示／測試用：不等排程，立刻重算（只限管理員） */
exports.triggerCustomerInsightsNow = onCall({ timeoutSeconds: 540, memory: "512MiB" }, async (request) => {
  assertAdminOrEmulator(request);
  return runCustomerInsights();
});

exports.helpers = { runCustomerInsights };

// Firestore → BigQuery 同步（Stream Firestore to BigQuery extension，見 extensions/*.env）的 transform function。
// extension 寫入前把每筆 row POST 過來：{ data: [{ insertId, json: { document_name, data, old_data, ... } }] }，
// json.data／old_data 是 JSON 字串。這裡拿掉分析用不到的個資與付款識別資料再交回去，
// 所以 BigQuery 原始 changelog 裡就沒有這些欄位（不只是 view 不顯示）。
// 回填腳本 fs-bq-import-collection 也要帶 -f 指向這個函式。
//
// extension 呼叫時不帶認證，所以 invoker 是 public；函式只轉換收到的資料，不讀寫資料庫。
const { onRequest } = require("firebase-functions/v2/https");

// 任何集合、任何層級都拿掉的欄位
const ALWAYS_DROP = new Set([
  "phone", "phone_number", "phone_last3", "email", "line_id", "note", "no_show_note", "consumer_feedback",
  "transaction_id", "pickup_code", "qr_nonce", "share_token",
]);

// payment_intents 只留金額、狀態、時間（GoogleCloud改動建議.md P0）
const PAYMENT_INTENT_FIELDS = new Set(["status", "amount", "total", "points_used"]);

function collectionOf(documentName) {
  // projects/{p}/databases/(default)/documents/{collection}/{id}
  const parts = String(documentName || "").split("/documents/")[1]?.split("/") || [];
  return parts[0] || "";
}

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!ALWAYS_DROP.has(k)) out[k] = scrub(v);
    }
    return out;
  }
  return value;
}

function sanitizeDoc(collection, doc) {
  if (!doc || typeof doc !== "object") return doc;
  if (collection === "payment_intents") {
    return Object.fromEntries(Object.entries(doc).filter(([k]) => PAYMENT_INTENT_FIELDS.has(k) || k.endsWith("_at")));
  }
  const out = scrub(doc);
  if (collection === "locks") delete out.resale_hold; // 進行中的付款保留，含 intent id
  return out;
}

function sanitizeJSONString(collection, text) {
  if (text == null || text === "") return text;
  return JSON.stringify(sanitizeDoc(collection, JSON.parse(text)));
}

function transformRows(rows) {
  return (rows || []).map((row) => {
    const json = row?.json;
    if (!json) return row;
    const collection = collectionOf(json.document_name);
    return {
      ...row,
      json: {
        ...json,
        data: sanitizeJSONString(collection, json.data),
        old_data: sanitizeJSONString(collection, json.old_data),
      },
    };
  });
}

exports.bqTransform = onRequest({ region: "asia-east1", invoker: "public", memory: "256MiB" }, (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("POST only");
    return;
  }
  res.json({ data: transformRows(req.body?.data) });
});

exports.helpers = { transformRows, sanitizeDoc };

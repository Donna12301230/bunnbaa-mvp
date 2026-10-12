// Transform function for the Firestore → BigQuery sync (Stream Firestore to BigQuery extension, see extensions/*.env).
// Before writing, the extension POSTs every row here: { data: [{ insertId, json: { document_name, data, old_data, ... } }] },
// where json.data / old_data are JSON strings. We strip personal data and payment identifiers analytics doesn't need and hand it back,
// so these fields never exist in the raw BigQuery changelog (not just hidden in the view).
// The backfill script fs-bq-import-collection must also pass -f pointing at this function.
//
// The extension calls it without auth, so the invoker is public; the function only transforms the data it receives and doesn't read or write the database.
const { onRequest } = require("firebase-functions/v2/https");

// Fields removed from every collection at every level
const ALWAYS_DROP = new Set([
  "phone", "phone_number", "phone_last3", "email", "line_id", "note", "no_show_note", "consumer_feedback",
  "transaction_id", "pickup_code", "qr_nonce", "share_token",
]);

// payment_intents keeps only amount, status and timestamps (GoogleCloud改動建議.md P0)
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
  if (collection === "locks") delete out.resale_hold; // in-progress payment hold, contains the intent id
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

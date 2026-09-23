const crypto = require("crypto");
const { randomUUID } = crypto;

// LINE Pay API v3. Sandbox vs production only differ by base URL — same
// signature scheme, same request/confirm payload shape. Defaults to sandbox
// so a missing/unset LINE_PAY_ENV can't accidentally hit production.
function baseUrl() {
  return process.env.LINE_PAY_ENV === "production"
    ? "https://api-pay.line.me"
    : "https://sandbox-api-pay.line.me";
}

function credentials() {
  const channelId = process.env.LINE_PAY_CHANNEL_ID;
  const channelSecret = process.env.LINE_PAY_CHANNEL_SECRET;
  if (!channelId || !channelSecret) {
    throw new Error("LINE_PAY_CHANNEL_ID / LINE_PAY_CHANNEL_SECRET not set in functions/.env");
  }
  return { channelId, channelSecret };
}

// Signature per LINE Pay v3 spec: Base64(HMAC-SHA256(channelSecret,
// channelSecret + uri + JSON body + nonce)).
function sign(channelSecret, uri, body, nonce) {
  const message = channelSecret + uri + JSON.stringify(body) + nonce;
  return crypto.createHmac("sha256", channelSecret).update(message).digest("base64");
}

// LINE Pay transaction IDs are up to 19 digits — past Number.MAX_SAFE_INTEGER
// (2^53-1, ~16 digits). A plain res.json() silently rounds them, so a
// transactionId we store from the request response can come back different
// from the one LINE Pay actually has, and confirm fails with "1159 The
// transaction request does not exist." Quote the bare numeric literal before
// JSON.parse so it round-trips as an exact string instead (LINE Pay's own
// docs flag this and ship an equivalent handleBigInteger() helper).
function parsePreservingTransactionId(text) {
  return JSON.parse(text.replace(/"(transactionId)":\s*(\d+)/g, '"$1":"$2"'));
}

async function callLinePay(method, uri, body) {
  const { channelId, channelSecret } = credentials();
  const nonce = randomUUID();
  const signature = sign(channelSecret, uri, body, nonce);

  const res = await fetch(`${baseUrl()}${uri}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-LINE-ChannelId": channelId,
      "X-LINE-Authorization-Nonce": nonce,
      "X-LINE-Authorization": signature,
    },
    body: JSON.stringify(body),
  });
  const json = parsePreservingTransactionId(await res.text());
  if (json.returnCode !== "0000") {
    const err = new Error(`LINE Pay ${uri} failed: ${json.returnCode} ${json.returnMessage}`);
    err.linePayResponse = json;
    throw err;
  }
  return json.info;
}

/**
 * Reserves a payment; returns { transactionId, paymentUrl, paymentAccessToken }.
 * `products` is LINE Pay's own shape: [{ name, quantity, price }, ...] — one
 * entry per cart line (a single-item checkout just passes a 1-element array).
 */
function requestPayment({ orderId, amount, products, confirmUrl, cancelUrl }) {
  const uri = "/v3/payments/request";
  return callLinePay("POST", uri, {
    amount,
    currency: "TWD",
    orderId,
    packages: [{ id: "package-1", amount, products }],
    redirectUrls: { confirmUrl, cancelUrl },
  });
}

/** Confirms a reserved payment after the buyer approves it in LINE Pay. */
function confirmPayment({ transactionId, amount }) {
  const uri = `/v3/payments/${transactionId}/confirm`;
  return callLinePay("POST", uri, { amount, currency: "TWD" });
}

module.exports = { requestPayment, confirmPayment };

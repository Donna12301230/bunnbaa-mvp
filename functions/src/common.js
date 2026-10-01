// Functions 共用：權限檢查、通知、讀取店家配方。index.js 先 initializeApp 才 require 各模組，
// 這裡的 db() 用到時才取，避免載入順序問題。
const { onCall: rawOnCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { withLang, t } = require("./i18n");

const REGION = "asia-east1";
const db = () => admin.firestore();

// 所有 callable 都包 withLang：handler 內的 t() 依前端送來的 data.lang 回中文或英文
const onCall = (opts, handler) => rawOnCall({ region: REGION, ...opts }, withLang(handler));

// ISO 27001 A.5.15/A.8.3: privileged and cost-bearing callables fail closed in
// deployed environments. Keep the admin list in sync with firestore.rules
// isAdmin() and web/src/lib/adminAuth.ts.
const ADMIN_EMAILS = ["suw192336@gmail.com", "ckchildlikekid@gmail.com"];

function isEmulator() {
  return process.env.FUNCTIONS_EMULATOR === "true";
}

function isAdminRequest(request) {
  const email = request.auth?.token?.email;
  return !!email && ADMIN_EMAILS.includes(email);
}

function assertAdminOrEmulator(request) {
  if (isEmulator()) return;
  if (!isAdminRequest(request)) {
    throw new HttpsError("permission-denied", "This action is restricted to platform admins.");
  }
}

function assertSignedInUser(request, action) {
  if (!request.auth || request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", t(`請先登入才能${action}`, `Please log in to ${action}`));
  }
}

async function assertAdminOrVendorOwner(request, vendorId) {
  if (isEmulator()) return;
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  if (isAdminRequest(request)) return;
  if (typeof vendorId !== "string" || !vendorId) throw new HttpsError("invalid-argument", "vendor_id is required");
  const vendorSnap = await db().collection("vendors").doc(vendorId).get();
  if (vendorSnap.exists && vendorSnap.data().owner_uid === request.auth.uid) return;
  throw new HttpsError("permission-denied", "Only this vendor's owner or a platform admin can do this.");
}

/** 呼叫者綁定的店家 id（店主）；管理員可指定任一家 */
async function callerVendorId(request, requested) {
  if (requested) {
    await assertAdminOrVendorOwner(request, requested);
    return requested;
  }
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in required.");
  const snap = await db().collection("vendors").where("owner_uid", "==", request.auth.uid).limit(1).get();
  if (snap.empty) throw new HttpsError("permission-denied", "Only vendor owners can do this.");
  return snap.docs[0].id;
}

/**
 * 站內通知＋盡量推播。notifications 是使用者自己可讀的收件匣（通知鈴鐺），
 * FCM token 存在 userTokens/{uid}；推播失敗不影響主流程。
 */
async function notifyUser(uid, { title, body, link = null, kind = "general" }) {
  if (!uid) return;
  try {
    // 會員中心關掉的通知類別（例如愛心餐）：站內通知與推播都不送
    const prefs = await db().collection("users").doc(uid).get();
    const muted = prefs.exists ? prefs.data().muted_kinds || [] : [];
    if (muted.includes(kind)) return;
    await db().collection("notifications").add({
      user_id: uid, title, body, link, kind, read: false, created_at: FieldValue.serverTimestamp(),
    });
    const tokenSnap = await db().collection("userTokens").doc(uid).get();
    const tokens = tokenSnap.exists ? tokenSnap.data().tokens || [] : [];
    for (const token of tokens.slice(-3)) {
      await admin.messaging().send({ token, notification: { title, body } }).catch((err) => logger.debug("push failed", err.message));
    }
  } catch (err) {
    logger.warn(`notifyUser ${uid} failed`, err);
  }
}

async function notifyVendor(vendorId, message) {
  const snap = await db().collection("vendors").doc(vendorId).get();
  const owner = snap.exists ? snap.data().owner_uid : null;
  if (owner) await notifyUser(owner, { kind: "vendor", ...message });
}

/** 店家的品項、半成品、原物料，一次讀齊（備料、採購、標籤都要） */
async function loadVendorCatalog(vendorId) {
  const vendorRef = db().collection("vendors").doc(vendorId);
  const [itemsSnap, compSnap, ingSnap] = await Promise.all([
    db().collection("menu_items").where("vendor_id", "==", vendorId).get(),
    vendorRef.collection("components").get(),
    vendorRef.collection("ingredients").get(),
  ]);
  const toMap = (snap) => Object.fromEntries(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  return { itemsById: toMap(itemsSnap), componentsById: toMap(compSnap), ingredientsById: toMap(ingSnap) };
}

async function allVendors() {
  const snap = await db().collection("vendors").get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((v) => v.status !== "disabled");
}

/** 對每家店執行，單店失敗不影響其他店 */
async function forEachVendor(label, fn) {
  for (const vendor of await allVendors()) {
    try {
      await fn(vendor);
    } catch (err) {
      logger.error(`${label} failed for vendor ${vendor.id}`, err);
    }
  }
}

/** 批次寫入，自動在 400 筆時送出 */
class BatchWriter {
  constructor() {
    this.batch = db().batch();
    this.count = 0;
  }
  async op(fn) {
    fn(this.batch);
    if (++this.count >= 400) await this.flush();
  }
  set(ref, data, opts) { return this.op((b) => (opts ? b.set(ref, data, opts) : b.set(ref, data))); }
  update(ref, data) { return this.op((b) => b.update(ref, data)); }
  async flush() {
    if (this.count === 0) return;
    await this.batch.commit();
    this.batch = db().batch();
    this.count = 0;
  }
}

/** 縣市（地址開頭，台→臺） */
function countyOf(address) {
  const m = String(address || "").replace(/台/g, "臺").match(/^(.{2}[市縣])/);
  return m ? m[1] : null;
}

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** geohash → 中心點（常用地點只存粗略 geohash，web/src/lib/geo.ts 有同一份） */
function decodeGeohash(hash) {
  if (typeof hash !== "string" || !hash) return null;
  const lat = [-90, 90];
  const lng = [-180, 180];
  let even = true;
  for (const ch of hash) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) return null;
    for (let b = 4; b >= 0; b--) {
      const range = even ? lng : lat;
      const mid = (range[0] + range[1]) / 2;
      if ((idx >> b) & 1) range[0] = mid;
      else range[1] = mid;
      even = !even;
    }
  }
  return { lat: (lat[0] + lat[1]) / 2, lng: (lng[0] + lng[1]) / 2 };
}

/** 兩點距離（公尺） */
function distanceMeters(a, b) {
  if (!Number.isFinite(a?.lat) || !Number.isFinite(b?.lat)) return Infinity;
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

module.exports = {
  REGION, db, onCall, HttpsError, logger, FieldValue, t, ADMIN_EMAILS, isEmulator, isAdminRequest,
  assertAdminOrEmulator, assertSignedInUser, assertAdminOrVendorOwner, callerVendorId, notifyUser, notifyVendor,
  loadVendorCatalog, allVendors, forEachVendor, BatchWriter, countyOf, distanceMeters, decodeGeohash,
};

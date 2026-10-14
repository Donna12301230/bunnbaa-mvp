// Shared Functions helpers: permission checks, notifications, loading vendor recipes. index.js calls initializeApp before
// requiring the modules, so db() here is resolved lazily to avoid load-order issues.
const { onCall: rawOnCall, HttpsError } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { withLang, inLang, t } = require("./i18n");

const REGION = "asia-east1";
const db = () => admin.firestore();

// Every callable is wrapped in withLang: t() inside the handler returns Chinese or English based on data.lang from the frontend
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

// Read-only demo admin from the login page (its password is public). It may call
// read-only admin callables via assertAdminViewerOrEmulator, never anything that
// writes or costs money. Keep in sync with firestore.rules isAdminViewer().
const DEMO_ADMIN_EMAIL = "admin@bunnbaa.test";

function assertAdminViewerOrEmulator(request) {
  if (isEmulator()) return;
  if (!isAdminRequest(request) && request.auth?.token?.email !== DEMO_ADMIN_EMAIL) {
    throw new HttpsError("permission-denied", "This action is restricted to platform admins.");
  }
}

function assertAdminOrEmulator(request) {
  if (isEmulator()) return;
  if (!isAdminRequest(request)) {
    throw new HttpsError("permission-denied", "This action is restricted to platform admins.");
  }
}

/** zhAction/enAction: what the user was trying to do, e.g. ("結帳", "check out") */
function assertSignedInUser(request, zhAction, enAction = "continue") {
  if (!request.auth || request.auth.token?.firebase?.sign_in_provider === "anonymous") {
    throw new HttpsError("unauthenticated", t(`請先登入才能${zhAction}`, `Please log in to ${enAction}`));
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

/** The vendor id bound to the caller (vendor owner); admins may specify any vendor */
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
 * In-app notification + best-effort push. notifications is the user's own readable inbox (the notification bell);
 * FCM tokens live in userTokens/{uid}; push failures don't affect the main flow.
 * message is { title, body, link, kind } or a builder () => ({ ... }): a builder runs inside inLang(users/{uid}.lang),
 * so t() in it follows the RECIPIENT's language rather than the caller's (or Chinese in schedules/triggers).
 */
async function notifyUser(uid, message) {
  if (!uid) return;
  try {
    const prefs = await db().collection("users").doc(uid).get();
    const lang = prefs.exists ? prefs.data().lang : null;
    const { title, body, link = null, kind = "general" } = typeof message === "function" ? inLang(lang, message) : message;
    // Notification kinds turned off in the member center (e.g. charity meals): neither in-app nor push is sent
    const muted = prefs.exists ? prefs.data().muted_kinds || [] : [];
    if (muted.includes(kind)) return;
    await db().collection("notifications").add({
      user_id: uid, title, body, link, kind, read: false, created_at: FieldValue.serverTimestamp(),
    });
    const tokenSnap = await db().collection("userTokens").doc(uid).get();
    const tokens = tokenSnap.exists ? tokenSnap.data().tokens || [] : [];
    for (const token of tokens.slice(-3)) {
      // data-only: the service worker shows it and handles the click (opens the link page); a notification field would make the SDK show it a second time, and clicking it wouldn't open the page
      await admin.messaging().send({ token, data: { title: String(title || ""), body: String(body || ""), link: String(link || "") } })
        .catch((err) => logger.debug("push failed", err.message));
    }
  } catch (err) {
    logger.warn(`notifyUser ${uid} failed`, err);
  }
}

/** message: object or builder, as in notifyUser (a builder follows the vendor owner's language) */
async function notifyVendor(vendorId, message) {
  const snap = await db().collection("vendors").doc(vendorId).get();
  const owner = snap.exists ? snap.data().owner_uid : null;
  if (!owner) return;
  await notifyUser(owner, typeof message === "function" ? () => ({ kind: "vendor", ...message() }) : { kind: "vendor", ...message });
}

/** Load a vendor's items, components and ingredients in one go (needed for prep, purchasing and tags) */
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

/** Run for every vendor; one vendor failing doesn't affect the others */
async function forEachVendor(label, fn) {
  for (const vendor of await allVendors()) {
    try {
      await fn(vendor);
    } catch (err) {
      logger.error(`${label} failed for vendor ${vendor.id}`, err);
    }
  }
}

/** Batched writes, committed automatically every 400 */
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

/** County/city (start of the address, 台 → 臺) */
function countyOf(address) {
  const m = String(address || "").replace(/台/g, "臺").match(/^(.{2}[市縣])/);
  return m ? m[1] : null;
}

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** geohash → center point (usual locations are stored only as coarse geohashes; web/src/lib/geo.ts has the same code) */
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

/** Distance between two points (meters) */
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
  REGION, db, onCall, HttpsError, logger, FieldValue, t, ADMIN_EMAILS, isEmulator, isAdminRequest, assertAdminViewerOrEmulator,
  assertAdminOrEmulator, assertSignedInUser, assertAdminOrVendorOwner, callerVendorId, notifyUser, notifyVendor,
  loadVendorCatalog, allVendors, forEachVendor, BatchWriter, countyOf, distanceMeters, decodeGeohash,
};

// Test cases that actually call Cloud Functions.
// Runs on a separate test emulator and creates its own test vendors (zz-*) and members A/B/C, so it
// doesn't depend on the dates in the seed data.
//
// Run:
//   1. Start a test emulator (project demo-bunnbaa-test; ports are in firebase.test.json at the repo root, clear of the dev emulator)
//        cd scripts/tests && npm run emulator
//      The first time, wait for Functions to load (about 30 seconds).
//   2. cd scripts/tests && npm run test:functions
//
// Notes:
//   - In the emulator assertAdminOrVendorOwner/assertAdminOrEmulator always pass, so cross-vendor permissions can only be tested on production.
//   - LINE Pay is never called: every order uses a NT$0 coupon covering the full amount to take the no-payment path (C-RWD-12), and cancelled orders have no transaction_id, so nothing is refunded.
//   - Anything that uses Gemini (real pre-order assistant answers, photo-to-menu recognition) only has its argument checks tested; no real requests are sent.
const path = require("node:path");
const admin = require("firebase-admin");
const { initializeApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");

const PROJECT = "demo-bunnbaa-test";
const HOST = "127.0.0.1";
const PORTS = { firestore: 8081, auth: 9098, functions: 5002 };
process.env.FIRESTORE_EMULATOR_HOST = `${HOST}:${PORTS.firestore}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `${HOST}:${PORTS.auth}`;
process.env.GCLOUD_PROJECT = PROJECT;

const SRC = path.resolve(__dirname, "../../functions/src");
const { taipeiToday, addDays, weekdayOf, mondayOf } = require(path.join(SRC, "calendar.js"));
const { isPastCutoff } = require(path.join(SRC, "pricing.js"));
const { DEFAULT_PLATFORM_CONFIG: CFG } = require(path.join(SRC, "config.js"));

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

const results = [];
async function test(id, name, fn) {
  try { await fn(); results.push([id, "PASS", name, ""]); }
  catch (e) { results.push([id, "FAIL", name, String(e.message || e).split("\n")[0].slice(0, 200)]); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ""} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Emulator triggers run in a queue, and earlier onLockCreated runs (which crash and restart with GEMINI_DISABLED set) slow things down, so wait longer
async function waitFor(fn, ms = 180000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for trigger");
    await sleep(500);
  }
}

// ── Identities ──
const PASSWORD = "test1234";
async function ensureUser(email, extra = {}) {
  try { return (await admin.auth().getUserByEmail(email)).uid; }
  catch { return (await admin.auth().createUser({ email, password: PASSWORD, ...extra })).uid; }
}
async function client(name, email, password = PASSWORD) {
  const app = initializeApp({ projectId: PROJECT, apiKey: "fake-key" }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:${PORTS.auth}`, { disableWarnings: true });
  if (email) await signInWithEmailAndPassword(auth, email, password);
  const fns = getFunctions(app, "asia-east1");
  connectFunctionsEmulator(fns, HOST, PORTS.functions);
  const call = async (fn, data = {}) => {
    try { return { ok: true, data: (await httpsCallable(fns, fn, { timeout: 60000 })(data)).data }; }
    catch (e) { return { ok: false, code: String(e.code || "").replace("functions/", ""), message: e.message }; }
  };
  return { uid: auth.currentUser?.uid, call };
}
function expectOk(r, msg) { if (!r.ok) throw new Error(`${msg || ""} expected ok, got ${r.code}: ${r.message}`); return r.data; }
function expectCode(r, code, msg) {
  if (r.ok) throw new Error(`${msg || ""} expected ${code}, but call succeeded`);
  if (r.code !== code) throw new Error(`${msg || ""} expected ${code}, got ${r.code}: ${r.message}`);
  return r;
}
/** Paid takeover on the resale market: reserve + request payment → confirm payment. The emulator has no LINE Pay keys, so this uses a fake payment flow */
async function takeOver(user, lockId) {
  const r = await user.call("createResaleLinePayReservation", { lock_id: lockId });
  if (!r.ok) return r;
  return user.call("confirmLinePayPayment", { order_id: r.data.order_id });
}

// ── Dates ──
const TODAY = taipeiToday();
function nextBusinessDay(from) {
  let d = addDays(from, 1);
  while (!CFG.businessWeekdays.includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
}
// Nearest business day not yet past cut-off (default cut-off 20:00; running in the evening skips to the day after tomorrow)
let OPEN_DAY = nextBusinessDay(TODAY);
while (isPastCutoff(OPEN_DAY, {}, CFG)) OPEN_DAY = nextBusinessDay(OPEN_DAY);
const TODAY_IS_BUSINESS = CFG.businessWeekdays.includes(weekdayOf(TODAY));
// Nearest business day that can still be cancelled: cancellation closes 48 hours before the pickup slot starts (WINDOW starts at 00:00, so at least 3 days out)
const CANCEL_DAY = nextBusinessDay(addDays(TODAY, 2));

// ── Test data ──
const V1 = "zz-test-vendor";
const V2 = "zz-test-vendor-2";
const ITEM = "zz-bento";
const ITEM2 = "zz-onigiri";
const WINDOW = "00:00-23:59"; // the whole day is inside the pickup slot, so donating and redeeming don't depend on when the tests run
let seq = 0;
const uniq = (p) => `${p}-${Date.now().toString(36)}-${++seq}`;

async function setupFixtures(uids) {
  const future = Timestamp.fromMillis(Date.now() + 30 * 86400000);
  const vendor = (name, extra = {}) => ({
    name, address: "臺北市大安區測試路 1 號", pickup_windows: [WINDOW], lat: 25.026, lng: 121.543,
    subscription_status: "active", subscription_end_date: future, owner_uid: uids.owner, ...extra,
  });
  await db.doc(`vendors/${V1}`).set(vendor("測試便當店", { slot_capacity: 0 }));
  await db.doc(`vendors/${V2}`).set(vendor("測試飯糰店"));
  await db.doc(`menu_items/${ITEM}`).set({
    vendor_id: V1, name: "測試雞腿便當", price: 100, category: "便當", available: true,
    main: { name: "滷雞腿" }, rice_component_id: "zz-rice",
    slots: [
      { category: "青菜類", default: { name: "高麗菜" }, candidates: [{ name: "地瓜葉", portion_level: 1, weekly_cap: 1000, min_qty: 10 }, { name: "筊白筍", portion_level: 0.5, weekly_cap: 1000, min_qty: 10 }] },
      { category: "蛋豆類", default: { name: "滷蛋" } },
    ],
  });
  await db.doc(`menu_items/${ITEM2}`).set({ vendor_id: V2, name: "測試飯糰", price: 60, category: "輕食", available: true });
}
async function coupon(uid, vendorId, discount = 100, extra = {}) {
  const ref = db.collection("coupons").doc(uniq("zzc"));
  await ref.set({ user_id: uid, vendor_id: vendorId, discount, tier: "free", status: "owned", expires_at: Timestamp.fromMillis(Date.now() + 30 * 86400000), created_at: Timestamp.now(), ...extra });
  return ref.id;
}
/** Writes a lock directly (skipping payment), for the cancel/redeem/donate cases */
async function lock(buyer, extra = {}) {
  const ref = db.collection("locks").doc(uniq("zzl"));
  const code = String(1000 + Math.floor(Math.random() * 9000));
  await ref.set({
    vendor_id: V1, menu_item_id: ITEM, item_name: "測試雞腿便當", pickup_date: OPEN_DAY, pickup_window: WINDOW,
    buyer_uid: buyer, payer_uid: buyer, status: "locked", locked_price: 80, list_price: 100, pickup_code: code, phone_last3: "567",
    slots: [
      { category: "青菜類", default_dish: "高麗菜", removed: false, wished: null, resolved: "高麗菜", portion_level: 1 },
      { category: "蛋豆類", default_dish: "滷蛋", removed: false, wished: null, resolved: "滷蛋", portion_level: 1 },
    ],
    rice: "normal", reward_counted: false, created_at: Timestamp.now(), ...extra,
  });
  return { id: ref.id, ref, code };
}
/** A period with an open pool: rewardPeriods.remaining plus the matching number of issued tickets */
async function issuePool(period, remaining) {
  await db.doc(`vendors/${V1}/rewardPeriods/${period}`).set({ period_id: period, status: "pooled", remaining, draw_deadline: Timestamp.fromMillis(Date.now() + 7 * 86400000) });
  const discount = { free: 100, t50: 50, t95: 5 };
  for (const [tier, n] of Object.entries(remaining)) {
    for (let i = 0; i < n; i++) {
      await db.collection("coupons").doc(uniq("zzp")).set({ vendor_id: V1, pool_period: period, tier, discount: discount[tier], status: "issued" });
    }
  }
}
const get = async (p) => (await db.doc(p).get()).data();
const counterId = (v, d, w) => `slot_counters/${v}__${d}__${w}`;

(async () => {
  // make sure the emulator is running
  try { await db.doc("_ping/x").get(); } catch (e) { console.error(`Cannot reach the Firestore emulator at ${HOST}:${PORTS.firestore}; run npm run emulator first`); process.exit(2); }

  const uids = {
    A: await ensureUser("zz-a@bunnbaa.test"), B: await ensureUser("zz-b@bunnbaa.test"), C: await ensureUser("zz-c@bunnbaa.test"),
    E: await ensureUser("zz-e@bunnbaa.test"), // only for C-RWD-01; cumulative spend starts at 0
    owner: await ensureUser("zz-owner@bunnbaa.test"),
  };
  await setupFixtures(uids);
  const A = await client("A", "zz-a@bunnbaa.test");
  const B = await client("B", "zz-b@bunnbaa.test");
  const C = await client("C", "zz-c@bunnbaa.test");
  const E = await client("E", "zz-e@bunnbaa.test");
  const OWNER = await client("owner", "zz-owner@bunnbaa.test");
  const ANON = await client("anon", null);
  console.log(`TODAY=${TODAY} OPEN_DAY=${OPEN_DAY}\n`);

  // ════ 3.5 Ordering (NT$0 coupon, no-payment path) + 3.4 server-side pricing ════
  const cart = (lines) => A.call("createCartLinePayReservation", { lines });
  const line = (extra = {}) => ({ menu_item_id: ITEM, pickup_date: OPEN_DAY, pickup_window: WINDOW, quantity: 1, rice: "normal", slots: [{ choice: "default" }, { choice: "default" }], ...extra });

  let paidLockId = null;
  await test("C-RWD-12", "零元券全額折抵：不經 LINE Pay，確認後直接建立 lock", async () => {
    const c = await coupon(uids.A, V1, 100);
    const r = expectOk(await cart([line({ coupon_id: c })]));
    assert(r.free === true, "free 應為 true");
    const conf = expectOk(await A.call("confirmLinePayPayment", { order_id: r.order_id }));
    eq(conf.lock_ids.length, 1);
    paidLockId = conf.lock_ids[0];
    const l = await get(`locks/${paidLockId}`);
    eq(l.status, "locked"); eq(l.locked_price, 0); eq(l.vendor_id, V1);
    eq((await get(`coupons/${c}`)).status, "redeemed");
  });

  await test("C-PRC-10", "加飯＋一格不要：list 100、早鳥、adjust、locked_price 由伺服器算", async () => {
    const c = await coupon(uids.A, V1, 1000); // full-amount coupon: no-payment path, discount = subtotal
    const r = expectOk(await cart([line({ rice: "add", slots: [{ choice: "none" }, { choice: "default" }], coupon_id: c })]));
    const d = (await get(`payment_intents/${r.order_id}`)).lock_drafts[0];
    const early = 100 - d.early_bird_amount;
    eq(d.list_price, 100); eq(d.adjust_amount, 5, "adjust（+10 −5）"); eq(d.rice, "add");
    eq(d.coupon_discount, early + 5, "小計 = 早鳥 + 5");
    const days = Math.round((Date.parse(OPEN_DAY) - Date.parse(TODAY)) / 86400000);
    eq(d.discount_percent, days <= 1 ? 5 : 20, `距取餐 ${days} 天的早鳥折扣`);
  });

  await test("C-PRC-08", "前端送的價格欄位被忽略，照 menu_items 重算", async () => {
    const c = await coupon(uids.A, V1, 1000);
    const r = expectOk(await cart([line({ price: 1, locked_price: 1, list_price: 1, coupon_id: c })]));
    const d = (await get(`payment_intents/${r.order_id}`)).lock_drafts[0];
    eq(d.list_price, 100);
    eq(d.coupon_discount, 100 - d.early_bird_amount, "小計照原價 100 算");
  });

  await test("C-RWD-10", "小計小於券面只折到 0、不找零；同一張券用兩次被擋", async () => {
    const c = await coupon(uids.A, V1, 100);
    const r = expectOk(await cart([line({ rice: "less", slots: [{ choice: "none" }, { choice: "none" }], coupon_id: c })]));
    const d = (await get(`payment_intents/${r.order_id}`)).lock_drafts[0];
    eq(d.locked_price, 0); assert(d.coupon_discount < 100, "折抵不應超過小計");
    const c2 = await coupon(uids.A, V1, 20);
    expectCode(await cart([line({ coupon_id: c2 }), line({ coupon_id: c2 })]), "invalid-argument");
  });

  await test("C-RWD-11", "A 店的券拿到 B 店結帳被擋", async () => {
    const c = await coupon(uids.A, V1, 20);
    expectCode(await cart([{ menu_item_id: ITEM2, pickup_date: OPEN_DAY, pickup_window: WINDOW, quantity: 1, coupon_id: c }]), "failed-precondition");
  });

  await test("C-RWD-xx", "別人的券、已過期的券不能用", async () => {
    const other = await coupon(uids.B, V1, 20);
    expectCode(await cart([line({ coupon_id: other })]), "failed-precondition", "別人的券");
    const expired = await coupon(uids.A, V1, 20, { expires_at: Timestamp.fromMillis(Date.now() - 1000) });
    expectCode(await cart([line({ coupon_id: expired })]), "failed-precondition", "過期");
  });

  await test("C-ORD-02", "購物車：跨店被擋（一次只能一家）；同店 2 行各 1 份 → 2 筆、vendor_id 正確", async () => {
    const cross = expectCode(await cart([line(), { menu_item_id: ITEM2, pickup_date: OPEN_DAY, pickup_window: WINDOW, quantity: 1 }]), "invalid-argument");
    assert(/一家店家/.test(cross.message), cross.message);
    const lines = [];
    for (let i = 0; i < 2; i++) lines.push({ menu_item_id: ITEM2, pickup_date: OPEN_DAY, pickup_window: WINDOW, quantity: 1, coupon_id: await coupon(uids.A, V2, 100) });
    const conf = expectOk(await A.call("confirmLinePayPayment", { order_id: expectOk(await cart(lines)).order_id }));
    eq(conf.lock_ids.length, 2);
    const vendors = (await Promise.all(conf.lock_ids.map((id) => get(`locks/${id}`)))).map((l) => l.vendor_id);
    eq(vendors, [V2, V2]);
  });

  await test("F-09", "同一個 order_id 確認兩次不重複建立 locks（C-ORD-15）", async () => {
    const r = expectOk(await cart([line({ coupon_id: await coupon(uids.A, V1, 100) })]));
    const a = expectOk(await A.call("confirmLinePayPayment", { order_id: r.order_id }));
    const b = expectOk(await A.call("confirmLinePayPayment", { order_id: r.order_id }));
    eq(b.lock_ids, a.lock_ids);
    const n = (await db.collection("locks").where("buyer_uid", "==", uids.A).get()).docs.filter((d) => a.lock_ids.includes(d.id)).length;
    eq(n, 1);
  });

  await test("C-ORD-xx", "別人不能確認我的付款", async () => {
    const r = expectOk(await cart([line({ coupon_id: await coupon(uids.A, V1, 100) })]));
    expectCode(await B.call("confirmLinePayPayment", { order_id: r.order_id }), "permission-denied");
  });

  await test("C-ORD-09", "份數上限 1：第一筆成立後同時段被擋（resource-exhausted）", async () => {
    const w = "10:00-10:30";
    await db.doc(`vendors/${V1}`).update({ slot_capacity: 1, pickup_windows: [WINDOW, w] });
    try {
      const r = expectOk(await cart([line({ pickup_window: w, coupon_id: await coupon(uids.A, V1, 100) })]));
      expectOk(await A.call("confirmLinePayPayment", { order_id: r.order_id }));
      expectCode(await cart([line({ pickup_window: w, coupon_id: await coupon(uids.A, V1, 100) })]), "resource-exhausted");
    } finally {
      await db.doc(`vendors/${V1}`).update({ slot_capacity: 0, pickup_windows: [WINDOW] });
    }
  });

  await test("C-ORD-10", "兩人搶最後一份：都拿到付款意圖，確認時只有一人成功", async () => {
    const w = "10:30-11:00";
    await db.doc(`vendors/${V1}`).update({ slot_capacity: 1, pickup_windows: [WINDOW, w] });
    try {
      const rA = expectOk(await A.call("createCartLinePayReservation", { lines: [line({ pickup_window: w, coupon_id: await coupon(uids.A, V1, 100) })] }));
      const rB = expectOk(await B.call("createCartLinePayReservation", { lines: [line({ pickup_window: w, coupon_id: await coupon(uids.B, V1, 100) })] }));
      const [cA, cB] = await Promise.all([A.call("confirmLinePayPayment", { order_id: rA.order_id }), B.call("confirmLinePayPayment", { order_id: rB.order_id })]);
      eq([cA.ok, cB.ok].filter(Boolean).length, 1, "成功人數");
      const loser = cA.ok ? cB : cA;
      eq(loser.code, "resource-exhausted");
      eq((await get(counterId(V1, OPEN_DAY, w))).count, 1, "slot_counters");
    } finally {
      await db.doc(`vendors/${V1}`).update({ slot_capacity: 0, pickup_windows: [WINDOW] });
    }
  });

  await test("C-ORD-05", "公休日伺服器擋", async () => {
    await db.doc(`vendors/${V1}`).update({ holidays: [OPEN_DAY] });
    try {
      const r = await cart([line({ coupon_id: await coupon(uids.A, V1, 100) })]);
      assert(!r.ok && /公休/.test(r.message), `應被擋並提示公休：${r.code} ${r.message}`);
    }
    finally { await db.doc(`vendors/${V1}`).update({ holidays: [] }); }
  });

  await test("C-BNT-03", "候選菜本週已滿（weekly_cap）伺服器擋", async () => {
    const item = await get(`menu_items/${ITEM}`);
    item.slots[0].candidates[0].weekly_cap = 1;
    await db.doc(`menu_items/${ITEM}`).set(item);
    try {
      const r = expectOk(await cart([line({ slots: [{ choice: 0 }, { choice: "default" }], coupon_id: await coupon(uids.A, V1, 100) })]));
      expectOk(await A.call("confirmLinePayPayment", { order_id: r.order_id }));
      expectCode(await cart([line({ slots: [{ choice: 0 }, { choice: "default" }], coupon_id: await coupon(uids.A, V1, 100) })]), "resource-exhausted");
    } finally {
      item.slots[0].candidates[0].weekly_cap = 1000;
      await db.doc(`menu_items/${ITEM}`).set(item);
    }
  });

  await test("C-BNT-05/06", "主菜不能不要、rice 只收 add/normal/less、候選 index 不存在被擋", async () => {
    const r = expectOk(await cart([line({ rice: "double", coupon_id: await coupon(uids.A, V1, 1000) })]));
    const d = (await get(`payment_intents/${r.order_id}`)).lock_drafts[0];
    eq(d.rice, "normal", "rice"); eq(d.adjust_amount, 0, "adjust");
    expectCode(await cart([line({ slots: [{ choice: 9 }, { choice: "default" }] })]), "invalid-argument", "候選 index");
  });

  await test("C-BAN-02", "被封鎖的會員下單被擋，訊息是白話", async () => {
    await db.doc(`users/${uids.C}`).set({ orderBanned: true }, { merge: true });
    try {
      const r = expectCode(await C.call("createCartLinePayReservation", { lines: [line()] }), "permission-denied");
      assert(/未取餐|解封/.test(r.message), r.message);
    } finally { await db.doc(`users/${uids.C}`).set({ orderBanned: false }, { merge: true }); }
  });

  // ════ 3.7 My meals: cancel, edit, donate, QR ════
  await test("C-MY-14", "取餐 48 小時前取消：cancelled、customer、不退現金改發原價 30% 折價券、份數與原本用的券退回", async () => {
    const c = await coupon(uids.A, V1, 10);
    const r = expectOk(await cart([line({ coupon_id: c, pickup_date: CANCEL_DAY })]));
    const id = expectOk(await A.call("confirmLinePayPayment", { order_id: r.order_id })).lock_ids[0];
    const placed = await get(`locks/${id}`);
    const before = (await get(counterId(V1, CANCEL_DAY, WINDOW))).count;
    const res = expectOk(await A.call("cancelLock", { lock_id: id }));
    const l = await get(`locks/${id}`);
    eq(l.status, "cancelled"); eq(l.cancel_reason, "customer");
    eq(l.refunded_amount, 0, "不退現金");
    eq(l.kept_amount, placed.paid_amount, "款項留在店家");
    const expected = Math.min(Math.round((placed.list_price + (placed.adjust_amount || 0)) * CFG.cancelCouponRate), placed.paid_amount);
    assert(expected > 0, `預期折價券面額應 > 0（實付 ${placed.paid_amount}）`);
    eq(l.refund_coupon_amount, expected, "折價券面額");
    eq(res.coupon.discount, expected);
    const issued = await get(`coupons/${l.refund_coupon_id}`);
    eq([issued.status, issued.user_id, issued.vendor_id, issued.tier, issued.discount, issued.source_lock_id], ["owned", uids.A, V1, "refund", expected, id]);
    const days = (issued.expires_at.toMillis() - Date.now()) / 86400000;
    assert(days > CFG.couponValidDays - 0.1 && days <= CFG.couponValidDays, `效期約 ${CFG.couponValidDays} 天（實際 ${days.toFixed(2)}）`);
    eq((await get(counterId(V1, CANCEL_DAY, WINDOW))).count, before - 1, "slot_counters");
    const cp = await get(`coupons/${c}`);
    eq(cp.status, "owned"); assert(!cp.lock_id, "lock_id 應清掉");
    // the refunded coupon can be used on the next order
    const again = expectOk(await cart([line({ coupon_id: l.refund_coupon_id, pickup_date: CANCEL_DAY })]));
    assert(again.order_id, "退款券可用於下單");
  });

  await test("C-MY-14b", "同一筆同時按兩次取消：份數只退一次、折價券只發一張", async () => {
    const { id } = await lock(uids.A, { pickup_date: CANCEL_DAY });
    await db.doc(counterId(V1, CANCEL_DAY, WINDOW)).set({ count: 50 }, { merge: true });
    const rs = await Promise.all([A.call("cancelLock", { lock_id: id }), A.call("cancelLock", { lock_id: id })]);
    const n = (await get(counterId(V1, CANCEL_DAY, WINDOW))).count;
    eq(n, 49, `成功 ${rs.filter((r) => r.ok).length} 次，份數`);
    eq((await db.collection("coupons").where("source_lock_id", "==", id).get()).size, 1, "折價券張數");
  });

  await test("C-MY-15", "取餐前 48 小時內不能取消（明天的單）", async () => {
    const { id } = await lock(uids.A, { pickup_date: addDays(TODAY, 1) });
    const r = expectCode(await A.call("cancelLock", { lock_id: id }), "failed-precondition");
    assert(/48 小時/.test(r.message), r.message);
    eq((await get(`locks/${id}`)).status, "locked");
  });

  await test("C-MY-16", "轉讓取得的不能退款", async () => {
    const { id } = await lock(uids.B, { payer_uid: uids.A, transferred_from_uids: [uids.A] });
    expectCode(await B.call("cancelLock", { lock_id: id }), "failed-precondition");
  });

  await test("C-MY-xx", "不能取消別人的訂單", async () => {
    const { id } = await lock(uids.A);
    expectCode(await B.call("cancelLock", { lock_id: id }), "permission-denied");
  });

  await test("C-MY-17", "截單前改許願：sideWishes 舊 −1 新 +1、金額不變", async () => {
    const r = expectOk(await cart([line({ slots: [{ choice: 0 }, { choice: "default" }], coupon_id: await coupon(uids.A, V1, 100) })]));
    const id = expectOk(await A.call("confirmLinePayPayment", { order_id: r.order_id })).lock_ids[0];
    const wid = (cand) => `${V1}_${OPEN_DAY}_${ITEM}_0_${cand}`;
    const beforeA = (await get(`sideWishes/${wid(0)}`))?.count || 0;
    const beforeB = (await get(`sideWishes/${wid(1)}`))?.count || 0;
    const price = (await get(`locks/${id}`)).locked_price;
    expectOk(await A.call("updateLockChoices", { lock_id: id, slots: [{ choice: 1 }, { choice: "default" }] }));
    eq((await get(`sideWishes/${wid(0)}`)).count, beforeA - 1, "舊候選");
    eq((await get(`sideWishes/${wid(1)}`)).count, beforeB + 1, "新候選");
    const l = await get(`locks/${id}`);
    eq(l.locked_price, price); eq(l.slots[0].wished, "筊白筍");
  });

  await test("C-MY-18", "截單前改成「不要」：變便宜 → 金額 −5、回傳退差額", async () => {
    // A bento with the 20%-off early-bird price (100 → 80); no transaction_id, so no real LINE Pay refund is called
    const { id } = await lock(uids.A, { discount_percent: 20, early_bird_amount: 20, adjust_amount: 0 });
    const r = expectOk(await A.call("updateLockChoices", { lock_id: id, slots: [{ choice: "none" }, { choice: "default" }] }));
    eq([r.locked_price, r.refunded], [75, 5]);
    const l = await get(`locks/${id}`);
    eq([l.locked_price, l.adjust_amount, l.slots[0].removed], [75, -5, true]);
  });

  await test("C-MY-23", "截單前改成變貴（白飯一碗半）被擋，資料不變", async () => {
    const { id } = await lock(uids.A, { discount_percent: 20, early_bird_amount: 20, adjust_amount: 0 });
    const r = expectCode(await A.call("updateLockChoices", { lock_id: id, rice: "add" }), "failed-precondition");
    assert(/多 NT\$10/.test(r.message), r.message);
    const l = await get(`locks/${id}`);
    eq([l.locked_price, l.rice], [80, "normal"]);
  });

  await test("C-MY-02", "本人取得 QR（簽章 token＋4 碼取餐號）；別人被擋", async () => {
    const { id, code } = await lock(uids.A);
    const q = expectOk(await A.call("issuePickupQr", { lock_id: id }));
    assert(/^BB1\.L\./.test(q.token), q.token); eq(q.pickup_code, code);
    expectCode(await B.call("issuePickupQr", { lock_id: id }), "permission-denied");
  });

  await test("C-MY-22", "代領連結（share_token）免登入可取得 QR；轉讓後舊連結失效", async () => {
    const { id, ref } = await lock(uids.A, { share_token: "tok-123" });
    expectOk(await ANON.call("issuePickupQr", { lock_id: id, share_token: "tok-123" }));
    expectCode(await ANON.call("issuePickupQr", { lock_id: id, share_token: "wrong" }), "permission-denied");
    await ref.update({ status: "for_resale" });
    expectOk(await takeOver(B, id));
    expectCode(await ANON.call("issuePickupQr", { lock_id: id, share_token: "tok-123" }), "permission-denied", "轉讓後");
  });

  await test("C-MY-27", "代領碼：本人產生 8 碼、免登入輸入碼可取得 QR；別人不能產生；轉讓中不能代領；轉讓後碼失效", async () => {
    const { id, ref } = await lock(uids.A, { share_token: "tok-code" });
    expectCode(await B.call("getProxyPickupCode", { lock_id: id }), "permission-denied");
    const { code } = expectOk(await A.call("getProxyPickupCode", { lock_id: id }));
    assert(/^[A-HJ-KM-NP-Z2-9]{8}$/.test(code), code);
    eq(expectOk(await A.call("getProxyPickupCode", { lock_id: id })).code, code, "再按一次拿回同一組");
    const q = expectOk(await ANON.call("issuePickupQr", { proxy_code: `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}` }));
    assert(/^BB1\.L\./.test(q.token), q.token);
    expectCode(await ANON.call("issuePickupQr", { proxy_code: "AAAA-AAAA" }), "not-found");
    // Listed for resale (lock is publicly readable, share_token visible): no proxy pickup
    await ref.update({ status: "for_resale" });
    expectCode(await ANON.call("issuePickupQr", { proxy_code: code }), "not-found", "轉讓中");
    expectCode(await ANON.call("issuePickupQr", { lock_id: id, share_token: "tok-code" }), "permission-denied", "轉讓中（連結）");
    expectOk(await takeOver(B, id));
    expectCode(await ANON.call("issuePickupQr", { proxy_code: code }), "not-found", "轉讓後");
  });

  await test("C-MY-28", "取消轉讓／取消贈送：觸發器換新 share_token，上架期間被看過的舊代領連結失效", async () => {
    const { id, ref } = await lock(uids.A, { share_token: "tok-listed" });
    await ref.update({ status: "for_gift" });
    await ref.update({ status: "locked" });
    await waitFor(async () => (await get(`locks/${id}`)).share_token !== "tok-listed");
    expectCode(await ANON.call("issuePickupQr", { lock_id: id, share_token: "tok-listed" }), "permission-denied");
    expectOk(await A.call("issuePickupQr", { lock_id: id }), "本人照常取餐");
  });

  await test("V-RPT-03", "每日收入圖：最近 15 天每天都有淨利欄，等於收入 − 材料 − 其他成本", async () => {
    const days = expectOk(await OWNER.call("getDailyRevenueSeries", { vendor_id: V1 })).days;
    eq(days.length, 15);
    for (const d of days) {
      assert(Number.isFinite(d.net_profit) && Number.isFinite(d.other_cost), JSON.stringify(d));
      assert(Math.abs(d.revenue - d.material_cost - d.other_cost - d.net_profit) <= 1, JSON.stringify(d));
    }
  });

  await test("V-CAL-06", "校準報告的準確率由程式算：Gemini 沒設 key 時也照樣寫入數字並更新穩定度", async () => {
    const vid = uniq("zz-cal");
    await db.collection("vendors").doc(vid).set({ name: "校準測試店", owner_uid: uids.owner });
    const add = (date, status) => db.collection("locks").add({ vendor_id: vid, pickup_date: date, pickup_window: WINDOW, status, buyer_uid: uids.A, locked_price: 80, created_at: Timestamp.now() });
    for (let i = 0; i < 8; i++) await add("2026-09-01", i < 6 ? "fulfilled" : "no_show"); // 6/8
    for (let i = 0; i < 2; i++) await add("2026-09-02", "fulfilled"); // 2/2
    const { report_id: id } = expectOk(await OWNER.call("triggerCalibrationNow", { vendor_id: vid }));
    const r = await get(`accuracy_reports/${id}`);
    eq([r.accuracy_rate, r.error_range, r.error_range_en], [0.8, "±1 份", "±1 meal"]);
    eq((await get(`vendors/${vid}`)).reliability_tone, "stable");
  });

  await test("F-05", "折扣說明只接受早鳥級距；Gemini 失敗時回 null、不報錯", async () => {
    expectCode(await ANON.call("getDiscountExplanation", { vendor_id: V1, discount_percent: 37 }), "invalid-argument");
    const r = expectOk(await ANON.call("getDiscountExplanation", { vendor_id: V1, discount_percent: 20 }));
    assert(r.explanation === null || typeof r.explanation === "string", JSON.stringify(r));
  });

  // ════ Platform points (wallet.js) ════
  const wallet = async (uid) => (await get(`wallets/${uid}`))?.balance ?? 0;
  await test("W-01", "截單前改便宜：差額退成點數（批次記原交易），不再退 LINE Pay", async () => {
    const before = await wallet(uids.C);
    const { id } = await lock(uids.C, { discount_percent: 20, early_bird_amount: 20, adjust_amount: 0, paid_amount: 80, transaction_id: "fake-w01" });
    const r = expectOk(await C.call("updateLockChoices", { lock_id: id, slots: [{ choice: "none" }, { choice: "default" }] }));
    eq(r.refunded, 5);
    eq((await wallet(uids.C)) - before, 5);
    const l = await get(`locks/${id}`);
    eq([l.paid_amount, l.refunded_amount, l.funding], [75, 5, [{ tx: "fake-w01", amount: 75 }]]);
  });

  await test("W-02", "用點數結帳：折抵後剩下的才走 LINE Pay；確認後每份記下點數與資金來源", async () => {
    const start = await wallet(uids.C);
    assert(start >= 5, `C 應有點數（W-01），現在 ${start}`);
    const c = await coupon(uids.C, V1, 30); // keep the amount small so points cover only part of it
    const r = expectOk(await C.call("createCartLinePayReservation", { lines: [line({ coupon_id: c })], use_points: true }));
    assert(r.points_used === start || r.points_used > 0, JSON.stringify(r));
    eq(await wallet(uids.C), start - r.points_used, "結帳時先扣住");
    const conf = expectOk(await C.call("confirmLinePayPayment", { order_id: r.order_id }));
    const l = await get(`locks/${conf.lock_ids[0]}`);
    eq(l.points_used, r.points_used);
    eq(l.funding.reduce((s, f) => s + f.amount, 0), l.locked_price, "資金來源加總＝實付");
    eq((await get(`wallets/${uids.C}/holds/${r.order_id}`)).status, "used");
  });

  await test("W-03", "付款取消：扣住的點數還回去；取消後不能再確認", async () => {
    const before = await wallet(uids.C);
    if (before <= 0) await db.doc(`wallets/${uids.C}`).set({ balance: 0 }, { merge: true });
    // give C some points first
    await db.collection(`wallets/${uids.C}/lots`).add({ source_tx: null, amount: 20, remaining: 20, reason: "test", created_at: Timestamp.now() });
    await db.doc(`wallets/${uids.C}`).set({ balance: FieldValue.increment(20) }, { merge: true });
    const has = await wallet(uids.C);
    const c = await coupon(uids.C, V1, 30);
    const r = expectOk(await C.call("createCartLinePayReservation", { lines: [line({ coupon_id: c })], use_points: true }));
    assert(r.points_used > 0);
    expectOk(await C.call("cancelPaymentIntent", { order_id: r.order_id }));
    eq(await wallet(uids.C), has, "點數還回去");
    expectCode(await C.call("confirmLinePayPayment", { order_id: r.order_id }), "failed-precondition");
  });

  await test("W-04", "退回 LINE Pay：只退有原交易的批次，退完餘額扣掉、明細記一筆", async () => {
    await db.collection(`wallets/${uids.E}/lots`).add({ source_tx: "fake-w04", amount: 40, remaining: 40, reason: "test", created_at: Timestamp.now() });
    await db.collection(`wallets/${uids.E}/lots`).add({ source_tx: null, amount: 7, remaining: 7, reason: "test", created_at: Timestamp.now() });
    await db.doc(`wallets/${uids.E}`).set({ balance: FieldValue.increment(47) }, { merge: true });
    const before = await wallet(uids.E);
    const r = expectOk(await E.call("withdrawPoints", {}));
    eq([r.withdrawn, r.failed], [40, 0]);
    eq(await wallet(uids.E), before - 40, "不能退回的 7 點留著");
  });

  await test("W-05", "店家未出餐：管理員全額退成點數給付款人，訂單取消", async () => {
    const before = await wallet(uids.B);
    const { id } = await lock(uids.B, { paid_amount: 80, transaction_id: "fake-w05" });
    expectOk(await OWNER.call("refundLockAsPoints", { lock_id: id, note: "店家沒開" }));
    const l = await get(`locks/${id}`);
    eq([l.status, l.cancel_reason, l.refunded_amount], ["cancelled", "vendor_failed", 80]);
    eq((await wallet(uids.B)) - before, 80);
    expectCode(await OWNER.call("refundLockAsPoints", { lock_id: id }), "failed-precondition", "不能退兩次");
  });

  await test("C-MY-19", "取餐日時段內捐為愛心餐", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const { id } = await lock(uids.A, { pickup_date: TODAY });
    const before = (await get(`users/${uids.A}`))?.donated_count || 0;
    const r = expectOk(await A.call("donateLock", { lock_id: id }));
    const l = await get(`locks/${id}`);
    eq(l.status, "charity"); eq(l.charity_source, "donated");
    const meal = await get(`charityMeals/${r.meal_id}`);
    eq(meal.status, "available"); eq(meal.source, "donated");
    assert(!("buyer_uid" in meal) && !("user_id" in meal), "愛心餐不應含原訂購人");
    eq((await get(`users/${uids.A}`)).donated_count, before + 1);
    const notes = await db.collection("notifications").where("user_id", "==", uids.A).where("kind", "==", "charity").get();
    assert(!notes.empty, "沒有「謝謝你的愛心」通知");
  });

  await test("C-MY-20", "取餐日前一天不能捐出", async () => {
    const { id } = await lock(uids.A);
    const r = expectCode(await A.call("donateLock", { lock_id: id }), "failed-precondition");
    assert(/取餐當天/.test(r.message), r.message);
  });

  // ════ 3.8 Resale market ════
  await test("C-MKT-02/08", "B 付款接手：buyer=B、locked、付款人換成 B、付接手價、原付款人退款、換新 share_token", async () => {
    const { id, ref } = await lock(uids.A, { share_token: "old", list_price: 100, early_bird_amount: 20, adjust_amount: 0, coupon_id: "c-old", coupon_discount: 30, locked_price: 50, paid_amount: 50, transaction_id: "fake-seller-tx" });
    await ref.update({ status: "for_resale" });
    const r = expectOk(await takeOver(B, id));
    eq(r.kind, "resale"); eq(r.lock_ids, [id]);
    const l = await get(`locks/${id}`);
    eq(l.buyer_uid, uids.B); eq(l.status, "locked"); eq(l.payer_uid, uids.B);
    eq([l.locked_price, l.paid_amount, l.coupon_id, l.coupon_discount], [80, 80, null, 0], "接手價＝早鳥價（折價券前）");
    eq([l.transfer_refund.uid, l.transfer_refund.amount, l.transfer_refund.status, l.transfer_refund.as], [uids.A, 50, "done", "points"], "A 實付的 50 退成點數");
    eq(l.funding, [{ tx: l.transaction_id, amount: 80 }], "新持有人的資金來源");
    const lots = (await db.collection(`wallets/${uids.A}/lots`).where("lock_id", "==", id).get()).docs.map((d) => d.data());
    eq(lots.map((x) => [x.source_tx, x.amount, x.reason]), [["fake-seller-tx", 50, "transfer"]], "點數批次記原交易");
    assert(!l.resale_hold && !l.resale_payment_pending, "保留與付款中標記應清掉");
    assert(l.share_token && l.share_token !== "old", "share_token 應更換");
    assert((l.transferred_from_uids || []).includes(uids.A), "transferred_from_uids 應含 A");
  });

  await test("C-MKT-09", "自訂轉讓價：接手者付轉讓價；原付款人退「實付與轉讓價取小的」；超過原價夾在原價；接手後清掉轉讓價", async () => {
    // A paid 80 (list price 100, early-bird discount 20); the cap is the list price, 100
    const listed = async (resalePrice) => {
      const { id, ref } = await lock(uids.A, { list_price: 100, early_bird_amount: 20, adjust_amount: 0, locked_price: 80, paid_amount: 80, transaction_id: "fake-seller-tx" });
      await ref.update({ status: "for_resale", resale_price: resalePrice });
      return id;
    };
    const cases = [
      { price: 60, pay: 60, refund: 60, note: "賣得比實付低：差額由轉讓人吸收" },
      { price: 100, pay: 100, refund: 80, note: "賣原價：只退實付，多的留在店家" },
      { price: 999, pay: 100, refund: 80, note: "超過原價：夾在原價" },
      { price: 0, pay: 0, refund: 0, note: "0 元送出：不經 LINE Pay、不退款" },
    ];
    for (const c of cases) {
      const id = await listed(c.price);
      const quote = expectOk(await B.call("createResaleLinePayReservation", { lock_id: id }), c.note);
      eq([quote.amount, quote.free], [c.pay, c.pay === 0], `${c.note}：報價`);
      expectOk(await B.call("confirmLinePayPayment", { order_id: quote.order_id }), c.note);
      const l = await get(`locks/${id}`);
      eq([l.buyer_uid, l.payer_uid, l.status], [uids.B, uids.B, "locked"], c.note);
      eq([l.locked_price, l.paid_amount], [c.pay, c.pay], `${c.note}：接手者付的金額`);
      eq([l.transfer_refund.amount, l.transfer_refund.status], [c.refund, c.refund > 0 ? "done" : "none"], `${c.note}：退給原付款人`);
      const t = l.transfers[l.transfers.length - 1];
      eq([t.price, t.refund_amount, t.refund_uid], [c.pay, c.refund, uids.A], `${c.note}：transfers 紀錄`);
      assert(!("resale_price" in l), `${c.note}：接手後 resale_price 應清掉`);
    }
    // No resale price set: keeps the early-bird price (old behavior)
    const { id, ref } = await lock(uids.A, { list_price: 100, early_bird_amount: 20, adjust_amount: 0, locked_price: 80, paid_amount: 80, transaction_id: "fake-seller-tx" });
    await ref.update({ status: "for_resale" });
    eq(expectOk(await B.call("createResaleLinePayReservation", { lock_id: id })).amount, 80, "沒填轉讓價用早鳥價");
  });

  await test("C-MKT-03", "接手自己的被擋（failed-precondition）", async () => {
    const { id, ref } = await lock(uids.A);
    await ref.update({ status: "for_resale" });
    expectCode(await A.call("createResaleLinePayReservation", { lock_id: id }), "failed-precondition");
  });

  await test("C-MKT-04", "B、C 同時按接手：只有一人能進付款（保留 15 分鐘），另一人被擋；確認後只有一人接手", async () => {
    const { id, ref } = await lock(uids.A);
    await ref.update({ status: "for_resale" });
    const rs = await Promise.all([B, C].map((u) => u.call("createResaleLinePayReservation", { lock_id: id })));
    eq(rs.filter((r) => r.ok).length, 1, "能進付款的人數");
    const winner = rs[0].ok ? B : C;
    const loser = rs[0].ok ? C : B;
    assert(/有人正在付款接手/.test(rs.find((r) => !r.ok).message), "被擋的人要看到有人正在付款");
    expectOk(await winner.call("confirmLinePayPayment", { order_id: rs.find((r) => r.ok).data.order_id }));
    eq((await get(`locks/${id}`)).buyer_uid, winner === B ? uids.B : uids.C);
    expectCode(await loser.call("createResaleLinePayReservation", { lock_id: id }), "failed-precondition", "已被接走");
  });

  await test("C-MKT-10", "付款中被別人免費領走（逾時）→ 確認時不扣款、意圖 gone", async () => {
    const { id, ref } = await lock(uids.A);
    await ref.update({ status: "for_resale" });
    const r = expectOk(await B.call("createResaleLinePayReservation", { lock_id: id }));
    await ref.update({ status: "locked", buyer_uid: uids.C, locked_price: 0, transferred_from_uids: [uids.A] }); // simulate C taking it for free after the timeout
    expectCode(await B.call("confirmLinePayPayment", { order_id: r.order_id }), "failed-precondition");
    eq((await get(`payment_intents/${r.order_id}`)).status, "gone");
    eq((await get(`locks/${id}`)).buyer_uid, uids.C, "還是 C 的");
  });

  // ════ 4.2 Pickup verification ════
  const V = (data) => OWNER.call("completePickup", { vendor_id: V1, ...data });
  await test("V-RDM-02/03", "取餐號＋末三碼查到、不顯示姓名；末三碼錯查不到", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const { code } = await lock(uids.A, { pickup_date: TODAY, buyer_name: "王小明", note: "不要辣" });
    const s = expectOk(await V({ pickup_code: code, phone_last3: "567", preview: true }));
    assert(!JSON.stringify(s).includes("王小明"), "不應顯示姓名");
    assert(!JSON.stringify(s).includes(uids.A), "不應顯示 uid");
    const bad = expectCode(await V({ pickup_code: code, phone_last3: "000", preview: true }), "not-found");
    assert(/取餐號或手機末三碼不符/.test(bad.message), "不應洩漏哪一項錯");
  });

  let rewardLock = null;
  await test("V-RDM-04/06", "掃 QR 完成取餐；同一張 QR 再掃被擋", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    rewardLock = await lock(uids.E, { pickup_date: TODAY, locked_price: 230 });
    const { token } = expectOk(await E.call("issuePickupQr", { lock_id: rewardLock.id }));
    const r = expectOk(await V({ token }));
    eq(r.status, "fulfilled");
    expectCode(await V({ token }), "failed-precondition", "重掃");
  });

  await test("C-RWD-01", "完成取餐 230 元 → 2 張抽獎券、carry=30（付款人）", async () => {
    if (!rewardLock) throw new Error("SKIP：前一案例沒跑");
    const l = await waitFor(async () => { const x = await get(`locks/${rewardLock.id}`); return x.reward_counted ? x : null; });
    eq(l.tickets_issued, 2);
    const t = await db.collection("rewardTickets").where("lock_id", "==", rewardLock.id).get();
    eq(t.size, 2); assert(t.docs.every((d) => d.data().user_id === uids.E && d.data().status === "pending"));
    eq((await get(`userSpend/${V1}_${uids.E}`)).carry, 30);
  });

  await test("C-MKT-08b", "B 付款接手後取餐：抽獎券發給真正付錢的 B", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const { id, ref } = await lock(uids.A, { pickup_date: TODAY, locked_price: 100 });
    await ref.update({ status: "for_resale" });
    expectOk(await takeOver(B, id));
    const { token } = expectOk(await B.call("issuePickupQr", { lock_id: id }));
    eq(expectOk(await V({ token })).status, "resold_and_fulfilled");
    await waitFor(async () => (await get(`locks/${id}`)).reward_counted);
    const t = await db.collection("rewardTickets").where("lock_id", "==", id).get();
    assert(t.size > 0 && t.docs.every((d) => d.data().user_id === uids.B), "抽獎券應給 B");
  });

  await test("V-RDM-07", "兩台裝置同時核銷：只有一次成功", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const { id } = await lock(uids.A, { pickup_date: TODAY });
    const rs = await Promise.all([V({ lock_id: id }), V({ lock_id: id })]);
    eq(rs.filter((r) => r.ok).length, 1);
  });

  await test("V-RDM-08", "cancelled／charity／fulfilled 不能核銷", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    for (const status of ["cancelled", "charity", "fulfilled"]) {
      const { id } = await lock(uids.A, { pickup_date: TODAY, status });
      expectCode(await V({ lock_id: id }), "failed-precondition", status);
    }
  });

  await test("V-RDM-11", "改過內容的 QR、非 BunnBaa QR 被擋", async () => {
    const { id } = await lock(uids.A, { pickup_date: TODAY });
    const { token } = expectOk(await A.call("issuePickupQr", { lock_id: id }));
    const parts = token.split("."); parts[3] = String(Number(parts[3]) + 3600000); // tamper with the expiry time
    expectCode(await V({ token: parts.join(".") }), "invalid-argument", "竄改");
    const r = expectCode(await V({ token: "https://example.com" }), "invalid-argument", "非 BunnBaa");
    assert(/不是有效的 BunnBaa/.test(r.message), r.message);
  });

  await test("V-RDM-12", "重新產生 QR 或轉讓後，舊 QR 失效", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const { id, ref } = await lock(uids.A, { pickup_date: TODAY });
    const old = expectOk(await A.call("issuePickupQr", { lock_id: id })).token;
    await ref.update({ status: "for_resale" });
    expectOk(await takeOver(B, id));
    expectCode(await V({ token: old }), "failed-precondition");
  });

  await test("V-RDM-xx", "別天的訂單不能核銷", async () => {
    const { id } = await lock(uids.A);
    expectCode(await V({ lock_id: id }), "failed-precondition");
  });

  // ════ 3.15 Charity meals ════
  let meal = null;
  await test("C-CHR-05", "預約愛心餐：reserved、10 分內到期、那份變 reserved", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const { id } = await lock(uids.A, { pickup_date: TODAY });
    meal = expectOk(await A.call("donateLock", { lock_id: id })).meal_id;
    const r = expectOk(await B.call("reserveCharity", { meal_id: meal }));
    const res = await get(`charityReservations/${r.reservation_id}`);
    eq(res.status, "reserved"); eq(res.user_id, uids.B);
    assert(res.expires_at.toMillis() - Date.now() <= 10 * 60000 + 5000, "到期時間應 ≤ 10 分");
    eq((await get(`charityMeals/${meal}`)).status, "reserved");
    meal = { id: meal, res: r.reservation_id };
  });

  await test("C-CHR-07", "同一天預約第二份被擋", async () => {
    if (!meal) throw new Error("SKIP：前一案例沒跑");
    const { id } = await lock(uids.A, { pickup_date: TODAY });
    const m2 = expectOk(await A.call("donateLock", { lock_id: id })).meal_id;
    expectCode(await B.call("reserveCharity", { meal_id: m2 }), "resource-exhausted");
  });

  await test("C-CHR-08", "預約者出示 QR、店家掃碼核銷 → claimed", async () => {
    if (!meal) throw new Error("SKIP：前一案例沒跑");
    const { token } = expectOk(await B.call("issuePickupQr", { reservation_id: meal.res }));
    assert(/^BB1\.R\./.test(token));
    expectOk(await V({ token }));
    eq((await get(`charityReservations/${meal.res}`)).status, "claimed");
    eq((await get(`charityMeals/${meal.id}`)).status, "claimed");
  });

  await test("C-CHR-10", "兩人同時預約同一份：只有一人成功", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const { id } = await lock(uids.B, { pickup_date: TODAY });
    const m = expectOk(await B.call("donateLock", { lock_id: id })).meal_id;
    const D = await client("D", "zz-d@bunnbaa.test").catch(async () => { await ensureUser("zz-d@bunnbaa.test"); return client("D2", "zz-d@bunnbaa.test"); });
    const rs = await Promise.all([C.call("reserveCharity", { meal_id: m }), D.call("reserveCharity", { meal_id: m })]);
    eq(rs.filter((r) => r.ok).length, 1);
  });

  await test("C-CHR-09b", "愛心餐不停權：舊制 charityBans 還在也不擋預約（v4）", async () => {
    await db.doc(`charityBans/${uids.C}`).set({ until: Timestamp.fromMillis(Date.now() + 7 * 86400000) });
    try {
      const r = await C.call("reserveCharity", { vendor_id: V1 });
      assert(r.ok || r.code !== "permission-denied", `不應被停權擋下：${r.code} ${r.message}`);
    } finally { await db.doc(`charityBans/${uids.C}`).delete(); }
  });

  await test("V-CHR-02", "店家現場送出一份 → given", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const { id } = await lock(uids.A, { pickup_date: TODAY });
    const m = expectOk(await A.call("donateLock", { lock_id: id })).meal_id;
    expectOk(await OWNER.call("giveCharityOnsite", { vendor_id: V1, meal_id: m }));
    eq((await get(`charityMeals/${m}`)).status, "given");
  });

  // ════ 3.14 Draws ════
  await test("C-RWD-06", "抽獎：coupons 一筆 owned、30 天到期、剩餘 −1", async () => {
    const period = mondayOf(addDays(TODAY, -7));
    const pRef = db.doc(`vendors/${V1}/rewardPeriods/${period}`);
    await issuePool(period, { t50: 1, t95: 1 });
    const tRef = db.collection("rewardTickets").doc(uniq("zzt"));
    await tRef.set({ vendor_id: V1, user_id: uids.A, period_id: period, pool_period: period, status: "drawable", created_at: Timestamp.now() });
    const r = expectOk(await A.call("drawTicket", { ticket_id: tRef.id }));
    const cp = r.coupon_id ? await get(`coupons/${r.coupon_id}`) : null;
    assert(cp, `找不到抽到的券：${JSON.stringify(r)}`);
    eq(cp.status, "owned");
    const days = (cp.expires_at.toMillis() - Date.now()) / 86400000;
    assert(days > 29 && days <= 30.01, `到期天數 ${days}`);
    const rem = (await pRef.get()).data().remaining;
    eq(rem.t50 + rem.t95, 1, "剩餘總張數");
    expectCode(await A.call("drawTicket", { ticket_id: tRef.id }), "failed-precondition", "同一張再抽");
  });

  await test("C-RWD-07", "兩人同時抽最後一張：不超抽", async () => {
    const period = mondayOf(addDays(TODAY, -14));
    const pRef = db.doc(`vendors/${V1}/rewardPeriods/${period}`);
    await issuePool(period, { t50: 1 });
    const mk = async (uid) => { const ref = db.collection("rewardTickets").doc(uniq("zzt")); await ref.set({ vendor_id: V1, user_id: uid, period_id: period, pool_period: period, status: "drawable", created_at: Timestamp.now() }); return ref.id; };
    const [ta, tb] = [await mk(uids.A), await mk(uids.B)];
    const rs = await Promise.all([A.call("drawTicket", { ticket_id: ta }), B.call("drawTicket", { ticket_id: tb })]);
    eq(rs.filter((r) => r.ok).length, 1, "只有一人抽到");
    const owned = await db.collection("coupons").where("vendor_id", "==", V1).where("pool_period", "==", period).where("status", "==", "owned").get();
    eq(owned.size, 1, "只發出一張");
    const rem = (await pRef.get()).data().remaining;
    assert(Object.values(rem).every((n) => n >= 0), `剩餘出現負數 ${JSON.stringify(rem)}`);
  });

  // ════ 4.3 Cut-off, wishes, prep ════
  await test("C-BNT-07/08 V-PRP-09", "截單：達 10 份的許願成立、3 份的改預設菜並通知；產生 prepPlans", async () => {
    const date = OPEN_DAY;
    // Clear active orders left on this day by earlier cases, keeping only the ones this case creates
    const olds = await db.collection("locks").where("vendor_id", "==", V1).where("pickup_date", "==", date).get();
    await Promise.all(olds.docs.map((d) => d.ref.update({ status: "cancelled" })));
    await db.doc(`vendors/${V1}/prepPlans/${date}`).delete();
    const wish = (cand, name) => ({ category: "青菜類", default_dish: "高麗菜", removed: false, wished: name, candidate_index: cand, resolved: null, portion_level: cand === 0 ? 0.75 : 0.5 });
    const egg = { category: "蛋豆類", default_dish: "滷蛋", removed: false, wished: null, resolved: null, portion_level: 1 };
    const okLock = await lock(uids.A, { pickup_date: date, slots: [wish(0, "地瓜葉"), egg] });
    const failLock = await lock(uids.B, { pickup_date: date, slots: [wish(1, "筊白筍"), egg] });
    await db.doc(`sideWishes/${V1}_${date}_${ITEM}_0_0`).set({ vendor_id: V1, date, count: 10 });
    await db.doc(`sideWishes/${V1}_${date}_${ITEM}_0_1`).set({ vendor_id: V1, date, count: 3 });
    expectOk(await OWNER.call("triggerLockOrdersNow", { vendor_id: V1, date }));
    eq((await get(`locks/${okLock.id}`)).slots[0].resolved, "地瓜葉", "成立");
    eq((await get(`locks/${failLock.id}`)).slots[0].resolved, "高麗菜", "未成立");
    const plan = await get(`vendors/${V1}/prepPlans/${date}`);
    eq(plan.order_count, 2);
    assert(plan.labels?.length === 2 && plan.wish_results, "要有出餐標籤與許願判定");
    assert(!JSON.stringify(plan.labels).includes(uids.A), "標籤不應含 uid");
    const n = await db.collection("notifications").where("user_id", "==", uids.B).where("kind", "==", "wish").get();
    assert(!n.empty, "未成立的人要收到通知");
  });

  await test("F-18", "同一天重跑截單：跳過、不重複判定", async () => {
    const r = expectOk(await OWNER.call("triggerLockOrdersNow", { vendor_id: V1, date: OPEN_DAY }));
    assert(r.skipped === true, JSON.stringify(r));
  });

  // ════ Argument checks for AI and other callables ════
  await test("V-PRP-02/03", "預估取餐區間：過去 5 天取餐率都是 75% → 平均 ± 1.28sd，a ≤ b ≤ N", async () => {
    // V2's history: the past 5 business days, 4 meals a day (3 picked up, 1 turned into a charity meal)
    let d = TODAY;
    for (let day = 0; day < 5; day++) {
      do { d = addDays(d, -1); } while (!CFG.businessWeekdays.includes(weekdayOf(d)));
      for (let i = 0; i < 4; i++) {
        await lock(uids.A, { vendor_id: V2, menu_item_id: ITEM2, pickup_date: d, status: i < 3 ? "fulfilled" : "charity", reward_counted: true });
      }
    }
    const target = await Promise.all([1, 2, 3, 4].map(() => lock(uids.A, { vendor_id: V2, menu_item_id: ITEM2, pickup_date: OPEN_DAY })));
    const r = expectOk(await OWNER.call("getPickupForecast", { vendor_id: V2, date: OPEN_DAY }));
    const N = r.locked;
    assert(N >= target.length, `locked=${N}`);
    eq(r.enough, true); eq(r.method, "mean_1.28sd"); eq(r.mean_rate, 0.75);
    eq([r.low, r.high], [Math.floor(N * 0.75), Math.ceil(N * 0.75)], `N=${N}`);
    assert(/不是備貨建議/.test(r.disclaimer), r.disclaimer);
  });
  await test("V-PRP-05", "沒有歷史的店不給區間，只回鎖定份數", async () => {
    const V3 = "zz-test-vendor-3";
    await db.doc(`vendors/${V3}`).set({ name: "測試新店", owner_uid: uids.owner, pickup_windows: [WINDOW] });
    await lock(uids.A, { vendor_id: V3, pickup_date: OPEN_DAY });
    const r = expectOk(await OWNER.call("getPickupForecast", { vendor_id: V3, date: OPEN_DAY }));
    eq(r.enough, false); eq(r.locked, 1);
    assert(r.low === undefined && r.high === undefined, JSON.stringify(r));
  });
  await test("F-17", "getPickupForecast 日期格式錯誤 → invalid-argument", async () => {
    expectCode(await OWNER.call("getPickupForecast", { vendor_id: V1, date: "10/02" }), "invalid-argument");
  });
  await test("F-15", "askShoppingAssistant：空 messages、最後一則是 assistant → invalid-argument", async () => {
    expectCode(await A.call("askShoppingAssistant", { messages: [] }), "invalid-argument");
    expectCode(await A.call("askShoppingAssistant", { messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "yo" }] }), "invalid-argument");
  });
  await test("C-AST-15", "每日 30 次用完 → resource-exhausted", async () => {
    await db.doc(`users/${uids.A}`).set({ assistant_usage: { date: TODAY, count: 30 } }, { merge: true });
    try { expectCode(await A.call("askShoppingAssistant", { messages: [{ role: "user", text: `測試上限 ${Date.now()}` }] }), "resource-exhausted"); }
    finally { await db.doc(`users/${uids.A}`).update({ assistant_usage: FieldValue.delete() }); }
  });
  await test("C-AST-14", "未登入呼叫助理 → unauthenticated", async () => {
    expectCode(await ANON.call("askShoppingAssistant", { messages: [{ role: "user", text: "hi" }] }), "unauthenticated");
  });
  await test("V-MNU-16", "拍照上架：PDF、超過 4 MB → invalid-argument", async () => {
    expectCode(await OWNER.call("extractMenuFromImage", { vendor_id: V1, image_base64: "AAAA", mime_type: "application/pdf" }), "invalid-argument", "pdf");
    expectCode(await OWNER.call("extractMenuFromImage", { vendor_id: V1, image_base64: "A".repeat(6 * 1024 * 1024), mime_type: "image/jpeg" }), "invalid-argument", "4MB");
  });
  await test("C-BRW-10", "同一天同品項瀏覽只算一次", async () => {
    await db.doc(`users/${uids.A}`).set({ viewed_items: FieldValue.delete() }, { merge: true });
    const CAFE_ITEM = "cafe-renheya-demo-classic"; // has a recipe, so a view adds taste tags
    expectOk(await A.call("recordItemView", { menu_item_id: CAFE_ITEM }));
    const s1 = JSON.stringify((await get(`tasteProfiles/${uids.A}`))?.scores || {});
    assert(s1 !== "{}", "第一次瀏覽應加分");
    expectOk(await A.call("recordItemView", { menu_item_id: CAFE_ITEM }));
    const s2 = JSON.stringify((await get(`tasteProfiles/${uids.A}`))?.scores || {});
    eq(s2, s1, "第二次不應再加分");
    eq((await get(`users/${uids.A}`)).viewed_items.ids.filter((x) => x === CAFE_ITEM).length, 1);
  });
  await test("C-WSH-03", "同一道菜許願兩次還是 1 人", async () => {
    const dish = (await db.collection("dishLibrary").limit(1).get()).docs[0];
    if (!dish) throw new Error("SKIP：沒有菜色庫資料");
    expectOk(await A.call("placeOpenWish", { vendor_id: V1, dish_id: dish.id }));
    expectOk(await A.call("placeOpenWish", { vendor_id: V1, dish_id: dish.id }));
    const w = await db.collection("openWishes").where("user_id", "==", uids.A).where("vendor_id", "==", V1).get();
    eq(w.docs.filter((d) => d.data().dish_id === dish.id).length, 1);
  });

  // ════ 6. Work/school suspension (runs last: cancels V1's orders on that day) ════
  await test("A-DIS-01", "臺北市停班：該日訂單 cancelled/disaster、券退回；外縣市不受影響（A-DIS-03）", async () => {
    const c = await coupon(uids.A, V1, 100);
    const r = expectOk(await cart([line({ coupon_id: c })]));
    const id = expectOk(await A.call("confirmLinePayPayment", { order_id: r.order_id })).lock_ids[0];
    await db.doc(`vendors/${V2}`).update({ address: "新北市板橋區測試路 2 號" });
    const other = await lock(uids.A, { vendor_id: V2, menu_item_id: ITEM2 });
    await db.collection("disasterEvents").doc(uniq("zzd")).set({
      type: "work_suspension", counties: ["臺北市"], towns: [], dates: [OPEN_DAY], source: "manual", summary: "測試停班", created_at: Timestamp.now(),
    });
    const l = await waitFor(async () => { const x = await get(`locks/${id}`); return x.status === "cancelled" ? x : null; }, 30000);
    eq(l.cancel_reason, "disaster");
    eq((await get(`coupons/${c}`)).status, "owned", "券退回");
    eq((await get(`locks/${other.id}`)).status, "locked", "新北市的單不受影響");
    const n = await db.collection("notifications").where("user_id", "==", uids.A).where("kind", "==", "disaster").get();
    assert(!n.empty, "消費者要收到停班取消通知");
  });

  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  for (const [id, st, name, msg] of results) console.log(`${st}  ${pad(id, 22)} ${name}${msg ? "  → " + msg : ""}`);
  const fails = results.filter((r) => r[1] === "FAIL" && !r[3].startsWith("SKIP")).length;
  const skips = results.filter((r) => r[3].startsWith("SKIP")).length;
  console.log(`\n${results.length - fails - skips}/${results.length} passed, ${skips} skipped`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

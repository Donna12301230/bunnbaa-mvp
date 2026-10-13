// Cases from doc/測試文件.md that functions.test.js doesn't cover but can be automated server-side:
// schedules (no-show to charity meal, charity meal close, reservation timeout, reward pool settlement,
// coupon expiry, draw period end, expiry reminders, anomaly detection, pickup reminders), resale matching,
// disaster days, purchasing, taste scores, open wishes, area insights, payouts, meal plans, English error messages.
//
// Run (uses the same test emulator as functions.test.js):
//   cd scripts/tests && npm run emulator      # in another window
//   cd scripts/tests && npm run test:functions:more
//
// Scheduled Functions don't run by themselves in the emulator, so this calls the onSchedule handler
// (`.run()`) directly in the local process. It reads and writes the same Firestore emulator, so the
// follow-up Firestore triggers (issuing draw tickets, matching) still run in the emulator. Each run uses
// fresh vendors and members (ids include RUN), so leftover data from earlier runs doesn't interfere.
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

const FN_DIR = path.resolve(__dirname, "../../functions");
const SRC = path.join(FN_DIR, "src");
const { taipeiToday, taipeiTime, addDays, weekdayOf, mondayOf } = require(path.join(SRC, "calendar.js"));
const { isPastCutoff } = require(path.join(SRC, "pricing.js"));
const { dishTags } = require(path.join(SRC, "bento.js"));
const { DEFAULT_PLATFORM_CONFIG: CFG, loadPlatformConfig } = require(path.join(SRC, "config.js"));

admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

// Functions modules use the firebase-admin in functions/node_modules (a separate copy); call initializeApp before requiring them
const fnAdmin = require(path.join(FN_DIR, "node_modules/firebase-admin"));
if (!fnAdmin.apps.length) fnAdmin.initializeApp({ projectId: PROJECT });
const fn = (mod) => require(path.join(SRC, mod));
const runSchedule = (mod, name) => fn(mod)[name].run({ scheduleTime: new Date().toISOString() });

const results = [];
async function test(id, name, f) {
  const t0 = Date.now();
  try { await f(); results.push([id, "PASS", name, ""]); }
  catch (e) { results.push([id, "FAIL", name, String(e.message || e).split("\n")[0].slice(0, 220)]); }
  if (process.env.VERBOSE) console.log(`  ${results.at(-1)[1]} ${id} (${Math.round((Date.now() - t0) / 1000)}s)`);
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || ""} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(f, ms = 180000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting for trigger");
    await sleep(500);
  }
}
const CJK = /[一-鿿]/;

// ── Identities ──
const RUN = Date.now().toString(36);
const PASSWORD = "test1234";
async function ensureUser(email) {
  try { return (await admin.auth().getUserByEmail(email)).uid; }
  catch { return (await admin.auth().createUser({ email, password: PASSWORD })).uid; }
}
let appSeq = 0;
async function client(email) {
  const app = initializeApp({ projectId: PROJECT, apiKey: "fake-key" }, `c${++appSeq}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${HOST}:${PORTS.auth}`, { disableWarnings: true });
  if (email) await signInWithEmailAndPassword(auth, email, PASSWORD);
  const fns = getFunctions(app, "asia-east1");
  connectFunctionsEmulator(fns, HOST, PORTS.functions);
  const call = async (name, data = {}) => {
    try { return { ok: true, data: (await httpsCallable(fns, name, { timeout: 120000 })(data)).data }; }
    catch (e) { return { ok: false, code: String(e.code || "").replace("functions/", ""), message: e.message }; }
  };
  return { uid: auth.currentUser?.uid, call };
}
/** A fresh member just for this run (signed-in client) */
async function freshUser(role) {
  const email = `zz2-${role}-${RUN}@bunnbaa.test`;
  await ensureUser(email);
  return client(email);
}
function expectOk(r, msg) { if (!r.ok) throw new Error(`${msg || ""} expected ok, got ${r.code}: ${r.message}`); return r.data; }
function expectCode(r, code, msg) {
  if (r.ok) throw new Error(`${msg || ""} expected ${code}, but call succeeded`);
  if (r.code !== code) throw new Error(`${msg || ""} expected ${code}, got ${r.code}: ${r.message}`);
  return r;
}
/** Paid takeover on the resale market (§4.1): reserve + request payment → confirm payment. The emulator has no LINE Pay keys, so this uses a fake payment flow */
async function takeOver(user, lockId) {
  const r = await user.call("createResaleLinePayReservation", { lock_id: lockId });
  if (!r.ok) return r;
  return user.call("confirmLinePayPayment", { order_id: r.data.order_id });
}

// ── Dates ──
const TODAY = taipeiToday();
const NOW_HM = taipeiTime(); // "HH:MM"
function nextBusinessDay(from) {
  let d = addDays(from, 1);
  while (!CFG.businessWeekdays.includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
}
let OPEN_DAY = nextBusinessDay(TODAY);
while (isPastCutoff(OPEN_DAY, {}, CFG)) OPEN_DAY = nextBusinessDay(OPEN_DAY);
const TODAY_IS_BUSINESS = CFG.businessWeekdays.includes(weekdayOf(TODAY));
// Nearest business day that can still be cancelled: cancellation closes 48 hours before the pickup slot starts (WINDOW starts at 00:00, so at least 3 days out)
const CANCEL_DAY = nextBusinessDay(addDays(TODAY, 2));
const prevBusinessDays = (n) => {
  const out = [];
  let d = TODAY;
  while (out.length < n) { d = addDays(d, -1); if (CFG.businessWeekdays.includes(weekdayOf(d))) out.push(d); }
  return out;
};
const hm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const nowMinutes = Number(NOW_HM.slice(0, 2)) * 60 + Number(NOW_HM.slice(3, 5));

// ── Test data ──
const WINDOW = "00:00-23:59";
const vid = (p) => `zz2-${p}-${RUN}`;
let seq = 0;
const uniq = (p) => `${p}-${RUN}-${++seq}`;
const future = () => Timestamp.fromMillis(Date.now() + 30 * 86400000);
let OWNER_UID = null;

async function mkVendor(id, extra = {}) {
  await db.doc(`vendors/${id}`).set({
    name: `測試店 ${id.slice(4, 14)}`, address: "臺北市大安區測試路 9 號", pickup_windows: [WINDOW], lat: 25.03, lng: 121.56,
    subscription_status: "active", subscription_end_date: future(), owner_uid: OWNER_UID, ...extra,
  });
  return id;
}
/** Bento item with the same structure as zz-bento in functions.test.js */
async function mkBento(vendorId, extra = {}) {
  const id = `${vendorId}-bento`;
  await db.doc(`menu_items/${id}`).set({
    vendor_id: vendorId, name: "測試雞腿便當", name_en: "Test Chicken Bento", price: 100, category: "便當", available: true,
    main: { name: "滷雞腿" }, rice_component_id: "zz-rice",
    slots: [
      { category: "青菜類", default: { name: "高麗菜" }, candidates: [{ name: "地瓜葉", portion_level: 1, weekly_cap: 1000, min_qty: 10 }] },
      { category: "蛋豆類", default: { name: "滷蛋" } },
    ],
    ...extra,
  });
  return id;
}
/** Copies a seeded vendor's catalog (ingredients, semi-finished items, recipes) into a new vendor, for the purchasing and taste-score tests */
async function cloneCatalog(from, to) {
  for (const sub of ["ingredients", "components"]) {
    const snap = await db.collection(`vendors/${from}/${sub}`).get();
    await Promise.all(snap.docs.map((d) => db.doc(`vendors/${to}/${sub}/${d.id}`).set(d.data())));
  }
  const items = await db.collection("menu_items").where("vendor_id", "==", from).get();
  const ids = {};
  for (const d of items.docs) {
    const key = d.id.slice(from.length + 1);
    ids[key] = `${to}-${key}`;
    await db.doc(`menu_items/${ids[key]}`).set({ ...d.data(), vendor_id: to });
  }
  return ids;
}
async function coupon(uid, vendorId, discount = 100, extra = {}) {
  const ref = db.collection("coupons").doc(uniq("zzc"));
  await ref.set({ user_id: uid, vendor_id: vendorId, vendor_name: "測試店", discount, tier: "free", status: "owned", expires_at: future(), created_at: Timestamp.now(), ...extra });
  return ref.id;
}
async function lock(buyer, vendorId, extra = {}) {
  const ref = db.collection("locks").doc(uniq("zzl"));
  const code = String(1000 + Math.floor(Math.random() * 9000));
  await ref.set({
    vendor_id: vendorId, menu_item_id: `${vendorId}-bento`, item_name: "測試雞腿便當", pickup_date: OPEN_DAY, pickup_window: WINDOW,
    buyer_uid: buyer, payer_uid: buyer, status: "locked", locked_price: 80, list_price: 100, pickup_code: code, phone_last3: "567",
    slots: [
      { category: "青菜類", default_dish: "高麗菜", removed: false, wished: null, resolved: "高麗菜", portion_level: 1 },
      { category: "蛋豆類", default_dish: "滷蛋", removed: false, wished: null, resolved: "滷蛋", portion_level: 1 },
    ],
    rice: "normal", reward_counted: false, created_at: Timestamp.now(), ...extra,
  });
  return { id: ref.id, ref, code };
}
const get = async (p) => (await db.doc(p).get()).data();
const notes = async (uid, filter = {}) => {
  let q = db.collection("notifications").where("user_id", "==", uid);
  if (filter.kind) q = q.where("kind", "==", filter.kind);
  const snap = await q.get();
  return snap.docs.map((d) => d.data()).filter((n) => !filter.title || filter.title.test(n.title));
};
const counterId = (v, d, w) => `slot_counters/${v}__${d}__${w}`;

/** geohash (same implementation as web/src/lib/geo.ts), for "frequent locations" */
function geohash(lat, lng, precision = 7) {
  const B = "0123456789bcdefghjkmnpqrstuvwxyz";
  const la = [-90, 90];
  const lo = [-180, 180];
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    const r = even ? lo : la;
    const v = even ? lng : lat;
    const mid = (r[0] + r[1]) / 2;
    if (v >= mid) { ch = (ch << 1) | 1; r[0] = mid; } else { ch <<= 1; r[1] = mid; }
    even = !even;
    if (++bit === 5) { hash += B[ch]; bit = 0; ch = 0; }
  }
  return hash;
}

(async () => {
  try { await db.doc("_ping/x").get(); } catch { console.error(`Cannot reach the Firestore emulator at ${HOST}:${PORTS.firestore}; run npm run emulator first`); process.exit(2); }
  OWNER_UID = await ensureUser("zz-owner@bunnbaa.test");
  const OWNER = await client("zz-owner@bunnbaa.test");
  console.log(`RUN=${RUN} TODAY=${TODAY} ${NOW_HM} OPEN_DAY=${OPEN_DAY}\n`);

  // ════ 3.15 No-show to charity meal, close, all given out, reservation timeout (schedules) ════
  {
    const VN = await mkVendor(vid("noshow"), { pickup_windows: ["00:00-00:30"], owner_uid: `zz2-owner-noshow-${RUN}` });
    await mkBento(VN);
    const X = `zz2-x-${RUN}`;
    let noshow = null;
    await test("C-CHR-01 C-RWD-02", "時段結束 30 分後未取餐 → charity/noshow、不退款、照常發券、通知；重跑不重複轉", async () => {
      if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
      if (nowMinutes < 60) throw new Error("SKIP：00:30 時段還沒結束 30 分");
      noshow = await lock(X, VN, { pickup_date: TODAY, pickup_window: "00:00-00:30", locked_price: 100, transaction_id: "tx-should-not-refund" });
      await runSchedule("charity.js", "convertToCharity");
      const l = await get(`locks/${noshow.id}`);
      eq(l.status, "charity"); eq(l.charity_source, "noshow");
      assert(l.refunded_amount === undefined, "不應退款");
      const meal = await get(`charityMeals/${l.charity_meal_id}`);
      eq(meal.source, "noshow"); eq(meal.status, "available");
      assert(!JSON.stringify(meal).includes(X), "愛心餐不應含原訂購人");
      assert((await notes(X, { kind: "charity", title: /沒有領到/ })).length === 1, "要收到「今天的便當沒有領到」");
      assert(!(await get(`users/${X}`))?.donated_count, "未取餐不計入愛心紀錄");
      const counted = await waitFor(async () => { const x = await get(`locks/${noshow.id}`); return x.reward_counted ? x : null; });
      eq(counted.tickets_issued, 1, "100 元 → 1 張抽獎券");
      await runSchedule("charity.js", "convertToCharity");
      eq((await db.collection("charityMeals").where("lock_id", "==", noshow.id).get()).size, 1, "重跑不應多一份");
    });

    await test("C-CHR-11", "時段結束 2 小時後截止：店家收到提醒、不能再預約；重跑不重複提醒", async () => {
      if (!noshow) throw new Error("SKIP：前一案例沒跑");
      if (nowMinutes < 150) throw new Error("SKIP：00:30 + 2 小時還沒到");
      await runSchedule("charity.js", "closeCharity");
      eq((await get(`vendors/${VN}/prepPlans/${TODAY}`)).charity_closed_breakfast, true); // v4 by meal period: the 00:00 slot counts as breakfast
      eq((await notes(`zz2-owner-noshow-${RUN}`, { title: /愛心餐已截止/ })).length, 1, "店家提醒");
      const R = await freshUser("late");
      const meal = (await get(`locks/${noshow.id}`)).charity_meal_id;
      const r = expectCode(await R.call("reserveCharity", { meal_id: meal }), "failed-precondition");
      assert(/截止/.test(r.message), r.message);
      await runSchedule("charity.js", "closeCharity");
      eq((await notes(`zz2-owner-noshow-${RUN}`, { title: /愛心餐已截止/ })).length, 1, "重跑不重複提醒");
    });

    await test("V-CHR-03 C-CHR-12", "輸入送出份數＝全部、沒報廢 → 原訂購人收到「都送出去了」（只一次）", async () => {
      if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
      const VC = await mkVendor(vid("chall"));
      await mkBento(VC);
      const [P1, P2] = [await freshUser("p1"), await freshUser("p2")];
      const m1 = expectOk(await P1.call("donateLock", { lock_id: (await lock(P1.uid, VC, { pickup_date: TODAY })).id })).meal_id;
      expectOk(await P2.call("donateLock", { lock_id: (await lock(P2.uid, VC, { pickup_date: TODAY })).id }));
      expectOk(await OWNER.call("giveCharityOnsite", { vendor_id: VC, meal_id: m1 }));
      const r = expectOk(await OWNER.call("submitCharityResult", { vendor_id: VC, date: TODAY, given: 2 }));
      eq(r.wasted, 0);
      const plan = await get(`vendors/${VC}/prepPlans/${TODAY}`);
      eq([plan.charity_result.total, plan.charity_result.wasted], [2, 0]);
      for (const u of [P1, P2]) eq((await notes(u.uid, { title: /都送出去了/ })).length, 1, "原訂購人通知");
      expectOk(await OWNER.call("submitCharityResult", { vendor_id: VC, date: TODAY, given: 2 }));
      eq((await notes(P1.uid, { title: /都送出去了/ })).length, 1, "每天只發一次");
    });

    await test("V-CHR-03b", "送出份數少於可領份數：其餘記報廢、寫進 prepPlans，不發「都送出去了」", async () => {
      if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
      const VW = await mkVendor(vid("waste"));
      await mkBento(VW);
      const P3 = await freshUser("p3");
      const ids = [];
      for (let i = 0; i < 2; i++) ids.push(expectOk(await P3.call("donateLock", { lock_id: (await lock(P3.uid, VW, { pickup_date: TODAY })).id })).meal_id);
      const r = expectOk(await OWNER.call("submitCharityResult", { vendor_id: VW, date: TODAY, given: 1 }));
      eq(r.wasted, 1);
      const statuses = (await Promise.all(ids.map((id) => get(`charityMeals/${id}`)))).map((m) => m.status).sort();
      eq(statuses, ["given", "wasted"]);
      eq((await get(`vendors/${VW}/prepPlans/${TODAY}`)).charity_result.wasted, 1);
      eq((await notes(P3.uid, { title: /都送出去了/ })).length, 0);
    });

    await test("C-CHR-09 C-CHR-15", "預約逾時（排程）：釋出回 available、不停權、可以再預約；預約不影響口味分數", async () => {
      if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
      const VE = await mkVendor(vid("expire"));
      await mkBento(VE);
      const P4 = await freshUser("p4");
      const R2 = await freshUser("r2");
      const meal = expectOk(await P4.call("donateLock", { lock_id: (await lock(P4.uid, VE, { pickup_date: TODAY })).id })).meal_id;
      const res = expectOk(await R2.call("reserveCharity", { meal_id: meal })).reservation_id;
      await db.doc(`charityReservations/${res}`).update({ expires_at: Timestamp.fromMillis(Date.now() - 1000) });
      await runSchedule("charity.js", "expireCharityReservation");
      eq((await get(`charityReservations/${res}`)).status, "expired");
      eq((await get(`charityMeals/${meal}`)).status, "available");
      assert(!(await get(`charityBans/${R2.uid}`)), "v4 不再寫 charityBans");
      const note = await notes(R2.uid, { title: /逾時/ });
      assert(note.length === 1 && /釋出給下一位/.test(note[0].body), "逾時通知寫釋出、不寫停權");
      const again = expectOk(await R2.call("reserveCharity", { meal_id: meal }), "逾時後可以再預約（C-CHR-18）");
      eq((await get(`charityReservations/${again.reservation_id}`)).status, "reserved");
      assert(!(await get(`tasteProfiles/${R2.uid}`)), "預約愛心餐不應產生口味分數");
    });

    await test("C-CHR-01b", "店家現在只設午餐時段，今天還有早餐時段的單：照樣轉愛心餐、照樣截止（2026-10-13 修）", async () => {
      if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
      if (nowMinutes < 150) throw new Error("SKIP：00:30 + 2 小時還沒到");
      const VL = await mkVendor(vid("lunchonly"), { pickup_windows: ["12:00-12:30"], owner_uid: `zz2-owner-lunchonly-${RUN}` });
      await mkBento(VL);
      const old = await lock(`zz2-y-${RUN}`, VL, { pickup_date: TODAY, pickup_window: "00:00-00:30", locked_price: 60 });
      await runSchedule("charity.js", "convertToCharity");
      const l = await get(`locks/${old.id}`);
      eq(l.status, "charity"); eq(l.charity_source, "noshow");
      await runSchedule("charity.js", "closeCharity");
      eq((await get(`vendors/${VL}/prepPlans/${TODAY}`)).charity_closed_breakfast, true, "轉完後截止排程也要看到早餐時段");
    });
  }

  // ════ 3.14 Reward pool settlement, coupon expiry, draw period end, expiry reminders, refund clawback ════
  const P = addDays(mondayOf(TODAY), -7); // previous period
  await test("C-RWD-03 C-RWD-17", "累積淨營業額不到 1 萬不開池：carried、結轉下一期、rewardStatus 再 X 元開獎；重跑不重算", async () => {
    const VR = await mkVendor(vid("carry"));
    for (let i = 0; i < 60; i++) {
      await db.collection("rewardTickets").add({ vendor_id: VR, user_id: `zz2-u${i % 7}-${RUN}`, period_id: P, status: "pending", created_at: Timestamp.now() });
    }
    await db.doc(`vendors/${VR}/rewardPeriods/${P}`).set({ period_id: P, net_revenue: 6000, tickets: 60 });
    eq(expectOk(await OWNER.call("triggerRewardPeriodNow", { vendor_id: VR, period_id: P }))[VR], "carried");
    const next = await get(`vendors/${VR}/rewardPeriods/${mondayOf(TODAY)}`);
    eq([next.carried_revenue, next.carried_tickets], [6000, 60], "結轉");
    const st = await get(`rewardStatus/${VR}`);
    eq([st.pool_open, st.tickets_so_far, st.revenue_so_far, st.min_revenue, st.amount_to_open], [false, 60, 6000, 10000, 4000]);
    eq(expectOk(await OWNER.call("triggerRewardPeriodNow", { vendor_id: VR, period_id: P }))[VR], "carried");
    eq((await get(`vendors/${VR}/rewardPeriods/${mondayOf(TODAY)}`)).carried_tickets, 60, "重跑不應再結轉一次");
  });

  await test("C-RWD-04 C-RWD-17", "§8.4 範例（100,000 元、1,000 張，回饋 10%）實際開池：分配、leftover、發 1,000 張券；重跑不重複發券", async () => {
    const VP = await mkVendor(vid("pool"));
    let batch = db.batch();
    for (let i = 0; i < 1000; i++) {
      batch.set(db.collection("rewardTickets").doc(), { vendor_id: VP, user_id: `zz2-pu${i}-${RUN}`, period_id: P, status: "pending", created_at: Timestamp.now() });
      if (i % 400 === 399) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
    await db.doc(`vendors/${VP}/rewardPeriods/${P}`).set({ period_id: P, net_revenue: 100000, tickets: 1000 });
    eq(expectOk(await OWNER.call("triggerRewardPeriodNow", { vendor_id: VP, period_id: P }))[VP], "pooled");
    const p = await get(`vendors/${VP}/rewardPeriods/${P}`);
    eq(p.pool, 10000); eq(p.leftover, 20);
    eq(Object.fromEntries(Object.entries(p.allocation).sort()), { free: 15, t50: 79, t95: 906 });
    const issued = await db.collection("coupons").where("vendor_id", "==", VP).where("pool_period", "==", P).get();
    eq(issued.size, 1000, "發出的券");
    const drawable = await db.collection("rewardTickets").where("vendor_id", "==", VP).where("status", "==", "drawable").get();
    eq(drawable.size, 1000, "抽獎券變 drawable");
    expectOk(await OWNER.call("triggerRewardPeriodNow", { vendor_id: VP, period_id: P }));
    eq((await db.collection("coupons").where("vendor_id", "==", VP).where("pool_period", "==", P).get()).size, 1000, "重跑不應多發");
  });

  await test("C-RWD-14", "expireCoupons：逾期券 expired；closeDrawWindow：沒抽的 forfeited、券 unclaimed、期別 closed", async () => {
    const VX = await mkVendor(vid("expiry"));
    const c = await coupon(`zz2-ex-${RUN}`, VX, 20, { expires_at: Timestamp.fromMillis(Date.now() - 60000) });
    await runSchedule("rewardsFns.js", "expireCoupons");
    eq((await get(`coupons/${c}`)).status, "expired");
    const Q = "2026-01-05";
    await db.doc(`vendors/${VX}/rewardPeriods/${Q}`).set({ period_id: Q, status: "pooled", remaining: { t95: 1 }, draw_deadline: Timestamp.fromMillis(Date.now() - 60000) });
    const issued = (await db.collection("coupons").add({ vendor_id: VX, pool_period: Q, tier: "t95", discount: 5, status: "issued" })).id;
    const ticket = (await db.collection("rewardTickets").add({ vendor_id: VX, user_id: `zz2-ex-${RUN}`, period_id: Q, pool_period: Q, status: "drawable", created_at: Timestamp.now() })).id;
    await runSchedule("rewardsFns.js", "closeDrawWindow");
    eq((await get(`rewardTickets/${ticket}`)).status, "forfeited");
    eq((await get(`coupons/${issued}`)).status, "unclaimed");
    const p = await get(`vendors/${VX}/rewardPeriods/${Q}`);
    eq([p.status, p.unclaimed_amount], ["closed", 5]);
  });

  await test("C-RWD-15", "券剩 3 天內到期 → couponReminders 提醒一次", async () => {
    const VX2 = await mkVendor(vid("remind"));
    const U = `zz2-rem-${RUN}`;
    const c = await coupon(U, VX2, 20, { expires_at: Timestamp.fromMillis(Date.now() + 2 * 86400000) });
    await runSchedule("rewardsFns.js", "couponReminders");
    eq((await notes(U, { title: /快到期/ })).length, 1);
    eq((await get(`coupons/${c}`)).reminded, true);
    await runSchedule("rewardsFns.js", "couponReminders");
    eq((await notes(U, { title: /快到期/ })).length, 1, "重跑不重複提醒");
  });

  await test("F-20 C-RWD-16 C-RWD-18", "fulfilled／charity／resold_and_fulfilled 各計一次（用實付金額）；計入後退款：扣回營業額、撤回未開池的抽獎券", async () => {
    const VF = await mkVendor(vid("count"));
    const U = `zz2-cnt-${RUN}`;
    const period = mondayOf(TODAY);
    const rev = async () => (await get(`vendors/${VF}/rewardPeriods/${period}`))?.net_revenue || 0;
    const a = await lock(U, VF, { pickup_date: TODAY, locked_price: 200 });
    await a.ref.update({ status: "fulfilled" });
    await waitFor(async () => (await get(`locks/${a.id}`)).reward_counted);
    eq(await rev(), 200, "營業額");
    await a.ref.update({ note: "touch" });
    await sleep(3000);
    eq((await db.collection("rewardTickets").where("lock_id", "==", a.id).get()).size, 2, "再寫一次不重複發券");
    const b = await lock(U, VF, { pickup_date: TODAY, locked_price: 80, early_bird_amount: 20 });
    await b.ref.update({ status: "charity" });
    await waitFor(async () => (await get(`locks/${b.id}`)).reward_counted);
    eq(await rev(), 280, "愛心餐用實付 80 計入");
    eq((await get(`userSpend/${VF}_${U}`)).carry, 80, "carry");
    const payer = `zz2-payer-${RUN}`;
    const c = await lock(`zz2-holder-${RUN}`, VF, { pickup_date: TODAY, payer_uid: payer, locked_price: 100 });
    await c.ref.update({ status: "resold_and_fulfilled" });
    await waitFor(async () => (await get(`locks/${c.id}`)).reward_counted);
    const tc = await db.collection("rewardTickets").where("lock_id", "==", c.id).get();
    assert(tc.size === 1 && tc.docs[0].data().user_id === payer, "轉讓後取餐的券給付款人");
    await a.ref.update({ status: "cancelled", refunded_amount: 200 });
    await waitFor(async () => (await get(`locks/${a.id}`)).refund_counted);
    const ts = await db.collection("rewardTickets").where("lock_id", "==", a.id).get();
    assert(ts.docs.every((d) => d.data().status === "revoked"), "抽獎券應撤回");
    const pr = await get(`vendors/${VF}/rewardPeriods/${period}`);
    eq([pr.net_revenue, pr.refunds], [180, 200], "扣回");
  });

  const VO = await mkVendor(vid("order"));
  await mkBento(VO);
  const line = (extra = {}) => ({ menu_item_id: `${VO}-bento`, pickup_date: OPEN_DAY, pickup_window: WINDOW, quantity: 1, rice: "normal", slots: [{ choice: "default" }, { choice: "default" }], ...extra });

  await test("C-RWD-13", "用券的訂單取消時券已過期 → 不退券（expired）", async () => {
    const U = await freshUser("cpx");
    const c = await coupon(U.uid, VO, 1000);
    const r = expectOk(await U.call("createCartLinePayReservation", { lines: [line({ coupon_id: c, pickup_date: CANCEL_DAY })] }));
    const id = expectOk(await U.call("confirmLinePayPayment", { order_id: r.order_id })).lock_ids[0];
    await db.doc(`coupons/${c}`).update({ expires_at: Timestamp.fromMillis(Date.now() - 1000) });
    expectOk(await U.call("cancelLock", { lock_id: id }));
    eq((await get(`coupons/${c}`)).status, "expired");
  });

  await test("V-GRW-03", "暫停參加：從 7 天後那週起不發抽獎券、不開池；已持有的券照常能用；可取消暫停", async () => {
    const VG = await mkVendor(vid("pause"));
    await mkBento(VG);
    const from = expectOk(await OWNER.call("setRewardPause", { vendor_id: VG, paused: true })).paused_from;
    assert(from >= addDays(TODAY, 7) && weekdayOf(from) === 1, `paused_from=${from}`);
    const l = await lock(`zz2-pz-${RUN}`, VG, { pickup_date: from, locked_price: 300 });
    await l.ref.update({ status: "fulfilled" });
    const x = await waitFor(async () => { const d = await get(`locks/${l.id}`); return d.reward_counted ? d : null; });
    eq(x.tickets_issued, 0, "暫停期間不發券");
    eq(expectOk(await OWNER.call("triggerRewardPeriodNow", { vendor_id: VG, period_id: from }))[VG], "paused");
    const U = await freshUser("pzc");
    const c = await coupon(U.uid, VG, 1000); // a full-amount discount takes the no-payment path (the emulator has no LINE Pay)
    expectOk(await U.call("createCartLinePayReservation", { lines: [{ ...line(), menu_item_id: `${VG}-bento`, coupon_id: c }] }), "已持有的券照常能用");
    eq(expectOk(await OWNER.call("setRewardPause", { vendor_id: VG, paused: false })).paused_from, null);
  });

  // ════ 5. Anomaly detection (schedule) ════
  await test("A-ANM-01", "7 天退款 3 筆、單人抽獎券占 > 20%、同裝置 3 帳號 → anomalies 各一筆、通知店家、不自動處分", async () => {
    const ownerA = `zz2-owner-anm-${RUN}`;
    const VA = await mkVendor(vid("anm"), { owner_uid: ownerA });
    const Q = `zz2-q-${RUN}`;
    for (let i = 0; i < 3; i++) await lock(Q, VA, { status: "cancelled", cancel_reason: "customer", cancelled_at: Timestamp.now() });
    const Q2 = `zz2-q2-${RUN}`;
    for (let i = 0; i < 20; i++) {
      await db.collection("rewardTickets").add({ vendor_id: VA, user_id: i < 8 ? Q2 : `zz2-qo${i}-${RUN}`, period_id: mondayOf(TODAY), status: "pending", created_at: Timestamp.now() });
    }
    const dev = `dev-${RUN}`;
    const devUsers = [1, 2, 3].map((i) => `zz2-dev${i}-${RUN}`);
    for (const u of devUsers) { await db.doc(`users/${u}`).set({ device_id: dev }); await coupon(u, VA, 5); }
    await runSchedule("rewardsFns.js", "detectAnomalies");
    const all = (await db.collection("anomalies").where("date", "==", TODAY).get()).docs.map((d) => d.data());
    assert(all.some((a) => a.type === "refunds" && a.user_id === Q && a.vendor_id === VA), "退款異常");
    assert(all.some((a) => a.type === "ticket_share" && a.user_id === Q2 && a.vendor_id === VA), "抽獎券占比異常");
    assert(all.some((a) => a.type === "device" && devUsers.every((u) => a.user_id.includes(u))), "同裝置異常");
    assert(all.filter((a) => [Q, Q2].includes(a.user_id)).every((a) => a.status === "open"), "狀態 open");
    assert((await notes(ownerA, { title: /異常/ })).length >= 2, "店家收到通知");
    assert(!(await get(`users/${Q}`))?.orderBanned, "不應自動封鎖");
  });

  // ════ 3.16 Taste scores, open wishes; 4.10 area insights ════
  await test("C-TST-02 C-TST-03", "onLockCreatedTaste：購買 +2、許願 +3、不要 −2；舊分數 30 天半衰", async () => {
    const VT = vid("taste");
    await mkVendor(VT);
    const ids = await cloneCatalog("cafe-renheya-demo", VT);
    const item = await get(`menu_items/${ids.classic}`);
    const comps = Object.fromEntries((await db.collection(`vendors/${VT}/components`).get()).docs.map((d) => [d.id, d.data()]));
    const ings = Object.fromEntries((await db.collection(`vendors/${VT}/ingredients`).get()).docs.map((d) => [d.id, d.data()]));
    const tags = (c) => dishTags(comps[c], ings);
    const T = `zz2-taste-${RUN}`;
    const s = item.slots;
    const cand = s[0].candidates.findIndex((c) => !c.disabled);
    const slots = [
      { category: s[0].category, default_dish: s[0].default.name, default_component_id: s[0].default.component_id, removed: false, wished: s[0].candidates[cand].name, wished_component_id: s[0].candidates[cand].component_id, candidate_index: cand },
      { category: s[1].category, default_dish: s[1].default.name, default_component_id: s[1].default.component_id, removed: false, wished: null },
      { category: s[2].category, default_dish: s[2].default.name, default_component_id: s[2].default.component_id, removed: true, wished: null },
    ];
    const expected = new Map();
    const add = (ts, w) => ts.forEach((x) => expected.set(x, (expected.get(x) || 0) + w));
    add(tags(item.main.component_id), 2);
    add(tags(s[0].candidates[cand].component_id), 3);
    add(tags(s[1].default.component_id), 2);
    add(tags(s[2].default.component_id), -2);
    const l = await lock(T, VT, { menu_item_id: ids.classic, slots, pickup_date: TODAY });
    const prof = await waitFor(async () => (await get(`tasteProfiles/${T}`))?.scores);
    eq(Object.fromEntries([...Object.entries(prof)].sort()), Object.fromEntries([...expected].sort()), "分數");
    assert(Array.isArray((await get(`locks/${l.id}`)).tags), "lock.tags 要寫回");
    // Half-life: set the score to {X: 10} dated 30 days ago, place another order → X becomes 5
    await db.doc(`tasteProfiles/${T}`).set({ scores: { 測試標籤: 10 }, scores_updated_at: Timestamp.fromMillis(Date.now() - 30 * 86400000) });
    await lock(T, VT, { menu_item_id: ids.classic, slots, pickup_date: TODAY });
    const after = await waitFor(async () => { const p = await get(`tasteProfiles/${T}`); return p.scores?.測試標籤 !== 10 ? p.scores : null; });
    assert(Math.abs(after.測試標籤 - 5) < 0.01, `半衰後 ${after.測試標籤}`);
  });

  await test("C-WSH-01", "從菜色庫許願：openWishes/{vendor}_{uid}_{dish} 建立（菜名、dish_id）；同一道再許一次不重複；不存在的菜 → not-found", async () => {
    const VW1 = await mkVendor(vid("wish1"));
    const U = await freshUser("wish1");
    const dish = (await db.collection("dishLibrary").limit(1).get()).docs[0];
    assert(dish, "菜色庫沒有資料（要先灌 seed-phase1 --catalog-only）");
    const r = expectOk(await U.call("placeOpenWish", { vendor_id: VW1, dish_id: dish.id }));
    eq(r.dish_name, dish.data().name);
    const w = await get(`openWishes/${VW1}_${U.uid}_${r.dish_key}`);
    eq([w.user_id, w.vendor_id, w.dish_id, w.dish_name], [U.uid, VW1, dish.id, dish.data().name]);
    expectOk(await U.call("placeOpenWish", { vendor_id: VW1, dish_id: dish.id }));
    eq((await db.collection("openWishes").where("vendor_id", "==", VW1).get()).size, 1, "同一道不重複");
    expectCode(await U.call("placeOpenWish", { vendor_id: VW1, dish_id: "no-such-dish" }), "not-found");
  });

  await test("C-WSH-04 C-WSH-05","近 30 天 20 人許願同一道 → 通知店家、notified；超過 30 天不算；按已上架通知許願者", async () => {
    const ownerW = `zz2-owner-wish-${RUN}`;
    const VW = await mkVendor(vid("wish"), { owner_uid: ownerW });
    const key = "打拋豬";
    const users = Array.from({ length: 20 }, (_, i) => `zz2-w${i}-${RUN}`);
    for (const u of users) await db.doc(`openWishes/${VW}_${u}_${key}`).set({ user_id: u, vendor_id: VW, dish_id: null, dish_key: key, dish_name: key, created_at: Timestamp.now() });
    const old = `zz2-wold-${RUN}`;
    await db.doc(`openWishes/${VW}_${old}_${key}`).set({ user_id: old, vendor_id: VW, dish_id: null, dish_key: key, dish_name: key, created_at: Timestamp.fromMillis(Date.now() - 35 * 86400000) });
    expectOk(await OWNER.call("triggerTallyOpenWishesNow", { vendor_id: VW }));
    const tally = await get(`vendors/${VW}/wishTally/${key}`);
    eq([tally.count, tally.notified], [20, true]);
    eq((await notes(ownerW, { title: /達門檻/ })).length, 1, "店家通知");
    expectOk(await OWNER.call("triggerTallyOpenWishesNow", { vendor_id: VW }));
    eq((await notes(ownerW, { title: /達門檻/ })).length, 1, "已通知過不重複");
    const r = expectOk(await OWNER.call("notifyWishersListed", { vendor_id: VW, dish_key: key }));
    assert(r.notified >= 20, `notified=${r.notified}`);
    eq((await notes(users[0], { kind: "wish", title: /上架/ })).length, 1);
    eq((await get(`vendors/${VW}/wishTally/${key}`)).listed, true);
  });

  await test("V-INS-01 V-INS-03", "1 公里內近 30 天 20 人 → 標籤占比、不要率、許願排行、缺口；文件沒有個人資料", async () => {
    const VI = await mkVendor(vid("ins"), { lat: 21.9, lng: 120.8, address: "屏東縣恆春鎮測試路 1 號" });
    const users = Array.from({ length: 20 }, (_, i) => `zz2-iu${i}-${RUN}`);
    for (const [i, u] of users.entries()) {
      await lock(u, VI, { pickup_date: addDays(TODAY, -2), status: "fulfilled", tags: ["雞", "炸"], buyer_name: `王${i}`,
        slots: [{ category: "青菜類", default_dish: "高麗菜", removed: i < 5, wished: null, resolved: i < 5 ? null : "高麗菜" }] });
    }
    for (const u of users.slice(0, 3)) await db.doc(`openWishes/${VI}_${u}_滷肉飯`).set({ user_id: u, vendor_id: VI, dish_key: "滷肉飯", dish_name: "滷肉飯", created_at: Timestamp.now() });
    const r = expectOk(await OWNER.call("triggerAreaInsightsNow", { vendor_id: VI }));
    eq(r.users, 20);
    const doc = await get(`areaInsights/${VI}_${mondayOf(TODAY)}`);
    eq(doc.tag_shares.find((x) => x.tag === "雞")?.share, 100, "標籤占比");
    const { dish, rate, total } = doc.removal_rates[0];
    eq({ dish, rate, total }, { dish: "高麗菜", rate: 25, total: 20 }, "不要率");
    eq(doc.open_wishes[0].people, 3, "許願排行");
    assert(doc.gaps.some((g) => g.tag === "雞"), "供需缺口");
    const json = JSON.stringify(doc);
    assert(users.every((u) => !json.includes(u)) && !json.includes("王0"), "不應含 uid 或姓名");
  });

  await test("V-INS-02 C-CHR-15", "只有 19 人 → 不產生洞察（insufficient）；愛心餐預約不算人數", async () => {
    const VJ = await mkVendor(vid("ins19"), { lat: 21.95, lng: 120.85, address: "屏東縣恆春鎮測試路 2 號" });
    for (let i = 0; i < 19; i++) await lock(`zz2-ju${i}-${RUN}`, VJ, { pickup_date: addDays(TODAY, -2), status: "fulfilled", tags: ["豬"] });
    await db.collection("charityReservations").add({ user_id: `zz2-jc-${RUN}`, vendor_id: VJ, meal_id: "x", date: TODAY, status: "claimed", expires_at: Timestamp.now() });
    eq(expectOk(await OWNER.call("triggerAreaInsightsNow", { vendor_id: VJ })).skipped, "too_few_users");
    eq((await get(`areaInsights/${VJ}_${mondayOf(TODAY)}`)).insufficient, true);
  });

  // ════ 3.12 Resale matching (the matchResaleLock trigger runs in the emulator; without embeddings it falls back to "ordered the same item") ════
  {
    const VM = await mkVendor(vid("match"));
    const IM = await mkBento(VM);
    const B1 = await freshUser("b1");
    const N = await freshUser("n");
    const u = (r) => `zz2-${r}-${RUN}`;
    const [B2, B3, H, M, F, D] = ["b2", "b3", "h", "m", "f", "d"].map(u);
    await db.doc(`users/${B2}`).set({ lang: "en" });
    await db.doc(`users/${M}`).set({ muted_kinds: ["resale_match"] });
    await db.doc(`users/${F}`).set({ home_geo: geohash(22.6273, 120.3014) }); // Kaohsiung, > 10 km from the vendor
    for (const x of [B1.uid, B2, B3, H, M, F, D]) await lock(x, VM, { menu_item_id: IM, pickup_date: addDays(TODAY, -3), status: "fulfilled" });
    await lock(D, VM, { menu_item_id: "other", pickup_date: OPEN_DAY }); // D already has an order at this vendor that day
    const S = u("s");
    const list = async (extra = {}) => {
      const l = await lock(S, VM, { menu_item_id: IM, ...extra });
      await l.ref.update({ status: "for_resale" });
      return l;
    };
    const match = (id) => waitFor(async () => get(`resale_matches/${id}`), 60000);
    let L1 = null;
    let L3 = null;

    await test("C-MTC-01 C-MTC-03 C-MTC-04 C-MTC-06 C-MTC-07", "上架 → 通知訂過的人；排除本人、前持有人、當天已訂、關掉通知、距離太遠", async () => {
      L1 = await list({ transferred_from_uids: [H] });
      const m = await match(L1.id);
      eq([...m.notified_uids].sort(), [B1.uid, B2, B3].sort(), "notified_uids");
      const n1 = await notes(B1.uid, { kind: "resale_match" });
      assert(n1.length === 1 && /可能想接手/.test(n1[0].title) && n1[0].link === "/marketplace", JSON.stringify(n1));
    });

    await test("C-MTC-02", "users.lang=en 的會員收到英文通知（站內；FCM 推播要在正式站測）", async () => {
      const n2 = await notes(B2, { kind: "resale_match" });
      assert(n2.length >= 1 && !CJK.test(n2[0].title), JSON.stringify(n2[0]));
    });

    await test("C-MTC-05", "一天最多 2 則：第 3 筆上架時已達上限的人不再通知", async () => {
      const L2 = await list();
      assert((await match(L2.id)).notified_uids.includes(B1.uid), "第 2 則");
      L3 = await list();
      const m3 = await match(L3.id);
      assert([B1.uid, B2, B3].every((x) => !m3.notified_uids.includes(x)), `第 3 則不應通知：${m3.notified_uids}`);
      eq((await get(`users/${B1.uid}`)).resale_match_log.count, 2);
    });

    await test("C-MTC-08 F-13", "取消後 12 小時內重新上架不重複通知；不是變成 for_resale 的更新不觸發", async () => {
      const before = (await notes(B1.uid, { kind: "resale_match" })).length;
      const created = (await get(`resale_matches/${L1.id}`)).created_at.toMillis();
      await L1.ref.update({ status: "locked" });
      await L1.ref.update({ status: "for_resale" });
      await L1.ref.update({ resale_deadline: Timestamp.fromMillis(Date.now() + 3600000) });
      const gift = await lock(S, VM, { menu_item_id: IM });
      await gift.ref.update({ status: "for_gift" });
      await sleep(8000);
      eq((await get(`resale_matches/${L1.id}`)).created_at.toMillis(), created, "resale_matches 不應重寫");
      eq((await notes(B1.uid, { kind: "resale_match" })).length, before, "不重複通知");
      assert(!(await get(`resale_matches/${gift.id}`)), "贈送不應觸發媒合");
    });

    await test("C-MTC-10", "被通知的人接手 → claimed_by_match=true；沒被通知的人接手維持 false", async () => {
      expectOk(await takeOver(B1, L1.id));
      eq((await get(`resale_matches/${L1.id}`)).claimed_by_match, true);
      expectOk(await takeOver(N, L3.id));
      eq((await get(`resale_matches/${L3.id}`)).claimed_by_match, false);
    });

    await test("C-MTC-11", "取餐日已過的 lock 上架不通知", async () => {
      const old = await list({ pickup_date: addDays(TODAY, -1) });
      await sleep(8000);
      assert(!(await get(`resale_matches/${old.id}`)), "不應有 resale_matches");
    });
  }

  await test("C-CHR-13", "關掉愛心餐通知 → 捐出、未取餐轉愛心餐都不再出現在通知", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const VQ = await mkVendor(vid("mute"));
    await mkBento(VQ);
    const U = await freshUser("mute");
    await db.doc(`users/${U.uid}`).set({ muted_kinds: ["charity"] }, { merge: true });
    expectOk(await U.call("donateLock", { lock_id: (await lock(U.uid, VQ, { pickup_date: TODAY })).id }));
    eq((await notes(U.uid, { kind: "charity" })).length, 0, "關掉後還收到愛心餐通知");
  });

  await test("C-MKT-07", "接手後原持有人的 lock_tokens 被刪除", async () => {
    const VK = await mkVendor(vid("tok"));
    await mkBento(VK);
    const A = await freshUser("tka");
    const B = await freshUser("tkb");
    const l = await lock(A.uid, VK);
    await db.doc(`lock_tokens/${l.id}`).set({ fcm_token: "fake-token", buyer_uid: A.uid });
    await l.ref.update({ status: "for_resale" });
    expectOk(await takeOver(B, l.id));
    assert(!(await get(`lock_tokens/${l.id}`)), "lock_tokens 仍在（A 會繼續收到這筆的提醒）");
  });

  // ════ 6. Pickup reminders (schedule) ════
  await test("F-02 F-03 C-CHR-02", "時段結束前 30 分仍未取餐 → 提醒；lang=en 收英文、用 item_name_en；轉讓後只提醒新持有人", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    if (nowMinutes < 30 || nowMinutes > 23 * 60 + 40) throw new Error("SKIP：時段跨午夜");
    const VPR = await mkVendor(vid("remind"), { pickup_windows: [`${hm(nowMinutes - 30)}-${hm(nowMinutes + 15)}`] });
    const w = (await get(`vendors/${VPR}`)).pickup_windows[0];
    const zh = `zz2-rz-${RUN}`;
    const en = `zz2-re-${RUN}`;
    const oldHolder = `zz2-ro-${RUN}`;
    await db.doc(`users/${en}`).set({ lang: "en" });
    await lock(zh, VPR, { pickup_date: TODAY, pickup_window: w });
    await lock(en, VPR, { pickup_date: TODAY, pickup_window: w, item_name_en: "Test Chicken Bento", payer_uid: oldHolder, transferred_from_uids: [oldHolder] });
    await runSchedule("orders.js", "pickupReminder");
    const nz = await notes(zh, { kind: "pickup" });
    assert(nz.length === 1 && /還沒取餐/.test(nz[0].title), "中文提醒");
    eq((await notes(oldHolder, { kind: "pickup" })).length, 0, "原持有人不應收到");
    const ne = await notes(en, { kind: "pickup" });
    assert(ne.length === 1, "新持有人要收到");
    assert(!CJK.test(ne[0].title + ne[0].body) && /Test Chicken Bento/.test(ne[0].body), `英文提醒：${ne[0].title} / ${ne[0].body}`);
  });

  // ════ 5. Disaster days ════
  await test("A-DIS-02", "已截單（取餐日當天）建立停班事件 → 仍取消退款", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const VD = await mkVendor(vid("dis"), { address: `臺北市測災${RUN}區測試路 1 號` });
    const l = await lock(`zz2-dis-${RUN}`, VD, { pickup_date: TODAY });
    await db.collection("disasterEvents").add({ type: "work_suspension", counties: ["臺北市"], towns: [`臺北市測災${RUN}區`], whole_counties: [], dates: [TODAY], source: "manual", summary: "測試", created_at: Timestamp.now() });
    const x = await waitFor(async () => { const d = await get(`locks/${l.id}`); return d.status === "cancelled" ? d : null; }, 60000);
    eq(x.cancel_reason, "disaster");
  });

  await test("A-DIS-05", "停班退款退成點數給付款人；按「重新處理」不重複退款與通知", async () => {
    const VD2 = await mkVendor(vid("dis2"), { address: `臺北市重處${RUN}區測試路 1 號` });
    const okBuyer = `zz2-dok-${RUN}`;
    const good = await lock(okBuyer, VD2, { paid_amount: 100, transaction_id: "fake-dis05" });
    const ev = await db.collection("disasterEvents").add({ type: "work_suspension", counties: ["臺北市"], towns: [`臺北市重處${RUN}區`], whole_counties: [], dates: [OPEN_DAY], source: "manual", summary: "測試", created_at: Timestamp.now() });
    const first = await waitFor(async () => (await ev.get()).data().result, 60000);
    eq([first.cancelled, first.failed], [1, 0]);
    eq((await get(`locks/${good.id}`)).cancel_reason, "disaster");
    eq((await get(`wallets/${okBuyer}`)).balance, 100, "全額退成點數");
    const r = expectOk(await OWNER.call("reprocessDisasterEvent", { event_id: ev.id }));
    eq([r.cancelled, r.failed], [0, 0]);
    eq((await get(`wallets/${okBuyer}`)).balance, 100, "不重複退");
    eq((await notes(okBuyer, { kind: "disaster" })).length, 1, "已取消的不重複通知");
  });

  await test("A-DIS-04", "颱風警報 → 有訂單的店家收到預警、店家頁顯示可能取消的日期", async () => {
    const ownerT = `zz2-owner-ty-${RUN}`;
    const VTY = await mkVendor(vid("ty"), { address: "澎湖縣馬公市測試路 1 號", owner_uid: ownerT });
    await lock(`zz2-ty-${RUN}`, VTY);
    await db.collection("disasterEvents").add({ type: "typhoon_warning", counties: ["澎湖縣"], towns: [], whole_counties: [], dates: [OPEN_DAY], source: "manual", summary: "測試颱風", created_at: Timestamp.now() });
    const v = await waitFor(async () => (await get(`vendors/${VTY}`)).typhoon_notice, 60000);
    assert(v.dates.includes(OPEN_DAY));
    assert((await notes(ownerT, { title: /颱風/ })).length === 1, "店家預警");
  });

  await test("A-DIS-06", "等值替換配菜：受影響訂單改配菜、通知消費者、prepPlans 記錄", async () => {
    const VS2 = await mkVendor(vid("sub"));
    const buyer = `zz2-sub-${RUN}`;
    const l = await lock(buyer, VS2, { slots: [{ category: "青菜類", default_dish: "高麗菜", removed: false, wished: "地瓜葉", resolved: "地瓜葉", portion_level: 0.75 }] });
    const untouched = await lock(`zz2-sub2-${RUN}`, VS2);
    eq(expectOk(await OWNER.call("substituteDish", { vendor_id: VS2, date: OPEN_DAY, from: "地瓜葉", to: "高麗菜" })).changed, 1);
    const s = (await get(`locks/${l.id}`)).slots[0];
    eq([s.resolved, s.substituted_from], ["高麗菜", "地瓜葉"]);
    eq((await get(`locks/${untouched.id}`)).slots[0].substituted_from, undefined);
    eq((await notes(buyer, { kind: "disaster", title: /替換/ })).length, 1);
    eq((await get(`vendors/${VS2}/prepPlans/${OPEN_DAY}`)).substitutions, [{ from: "地瓜葉", to: "高麗菜" }]);
  });

  // ════ 4.8 Purchasing ════
  await test("V-PUR-01 V-PUR-03 V-PUR-05 V-PUR-09 A-DIS-07 V-CHR-04 V-RCP-09", "週叫貨單：原物料 × 週一至週五、已確定／預測；4 週同星期幾平均排除停班日與報廢；盤點；冪等；主菜鎖定", async () => {
    const VPU = vid("pur");
    const thisMonday = mondayOf(TODAY);
    const mondays = [28, 21, 14, 7].map((d) => addDays(thisMonday, -d));
    const tuesdays = mondays.map((d) => addDays(d, 1));
    await mkVendor(VPU, { disaster_dates: [mondays[3]] });
    const ids = await cloneCatalog("cafe-renheya-demo", VPU);
    const hist = async (date, n) => { for (let i = 0; i < n; i++) await lock(`zz2-h${i}-${RUN}`, VPU, { menu_item_id: ids.classic, pickup_date: date, status: "fulfilled", reward_counted: true }); };
    for (const d of mondays.slice(0, 3)) await hist(d, 4);
    await hist(mondays[3], 20); // work-suspension day: excluded from the average
    for (const d of tuesdays) await hist(d, 4);
    await db.doc(`vendors/${VPU}/prepPlans/${tuesdays[0]}`).set({ date: tuesdays[0], charity_result: { wasted: 4 } }); // everything was wasted that day
    const week = mondayOf(addDays(TODAY, 7));
    await lock(`zz2-cf-${RUN}`, VPU, { menu_item_id: ids.classic, pickup_date: week });
    const r = expectOk(await OWNER.call("triggerPurchaseListNow", { vendor_id: VPU, week_start: week }));
    eq(r.uncounted, true, "沒盤點");
    const list = await get(`vendors/${VPU}/purchaseLists/weekly_${week}`);
    eq(list.board[0], { date: week, closed: false, confirmed: 1, forecast: 3 }, "週一：確定 1、預測 4−1");
    eq(list.board[1].forecast, 3, "週二：(0+4+4+4)/4 = 3");
    const ings = Object.fromEntries((await db.collection(`vendors/${VPU}/ingredients`).get()).docs.map((d) => [d.id, d.data()]));
    // v4: long-shelf-life items (monthly) are folded into the weekly order, appear only when stock is short, and arrive in one Monday delivery
    const longLived = list.lines.filter((l) => ings[l.ingredient_id].frequency === "monthly");
    assert(longLived.every((l) => l.long_lived && l.deliveries.length === 1 && l.deliveries[0].date === week), `久放品項：${JSON.stringify(longLived)}`);
    assert(list.lines.every((l) => l.by_day.length === 5 && l.by_day.every((d) => "confirmed" in d && "forecast" in d)), "每格分已確定與預測");
    const leg = list.lines.find((l) => l.ingredient_id === "chicken_leg");
    assert(leg && leg.order_units * leg.purchase_unit_size >= leg.need - leg.stock, "進料量依採購單位進位");
    await db.doc(`vendors/${VPU}/inventory/${addDays(week, -7)}`).set({ counted: true, counts: { chicken_leg: 999999 } });
    eq(expectOk(await OWNER.call("triggerPurchaseListNow", { vendor_id: VPU, week_start: week })).uncounted, false, "盤點後");
    const again = await get(`vendors/${VPU}/purchaseLists/weekly_${week}`);
    eq(again.lines.find((l) => l.ingredient_id === "chicken_leg").order_units, 0, "庫存夠就不叫");
    const weeklies = (await db.collection(`vendors/${VPU}/purchaseLists`).get()).docs.filter((d) => d.data().type === "weekly");
    eq(weeklies.length, 1, "同一週重跑只覆寫一張");
    eq((await get(`vendors/${VPU}`)).menu_locked_week, week, "下週主菜鎖定");
  });

  await test("V-PUR-04 V-PUR-06", "新店用自填預估；保存 ≤ 3 天的葉菜分批到貨、耐放的一次週一", async () => {
    const VPN = vid("purnew");
    await mkVendor(VPN);
    const ids = await cloneCatalog("cafe-renheya-demo", VPN);
    await db.doc(`vendors/${VPN}`).update({ forecast_daily: { [ids.healthy]: 5 } });
    const week = mondayOf(addDays(TODAY, 7));
    expectOk(await OWNER.call("triggerPurchaseListNow", { vendor_id: VPN, week_start: week }));
    const list = await get(`vendors/${VPN}/purchaseLists/weekly_${week}`);
    assert(list.board.every((d) => d.forecast === 5), JSON.stringify(list.board));
    const leaf = list.lines.find((l) => l.ingredient_id === "sweet_potato_leaf");
    assert(leaf && leaf.deliveries.length >= 2, `地瓜葉應分批：${JSON.stringify(leaf?.deliveries)}`);
    const breast = list.lines.find((l) => l.ingredient_id === "chicken_breast");
    assert(breast && breast.deliveries.length === 1 && breast.deliveries[0].date === week, `雞胸一次週一：${JSON.stringify(breast?.deliveries)}`);
  });

  // ════ 6. Cut-off schedule ════
  await test("F-19", "lockOrders 排程：截單時間已過的店各自產生備料（20:00 與 18:00 兩家）", async () => {
    const tomorrow = addDays(TODAY, 1);
    if (!CFG.businessWeekdays.includes(weekdayOf(tomorrow))) throw new Error("SKIP：明天不是營業日");
    if (nowMinutes < 20 * 60) throw new Error("SKIP：要 20:00 後才能兩家都截單");
    const V20 = await mkVendor(vid("cut20"));
    const V18 = await mkVendor(vid("cut18"), { cutoff_time: "18:00" });
    for (const v of [V20, V18]) { await mkBento(v); await lock(`zz2-cut-${RUN}`, v, { pickup_date: tomorrow }); }
    await runSchedule("orders.js", "lockOrders");
    for (const v of [V20, V18]) eq((await get(`vendors/${v}/prepPlans/${tomorrow}`))?.order_count, 1, v);
  });

  // ════ 1b. Payouts ════
  await test("F-01 A-PAY-01", "手動結算：已取餐＋愛心餐＋轉讓取餐＋舊制未取餐＋取消換券留下的款項計入，還沒取餐、已退款的不算；扣 5% 抽成；重按不重複結算", async () => {
    const VS3 = await mkVendor(vid("pay"));
    await lock(`zz2-pa-${RUN}`, VS3, { status: "fulfilled", locked_price: 80 });
    await lock(`zz2-pb-${RUN}`, VS3, { status: "charity", locked_price: 100 });
    await lock(`zz2-pc-${RUN}`, VS3, { status: "resold_and_fulfilled", locked_price: 50 });
    await lock(`zz2-pd-${RUN}`, VS3, { status: "locked", locked_price: 70 });
    await lock(`zz2-pe-${RUN}`, VS3, { status: "cancelled", cancel_reason: "customer", locked_price: 60, kept_amount: 60, refunded_amount: 0 }); // cancelled for a coupon: the money stays with the vendor
    await lock(`zz2-pf-${RUN}`, VS3, { status: "cancelled", cancel_reason: "disaster", locked_price: 90, refunded_amount: 90 }); // work-suspension full refund: not paid out
    await lock(`zz2-pg-${RUN}`, VS3, { status: "no_show", locked_price: 40 }); // legacy no-show: prepayment not refunded, paid out as usual (2026-10-09)
    const r = expectOk(await OWNER.call("triggerSettlementNow", { vendor_id: VS3 }));
    const p = await get(`payouts/${r.payout_id}`);
    // Commission is rounded per meal: 80→4, 100→5, 50→3, 60→3, 40→2
    eq([p.gross_amount, p.commission_amount, p.amount, p.lock_count], [330, 17, 313, 5]);
    eq(expectOk(await OWNER.call("triggerSettlementNow", { vendor_id: VS3 })).payout_id, null, "重按");
  });

  // ════ 3.5/3.6 Ordering and meal plans ════
  await test("C-ORD-08", "份數 1、數量 2 → 提示只剩 1 份", async () => {
    const U = await freshUser("q2");
    await db.doc(`vendors/${VO}`).update({ slot_capacity: 1 });
    try {
      const r = expectCode(await U.call("createCartLinePayReservation", { lines: [line({ quantity: 2 })] }), "resource-exhausted");
      assert(/只剩 1 份/.test(r.message), r.message);
    } finally { await db.doc(`vendors/${VO}`).update({ slot_capacity: 0 }); }
  });

  await test("C-ORD-13", "同時段已有訂單再訂一筆 → 不擋", async () => {
    const U = await freshUser("dup");
    for (let i = 0; i < 2; i++) {
      const r = expectOk(await U.call("createCartLinePayReservation", { lines: [line({ coupon_id: await coupon(U.uid, VO, 1000) })] }));
      expectOk(await U.call("confirmLinePayPayment", { order_id: r.order_id }), `第 ${i + 1} 筆`);
    }
  });

  await test("C-ORD-04", "備註寫入 locks.note，店家核對時看得到", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const U = await freshUser("note");
    const r = expectOk(await U.call("createCartLinePayReservation", { lines: [line({ note: "  不要辣  ", coupon_id: await coupon(U.uid, VO, 1000) })] }));
    const id = expectOk(await U.call("confirmLinePayPayment", { order_id: r.order_id })).lock_ids[0];
    eq((await get(`locks/${id}`)).note, "不要辣");
    await db.doc(`locks/${id}`).update({ pickup_date: TODAY });
    eq(expectOk(await OWNER.call("completePickup", { vendor_id: VO, lock_id: id, preview: true })).note, "不要辣");
  });

  await test("C-ORD-11", "LINE Pay Confirm 失敗 → 份數與折價券退回、意圖回 pending、不產生 locks", async () => {
    const U = await freshUser("cf");
    const c = await coupon(U.uid, VO, 10);
    // An amount > 0 has to go through LINE Pay (the emulator has no keys), so write a payment intent directly to simulate "redirected to payment"
    const intent = db.collection("payment_intents").doc(uniq("zzpi"));
    const draft = { vendor_id: VO, menu_item_id: `${VO}-bento`, item_name: "測試雞腿便當", pickup_date: OPEN_DAY, pickup_window: WINDOW, slots: [], rice: "normal", list_price: 100, locked_price: 70, coupon_id: c, coupon_discount: 10 };
    await intent.set({ status: "pending", buyer_uid: U.uid, transaction_id: "tx-fake", amount: 70, lock_drafts: [draft], created_at: Timestamp.now() });
    const before = (await get(counterId(VO, OPEN_DAY, WINDOW)))?.count || 0;
    expectCode(await U.call("confirmLinePayPayment", { order_id: intent.id }), "internal");
    eq((await get(counterId(VO, OPEN_DAY, WINDOW)))?.count || 0, before, "份數退回");
    eq((await get(`coupons/${c}`)).status, "owned", "券退回");
    eq((await intent.get()).data().status, "pending");
    eq((await db.collection("locks").where("payment_intent_id", "==", intent.id).get()).size, 0, "不產生 locks");
  });

  {
    const VPL = await mkVendor(vid("plan"));
    await mkBento(VPL);
    const plan = async (extra = {}) => {
      const ref = db.collection("meal_plans").doc(uniq("zzmp"));
      await ref.set({ vendor_id: VPL, name: "測試週餐", label: "週方案", days: 3, price_per_meal: 90, menu_item_id: `${VPL}-bento`, ...extra });
      return ref.id;
    };
    const U = await freshUser("plan");
    const join = (planId, extra = {}) => U.call("createPlanLinePayReservation", { plan_id: planId, start_date: OPEN_DAY, pickup_window: WINDOW, ...extra });

    await test("C-PLN-03", "其中一天額滿 → 被擋並說明是哪一天", async () => {
      const second = nextBusinessDay(OPEN_DAY);
      await db.doc(`vendors/${VPL}`).update({ slot_capacity: 1 });
      await db.doc(counterId(VPL, second, WINDOW)).set({ count: 1 });
      try {
        const r = expectCode(await join(await plan()), "resource-exhausted");
        assert(r.message.includes(second), r.message);
      } finally { await db.doc(`vendors/${VPL}`).update({ slot_capacity: 0 }); }
    });

    await test("C-PLN-04", "30 天內排不滿 N 個營業日 → 被擋並提示", async () => {
      const r = expectCode(await join(await plan({ days: 30 })), "invalid-argument"); // at most 22 business days within 30 days
      assert(/湊不滿/.test(r.message), r.message);
    });

    await test("C-BAN-03", "加入計畫：被封鎖的帳號拿到同一句白話提示", async () => {
      await db.doc(`users/${U.uid}`).set({ orderBanned: true }, { merge: true });
      try {
        const r = expectCode(await join(await plan()), "permission-denied");
        assert(/解封申訴/.test(r.message), r.message);
      } finally { await db.doc(`users/${U.uid}`).set({ orderBanned: false }, { merge: true }); }
    });
  }

  // Meal plan pricing and restrictions (paid entirely with points, so it doesn't go through LINE Pay)
  {
    const VP = await mkVendor(vid("plan2"), { pickup_windows: ["07:30-08:00", "11:00-11:30", "11:30-12:00"] });
    await mkBento(VP, { meal_periods: ["lunch"] });
    const plan = async (extra = {}) => {
      const ref = db.collection("meal_plans").doc(uniq("zzmp"));
      await ref.set({ vendor_id: VP, name: "測試週餐", label: "週方案", days: 3, price_per_meal: 100, menu_item_id: `${VP}-bento`, ...extra });
      return ref.id;
    };
    const U = await freshUser("plan2");
    const givePoints = async (n) => {
      await db.collection(`wallets/${U.uid}/lots`).add({ source_tx: null, amount: n, remaining: n, reason: "test", created_at: Timestamp.now() });
      await db.doc(`wallets/${U.uid}`).set({ balance: FieldValue.increment(n) }, { merge: true });
    };
    let planLocks = [];

    await test("C-PRC-09", "計畫 price_per_meal=100、第一天明天：每天各自疊早鳥（明天 95、其餘 80），每筆寫 discount_percent／early_bird_amount", async () => {
      const tomorrow = addDays(TODAY, 1);
      if (OPEN_DAY !== tomorrow) throw new Error(`SKIP：明天 ${tomorrow} 不能訂（OPEN_DAY=${OPEN_DAY}）`);
      await givePoints(300);
      const r = expectOk(await U.call("createPlanLinePayReservation", { plan_id: await plan(), start_date: tomorrow, pickup_window: "11:00-11:30", use_points: true }));
      eq([r.free, r.points_used], [true, 255], "95＋80＋80 全用點數");
      planLocks = expectOk(await U.call("confirmLinePayPayment", { order_id: r.order_id })).lock_ids;
      const locks = (await Promise.all(planLocks.map((id) => get(`locks/${id}`)))).sort((a, b) => a.plan_day - b.plan_day);
      eq(locks.map((l) => [l.list_price, l.discount_percent, l.early_bird_amount, l.locked_price]), [[100, 5, 5, 95], [100, 20, 20, 80], [100, 20, 20, 80]]);
      eq(locks[0].pickup_date, tomorrow);
      assert(new Set(locks.map((l) => l.plan_id)).size === 1, "同一個 plan_id");
    });

    await test("C-PRC-14", "20 天後的計畫：仍是 8 折（80），不是 7 折", async () => {
      let d = addDays(TODAY, 20);
      while (!CFG.businessWeekdays.includes(weekdayOf(d))) d = addDays(d, 1);
      const p = expectOk(await U.call("createPlanLinePayReservation", { plan_id: await plan({ days: 1 }), start_date: d, pickup_window: "11:00-11:30", preview: true }));
      eq(p.days.map((x) => [x.date, x.discount_percent, x.price]), [[d, 20, 80]]);
    });

    await test("C-PLN-07", "計畫中的一天：截單前改同一天另一個時段成功；改配菜被擋", async () => {
      if (!planLocks.length) throw new Error("SKIP：C-PRC-09 沒有建立計畫訂單");
      const first = (await Promise.all(planLocks.map(async (id) => ({ id, ...(await get(`locks/${id}`)) })))).find((l) => l.plan_day === 1);
      expectOk(await U.call("updateLockChoices", { lock_id: first.id, pickup_window: "11:30-12:00" }), "改時段");
      eq((await get(`locks/${first.id}`)).pickup_window, "11:30-12:00");
      const r = expectCode(await U.call("updateLockChoices", { lock_id: first.id, slots: [{ choice: "default" }, { choice: "default" }] }), "failed-precondition");
      assert(/只能改取餐時段/.test(r.message), r.message);
      eq((await get(`locks/${first.id}`)).locked_price, 95, "價格不變");
    });

    await test("C-PLN-08", "計畫綁的品項只供應午餐，開始時段選早餐 → 擋「沒有供應早餐」", async () => {
      const r = expectCode(await U.call("createPlanLinePayReservation", { plan_id: await plan(), start_date: OPEN_DAY, pickup_window: "07:30-08:00", preview: true }), "invalid-argument");
      assert(/沒有供應早餐/.test(r.message), r.message);
    });

    await test("W-06", "用點數下單不付款超過 40 分 → releaseStalePointHolds 還點數、意圖 expired、之後不能確認", async () => {
      await givePoints(100);
      const before = (await get(`wallets/${U.uid}`)).balance;
      const r = expectOk(await U.call("createPlanLinePayReservation", { plan_id: await plan({ days: 1 }), start_date: OPEN_DAY, pickup_window: "11:00-11:30", use_points: true }));
      assert(r.points_used > 0, "有扣點數");
      eq((await get(`wallets/${U.uid}`)).balance, before - r.points_used, "扣住");
      const hold = db.doc(`wallets/${U.uid}/holds/${r.order_id}`);
      await hold.update({ created_at: Timestamp.fromMillis(Date.now() - 39 * 60000) });
      await runSchedule("wallet.js", "releaseStalePointHolds");
      eq((await hold.get()).data().status, "held", "39 分還不還");
      await hold.update({ created_at: Timestamp.fromMillis(Date.now() - 41 * 60000) });
      await runSchedule("wallet.js", "releaseStalePointHolds");
      eq((await hold.get()).data().status, "expired");
      eq((await get(`wallets/${U.uid}`)).balance, before, "點數還回去");
      eq((await get(`payment_intents/${r.order_id}`)).status, "expired");
      expectCode(await U.call("confirmLinePayPayment", { order_id: r.order_id }), "failed-precondition", "逾時後確認");
      eq((await db.collection("locks").where("payment_intent_id", "==", r.order_id).get()).size, 0, "不產生 locks");
    });
  }

  await test("C-CHR-20", "有加菜的訂單轉愛心餐：charityMeals.sides 含加菜（遞補後的菜），沒用到的備案不列", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const VA = await mkVendor(vid("addon"), { pickup_windows: ["07:30-08:00"], owner_uid: `zz2-owner-addon-${RUN}` });
    await mkBento(VA);
    const l = await lock(`zz2-addon-${RUN}`, VA, {
      pickup_date: TODAY, pickup_window: "07:30-08:00",
      slots: [
        { category: "青菜類", default_dish: "高麗菜", removed: false, wished: "地瓜葉", backup: "空心菜", backup_used: false, resolved: "地瓜葉", portion_level: 1 },
        { category: "蛋豆類", default_dish: "滷蛋", removed: true, wished: null, resolved: null, portion_level: 1 },
      ],
      extra_side: { mode: "addon", dish: "玉米筍", resolved: "花椰菜", price: 15 },
    });
    const realNow = Date.now;
    try {
      Date.now = () => Date.parse(`${TODAY}T09:00:00+08:00`);
      await runSchedule("charity.js", "convertToCharity");
    } finally { Date.now = realNow; }
    const after = await get(`locks/${l.id}`);
    eq(after.status, "charity");
    eq((await get(`charityMeals/${after.charity_meal_id}`)).sides, ["地瓜葉", "花椰菜"], "加菜用遞補後的、拿掉的格子和沒用到的備案不列");
  });

  // ════ 6. English error messages, AI failures, platform settings ════
  await test("F-08", "lang=en：公休、額滿、封鎖、截單的錯誤訊息是英文", async () => {
    const U = await freshUser("en");
    const en = (lines) => U.call("createCartLinePayReservation", { lines, lang: "en" });
    await db.doc(`vendors/${VO}`).update({ holidays: [OPEN_DAY] });
    try {
      const r = await en([line()]);
      assert(!r.ok && !CJK.test(r.message.replace(/測試店[^ ]*/g, "")), `公休：${r.message}`);
    } finally { await db.doc(`vendors/${VO}`).update({ holidays: [] }); }
    await db.doc(`vendors/${VO}`).update({ slot_capacity: 1 });
    try {
      const r = await en([line({ quantity: 2 })]);
      assert(!r.ok && !CJK.test(r.message.replace(/測試店[^ ]*/g, "")), `額滿：${r.message}`);
    } finally { await db.doc(`vendors/${VO}`).update({ slot_capacity: 0 }); }
    const past = await en([line({ pickup_date: TODAY_IS_BUSINESS ? TODAY : prevBusinessDays(1)[0] })]);
    assert(!past.ok && !CJK.test(past.message), `截單：${past.message}`);
    await db.doc(`users/${U.uid}`).set({ orderBanned: true }, { merge: true });
    try {
      const r = await en([line()]);
      assert(!r.ok && r.code === "permission-denied" && !CJK.test(r.message), `封鎖：${r.message}`);
    } finally { await db.doc(`users/${U.uid}`).set({ orderBanned: false }, { merge: true }); }
  });

  await test("F-14 F-22", "Gemini 失效（emulator 沒設金鑰）：助理、拍照上架回白話錯誤；下單、截單、結算照常", async () => {
    const U = await freshUser("ai");
    const a = expectCode(await U.call("askShoppingAssistant", { messages: [{ role: "user", text: `明天中午便當 ${RUN}` }] }), "unavailable");
    assert(/忙不過來/.test(a.message), a.message);
    eq((await get(`users/${U.uid}`))?.assistant_usage?.count ?? 0, 0, "失敗不扣助理次數");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const m = expectCode(await OWNER.call("extractMenuFromImage", { vendor_id: VO, image_base64: png, mime_type: "image/png" }), "unavailable");
    assert(/AI 暫時無法辨識/.test(m.message), m.message);
    // The other flows already ran end to end in the emulator without Gemini (ordering, cut-off, settlement, draws and supplier orders all PASS)
  });

  await test("A-CFG-01 A-CFG-02", "平台參數改截單時間 → 伺服器照新值；刪掉欄位 → 用預設值", async () => {
    const tomorrow = addDays(TODAY, 1);
    if (!CFG.businessWeekdays.includes(weekdayOf(tomorrow))) throw new Error("SKIP：明天不是營業日");
    const ref = db.doc("platformConfig/global");
    const original = (await ref.get()).data();
    const U = await freshUser("cfg");
    const pastDefault = nowMinutes >= 20 * 60;
    const flip = pastDefault ? "23:59" : "00:01"; // makes the result for "tomorrow" the opposite of the default 20:00
    try {
      await ref.set({ cutoffTime: flip }, { merge: true });
      const r = await U.call("createCartLinePayReservation", { lines: [line({ pickup_date: tomorrow, coupon_id: await coupon(U.uid, VO, 1000) })] });
      eq(r.ok, pastDefault, `截單改 ${flip} 後明天能不能訂`);
      await ref.update({ bookingRangeDays: FieldValue.delete(), cutoffTime: FieldValue.delete() });
      const cfg = await loadPlatformConfig(db);
      eq([cfg.bookingRangeDays, cfg.cutoffTime], [30, "20:00"], "缺欄位用預設");
    } finally { await ref.set(original); }
  });

  // ════ v4 (1002 spec): mains, fourth dish, changing slot, charity meals by meal period, maintenance fee, minimum wage, revenue dashboard ════
  {
    const VB = await mkVendor(vid("v4bento"), { pickup_windows: ["07:30-08:00", "11:00-11:30", "12:00-12:30"] });
    const BENTO = await mkBento(VB, {
      meal_periods: ["lunch"],
      slots: [
        { category: "青菜類", default: { name: "高麗菜" }, candidates: [
          { name: "地瓜葉", portion_level: 1, weekly_cap: 1000, min_qty: 10 },
          { name: "筊白筍", portion_level: 0.5, weekly_cap: 1000, min_qty: 1 },
        ] },
        { category: "蛋豆類", default: { name: "滷蛋" } },
      ],
    });
    const U = await freshUser("v4");
    const vline = (extra = {}) => ({ menu_item_id: BENTO, pickup_date: OPEN_DAY, pickup_window: "11:00-11:30", quantity: 1, rice: "normal", slots: [{ choice: "default" }, { choice: "default" }], ...extra });
    /** Places an order with a full-amount coupon (no LINE Pay); returns { draft, lockId } */
    const order = async (extra = {}) => {
      const r = expectOk(await U.call("createCartLinePayReservation", { lines: [vline({ coupon_id: await coupon(U.uid, VB, 1000), ...extra })] }));
      const draft = (await get(`payment_intents/${r.order_id}`)).lock_drafts[0];
      const lockId = expectOk(await U.call("confirmLinePayPayment", { order_id: r.order_id })).lock_ids[0];
      return { draft, lockId };
    };

    await test("C-BNT-14", "第四道「備案」：不加價、extra_side.mode=backup", async () => {
      const { draft, lockId } = await order({ extra_side: { slot: 0, candidate: 1, mode: "backup" } });
      eq([draft.adjust_amount, draft.extra_side.mode, draft.extra_side.dish], [0, "backup", "筊白筍"]);
      eq((await get(`locks/${lockId}`)).extra_side.mode, "backup");
    });

    await test("C-BNT-15", "第四道「加菜」：+10、extra_side.mode=addon", async () => {
      const { draft, lockId } = await order({ extra_side: { slot: 0, candidate: 1, mode: "addon" } });
      eq([draft.adjust_amount, draft.extra_side.mode], [10, "addon"]);
      eq((await get(`locks/${lockId}`)).extra_side.mode, "addon");
    });

    await test("C-MY-24 C-MY-25", "截單前改取餐時段：份數搬到新時段、meal_period 更新；額滿、沒供應的餐期被擋", async () => {
      const { lockId } = await order();
      const from = "11:00-11:30";
      const to = "12:00-12:30";
      const fromBefore = (await get(counterId(VB, OPEN_DAY, from))).count;
      const toBefore = (await get(counterId(VB, OPEN_DAY, to)))?.count || 0;
      const before = (await get(`locks/${lockId}`)).locked_price;
      const r = expectOk(await U.call("updateLockChoices", { lock_id: lockId, pickup_window: to }));
      eq(r.refunded, 0);
      const l = await get(`locks/${lockId}`);
      eq([l.pickup_window, l.meal_period, l.locked_price], [to, "lunch", before]);
      eq([(await get(counterId(VB, OPEN_DAY, from))).count, (await get(counterId(VB, OPEN_DAY, to))).count], [fromBefore - 1, toBefore + 1], "份數搬家");
      const bf = expectCode(await U.call("updateLockChoices", { lock_id: lockId, pickup_window: "07:30-08:00" }), "invalid-argument");
      assert(/沒有供應早餐/.test(bf.message), bf.message);
      await db.doc(`vendors/${VB}`).update({ slot_capacity: 1 });
      await db.doc(counterId(VB, OPEN_DAY, from)).set({ count: 1 }, { merge: true });
      try {
        expectCode(await U.call("updateLockChoices", { lock_id: lockId, pickup_window: from }), "resource-exhausted");
        eq([(await get(counterId(VB, OPEN_DAY, from))).count, (await get(counterId(VB, OPEN_DAY, to))).count], [1, toBefore + 1], "額滿不動份數");
        eq((await get(`locks/${lockId}`)).pickup_window, to);
      } finally { await db.doc(`vendors/${VB}`).update({ slot_capacity: 0 }); }
    });

    await test("C-BNT-19", "備案遞補：許願未成立 → 那格換成備案、backup_used、used_for_slot、推播寫「換成備案」", async () => {
      // Sweet potato leaves need 10 portions to go ahead (this is the only one); the backup, water bamboo, goes ahead at 1
      const { lockId } = await order({ slots: [{ choice: 0 }, { choice: "default" }], extra_side: { slot: 0, candidate: 1, mode: "backup" } });
      expectOk(await OWNER.call("triggerLockOrdersNow", { vendor_id: VB, date: OPEN_DAY, force: true }));
      const l = await get(`locks/${lockId}`);
      eq([l.slots[0].resolved, l.slots[0].backup_used], ["筊白筍", true], "第一格遞補");
      eq([l.extra_side.used_for_slot, l.extra_side.resolved], [0, "筊白筍"]);
      const n = await notes(U.uid, { kind: "wish" });
      assert(n.some((x) => /已幫你換成備案「筊白筍」/.test(x.body)), JSON.stringify(n.map((x) => x.body)));
    });
  }

  // ════ Other cut-off scenarios for backups/add-ons (C-BNT-20 to 23): a separate vendor, one member per case, so notifications don't interfere ════
  {
    const VW = await mkVendor(vid("backup"), { pickup_windows: ["11:00-11:30"] });
    // Candidates marked "hard" need 10 portions to go ahead (each case has one or two at most, so they never do); those marked "easy" go ahead at 1
    const ITEM = await mkBento(VW, {
      slots: [
        { category: "青菜類", default: { name: "高麗菜", component_id: "zzb-cabbage" }, candidates: [
          { name: "地瓜葉", component_id: "zzb-yam", portion_level: 1, weekly_cap: 1000, min_qty: 10 }, // hard
          { name: "筊白筍", component_id: "zzb-bamboo", portion_level: 1, weekly_cap: 1000, min_qty: 1 }, // easy
        ] },
        { category: "蛋豆類", default: { name: "滷蛋", component_id: "zzb-egg" }, candidates: [
          { name: "豆干", component_id: "zzb-tofu", portion_level: 1, weekly_cap: 1000, min_qty: 10 }, // hard
        ] },
      ],
    });
    const orderAs = async (U, extra) => {
      const r = expectOk(await U.call("createCartLinePayReservation", { lines: [{
        menu_item_id: ITEM, pickup_date: OPEN_DAY, pickup_window: "11:00-11:30", quantity: 1, rice: "normal",
        coupon_id: await coupon(U.uid, VW, 1000), ...extra,
      }] }));
      const draft = (await get(`payment_intents/${r.order_id}`)).lock_drafts[0];
      const lockId = expectOk(await U.call("confirmLinePayPayment", { order_id: r.order_id })).lock_ids[0];
      return { draft, lockId };
    };
    const cutoff = async () => expectOk(await OWNER.call("triggerLockOrdersNow", { vendor_id: VW, date: OPEN_DAY, force: true }), "截單");
    const wishBodies = async (uid) => (await notes(uid, { kind: "wish" })).map((x) => x.body);

    // Place all orders first, then run cut-off once: cut-off re-evaluates every order for the same vendor and day. If setup fails, each of the four cases records FAIL without stopping the whole test
    const setup = (async () => {
      const [U20, U21, U22, U23] = [await freshUser("bnt20"), await freshUser("bnt21"), await freshUser("bnt22"), await freshUser("bnt23")];
      const o20 = await orderAs(U20, { slots: [{ choice: 1 }, { choice: "default" }], extra_side: { slot: 0, candidate: null, mode: "backup" } });
      const o21 = await orderAs(U21, { slots: [{ choice: 0 }, { choice: 0 }], extra_side: { slot: 0, candidate: 1, mode: "backup" } });
      const o22 = await orderAs(U22, { slots: [{ choice: "default" }, { choice: 0 }], extra_side: { slot: 0, candidate: 0, mode: "backup" } });
      const o23 = await orderAs(U23, { slots: [{ choice: "default" }, { choice: "default" }], extra_side: { slot: 0, candidate: 0, mode: "addon" } });
      await cutoff();
      const plan = await get(`vendors/${VW}/prepPlans/${OPEN_DAY}`);
      const portionsOf = (id) => plan.components.find((c) => c.component_id === id)?.portions || 0;
      return { U20, U21, U22, U23, o20, o21, o22, o23, portionsOf };
    })();
    setup.catch(() => {});

    await test("C-BNT-20", "備案沒用到：許願成立 → extra_side.resolved=null、used_for_slot=null、不備料、不退錢", async () => {
      const { U20, o20 } = await setup;
      eq(o20.draft.adjust_amount, 0, "備案不加價");
      const l = await get(`locks/${o20.lockId}`);
      eq([l.slots[0].resolved, !!l.slots[0].backup_used], ["筊白筍", false], "許願成立");
      eq([l.extra_side.resolved, l.extra_side.used_for_slot], [null, null], "備案沒放進便當");
      eq(await wishBodies(U20.uid), [], "沒有許願未成立通知");
      eq(l.locked_price, o20.draft.locked_price, "金額不變（不退錢）");    });

    await test("C-BNT-21", "兩格都沒成立、一個備案：只有第一格遞補備案，第二格換回預設；通知兩件事都寫", async () => {
      const { U21, o21 } = await setup;
      const l = await get(`locks/${o21.lockId}`);
      eq([l.slots[0].resolved, l.slots[0].backup_used], ["筊白筍", true], "第一格遞補備案");
      eq([l.slots[1].resolved, !!l.slots[1].backup_used], ["滷蛋", false], "第二格換回預設");
      eq([l.extra_side.used_for_slot, l.extra_side.resolved], [0, "筊白筍"]);
      const b = (await wishBodies(U21.uid)).join("\n");
      assert(/「地瓜葉」.*已幫你換成備案「筊白筍」/.test(b) && /「豆干」.*已幫你換回「滷蛋」/.test(b), b);
    });

    await test("C-BNT-22", "備案本身是候選菜也沒成立：不遞補，未成立的格子換回預設菜", async () => {
      const { U22, o22 } = await setup;
      const l = await get(`locks/${o22.lockId}`);
      eq([l.slots[1].resolved, !!l.slots[1].backup_used], ["滷蛋", false], "換回預設、沒用備案");
      eq([l.extra_side.used_for_slot, l.extra_side.resolved], [null, null], "備案沒用到");
      const b = (await wishBodies(U22.uid)).join("\n");
      assert(/「豆干」.*已幫你換回「滷蛋」/.test(b) && !/備案/.test(b), b);
    });

    await test("C-BNT-23", "加菜的候選菜沒成立：改放那一格預設菜、仍是第四道、不退 10 元；推播「加菜…未成立，已改為…」；備料算預設菜", async () => {
      const { U23, o23, portionsOf } = await setup;
      eq(o23.draft.adjust_amount, 10, "加菜 +10");
      const l = await get(`locks/${o23.lockId}`);
      eq([l.extra_side.mode, l.extra_side.resolved, l.extra_side.resolved_component_id], ["addon", "高麗菜", "zzb-cabbage"]);
      eq(l.locked_price, o23.draft.locked_price, "不退 10 元");
      const b = (await wishBodies(U23.uid)).join("\n");
      assert(/加菜「地瓜葉」未成立，已改為「高麗菜」/.test(b), b);
      // Prep: no sweet potato leaves at all (none went ahead); cabbage = default slots of o22 and o23 + o23's fourth dish = 3 portions (o20's backup cabbage wasn't used, so it doesn't count)
      eq(portionsOf("zzb-yam"), 0, "地瓜葉不備料");
      eq(portionsOf("zzb-cabbage"), 3, "高麗菜份數");
      eq(portionsOf("zzb-bamboo"), 2, "筊白筍＝o20 許願＋o21 備案");
    });
  }

  await test("C-CHR-16 C-CHR-19", "早、午兩個餐期各自轉愛心餐（時鐘模擬 09:00、12:30）；重跑不重複", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const owner = `zz2-owner-period-${RUN}`;
    const VC = await mkVendor(vid("period"), { pickup_windows: ["07:30-08:00", "11:00-11:30"], owner_uid: owner });
    await mkBento(VC);
    const X = `zz2-px-${RUN}`;
    const bf = await lock(X, VC, { pickup_date: TODAY, pickup_window: "07:30-08:00", locked_price: 80 });
    const lu = await lock(X, VC, { pickup_date: TODAY, pickup_window: "11:00-11:30", locked_price: 80 });
    // Schedules run in the local process; only within this block, Date.now is swapped for set times today in Taipei
    const realNow = Date.now;
    const at = (hhmm) => () => Date.parse(`${TODAY}T${hhmm}:00+08:00`);
    try {
      Date.now = at("09:00");
      await runSchedule("charity.js", "convertToCharity");
      eq([(await get(`locks/${bf.id}`)).status, (await get(`locks/${lu.id}`)).status], ["charity", "locked"], "09:00 只轉早餐");
      const plan = await get(`vendors/${VC}/prepPlans/${TODAY}`);
      eq([plan.charity_converted_breakfast, plan.charity_converted_lunch ?? null, plan.charity_noshow_count], [true, null, 1]);
      Date.now = at("12:30");
      await runSchedule("charity.js", "convertToCharity");
      await runSchedule("charity.js", "convertToCharity");
    } finally { Date.now = realNow; }
    eq((await get(`locks/${lu.id}`)).status, "charity", "12:30 轉午餐");
    const plan = await get(`vendors/${VC}/prepPlans/${TODAY}`);
    eq([plan.charity_converted_lunch, plan.charity_noshow_count], [true, 2], "重跑不重複計數");
    eq((await db.collection("charityMeals").where("vendor_id", "==", VC).get()).size, 2, "兩份愛心餐、不重複");
    const titles = (await notes(owner, { title: /未取餐已轉為愛心餐/ })).map((n) => n.title).sort();
    eq(titles, ["午餐 1 份未取餐已轉為愛心餐", "早餐 1 份未取餐已轉為愛心餐"]);
  });

  await test("V-FEE-02", "撥款扣平台抽成 5%：gross、commission（逐份四捨五入）、amount＝gross − commission；重跑不重複撥", async () => {
    const VC = await mkVendor(vid("commission"));
    const buyer = `zz2-cm-${RUN}`;
    for (const price of [80, 90, 110]) await lock(buyer, VC, { status: "fulfilled", locked_price: price, created_at: Timestamp.now() });
    await lock(buyer, VC, { status: "locked", locked_price: 500, created_at: Timestamp.now() }); // not picked up yet: not paid out
    const id = expectOk(await OWNER.call("triggerSettlementNow", { vendor_id: VC })).payout_id;
    const p = await get(`payouts/${id}`);
    eq([p.gross_amount, p.commission_amount, p.amount, p.commission_rate, p.lock_count], [280, 4 + 5 + 6, 265, CFG.commissionRate, 3]);
    eq(expectOk(await OWNER.call("triggerSettlementNow", { vendor_id: VC })).payout_id, null, "已撥過的不重複");
  });

  await test("V-WAGE-02", "updateVendorCosts：時薪、月薪低於基本工資被擋；高於可存", async () => {
    const VW2 = await mkVendor(vid("wage"));
    const wage = expectOk(await OWNER.call("updateVendorCosts", { vendor_id: VW2, fixed_costs: 0 })).minimum_wage;
    assert(wage.hourly > 0 && wage.monthly > 0, JSON.stringify(wage));
    const h = expectCode(await OWNER.call("updateVendorCosts", { vendor_id: VW2, hourly_wage: wage.hourly - 1 }), "invalid-argument");
    assert(h.message.includes(String(wage.hourly)), h.message);
    const m = expectCode(await OWNER.call("updateVendorCosts", { vendor_id: VW2, staff_salaries: [wage.monthly - 1] }), "invalid-argument");
    assert(m.message.includes(String(wage.monthly)), m.message);
    expectOk(await OWNER.call("updateVendorCosts", { vendor_id: VW2, hourly_wage: wage.hourly + 4, staff_salaries: [wage.monthly + 500] }));
    const v = await get(`vendors/${VW2}`);
    eq([v.hourly_wage, v.staff_salaries], [wage.hourly + 4, [wage.monthly + 500]]);
  });

  await test("V-REV-02", "本月收益看板：已確定營收與份數對得上、平台抽成 5%（沒有月費）、淨利＝營收 − 各項成本", async () => {
    const VRV = await mkVendor(vid("rev"), { fixed_costs: 3000, staff_salaries: [30000], hourly_wage: 200 });
    const ids = await cloneCatalog("cafe-renheya-demo", VRV);
    const item = ids.classic || Object.values(ids)[0];
    const month = TODAY.slice(0, 7);
    const past = prevBusinessDays(3).filter((d) => d.startsWith(month));
    const mk = (date, status, price) => lock(`zz2-rv-${RUN}`, VRV, { menu_item_id: item, pickup_date: date, pickup_window: "11:00-11:30", status, locked_price: price });
    let expRevenue = 0;
    let expQty = 0;
    for (const d of past) { await mk(d, "fulfilled", 90); expRevenue += 90; expQty++; }
    await mk(OPEN_DAY.startsWith(month) ? OPEN_DAY : TODAY, "locked", 80); expRevenue += 80; expQty++;
    await mk(past[0] || TODAY, "cancelled", 500); // cancelled ones don't count
    const r = expectOk(await OWNER.call("refreshRevenueForecast", { vendor_id: VRV, month }));
    eq([r.confirmed_revenue, r.confirmed_qty], [expRevenue, expQty], "已確定");
    eq([r.maintenance_fee, r.commission_rate, r.staff_salary, r.other_fixed_costs, r.hourly_wage], [undefined, CFG.commissionRate, 30000, 3000, 200]);
    assert(r.commission_fee >= Math.floor(expRevenue * CFG.commissionRate) - expQty && r.commission_fee > 0, `抽成 ${r.commission_fee}（已確定營收 ${expRevenue}）`);
    const net = r.revenue - r.material_cost - r.labor_cost - r.payment_fee - r.commission_fee - r.staff_salary - r.other_fixed_costs;
    assert(Math.abs(net - r.net_profit) <= 3, `淨利 ${r.net_profit} vs 手算 ${net}`);
    assert(r.material_cost > 0 && r.labor_cost > 0, `材料 ${r.material_cost}、人工 ${r.labor_cost}`);
    eq(r.by_meal_period.lunch.qty, expQty, "依餐期");
    eq((await get(`vendors/${VRV}/revenueForecast/${month}`)).net_profit, r.net_profit, "寫入 revenueForecast");
  });

  await test("V-REV-03", "人工用當天的基本工資：月中調漲前用舊時薪、之後用新時薪；店家自設較高時用店家的", async () => {
    // Use last month (fully past, no forecast portions): one identical order on the 5th and the 25th → same labor minutes on both days, so the ratio depends only on the hourly wage
    const ref = db.doc("platformConfig/minimumWage");
    const original = (await ref.get()).data() || null;
    const VW3 = await mkVendor(vid("rev3"));
    const ids = await cloneCatalog("cafe-renheya-demo", VW3);
    const item = ids.classic || Object.values(ids)[0];
    const month = addDays(`${TODAY.slice(0, 7)}-01`, -1).slice(0, 7);
    for (const d of ["05", "25"]) await lock(`zz2-rv3-${RUN}`, VW3, { menu_item_id: item, pickup_date: `${month}-${d}`, pickup_window: "11:00-11:30", status: "fulfilled", locked_price: 90 });
    const labor = async () => expectOk(await OWNER.call("refreshRevenueForecast", { vendor_id: VW3, month })).labor_cost;
    const flat = { monthly: 20000, hourly: 100, effectiveFrom: "2020-01-01" };
    try {
      await ref.set({ ...flat, history: [flat] });
      const base = await labor(); // 100 on both days
      assert(base > 0, `人工 ${base}`);
      await ref.set({ ...flat, history: [flat, { monthly: 80000, hourly: 400, effectiveFrom: `${month}-15` }] });
      const raised = await labor(); // 100 on the 5th, 400 on the 25th
      assert(Math.abs(raised / base - 2.5) < 0.02, `月中調漲：${raised} / ${base} 應為 2.5`);
      await db.doc(`vendors/${VW3}`).update({ hourly_wage: 300 });
      const own = await labor(); // vendor's 300 on the 5th, minimum wage 400 on the 25th
      assert(Math.abs(own / base - 3.5) < 0.02, `店家較高：${own} / ${base} 應為 3.5`);
    } finally { if (original) await ref.set(original); else await ref.delete(); }
  });

  await test("C-CHR-19", "舊旗標相容：prepPlans 只有 reminder_sent／charity_converted／charity_closed → 午餐不再處理，早餐照常", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const owner = `zz2-owner-legacy-${RUN}`;
    const VL = await mkVendor(vid("legacy"), { pickup_windows: ["07:30-08:00", "11:00-11:30"], owner_uid: owner });
    await mkBento(VL);
    await db.doc(`vendors/${VL}/prepPlans/${TODAY}`).set({ reminder_sent: true, charity_converted: true, charity_closed: true });
    const [XB, XL] = [`zz2-lgb-${RUN}`, `zz2-lgl-${RUN}`];
    const bf = await lock(XB, VL, { pickup_date: TODAY, pickup_window: "07:30-08:00" });
    const lu = await lock(XL, VL, { pickup_date: TODAY, pickup_window: "11:00-11:30" });
    const realNow = Date.now;
    const at = (hhmm) => () => Date.parse(`${TODAY}T${hhmm}:00+08:00`);
    try {
      Date.now = at("07:40"); // 20 min before breakfast ends
      await runSchedule("orders.js", "pickupReminder");
      Date.now = at("11:10"); // 20 min before lunch ends
      await runSchedule("orders.js", "pickupReminder");
      Date.now = at("12:30");
      await runSchedule("charity.js", "convertToCharity");
      Date.now = at("14:00"); // past both the breakfast close (10:00) and the lunch close (13:30)
      await runSchedule("charity.js", "closeCharity");
    } finally { Date.now = realNow; }
    eq([(await notes(XB, { title: /還沒取餐/ })).length, (await notes(XL, { title: /還沒取餐/ })).length], [1, 0], "取餐提醒：早餐有、午餐沿用舊旗標");
    eq([(await get(`locks/${bf.id}`)).status, (await get(`locks/${lu.id}`)).status], ["charity", "locked"], "轉愛心餐：早餐轉、午餐沿用舊旗標");
    const closed = (await notes(owner, { title: /愛心餐已截止/ })).map((n) => n.title);
    eq(closed, ["早餐愛心餐已截止"], "截止：只有早餐");
    const plan = await get(`vendors/${VL}/prepPlans/${TODAY}`);
    eq([plan.reminder_sent_breakfast, plan.charity_converted_breakfast, plan.charity_closed_breakfast], [true, true, true]);
    eq([plan.reminder_sent_lunch ?? null, plan.charity_converted_lunch ?? null, plan.charity_closed_lunch ?? null], [null, null, null]);
  });

  await test("V-ACC-06", "沒有月費：舊資料訂閱已過期的店照常接單（計畫、單點）、核銷、截單、取消換券", async () => {
    const VS = await mkVendor(vid("suspall"), { subscription_end_date: Timestamp.fromMillis(Date.now() - 8 * 86400000), billing: { status: "suspended" } });
    await mkBento(VS);
    const U = await freshUser("suspall");
    const planRef = db.collection("meal_plans").doc(uniq("zzmp"));
    await planRef.set({ vendor_id: VS, name: "測試週餐", label: "週方案", days: 3, price_per_meal: 90, menu_item_id: `${VS}-bento` });
    const p = expectOk(await U.call("createPlanLinePayReservation", { plan_id: planRef.id, start_date: OPEN_DAY, pickup_window: WINDOW, preview: true }), "計畫");
    eq(p.days.length, 3, "不再因訂閱到期擋下單");
    const later = await lock(U.uid, VS, { pickup_date: OPEN_DAY });
    const r = expectOk(await OWNER.call("triggerLockOrdersNow", { vendor_id: VS, date: OPEN_DAY, force: true }), "截單");
    assert(!r.skipped && (await get(`vendors/${VS}/prepPlans/${OPEN_DAY}`))?.locked_at, "產生備料");
    expectOk(await U.call("cancelLock", { lock_id: (await lock(U.uid, VS, { pickup_date: CANCEL_DAY })).id }), "48 小時前取消");
    if (TODAY_IS_BUSINESS) {
      const today = await lock(U.uid, VS, { pickup_date: TODAY });
      expectOk(await OWNER.call("completePickup", { vendor_id: VS, lock_id: today.id }), "核銷");
      eq((await get(`locks/${today.id}`)).status, "fulfilled");
    }
    eq((await get(`locks/${later.id}`)).cutoff_done, true, "截單判定");
  });

  // ════ v4 extra tests: build-a-bento edge cases, meal-period settings, close by meal period, maintenance fee restore, minimum wage, platform settings, favorites ════
  {
    const VX = await mkVendor(vid("v4more"), { pickup_windows: ["10:30-11:00", "11:00-11:30"] });
    const MAINS = await mkBento(VX, {
      mains: [{ name: "滷雞腿", price: 110 }, { name: "烤雞胸", price: 100 }],
      slots: [
        { category: "青菜類", default: { name: "高麗菜" }, candidates: [{ name: "地瓜葉", portion_level: 1, weekly_cap: 1, min_qty: 10 }] },
        { category: "蛋豆類", default: { name: "滷蛋" } },
      ],
    });
    const FOUR = `${VX}-four`;
    await db.doc(`menu_items/${FOUR}`).set({
      vendor_id: VX, name: "四格便當", price: 120, category: "便當", available: true, main: { name: "排骨" },
      slots: ["青菜類", "蛋豆類", "根莖類", "其他"].map((category, i) => ({ category, default: { name: `預設${i}` } })),
    });
    const SINGLE = `${VX}-single`;
    await db.doc(`menu_items/${SINGLE}`).set({ vendor_id: VX, name: "美式咖啡", price: 60, category: "飲料", available: true });
    const U = await freshUser("v4more");
    const xline = (extra = {}) => ({ menu_item_id: MAINS, pickup_date: OPEN_DAY, pickup_window: "11:00-11:30", quantity: 1, rice: "normal", slots: [{ choice: "default" }, { choice: "default" }], ...extra });
    const reserve = async (extra = {}) => U.call("createCartLinePayReservation", { lines: [xline({ coupon_id: await coupon(U.uid, VX, 1000), ...extra })] });
    const draftOf = async (r) => (await get(`payment_intents/${expectOk(r).order_id}`)).lock_drafts[0];

    await test("C-BNT-13", "主菜不存在 → invalid-argument；沒送 main_index → 用第一道", async () => {
      const bad = expectCode(await reserve({ main_index: 5 }), "invalid-argument");
      assert(/選的主菜不存在/.test(bad.message), bad.message);
      const d = await draftOf(await reserve());
      eq([d.main_dish, d.main_index, d.list_price], ["滷雞腿", 0, 110]);
      const d2 = await draftOf(await reserve({ main_index: 1 }));
      eq([d2.main_dish, d2.list_price], ["烤雞胸", 100]);
    });

    await test("C-BNT-17", "第四道選已經在便當裡的菜 → 被擋", async () => {
      const r = expectCode(await reserve({ extra_side: { slot: 1, candidate: null, mode: "addon" } }), "invalid-argument");
      assert(/已經在便當裡/.test(r.message), r.message);
    });

    await test("C-BNT-18", "配菜上限：4 格的品項不能再加；mode 不合法；單品不能加配菜", async () => {
      const four = expectCode(await reserve({ menu_item_id: FOUR, slots: [0, 1, 2, 3].map(() => ({ choice: "default" })), extra_side: { slot: 0, candidate: null, mode: "addon" } }), "invalid-argument");
      assert(/配菜最多 4 道/.test(four.message), four.message);
      const mode = expectCode(await reserve({ extra_side: { slot: 0, candidate: 0, mode: "other" } }), "invalid-argument");
      assert(/只能選「備案」或「加菜」/.test(mode.message), mode.message);
      const single = expectCode(await reserve({ menu_item_id: SINGLE, slots: [], extra_side: { slot: 0, candidate: null, mode: "addon" } }), "invalid-argument");
      assert(/不能加配菜/.test(single.message), single.message);
    });

    await test("C-BNT-24", "第四道選候選菜也算許願：sideWishes +1、取消 −1；weekly_cap 滿了也擋第四道", async () => {
      // Use a date that can still be cancelled (cancellation closes 48 hours before pickup)
      const wid = `sideWishes/${VX}_${CANCEL_DAY}_${MAINS}_0_0`;
      const before = (await get(wid))?.count || 0;
      const r = expectOk(await reserve({ pickup_date: CANCEL_DAY, extra_side: { slot: 0, candidate: 0, mode: "backup" } }));
      const lockId = expectOk(await U.call("confirmLinePayPayment", { order_id: r.order_id })).lock_ids[0];
      eq((await get(wid)).count, before + 1, "下單 +1");
      const full = expectCode(await reserve({ pickup_date: CANCEL_DAY, extra_side: { slot: 0, candidate: 0, mode: "addon" } }), "resource-exhausted", "weekly_cap=1 已滿");
      assert(/本週已滿/.test(full.message), full.message);
      expectOk(await U.call("cancelLock", { lock_id: lockId }));
      eq((await get(wid)).count, before, "取消 −1");
    });

    await test("C-BNT-25", "舊資料相容：只有 main＋price 的便當照 price 計價；沒有 extra_side 的舊 lock 截單、核對不報錯", async () => {
      // Legacy format: only main + price, no mains or meal_periods
      const OLD = `${VX}-old`;
      const { mains: _mains, ...base } = await get(`menu_items/${MAINS}`);
      await db.doc(`menu_items/${OLD}`).set({ ...base, main: { name: "滷雞腿" }, price: 100 });
      const d = await draftOf(await reserve({ menu_item_id: OLD }));
      eq([d.list_price, d.main_dish, d.extra_side], [100, "滷雞腿", null]);
      const legacy = await lock(U.uid, VX, { menu_item_id: OLD });
      expectOk(await OWNER.call("triggerLockOrdersNow", { vendor_id: VX, date: OPEN_DAY, force: true }), "截單");
      eq((await get(`locks/${legacy.id}`)).cutoff_done, true);
    });

    await test("C-MEAL-06", "平台改餐期範圍：午餐改 11:00-14:00 → 10:30 時段改歸早餐，只供應午餐的品項被擋", async () => {
      const ref = db.doc("platformConfig/global");
      const original = (await ref.get()).data();
      await db.doc(`menu_items/${MAINS}`).update({ meal_periods: ["lunch"] });
      try {
        expectOk(await reserve({ pickup_window: "10:30-11:00" }), "預設範圍 10:30 屬午餐");
        await ref.set({ mealPeriods: { breakfast: "06:00-11:00", lunch: "11:00-14:00", dinner: "16:30-20:00" } }, { merge: true });
        const r = expectCode(await reserve({ pickup_window: "10:30-11:00" }), "invalid-argument");
        assert(/沒有供應早餐/.test(r.message), r.message);
        expectOk(await reserve({ pickup_window: "11:00-11:30" }), "11:00 仍是午餐");
      } finally {
        await ref.set(original);
        await db.doc(`menu_items/${MAINS}`).update({ meal_periods: FieldValue.delete() });
      }
    });

    await test("C-MEAL-07", "lang=en：沒供應的餐期錯誤訊息是英文", async () => {
      await db.doc(`menu_items/${MAINS}`).update({ meal_periods: ["dinner"] });
      try {
        const r = await U.call("createCartLinePayReservation", { lines: [xline({ coupon_id: await coupon(U.uid, VX, 1000) })], lang: "en" });
        assert(!r.ok && /isn't served at Lunch/.test(r.message) && !CJK.test(r.message.replace(/測試雞腿便當/g, "")), r.message);
      } finally { await db.doc(`menu_items/${MAINS}`).update({ meal_periods: FieldValue.delete() }); }
    });

    await test("A-CFG-03", "v4 平台參數：bookingRangeDays=14、addonSidePrice=15 生效", async () => {
      const ref = db.doc("platformConfig/global");
      const original = (await ref.get()).data();
      try {
        await ref.set({ bookingRangeDays: 14, addonSidePrice: 15 }, { merge: true });
        let far = addDays(TODAY, 20);
        while (!CFG.businessWeekdays.includes(weekdayOf(far))) far = addDays(far, 1);
        const r = expectCode(await reserve({ pickup_date: far }), "invalid-argument", "20 天後");
        assert(/14 天內/.test(r.message), r.message);
        const d = await draftOf(await reserve({ extra_side: { slot: 0, candidate: null, mode: "addon" }, slots: [{ choice: 0 }, { choice: "default" }] }));
        eq(d.adjust_amount, 15, "加菜 +15");
      } finally { await ref.set(original); }
    });
  }

  await test("C-CHR-17 F-23", "各餐期分開截止（時鐘 10:30 只截止早餐、14:00 截止午餐）；取餐提醒同一餐期重跑只發一次", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const owner = `zz2-owner-close-${RUN}`;
    const VC = await mkVendor(vid("close"), { pickup_windows: ["07:30-08:00", "11:00-11:30"], owner_uid: owner });
    await mkBento(VC);
    const X = `zz2-cx-${RUN}`;
    await lock(X, VC, { pickup_date: TODAY, pickup_window: "07:30-08:00" });
    await lock(X, VC, { pickup_date: TODAY, pickup_window: "11:00-11:30" });
    const realNow = Date.now;
    const at = (hhmm) => () => Date.parse(`${TODAY}T${hhmm}:00+08:00`);
    let afterBreakfast;
    try {
      Date.now = at("07:40");
      await runSchedule("orders.js", "pickupReminder");
      await runSchedule("orders.js", "pickupReminder");
      Date.now = at("09:00");
      await runSchedule("charity.js", "convertToCharity");
      Date.now = at("10:30");
      await runSchedule("charity.js", "closeCharity");
      afterBreakfast = await get(`vendors/${VC}/prepPlans/${TODAY}`);
      Date.now = at("12:30");
      await runSchedule("charity.js", "convertToCharity");
      Date.now = at("14:00");
      await runSchedule("charity.js", "closeCharity");
      await runSchedule("charity.js", "closeCharity");
    } finally { Date.now = realNow; }
    eq((await notes(X, { title: /還沒取餐/ })).length, 1, "早餐提醒重跑只一次");
    eq([afterBreakfast.charity_closed_breakfast, afterBreakfast.charity_closed_lunch ?? null], [true, null], "10:30 只截止早餐");
    const titles = (await notes(owner, { title: /愛心餐已截止/ })).map((n) => n.title).sort();
    eq(titles, ["午餐愛心餐已截止", "早餐愛心餐已截止"], "各一次");
  });

  await test("V-ACC-05", "沒有任何訂閱欄位的舊店家不擋下單", async () => {
    const VN = vid("nosub");
    await db.doc(`vendors/${VN}`).set({ name: "沒訂閱的店", address: "臺北市大安區測試路 9 號", pickup_windows: [WINDOW], owner_uid: OWNER_UID });
    await mkBento(VN);
    const U = await freshUser("nosub");
    expectOk(await U.call("createCartLinePayReservation", { lines: [{ menu_item_id: `${VN}-bento`, pickup_date: OPEN_DAY, pickup_window: WINDOW, quantity: 1, slots: [{ choice: "default" }, { choice: "default" }], coupon_id: await coupon(U.uid, VN, 1000) }] }));
  });

  await test("V-WAGE-03", "基本工資今天調漲 → syncMinimumWage 更新標準、低於的店家拉到新標準並通知、較高的不動", async () => {
    const ref = db.doc("platformConfig/minimumWage");
    const original = (await ref.get()).data() || null;
    const [lowOwner, highOwner] = [`zz2-owner-wlow-${RUN}`, `zz2-owner-whigh-${RUN}`];
    const VL = await mkVendor(vid("wlow"), { owner_uid: lowOwner, hourly_wage: 196, staff_salaries: [29500, 40000] });
    const VH = await mkVendor(vid("whigh"), { owner_uid: highOwner, hourly_wage: 260, staff_salaries: [45000] });
    try {
      await ref.set({
        monthly: 29500, hourly: 196, effectiveFrom: "2026-01-01", source: "測試",
        history: [{ monthly: 29500, hourly: 196, effectiveFrom: "2026-01-01" }, { monthly: 30000, hourly: 200, effectiveFrom: TODAY }],
      });
      await runSchedule("finance.js", "syncMinimumWage");
      const w = await get("platformConfig/minimumWage");
      eq([w.hourly, w.monthly, w.effectiveFrom], [200, 30000, TODAY], "標準更新");
      const low = await get(`vendors/${VL}`);
      eq([low.hourly_wage, low.staff_salaries], [200, [30000, 40000]]);
      eq((await notes(lowOwner, { title: /基本工資調整/ })).length, 1);
      const high = await get(`vendors/${VH}`);
      eq([high.hourly_wage, high.staff_salaries], [260, [45000]]);
      eq((await notes(highOwner, { title: /基本工資調整/ })).length, 0);
    } finally { if (original) await ref.set(original); else await ref.delete(); }
  });

  await test("V-WAGE-04", "updateVendorCosts：LINE Pay 費率 > 10%、老闆工時 > 24、沒有欄位 → invalid-argument", async () => {
    const VW = await mkVendor(vid("wage4"));
    for (const data of [{ linepay_fee_rate: 0.2 }, { owner_hours_per_day: 30 }, {}]) {
      expectCode(await OWNER.call("updateVendorCosts", { vendor_id: VW, ...data }), "invalid-argument", JSON.stringify(data));
    }
  });

  await test("C-FAV-02", "收藏店家 → onFavoriteCreated 把 +2 分給該店供應中品項的主菜與預設配菜標籤", async () => {
    const VF = await mkVendor(vid("fav"));
    await cloneCatalog("cafe-renheya-demo", VF);
    const uid = `zz2-fav-${RUN}`;
    await db.doc(`users/${uid}/favorites/${VF}`).set({ vendor_id: VF, created_at: Timestamp.now() });
    const tp = await waitFor(async () => (await get(`tasteProfiles/${uid}`))?.scores || null, 60000);
    const values = Object.values(tp);
    assert(values.length > 0 && values.every((v) => v > 0 && v <= 2), JSON.stringify(tp));
  });

  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  for (const [id, st, name, msg] of results) console.log(`${st}  ${pad(id, 30)} ${name}${msg ? "  → " + msg : ""}`);
  const fails = results.filter((r) => r[1] === "FAIL" && !r[3].startsWith("SKIP")).length;
  const skips = results.filter((r) => r[3].startsWith("SKIP")).length;
  console.log(`\n${results.length - fails - skips}/${results.length} passed, ${skips} skipped`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

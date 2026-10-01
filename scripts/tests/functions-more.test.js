// doc/測試文件.md 中 functions.test.js 沒涵蓋、但伺服器端可以自動測的案例：
// 排程（轉愛心餐、愛心餐截止、預約逾時、回饋池結算、券過期、抽獎期結束、到期提醒、異常偵測、
// 取餐提醒）、轉讓媒合、天災、採購、口味分數、開放許願、區域洞察、撥款、計畫方案、英文錯誤訊息。
//
// 執行（跟 functions.test.js 用同一個測試 emulator）：
//   cd scripts/tests && npm run emulator      # 另一個視窗
//   cd scripts/tests && npm run test:functions:more
//
// 排程類 Functions 在 emulator 不會自己跑，這裡直接在本機 process 內呼叫 onSchedule 的 handler
// （`.run()`），讀寫的是同一個 Firestore emulator，所以後續的 Firestore 觸發器（發抽獎券、媒合）
// 照樣在 emulator 裡跑。每次執行都用新的店家與會員（id 帶 RUN），不受前一次殘留資料影響。
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

// Functions 的模組用 functions/node_modules 裡的 firebase-admin（另一份），要先 initializeApp 才能 require
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

// ── 身分 ──
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
/** 這次執行專用的新會員（已登入的 client） */
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

// ── 日期 ──
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
const prevBusinessDays = (n) => {
  const out = [];
  let d = TODAY;
  while (out.length < n) { d = addDays(d, -1); if (CFG.businessWeekdays.includes(weekdayOf(d))) out.push(d); }
  return out;
};
const hm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const nowMinutes = Number(NOW_HM.slice(0, 2)) * 60 + Number(NOW_HM.slice(3, 5));

// ── 測試資料 ──
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
/** 跟 functions.test.js 的 zz-bento 同結構的便當品項 */
async function mkBento(vendorId, extra = {}) {
  const id = `${vendorId}-bento`;
  await db.doc(`menu_items/${id}`).set({
    vendor_id: vendorId, name: "測試雞腿便當", name_en: "Test Chicken Bento", price: 100, category: "便當", available: true,
    main: { name: "滷雞腿" }, rice_component_id: "zz-rice",
    slots: [
      { category: "青菜類", default: { name: "高麗菜" }, candidates: [{ name: "地瓜葉", portion_level: 0.75, weekly_cap: 1000, min_qty: 10 }] },
      { category: "蛋豆類", default: { name: "滷蛋" } },
    ],
    ...extra,
  });
  return id;
}
/** 把種子店（有原物料、半成品、配方）的目錄複製成新店，採購與口味分數要用 */
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

/** geohash（跟 web/src/lib/geo.ts 同一套），給「常用地點」用 */
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
  try { await db.doc("_ping/x").get(); } catch { console.error(`連不到 Firestore emulator ${HOST}:${PORTS.firestore}，請先 npm run emulator`); process.exit(2); }
  OWNER_UID = await ensureUser("zz-owner@bunnbaa.test");
  const OWNER = await client("zz-owner@bunnbaa.test");
  console.log(`RUN=${RUN} TODAY=${TODAY} ${NOW_HM} OPEN_DAY=${OPEN_DAY}\n`);

  // ════ 3.15 未取餐轉愛心餐、截止、全數送出、預約逾時（排程） ════
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
      eq((await get(`vendors/${VN}/prepPlans/${TODAY}`)).charity_closed, true);
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

    await test("C-CHR-09 C-CHR-15", "預約逾時（排程）：釋出回 available、停權 7 天、再預約被擋；預約不影響口味分數", async () => {
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
      const days = ((await get(`charityBans/${R2.uid}`)).until.toMillis() - Date.now()) / 86400000;
      assert(days > 6.9 && days <= 7.01, `停權天數 ${days}`);
      assert((await notes(R2.uid, { title: /逾時/ })).length === 1, "逾時通知");
      const again = expectCode(await R2.call("reserveCharity", { meal_id: meal }), "permission-denied");
      assert(/不影響一般訂餐/.test(again.message), again.message);
      assert(!(await get(`tasteProfiles/${R2.uid}`)), "預約愛心餐不應產生口味分數");
    });
  }

  // ════ 3.14 回饋池結算、券過期、抽獎期結束、到期提醒、退款扣回 ════
  const P = addDays(mondayOf(TODAY), -7); // 上一期
  await test("C-RWD-03 C-RWD-17", "不到 100 張不開池：carried、結轉下一期、rewardStatus 再 X 元開獎；重跑不重算", async () => {
    const VR = await mkVendor(vid("carry"));
    for (let i = 0; i < 60; i++) {
      await db.collection("rewardTickets").add({ vendor_id: VR, user_id: `zz2-u${i % 7}-${RUN}`, period_id: P, status: "pending", created_at: Timestamp.now() });
    }
    await db.doc(`vendors/${VR}/rewardPeriods/${P}`).set({ period_id: P, net_revenue: 6000, tickets: 60 });
    eq(expectOk(await OWNER.call("triggerRewardPeriodNow", { vendor_id: VR, period_id: P }))[VR], "carried");
    const next = await get(`vendors/${VR}/rewardPeriods/${mondayOf(TODAY)}`);
    eq([next.carried_revenue, next.carried_tickets], [6000, 60], "結轉");
    const st = await get(`rewardStatus/${VR}`);
    eq([st.pool_open, st.tickets_so_far, st.amount_to_open], [false, 60, 4000]);
    eq(expectOk(await OWNER.call("triggerRewardPeriodNow", { vendor_id: VR, period_id: P }))[VR], "carried");
    eq((await get(`vendors/${VR}/rewardPeriods/${mondayOf(TODAY)}`)).carried_tickets, 60, "重跑不應再結轉一次");
  });

  await test("C-RWD-04 C-RWD-17", "§8.4 範例（100,000 元、1,000 張）實際開池：分配、leftover、發 1,000 張券；重跑不重複發券", async () => {
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
    eq(p.pool, 10000); eq(p.leftover, 10);
    eq(Object.fromEntries(Object.entries(p.allocation).sort()), { free: 2, t10: 5, t30: 11, t50: 27, t80: 163, t95: 792 });
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
    const r = expectOk(await U.call("createCartLinePayReservation", { lines: [line({ coupon_id: c })] }));
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
    const c = await coupon(U.uid, VG, 1000); // 全額折抵走免付款路徑（emulator 沒有 LINE Pay）
    expectOk(await U.call("createCartLinePayReservation", { lines: [{ ...line(), menu_item_id: `${VG}-bento`, coupon_id: c }] }), "已持有的券照常能用");
    eq(expectOk(await OWNER.call("setRewardPause", { vendor_id: VG, paused: false })).paused_from, null);
  });

  // ════ 5. 異常偵測（排程） ════
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

  // ════ 3.16 口味分數、開放許願；4.10 區域洞察 ════
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
    // 半衰期：把分數改成 30 天前的 {X: 10}，再下一單 → X 變 5
    await db.doc(`tasteProfiles/${T}`).set({ scores: { 測試標籤: 10 }, scores_updated_at: Timestamp.fromMillis(Date.now() - 30 * 86400000) });
    await lock(T, VT, { menu_item_id: ids.classic, slots, pickup_date: TODAY });
    const after = await waitFor(async () => { const p = await get(`tasteProfiles/${T}`); return p.scores?.測試標籤 !== 10 ? p.scores : null; });
    assert(Math.abs(after.測試標籤 - 5) < 0.01, `半衰後 ${after.測試標籤}`);
  });

  await test("C-WSH-04 C-WSH-05", "近 30 天 20 人許願同一道 → 通知店家、notified；超過 30 天不算；按已上架通知許願者", async () => {
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
    eq(doc.removal_rates[0], { dish: "高麗菜", rate: 25, total: 20 }, "不要率");
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

  // ════ 3.12 轉讓媒合（matchResaleLock 觸發器在 emulator 裡跑；沒有向量時退回「訂過同一品項」） ════
  {
    const VM = await mkVendor(vid("match"));
    const IM = await mkBento(VM);
    const B1 = await freshUser("b1");
    const N = await freshUser("n");
    const u = (r) => `zz2-${r}-${RUN}`;
    const [B2, B3, H, M, F, D] = ["b2", "b3", "h", "m", "f", "d"].map(u);
    await db.doc(`users/${B2}`).set({ lang: "en" });
    await db.doc(`users/${M}`).set({ muted_kinds: ["resale_match"] });
    await db.doc(`users/${F}`).set({ home_geo: geohash(22.6273, 120.3014) }); // 高雄，離店 > 10 km
    for (const x of [B1.uid, B2, B3, H, M, F, D]) await lock(x, VM, { menu_item_id: IM, pickup_date: addDays(TODAY, -3), status: "fulfilled" });
    await lock(D, VM, { menu_item_id: "other", pickup_date: OPEN_DAY }); // D 當天已訂這家店
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
      expectOk(await B1.call("claimResoldLock", { lock_id: L1.id }));
      eq((await get(`resale_matches/${L1.id}`)).claimed_by_match, true);
      expectOk(await N.call("claimResoldLock", { lock_id: L3.id }));
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
    expectOk(await B.call("claimResoldLock", { lock_id: l.id }));
    assert(!(await get(`lock_tokens/${l.id}`)), "lock_tokens 仍在（A 會繼續收到這筆的提醒）");
  });

  // ════ 6. 取餐提醒（排程） ════
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

  // ════ 5. 天災 ════
  await test("A-DIS-02", "已截單（取餐日當天）建立停班事件 → 仍取消退款", async () => {
    if (!TODAY_IS_BUSINESS) throw new Error("SKIP：今天不是營業日");
    const VD = await mkVendor(vid("dis"), { address: `臺北市測災${RUN}區測試路 1 號` });
    const l = await lock(`zz2-dis-${RUN}`, VD, { pickup_date: TODAY });
    await db.collection("disasterEvents").add({ type: "work_suspension", counties: ["臺北市"], towns: [`臺北市測災${RUN}區`], whole_counties: [], dates: [TODAY], source: "manual", summary: "測試", created_at: Timestamp.now() });
    const x = await waitFor(async () => { const d = await get(`locks/${l.id}`); return d.status === "cancelled" ? d : null; }, 60000);
    eq(x.cancel_reason, "disaster");
  });

  await test("A-DIS-05", "退款失敗的那筆按「重新處理」只補失敗的，不重複退款與通知", async () => {
    const VD2 = await mkVendor(vid("dis2"), { address: `臺北市重處${RUN}區測試路 1 號` });
    const okBuyer = `zz2-dok-${RUN}`;
    const good = await lock(okBuyer, VD2);
    const bad = await lock(`zz2-dbad-${RUN}`, VD2, { transaction_id: "tx-that-fails" }); // emulator 沒有 LINE Pay 金鑰 → 退款失敗
    const ev = await db.collection("disasterEvents").add({ type: "work_suspension", counties: ["臺北市"], towns: [`臺北市重處${RUN}區`], whole_counties: [], dates: [OPEN_DAY], source: "manual", summary: "測試", created_at: Timestamp.now() });
    const first = await waitFor(async () => (await ev.get()).data().result, 60000);
    eq([first.cancelled, first.failed], [1, 1]);
    eq((await ev.get()).data().processed, false, "有失敗 → processed=false");
    eq((await get(`locks/${bad.id}`)).status, "locked", "失敗的那筆狀態要還原");
    await bad.ref.update({ transaction_id: FieldValue.delete() });
    const r = expectOk(await OWNER.call("reprocessDisasterEvent", { event_id: ev.id }));
    eq([r.cancelled, r.failed], [1, 0]);
    eq((await get(`locks/${bad.id}`)).status, "cancelled");
    eq((await get(`locks/${good.id}`)).cancel_reason, "disaster");
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

  // ════ 4.8 採購 ════
  await test("V-PUR-01 V-PUR-03 V-PUR-05 V-PUR-09 A-DIS-07 V-CHR-04 V-RCP-09", "週叫貨單：原物料 × 週一至週五、已確定／預測；4 週同星期幾平均排除停班日與報廢；盤點；冪等；主菜鎖定", async () => {
    const VPU = vid("pur");
    const thisMonday = mondayOf(TODAY);
    const mondays = [28, 21, 14, 7].map((d) => addDays(thisMonday, -d));
    const tuesdays = mondays.map((d) => addDays(d, 1));
    await mkVendor(VPU, { disaster_dates: [mondays[3]] });
    const ids = await cloneCatalog("cafe-renheya-demo", VPU);
    const hist = async (date, n) => { for (let i = 0; i < n; i++) await lock(`zz2-h${i}-${RUN}`, VPU, { menu_item_id: ids.classic, pickup_date: date, status: "fulfilled", reward_counted: true }); };
    for (const d of mondays.slice(0, 3)) await hist(d, 4);
    await hist(mondays[3], 20); // 停班日：不列入平均
    for (const d of tuesdays) await hist(d, 4);
    await db.doc(`vendors/${VPU}/prepPlans/${tuesdays[0]}`).set({ date: tuesdays[0], charity_result: { wasted: 4 } }); // 那天全部報廢
    const week = mondayOf(addDays(TODAY, 7));
    await lock(`zz2-cf-${RUN}`, VPU, { menu_item_id: ids.classic, pickup_date: week });
    const r = expectOk(await OWNER.call("triggerPurchaseListNow", { vendor_id: VPU, week_start: week }));
    eq(r.uncounted, true, "沒盤點");
    const list = await get(`vendors/${VPU}/purchaseLists/weekly_${week}`);
    eq(list.board[0], { date: week, closed: false, confirmed: 1, forecast: 3 }, "週一：確定 1、預測 4−1");
    eq(list.board[1].forecast, 3, "週二：(0+4+4+4)/4 = 3");
    const ings = Object.fromEntries((await db.collection(`vendors/${VPU}/ingredients`).get()).docs.map((d) => [d.id, d.data()]));
    assert(list.lines.length > 0 && list.lines.every((l) => ings[l.ingredient_id].frequency !== "monthly"), "週單不含 monthly");
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
    const m = expectOk(await OWNER.call("triggerPurchaseListNow", { vendor_id: VPU, type: "monthly" }));
    const monthly = await get(`vendors/${VPU}/purchaseLists/monthly_${m.month}`);
    assert(monthly.lines.length > 0 && monthly.lines.every((l) => ings[l.ingredient_id].frequency === "monthly"), "月單只含 monthly（V-PUR-07）");
  });

  await test("V-PUR-04 V-PUR-06 V-PUR-07", "新店用自填預估；保存 ≤ 3 天的葉菜分批到貨、耐放的一次週一", async () => {
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

  // ════ 6. 截單排程 ════
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

  // ════ 1b. 撥款 ════
  await test("F-01 A-PAY-01", "手動結算：已取餐＋愛心餐＋轉讓取餐計入、未取餐的不算；重按不重複結算", async () => {
    const VS3 = await mkVendor(vid("pay"));
    await lock(`zz2-pa-${RUN}`, VS3, { status: "fulfilled", locked_price: 80 });
    await lock(`zz2-pb-${RUN}`, VS3, { status: "charity", locked_price: 100 });
    await lock(`zz2-pc-${RUN}`, VS3, { status: "resold_and_fulfilled", locked_price: 50 });
    await lock(`zz2-pd-${RUN}`, VS3, { status: "locked", locked_price: 70 });
    const r = expectOk(await OWNER.call("triggerSettlementNow", { vendor_id: VS3 }));
    const p = await get(`payouts/${r.payout_id}`);
    eq([p.amount, p.lock_count], [230, 3]);
    eq(expectOk(await OWNER.call("triggerSettlementNow", { vendor_id: VS3 })).payout_id, null, "重按");
  });

  // ════ 3.5／3.6 下單與計畫方案 ════
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
    // 金額 > 0 要經 LINE Pay（emulator 沒有金鑰），直接寫一筆付款意圖模擬「已導去付款」
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

    await test("C-PLN-04", "到下週五排不滿 N 個營業日 → 被擋並提示", async () => {
      const r = expectCode(await join(await plan({ days: 30 })), "invalid-argument");
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

  // ════ 6. 英文錯誤訊息、AI 失敗、平台參數 ════
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
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const m = expectCode(await OWNER.call("extractMenuFromImage", { vendor_id: VO, image_base64: png, mime_type: "image/png" }), "unavailable");
    assert(/AI 暫時無法辨識/.test(m.message), m.message);
    // 其他流程在沒有 Gemini 的 emulator 裡已經整份跑過（下單、截單、結算、抽獎、叫貨單都 PASS）
  });

  await test("A-CFG-01 A-CFG-02", "平台參數改截單時間 → 伺服器照新值；刪掉欄位 → 用預設值", async () => {
    const tomorrow = addDays(TODAY, 1);
    if (!CFG.businessWeekdays.includes(weekdayOf(tomorrow))) throw new Error("SKIP：明天不是營業日");
    const ref = db.doc("platformConfig/global");
    const original = (await ref.get()).data();
    const U = await freshUser("cfg");
    const pastDefault = nowMinutes >= 20 * 60;
    const flip = pastDefault ? "23:59" : "00:01"; // 讓「明天」的結果跟預設 20:00 相反
    try {
      await ref.set({ cutoffTime: flip }, { merge: true });
      const r = await U.call("createCartLinePayReservation", { lines: [line({ pickup_date: tomorrow, coupon_id: await coupon(U.uid, VO, 1000) })] });
      eq(r.ok, pastDefault, `截單改 ${flip} 後明天能不能訂`);
      await ref.update({ charityBanDays: FieldValue.delete(), cutoffTime: FieldValue.delete() });
      const cfg = await loadPlatformConfig(db);
      eq([cfg.charityBanDays, cfg.cutoffTime], [7, "20:00"], "缺欄位用預設");
    } finally { await ref.set(original); }
  });

  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  for (const [id, st, name, msg] of results) console.log(`${st}  ${pad(id, 30)} ${name}${msg ? "  → " + msg : ""}`);
  const fails = results.filter((r) => r[1] === "FAIL" && !r[3].startsWith("SKIP")).length;
  const skips = results.filter((r) => r[3].startsWith("SKIP")).length;
  console.log(`\n${results.length - fails - skips}/${results.length} passed, ${skips} skipped`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

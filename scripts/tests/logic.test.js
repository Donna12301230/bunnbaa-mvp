// doc/測試文件.md 中可用純函式驗證的案例（Cloud Functions 端邏輯）。
// 執行：cd scripts/tests && npm run test:logic（不需要 emulator）。
// 故意用 UTC 跑，確認日期判斷一律以台北時間計（F-21）。
process.env.TZ = "UTC";
const assert = require("node:assert/strict");
const path = require("node:path");
const SRC = path.resolve(__dirname, "../../functions/src");
const req = (m) => require(path.join(SRC, m));

const pricing = req("pricing.js");
const bento = req("bento.js");
const rewards = req("rewards.js");
const cal = req("calendar.js");
const prep = req("prep.js");
const { DEFAULT_PLATFORM_CONFIG: CFG } = req("config.js");

const results = [];
function test(id, name, fn) {
  try { fn(); results.push([id, "PASS", name, ""]); }
  catch (e) { results.push([id, "FAIL", name, e.message.split("\n")[0]]); }
}

// 固定「現在」＝ 2026-09-30（週三）台北 10:00
const NOW = new Date("2026-09-30T10:00:00+08:00");
const vendor = { name: "測試店" };
const W = "11:00-11:30";

test("C-PRC-01", "明天（今天 20:00 前）95 折", () => {
  assert.equal(pricing.validatePickup("2026-10-01", W, vendor, CFG, NOW), null);
  assert.equal(pricing.applyEarlyBirdPrice(100, "2026-10-01", NOW).lockedPrice, 95);
});
test("C-PRC-01b", "明天、但已過 20:00 → 截單", () => {
  const late = new Date("2026-09-30T20:00:00+08:00");
  assert.notEqual(pricing.validatePickup("2026-10-01", W, vendor, CFG, late), null);
});
test("C-PRC-02", "今天不能選（前一天已截單）", () => {
  assert.notEqual(pricing.validatePickup("2026-09-30", W, vendor, CFG, NOW), null);
});
test("C-PRC-03", "2 天後 8 折", () => {
  assert.equal(pricing.validatePickup("2026-10-02", W, vendor, CFG, NOW), null);
  assert.equal(pricing.applyEarlyBirdPrice(100, "2026-10-02", NOW).lockedPrice, 80);
});
test("C-PRC-04", "最遠 30 天後（10/30 週五）8 折", () => {
  assert.equal(cal.lastBookableDate("2026-09-30"), "2026-10-30");
  assert.equal(pricing.validatePickup("2026-10-30", W, vendor, CFG, NOW), null);
  assert.equal(pricing.applyEarlyBirdPrice(100, "2026-10-30", NOW).lockedPrice, 80);
  assert.equal(pricing.applyEarlyBirdPrice(100, "2026-10-16", NOW).lockedPrice, 80, "提前 14 天以上仍是 8 折（7 折列後續改版）");
});
test("C-PRC-05", "超過 30 天不能選", () => {
  assert.notEqual(pricing.validatePickup("2026-11-02", W, vendor, CFG, NOW), null);
});
test("C-PRC-06", "週六訂下週一到五 8 折", () => {
  const sat = new Date("2026-10-03T10:00:00+08:00");
  for (const d of ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]) {
    assert.equal(pricing.validatePickup(d, W, vendor, CFG, sat), null, d);
    assert.equal(pricing.applyEarlyBirdPrice(100, d, sat).lockedPrice, 80, d);
  }
});
test("C-PRC-06b", "週日也能訂下週一到五（週一是 1 天 → 95 折）", () => {
  const sun = new Date("2026-10-04T10:00:00+08:00");
  assert.equal(pricing.validatePickup("2026-10-09", W, vendor, CFG, sun), null);
  assert.equal(pricing.applyEarlyBirdPrice(100, "2026-10-05", sun).lockedPrice, 95);
});
test("C-PRC-07", "週六、週日不能當取餐日", () => {
  assert.notEqual(pricing.validatePickup("2026-10-03", W, vendor, CFG, NOW), null);
  assert.notEqual(pricing.validatePickup("2026-10-04", W, vendor, CFG, NOW), null);
});
test("C-PRC-10", "8 折 + 加飯 + 一格不要 = 85", () => {
  const eb = pricing.applyEarlyBirdPrice(100, "2026-10-02", NOW).lockedPrice;
  assert.equal(eb + bento.adjustAmount({ rice: "add", removedCount: 1 }, CFG), 85);
});
test("C-PRC-11", "8 折 + 減飯 = 75", () => {
  const eb = pricing.applyEarlyBirdPrice(100, "2026-10-02", NOW).lockedPrice;
  assert.equal(eb + bento.adjustAmount({ rice: "less", removedCount: 0 }, CFG), 75);
});
test("C-PRC-12", "店家截單 18:00，今天 19:00 訂明天被擋", () => {
  const v = { ...vendor, cutoff_time: "18:00" };
  const t19 = new Date("2026-09-30T19:00:00+08:00");
  assert.notEqual(pricing.validatePickup("2026-10-01", W, v, CFG, t19), null);
  assert.equal(pricing.validatePickup("2026-10-01", W, vendor, CFG, t19), null);
});
test("C-PRC-13", "店家截單設 21:00 → 照 20:00 算", () => {
  assert.equal(pricing.vendorCutoffTime({ cutoff_time: "21:00" }, CFG), "20:00");
});
test("C-ORD-05", "公休日被擋", () => {
  assert.notEqual(pricing.validatePickup("2026-10-02", W, { ...vendor, holidays: ["2026-10-02"] }, CFG, NOW), null);
});
test("C-ORD-06", "business_hours 關閉的星期被擋", () => {
  const v = { ...vendor, business_hours: [{ weekday: 5, open: false }] };
  assert.match(pricing.validatePickup("2026-10-02", W, v, CFG, NOW), /沒有營業/);
});
test("C-PLN-01", "計畫取餐日跳過公休", () => {
  const v = { ...vendor, holidays: ["2026-10-05"] };
  const r = pricing.planPickupDates("2026-10-02", W, v, 3, CFG, NOW);
  assert.deepEqual(r.dates, ["2026-10-02", "2026-10-06", "2026-10-07"]);
});
test("C-PLN-02", "計畫開始日是公休被擋", () => {
  const r = pricing.planPickupDates("2026-10-02", W, { ...vendor, holidays: ["2026-10-02"] }, 3, CFG, NOW);
  assert.ok(r.problem);
});
test("V-SET-03", "取餐時段格式驗證", () => {
  assert.equal(pricing.isValidWindow("14:00-14:30"), true);
  assert.equal(pricing.isValidWindow("14:30-14:00"), false);
  assert.equal(pricing.isValidWindow("25:00-26:00"), false);
});

// 3.13 組便當
const item = {
  slots: [
    { category: "青菜", default: { name: "高麗菜", component_id: "c1" }, candidates: [{ name: "筊白筍", component_id: "c9", portion_level: 0.5 }] },
    { category: "蛋", default: { name: "炒蛋", component_id: "c2" } },
    { category: "豆", default: { name: "豆干", component_id: "c3" } },
  ],
};
test("C-BNT-04", "某格選「不要」金額 −5", () => {
  const r = bento.resolveChoices(item, [{ choice: "none" }]);
  assert.equal(r.removedCount, 1);
  assert.equal(bento.adjustAmount({ rice: "normal", removedCount: r.removedCount }, CFG), -5);
});
test("C-BNT-06", "rice 只接受 add/normal/less", () => {
  assert.deepEqual(bento.RICE_OPTIONS, ["add", "normal", "less"]);
});
test("C-BNT-xx", "不存在的候選 index 被擋", () => {
  assert.ok(bento.resolveChoices(item, [{ choice: 5 }]).problem);
});
test("C-BNT-09", "份量級距只分全份／半份：比例 ≥0.75 全份、0.5–0.75 半份、<0.5 不能列", () => {
  assert.equal(bento.portionLevelFor(10, 12), 1);
  assert.equal(bento.portionLevelFor(10, 16), 0.5);
  assert.equal(bento.portionLevelFor(10, 25), null);
  assert.equal(bento.portionLabel(0.75), "半份");
});
test("C-BNT-11", "沒有 slots 的舊品項不能加減", () => {
  assert.equal(bento.isBento({}), false);
  assert.deepEqual(bento.resolveChoices({}, []), { slots: [], removedCount: 0 });
});

// 3.14 回饋池
test("C-RWD-04", "規格 §8.4 範例：池 10000、1000 張 → 免費 15、半價 79、保底 906，餘 20", () => {
  const r = rewards.allocatePool(10000, 1000);
  assert.deepEqual(r.counts, { free: 15, t50: 79, t95: 906 });
  assert.equal(r.spent, 9980);
  assert.equal(r.leftover, 20);
});
test("C-RWD-05", "頭獎保證：免費餐券算出 0 張且剩 ≥ 95 時先配 1 張", () => {
  // N=100、P=800 → budget=300，free floor(90/95)=0、t50 floor(210/45)=4（180）→ 剩 120 ≥ 95 → 補 1 張免費
  const r = rewards.allocatePool(800, 100);
  assert.equal(r.counts.free, 1);
  const total = Object.values(r.counts).reduce((s, n) => s + n, 0);
  assert.equal(total, 100);
});
test("C-RWD-06", "第一階段只有 3 種券", () => {
  assert.deepEqual(Object.keys(rewards.allocatePool(10000, 1000).counts).sort(), ["free", "t50", "t95"]);
});
test("C-RWD-xx", "高階張數不超過抽獎券數、spent+leftover=pool", () => {
  for (const [p, n] of [[10000, 100], [5000, 1000], [123456, 1234], [999, 100]]) {
    const r = rewards.allocatePool(p, n);
    const total = Object.values(r.counts).reduce((s, x) => s + x, 0);
    assert.equal(total, n, `${p}/${n}`);
    assert.equal(r.spent + r.leftover, p);
  }
});
test("C-RWD-07", "pickTier 只抽剩餘 > 0 的等級", () => {
  assert.equal(rewards.pickTier({ free: 0, t50: 1 }, () => 0.99), "t50");
  assert.equal(rewards.pickTier({ free: 0 }), null);
});

// 4.7 / 4.8 / 4.3
test("V-RCP-03", "生料換算 100g×10 ÷ (0.8×0.8) ≈ 1563", () => {
  assert.ok(Math.abs(bento.rawAmount(1000, { yield_rate: 0.8, loss_rate: 0.2 }) - 1562.5) < 1e-6);
});
test("V-PUR-02", "依採購單位無條件進位", () => {
  assert.deepEqual(prep.roundToPurchaseUnit(31, { purchase_unit_size: 30 }), { units: 2, amount: 60 });
  assert.deepEqual(prep.roundToPurchaseUnit(30, { purchase_unit_size: 30 }), { units: 1, amount: 30 });
});
test("V-PUR-06", "葉菜（保存 ≤3 天）分批，其他一次週一", () => {
  const byDay = ["10-05", "10-06", "10-07", "10-08", "10-09"].map((d) => ({ date: d, amount: 10 }));
  assert.ok(prep.splitDeliveries(byDay, { shelf_days: 2 }).length > 1);
  assert.deepEqual(prep.splitDeliveries(byDay, { shelf_days: 30 }), [{ date: "10-05", amount: 50 }]);
});
test("V-PRP-11", "減飯 0.5 份、加飯 +100g、不要不備、許願依級距", () => {
  const comps = { rice: { portion_grams: 200 } };
  const it = { main: { component_id: "m" }, rice_component_id: "rice", slots: item.slots };
  const less = prep.componentPortionsForLock({ rice: "less", slots: [] }, it, comps, CFG);
  assert.equal(less.get("rice"), 0.5);
  const add = prep.componentPortionsForLock({ rice: "add", slots: [] }, it, comps, CFG);
  assert.equal(add.get("rice"), 1.5);
  const slots = [
    { removed: false, wished: "筊白筍", resolved: "筊白筍", wished_component_id: "c9", portion_level: 0.5 },
    { removed: true },
    { removed: false, default_component_id: "c3" },
  ];
  const p = prep.componentPortionsForLock({ rice: "normal", slots }, it, comps, CFG);
  assert.equal(p.get("c9"), 0.5);
  assert.equal(p.has("c1"), false);
  assert.equal(p.has("c2"), false);
  assert.equal(p.get("c3"), 1);
});
test("V-PRP-13", "時間軸：≥8h 排前一晚、同設備不重疊、取餐前 20 分裝盒", () => {
  const comps = {
    a: { name: "滷肉", advance_hours: 10, prep_minutes: 60 },
    b: { name: "炸雞", equipment: "炸爐", prep_minutes: 30, batch_capacity: 10 },
    c: { name: "炸豆腐", equipment: "炸爐", prep_minutes: 20 },
  };
  const tl = prep.buildTimeline(new Map([["a", 5], ["b", 15], ["c", 5]]), comps, "11:00");
  assert.equal(tl.packing.start, "10:40");
  assert.equal(tl.overnight.length, 1);
  const fry = tl.slots.filter((s) => s.equipment === "炸爐").sort((x, y) => x.start.localeCompare(y.start));
  for (let i = 1; i < fry.length; i++) assert.ok(fry[i - 1].end <= fry[i].start, "overlap");
  assert.ok(fry.every((s) => s.end <= "10:40"));
});
test("V-PRP-14", "出餐標籤不含姓名", () => {
  const labels = prep.buildLabels([{ id: "abcd1234", pickup_code: "A1B2", buyer_name: "王小明", slots: [], note: "x" }], {});
  assert.ok(!JSON.stringify(labels).includes("王小明"));
  assert.equal(labels[0].pickup_code, "A1B2");
});

// ── 2026-10-02 規格（技術規格1002.md）新增 ──
test("C-MEAL-01", "餐期依取餐開始時間歸類：早 06:00–10:30／中 10:30–14:00／晚 16:30–20:00", () => {
  assert.equal(pricing.mealPeriodOf("07:30-08:00", CFG), "breakfast");
  assert.equal(pricing.mealPeriodOf("10:30-11:00", CFG), "lunch");
  assert.equal(pricing.mealPeriodOf("17:00-17:30", CFG), "dinner");
});
test("C-MEAL-02", "品項只供應午餐 → 早餐時段被擋；沒設餐期的舊品項不擋", () => {
  const v = { ...vendor, pickup_windows: ["07:30-08:00", "11:00-11:30"] };
  const lunchOnly = { name: "雞腿便當", meal_periods: ["lunch"] };
  assert.match(pricing.validatePickup("2026-10-02", "07:30-08:00", v, CFG, NOW, lunchOnly), /早餐/);
  assert.equal(pricing.validatePickup("2026-10-02", "11:00-11:30", v, CFG, NOW, lunchOnly), null);
  assert.equal(pricing.validatePickup("2026-10-02", "07:30-08:00", v, CFG, NOW, { name: "舊品項" }), null);
});
test("C-MEAL-03", "各餐期取餐範圍分開算（愛心餐、提醒、時間軸用）", () => {
  const v = { pickup_windows: ["07:30-08:00", "08:00-08:30", "11:30-12:00", "12:30-13:00", "17:00-18:00"] };
  assert.deepEqual(pricing.vendorPeriodRanges(v, CFG), { breakfast: "07:30-08:30", lunch: "11:30-13:00", dinner: "17:00-18:00" });
});
test("C-PLN-03", "計畫遇公休順延，順延的日期標示出來", () => {
  const v = { ...vendor, holidays: ["2026-10-05"] };
  const r = pricing.planPickupDates("2026-10-02", W, v, 3, CFG, NOW);
  assert.deepEqual(r.postponed, ["2026-10-06", "2026-10-07"]);
});
const bentoItem = {
  price: 0,
  mains: [{ name: "雞肉", component_id: "m1", price: 50 }, { name: "豬肉", component_id: "m2", price: 60 }],
  rice_component_id: "rice",
  slots: [
    { category: "配菜1", default: { name: "茄子", component_id: "c1" }, candidates: [{ name: "苦瓜", component_id: "c9", portion_level: 1 }] },
    { category: "配菜2", default: { name: "高麗菜", component_id: "c2" } },
    { category: "配菜3", default: { name: "辣炒年糕", component_id: "c3" } },
  ],
};
test("C-BNT-20", "主菜各自定價：選豬肉 → 原價 60；沒選預設第一道", () => {
  assert.equal(bento.resolveMain(bentoItem, 1).price, 60);
  assert.equal(bento.resolveMain(bentoItem, null).price, 50);
  assert.ok(bento.resolveMain(bentoItem, 5).problem);
  assert.equal(bento.resolveMain({ price: 80, main: { name: "排骨" } }).price, 80);
});
test("C-BNT-21", "第四道：加菜 +10、備案 0；要先選滿、不能重複、不能超過 4 道", () => {
  const full = bento.resolveChoices(bentoItem, []).slots;
  const addon = bento.resolveExtraSide(bentoItem, { slot: 0, candidate: 0, mode: "addon" }, full, CFG);
  assert.equal(addon.extra.dish, "苦瓜");
  assert.equal(bento.adjustAmount({ rice: "normal", removedCount: 0, extraMode: "addon" }, CFG), 10);
  assert.equal(bento.adjustAmount({ rice: "normal", removedCount: 0, extraMode: "backup" }, CFG), 0);
  assert.ok(bento.resolveExtraSide(bentoItem, { slot: 1, candidate: null, mode: "addon" }, full, CFG).problem, "高麗菜已在便當裡");
  const missing = bento.resolveChoices(bentoItem, [{ choice: "none" }]).slots;
  assert.ok(bento.resolveExtraSide(bentoItem, { slot: 0, candidate: 0, mode: "backup" }, missing, CFG).problem, "沒選滿不能加第四道");
  const four = { ...bentoItem, slots: [...bentoItem.slots, { category: "配菜4", default: { name: "滷蛋" } }] };
  assert.ok(bento.resolveExtraSide(four, { slot: 0, candidate: 0, mode: "addon" }, bento.resolveChoices(four, []).slots, CFG).problem, "標準 4 道就不能再加");
});
test("C-BNT-22", "飯量：半碗 −5、一碗 0、一碗半 +10；少一道 −5", () => {
  assert.equal(bento.adjustAmount({ rice: "less", removedCount: 0 }, CFG), -5);
  assert.equal(bento.adjustAmount({ rice: "add", removedCount: 1 }, CFG), 5);
});
test("V-PRP-20", "備料：選的主菜、備案遞補、第四道加菜都算進去", () => {
  const comps = { rice: { portion_grams: 200 } };
  const slots = [
    { removed: false, wished: "苦瓜", resolved: "高麗菜", backup_used: true, resolved_component_id: "c2", portion_level: 1 },
    { removed: false, default_component_id: "c2" },
    { removed: false, default_component_id: "c3" },
  ];
  const lock = { rice: "normal", main_component_id: "m2", slots, extra_side: { mode: "addon", component_id: "c9", portion_level: 1 } };
  const p = prep.componentPortionsForLock(lock, bentoItem, comps, CFG);
  assert.equal(p.get("m2"), 1);
  assert.equal(p.has("m1"), false);
  assert.equal(p.get("c2"), 2);
  assert.equal(p.get("c9"), 1);
  const label = prep.buildLabels([{ id: "x", pickup_code: "1234", main_dish: "豬肉", rice: "less", slots, extra_side: { mode: "addon", dish: "苦瓜" } }], {})[0];
  assert.equal(label.main, "豬肉");
  assert.equal(label.rice, "白飯半碗");
  assert.ok(label.sides.includes("＋苦瓜"));
});

let fin;
try { fin = req("finance.js").helpers; } catch (e) { fin = null; }
test("V-BIL-01", "維護費：到期前 active、寬限 7 天 grace、之後 suspended；舊資料不擋", () => {
  if (!fin) throw new Error("finance.js 無法載入");
  const due = Date.parse("2026-10-10T00:00:00+08:00");
  const v = { subscription_status: "active", subscription_end_date: { toMillis: () => due } };
  assert.equal(fin.billingStateOf(v, due - 1, CFG).status, "active");
  assert.equal(fin.billingStateOf(v, due + 3 * 86400000, CFG).status, "grace");
  assert.equal(fin.billingStateOf(v, due + 8 * 86400000, CFG).status, "suspended");
  assert.equal(fin.billingStateOf({}, due, CFG).status, "active");
  assert.equal(fin.billingStateOf({ ...v, subscription_status: "cancelled" }, due + 1, CFG).status, "suspended");
});
test("V-WAGE-01", "基本工資：依生效日取值；低於標準的時薪／月薪自動上調", () => {
  if (!fin) throw new Error("finance.js 無法載入");
  const { DEFAULT_MINIMUM_WAGE, wageOn } = req("config.js");
  assert.equal(wageOn(DEFAULT_MINIMUM_WAGE, "2025-06-01").hourly, 190);
  assert.equal(wageOn(DEFAULT_MINIMUM_WAGE, "2026-10-02").hourly, 196);
  const { patch } = fin.raiseToMinimum({ hourly_wage: 190, staff_salaries: [28000, 35000] }, { hourly: 196, monthly: 29500 });
  assert.equal(patch.hourly_wage, 196);
  assert.deepEqual(patch.staff_salaries, [29500, 35000]);
  assert.deepEqual(fin.raiseToMinimum({ hourly_wage: 200, staff_salaries: [30000] }, { hourly: 196, monthly: 29500 }).patch, {});
});
test("V-REV-01", "材料成本＝用量 ÷ 採購單位 × 單價；時間軸工時含裝盒", () => {
  if (!fin) throw new Error("finance.js 無法載入");
  assert.equal(fin.needsCost(new Map([["egg", 20]]), { egg: { purchase_unit_size: 10, unit_price: 60 } }), 120);
  const tl = { slots: [{ start: "09:00", end: "09:30" }, { start: "10:00", end: "10:20" }], overnight: [] };
  assert.equal(fin.timelineMinutes(tl, {}), 70);
});

// V-PRP-03 預測區間
let fc;
try { fc = req("pickupForecast.js").helpers; } catch (e) { fc = null; }
test("V-PRP-03", "區間：≥8 天分位數、<8 天平均±1.28sd；a≤b≤N", () => {
  if (!fc) throw new Error("pickupForecast.js 無法載入（需要 firebase-admin 初始化）");
  const r8 = fc.pickupRange([0.8, 0.85, 0.9, 0.9, 0.95, 0.9, 0.88, 0.92], 40);
  assert.equal(r8.method, "quantile_10_90");
  assert.ok(r8.low <= r8.high && r8.high <= 40);
  const r3 = fc.pickupRange([0.8, 0.9, 1], 40);
  assert.equal(r3.method, "mean_1.28sd");
  assert.ok(r3.low <= r3.high && r3.high <= 40);
});

// F-21 時區：calendar 不依機器時區
test("F-21", "taipeiToday 以台北時間計（UTC 16:30 已是隔天）", () => {
  assert.equal(cal.taipeiToday(new Date("2026-09-30T16:30:00Z")), "2026-10-01");
});

// C-NAV-01 靜態檢查：前端不能再出現舊制早鳥文案（BUG-1 回歸）
test("C-NAV-01", "web/src 沒有「最高 7 折」「提前 14 天」「最早 30 天」", () => {
  const fs = require("node:fs");
  const banned = /最高\s*7\s*折|提前\s*14\s*天|最早\s*30\s*天|up to 30% off/;
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|json)$/.test(e.name) && banned.test(fs.readFileSync(p, "utf8"))) hits.push(path.relative(SRC, p));
    }
  };
  walk(path.resolve(__dirname, "../../web/src"));
  assert.deepEqual(hits, []);
});

const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
for (const [id, st, name, msg] of results) console.log(`${st}  ${pad(id, 11)} ${name}${msg ? "  → " + msg : ""}`);
const fails = results.filter((r) => r[1] === "FAIL").length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);

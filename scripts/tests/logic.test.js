// Cases from doc/測試文件.md that can be checked with pure functions (Cloud Functions-side logic).
// Run: cd scripts/tests && npm run test:logic (no emulator needed).
// Runs in UTC on purpose, to confirm date logic always uses Taipei time (F-21).
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

// Fixed "now" = 2026-09-30 (Wednesday) 10:00 Taipei time
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

// 3.13 Build-a-bento
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
test("C-BNT-26", "材料總和份量文字：排除調味料與包材、以個計優先、g→克；沒配方只回菜名", () => {
  const ING = {
    leg: { unit: "個", category: "雞" }, soy: { unit: "ml", category: "調味" }, cabbage: { unit: "g", category: "葉菜" },
    oil: { unit: "ml", category: "調味" }, rice: { unit: "g", category: "米" }, box: { unit: "個", category: "包材" },
  };
  const comp = (lines) => ({ ingredients: lines.map(([ingredient_id, grams]) => ({ ingredient_id, grams })) });
  assert.equal(bento.portionText(comp([["leg", 1], ["soy", 10]]), ING, "滷雞腿"), "滷雞腿 1 個");
  assert.equal(bento.portionText(comp([["cabbage", 80], ["oil", 5]]), ING, "炒高麗菜"), "炒高麗菜 80 克");
  assert.equal(bento.portionText(comp([["rice", 200], ["box", 1]]), ING, "白飯"), "白飯 200 克");
  assert.equal(bento.portionText(undefined, ING, "滷蛋"), "滷蛋");
});
test("C-BNT-11", "沒有 slots 的舊品項不能加減", () => {
  assert.equal(bento.isBento({}), false);
  assert.deepEqual(bento.resolveChoices({}, []), { slots: [], removedCount: 0 });
});

// 3.14 Reward pool
test("C-RWD-04", "規格 §8.4 範例：池 10000、1000 張 → 免費 15、半價 79、保底 906，餘 20", () => {
  const r = rewards.allocatePool(10000, 1000);
  assert.deepEqual(r.counts, { free: 15, t50: 79, t95: 906 });
  assert.equal(r.spent, 9980);
  assert.equal(r.leftover, 20);
});
test("C-RWD-05", "頭獎保證：免費餐券算出 0 張且剩 ≥ 95 時先配 1 張", () => {
  // N=100, P=800 → budget=300, free floor(90/95)=0, t50 floor(210/45)=4 (180) → 120 left ≥ 95 → add 1 free ticket
  const r = rewards.allocatePool(800, 100);
  assert.equal(r.counts.free, 1);
  const total = Object.values(r.counts).reduce((s, n) => s + n, 0);
  assert.equal(total, 100);
});
test("C-RWD-19", "第一階段只有 3 種券", () => {
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

// ── Added in the 2026-10-02 spec (技術規格1002.md) ──
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
test("C-MEAL-08", "各餐期取餐範圍分開算（愛心餐、提醒、時間軸用）", () => {
  const v = { pickup_windows: ["07:30-08:00", "08:00-08:30", "11:30-12:00", "12:30-13:00", "17:00-18:00"] };
  assert.deepEqual(pricing.vendorPeriodRanges(v, CFG), { breakfast: "07:30-08:30", lunch: "11:30-13:00", dinner: "17:00-18:00" });
});
test("C-PLN-06", "計畫遇公休順延，順延的日期標示出來", () => {
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
test("C-BNT-12 C-BNT-13", "主菜各自定價：選豬肉 → 原價 60；沒選預設第一道", () => {
  assert.equal(bento.resolveMain(bentoItem, 1).price, 60);
  assert.equal(bento.resolveMain(bentoItem, null).price, 50);
  assert.ok(bento.resolveMain(bentoItem, 5).problem);
  assert.equal(bento.resolveMain({ price: 80, main: { name: "排骨" } }).price, 80);
});
test("C-BNT-14～18", "第四道：加菜 +10、備案 0；要先選滿、不能重複、不能超過 4 道", () => {
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
test("C-PRC-10b", "飯量：半碗 −5、一碗 0、一碗半 +10；少一道 −5", () => {
  assert.equal(bento.adjustAmount({ rice: "less", removedCount: 0 }, CFG), -5);
  assert.equal(bento.adjustAmount({ rice: "add", removedCount: 1 }, CFG), 5);
});
test("V-PRP-11b", "備料：選的主菜、備案遞補、第四道加菜都算進去", () => {
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
test("V-FEE-01", "合作方案：不收月費，每份實付抽成 5%（逐份四捨五入）", () => {
  assert.equal(CFG.commissionRate, 0.05);
  assert.equal(CFG.maintenanceFee, undefined, "月費參數應已移除");
  assert.equal(pricing.commissionOf([{ status: "fulfilled", locked_price: 80 }, { status: "charity", locked_price: 90 }, { status: "fulfilled", locked_price: 0 }], 0.05), 4 + 5);
  assert.equal(pricing.commissionOf([{ status: "fulfilled", locked_price: 110 }], 0.05), 6, "5.5 進位");
  assert.equal(pricing.commissionOf([], 0.05), 0);
});
test("V-REV-07", "營收口徑＝撥款口徑：預付照實付（含未取餐）、取消換券算留下的款項、退成點數的不算", () => {
  eq3(pricing.revenueOf({ status: "no_show", locked_price: 80 }), 80);
  eq3(pricing.revenueOf({ status: "cancelled", cancel_reason: "customer", locked_price: 60, kept_amount: 60 }), 60);
  eq3(pricing.revenueOf({ status: "cancelled", cancel_reason: "disaster", locked_price: 90, refunded_amount: 90 }), 0);
  eq3(pricing.commissionOf([{ status: "cancelled", kept_amount: 60 }, { status: "cancelled", refunded_amount: 90, locked_price: 90 }], 0.05), 3);
});
function eq3(a, b) { assert.equal(a, b); }
test("C-CXL-01", "取消期限：取餐時段開始前 48 小時；折價券＝原價（含加減項）30%，不超過實付", () => {
  const deadline = pricing.cancelDeadlineAt("2026-10-05", "11:00-11:30", CFG);
  assert.equal(deadline.toISOString(), new Date("2026-10-03T11:00:00+08:00").toISOString());
  assert.equal(pricing.cancelDeadlineAt("2026-10-05", "11:00-11:30", { cancelHoursBefore: 24 }).toISOString(), new Date("2026-10-04T11:00:00+08:00").toISOString());
  assert.equal(pricing.cancelCouponAmount({ list_price: 100, adjust_amount: 0, paid_amount: 80 }, CFG), 30);
  assert.equal(pricing.cancelCouponAmount({ list_price: 100, adjust_amount: 10, paid_amount: 88 }, CFG), 33);
  assert.equal(pricing.cancelCouponAmount({ list_price: 100, adjust_amount: 0, paid_amount: 20 }, CFG), 20, "不超過實付");
  assert.equal(pricing.cancelCouponAmount({ list_price: 100, adjust_amount: 0, paid_amount: 0 }, CFG), 0, "0 元單不發券");
  assert.equal(pricing.cancelCouponAmount({ list_price: 100, locked_price: 80 }, CFG), 30, "舊資料沒有 paid_amount 用 locked_price");
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

// V-PRP-03 forecast interval
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

// F-21 time zone: calendar doesn't depend on the machine's time zone
test("F-21", "taipeiToday 以台北時間計（UTC 16:30 已是隔天）", () => {
  assert.equal(cal.taipeiToday(new Date("2026-09-30T16:30:00Z")), "2026-10-01");
});

// C-NAV-01 static check: the old early-bird copy must not reappear in the frontend (BUG-1 regression)
test("C-NAV-01", "web/src 畫面文字沒有「最高 7 折」「提前 14 天」（註解不算；1002 版起最遠 30 天是正確說法）", () => {
  const fs = require("node:fs");
  const banned = /最高\s*7\s*折|提前\s*14\s*天|up to 30% off/;
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|json)$/.test(e.name) && banned.test(stripComments(fs.readFileSync(p, "utf8")))) hits.push(path.relative(SRC, p));
    }
  };
  walk(path.resolve(__dirname, "../../web/src"));
  assert.deepEqual(hits, []);
});

// Pre-order assistant tools (functions/src/shoppingAssistant.js): no Gemini call, a fake catalog is fed in directly.
// The vendor has no slot_capacity, so slot_counters isn't read (no emulator needed).
const asyncTests = [];
const testAsync = (id, name, fn) => asyncTests.push([id, name, fn]);
const assistant = req("shoppingAssistant.js").helpers;
const AST_VENDOR = { id: "v1", name: "大安小館", address: "臺北市大安區復興南路一段 1 號", holidays: ["2026-10-02"], disaster_dates: ["2026-10-05"] };
const AST_ITEMS = [
  { id: "beef", vendor_id: "v1", name: "紅燒牛肉便當", price: 120, dietary_tags: ["葷食"] },
  { id: "burdock", vendor_id: "v1", name: "雞腿便當", price: 110, slots: [{ default: { name: "牛蒡絲" } }] },
  { id: "mains", vendor_id: "v1", name: "主菜任選便當", mains: [{ name: "排骨", price: 100 }, { name: "雞腿", price: 120 }] },
  { id: "soy", vendor_id: "v1", name: "素食便當", price: 90, dietary_tags: ["素食"], allergens: ["大豆"] },
  { id: "dinner", vendor_id: "v1", name: "晚餐咖哩", price: 100, meal_periods: ["dinner"] },
];
const astCatalog = () => async () => ({
  vendors: new Map([["v1", AST_VENDOR]]),
  items: new Map(AST_ITEMS.map((i) => [i.id, i])),
  plans: new Map([["p1", { id: "p1", vendor_id: "v1", name: "一週雞腿", label: "週方案", days: 5, price_per_meal: 100 }], ["bad", { id: "bad", vendor_id: "v1", name: "壞方案", days: 0 }]]),
});
const astTools = (allergies = []) => assistant.toolHandlers({ loadCatalog: astCatalog(), taste: { prefs: [], allergies }, config: CFG, availability: new Map() });

testAsync("C-AST-05", "只寫「不吃牛」也不會誤排牛蒡；牛肉便當被排掉", async () => {
  const r = await astTools().searchMenuItems({ excludeKeywords: ["牛"] });
  const ids = r.items.map((i) => i.id);
  assert.ok(ids.includes("burdock"), ids.join());
  assert.ok(!ids.includes("beef"), ids.join());
});
testAsync("C-AST-03", "多主菜品項（沒有 item.price）用第一個主菜的價格，跟結帳一致", async () => {
  assert.equal(assistant.basePrice(AST_ITEMS[2]), bento.resolveMain(AST_ITEMS[2], null).price);
  const r = await astTools().searchMenuItems({ maxPrice: 100 });
  const mains = r.items.find((i) => i.id === "mains");
  assert.ok(mains, "多主菜品項要查得到");
  assert.equal(mains.price, 100);
});
testAsync("C-AST-04", "會員過敏原（大豆）在伺服器端排除", async () => {
  const r = await astTools(["大豆"]).searchMenuItems({ dietaryTags: ["素食"] });
  assert.equal(r.count, 0);
  assert.deepEqual(r.allergies_excluded, ["大豆"]);
});
testAsync("C-AST-08", "可訂判斷跟下單一致：截單、公休、停班停課、品項餐期", async () => {
  const [today, tomorrow, holiday, disaster] = await assistant.checkDates(AST_ITEMS[0], AST_VENDOR, ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-05"], CFG, NOW);
  assert.equal(today.available, false, "今天已截單");
  assert.equal(tomorrow.available, true);
  assert.equal(tomorrow.estimated_price, 114, "明天 95 折");
  assert.equal(holiday.available, false);
  assert.match(holiday.reason, /公休/);
  assert.equal(disaster.available, false);
  assert.match(disaster.reason, /停班停課/);
  const [dinner] = await assistant.checkDates(AST_ITEMS[4], AST_VENDOR, ["2026-10-01"], CFG, NOW);
  assert.equal(dinner.available, false, "只供晚餐的品項不能訂午餐時段");
});
testAsync("C-AST-08b", "模型建議的日期沒查過、而且是公休：卡片不帶那天", async () => {
  const cards = await assistant.buildCards({ menuItemIds: ["beef"], suggestedDates: ["2026-10-02"] }, astCatalog(), new Map(), "zh", CFG, NOW);
  assert.equal(cards[0].date, null);
  assert.equal(cards[0].estimated_price, null);
  assert.deepEqual(cards[0].closed_dates, ["2026-10-02"]);
});
testAsync("C-AST-02", "卡片帶入可訂的日期與時段（品項頁預填要兩者都有）", async () => {
  const cards = await assistant.buildCards({ menuItemIds: ["mains"], suggestedDates: ["2026-10-01"], suggestedWindow: "12:00-12:30" }, astCatalog(), new Map(), "zh", CFG, NOW);
  assert.equal(cards[0].date, "2026-10-01");
  assert.equal(cards[0].window, "12:00-12:30");
  assert.equal(cards[0].list_price, 100);
  assert.equal(cards[0].estimated_price, 95);
});
testAsync("F-16", "模型回不存在的品項／方案 id 被丟掉；設定壞掉的方案也不出卡", async () => {
  const cards = await assistant.buildCards({ menuItemIds: ["nope", "beef"], mealPlanIds: ["ghost", "bad", "p1"] }, astCatalog(), new Map(), "zh", CFG, NOW);
  assert.deepEqual(cards.map((c) => `${c.type}:${c.id}`), ["item:beef", "plan:p1"]);
});

testAsync("C-AST-18", "指定餐期：午餐查不到只供晚餐的品項；店家沒開晚餐時段，晚餐查不到任何品項", async () => {
  const lunch = await astTools().searchMenuItems({ mealPeriod: "lunch" });
  assert.ok(!lunch.items.some((i) => i.id === "dinner"), lunch.items.map((i) => i.id).join());
  assert.ok(lunch.items.every((i) => i.meal_periods.includes("lunch")));
  const dinner = await astTools().searchMenuItems({ mealPeriod: "dinner" });
  assert.equal(dinner.count, 0);
  const [d] = await assistant.checkDates(AST_ITEMS[0], AST_VENDOR, ["2026-10-01"], CFG, NOW, "dinner");
  assert.equal(d.available, false);
  assert.match(d.reason, /晚餐/);
});
testAsync("C-AST-19", "卡片最後把關：沒被搜尋工具回傳過的品項、含會員過敏原的品項都不出卡", async () => {
  const seen = new Set(["beef", "soy"]);
  const cards = await assistant.buildCards({ menuItemIds: ["burdock", "beef", "soy"] }, astCatalog(), new Map(), "zh", CFG, NOW, { seen, taste: { prefs: [], allergies: ["大豆"] } });
  assert.deepEqual(cards.map((c) => c.id), ["beef"]);
});
test("V-CAL-05", "校準準確率與誤差由程式算（不經 LLM）：Σ取餐÷Σ鎖定、平均落差", () => {
  const cal = req("vendorCalibration.js");
  const st = cal.calibrationStats([{ locked_qty: 10, fulfilled_qty: 8 }, { locked_qty: 5, fulfilled_qty: 5 }, { locked_qty: 0, fulfilled_qty: 0 }]);
  assert.equal(st.accuracy_rate, 0.867);
  assert.equal(st.error_range, "±1 份");
  assert.equal(st.max_gap, 2);
  assert.equal(st.rounds, 2);
});
test("F-24", "常一起買：購物籃配對（品名）→ 同店品項 id，依 buyers 排序、最多 5 個；沒變不寫、配對消失要清掉", () => {
  const { oftenWithByItem, oftenWithUpdates } = req("customerInsights.js").helpers;
  const items = [
    { id: "a", vendor_id: "v1", name: "雞腿便當" },
    { id: "b", vendor_id: "v1", name: "滷蛋" },
    { id: "c", vendor_id: "v1", name: "紅茶" },
    { id: "x", vendor_id: "v2", name: "滷蛋" }, // same name at another vendor; must not mix into v1's pairs
    { id: "old", vendor_id: "v1", name: "停售品", often_with: ["a"] },
    { id: "same", vendor_id: "v3", name: "粥", often_with: ["side"] },
    { id: "side", vendor_id: "v3", name: "小菜", often_with: ["same"] },
  ];
  const pairs = [
    { vendor_id: "v1", item_a: "滷蛋", item_b: "雞腿便當", buyers: 3, confidence: 0.5 },
    { vendor_id: "v1", item_a: "紅茶", item_b: "雞腿便當", buyers: 5, confidence: 0.4 },
    { vendor_id: "v1", item_a: "A方案・第1/5天", item_b: "雞腿便當", buyers: 9, confidence: 1 }, // matches no item, skipped
    { vendor_id: "v3", item_a: "小菜", item_b: "粥", buyers: 2, confidence: 1 },
  ];
  const m = oftenWithByItem(pairs, items);
  assert.deepEqual(m.get("a"), ["c", "b"]);
  assert.deepEqual(m.get("b"), ["a"]);
  assert.equal(m.has("x"), false);
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, vendor_id: "v9", name: `配菜${i}` }));
  const m2 = oftenWithByItem(many.slice(1).map((s, i) => ({ vendor_id: "v9", item_a: "配菜0", item_b: s.name, buyers: 10 - i, confidence: 1 })), many);
  assert.deepEqual(m2.get("s0"), ["s1", "s2", "s3", "s4", "s5"]);
  const updates = oftenWithUpdates(pairs, items);
  assert.deepEqual(updates.map((u) => u.id).sort(), ["a", "b", "c", "old"]);
  assert.equal(updates.find((u) => u.id === "old").often_with, null);
});
test("C-AST-20", "推薦理由：只收有 getVendorInsights 資料的店、20 字內、沒有催促字眼", () => {
  const { cardReason } = assistant;
  const grounded = new Set(["v1"]);
  assert.equal(cardReason("預估比平常不擁擠", "v1", grounded, "zh"), "預估比平常不擁擠");
  assert.equal(cardReason("預估比平常不擁擠", "v2", grounded, "zh"), null);
  assert.equal(cardReason("很多人訂，快搶", "v1", grounded, "zh"), null);
  assert.equal(cardReason("這家店的便當很好吃而且份量很大配菜也很豐富喔", "v1", grounded, "zh"), null);
  assert.equal(cardReason("Often ordered with braised egg", "v1", grounded, "en"), "Often ordered with braised egg");
  assert.equal(cardReason("", "v1", grounded, "zh"), null);
});
test("C-AST-21", "回覆是純文字：模型用的 Markdown 粗體、標題、項目符號被拿掉", () => {
  const { plainText } = assistant;
  assert.equal(plainText("1. **麻婆豆腐素食便當**（仁和雅咖啡）"), "1. 麻婆豆腐素食便當（仁和雅咖啡）");
  assert.equal(plainText("## 推薦\n* 素排便當\n- 五穀雜糧便當"), "推薦\n・素排便當\n・五穀雜糧便當");
  assert.equal(plainText("預算 120 元以內"), "預算 120 元以內");
});

(async () => {
  for (const [id, name, fn] of asyncTests) {
    try { await fn(); results.push([id, "PASS", name, ""]); }
    catch (e) { results.push([id, "FAIL", name, e.message.split("\n")[0]]); }
  }
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
  for (const [id, st, name, msg] of results) console.log(`${st}  ${pad(id, 11)} ${name}${msg ? "  → " + msg : ""}`);
  const fails = results.filter((r) => r[1] === "FAIL").length;
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
})();

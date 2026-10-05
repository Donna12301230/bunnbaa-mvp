/**
 * 第一階段規格（doc/BunnBaa 飯飽｜第一階段技術規格.md）的 demo 資料。
 * 跑在舊的 seed.js（商家、帳號、舊 locks）之後；全部用固定 doc id，重跑會覆蓋，不會重複。
 *
 * 寫入：
 *   platformConfig/global            全域參數（§2）
 *   dishLibrary/*                    平台菜色庫（開放許願歸類用）
 *   templates/*                      定式菜單模板 ×6（§3.1）
 *   vendors/{demo}/ingredients|components|suppliers、menu_items    兩家 demo 店的配方與便當
 *   vendors/{demo} lat/lng           取餐點座標（附近愛心餐、區域洞察）
 *   locks（p1-*）                    過去 4 週的歷史訂單（預測、區域洞察）＋下一個營業日的訂單與許願
 *   sideWishes、prepPlans（報廢數）、openWishes、wishTally
 *   rewardPeriods、rewardTickets、coupons、rewardStatus   仁和雅上一期已開池（§8）
 *
 * 歷史訂單直接帶 reward_counted: true、tags，不依賴 Functions 觸發器，emulator 或正式站都能跑。
 *
 * 用法：
 *   node scripts/seed-phase1.js                 # 全部
 *   node scripts/seed-phase1.js --catalog-only  # 只寫參數、菜色庫、模板、配方與菜單（不寫訂單／獎勵）
 * 需要服務帳號（GOOGLE_APPLICATION_CREDENTIALS）或 emulator（FIRESTORE_EMULATOR_HOST）。
 */
const admin = require("firebase-admin");
const { dishTags, componentCost, portionLevelFor, portionText } = require("../functions/src/bento");
const { allocatePool, tierInfo } = require("../functions/src/rewards");
const { DEFAULT_PLATFORM_CONFIG } = require("../functions/src/config");
const { taipeiToday, addDays, mondayOf, weekdayOf } = require("../functions/src/calendar");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;
const CATALOG_ONLY = process.argv.includes("--catalog-only");

class BatchWriter {
  constructor() {
    this.batch = db.batch();
    this.n = 0;
    this.total = 0;
  }
  async set(ref, data, opts) {
    opts ? this.batch.set(ref, data, opts) : this.batch.set(ref, data);
    if (++this.n >= 400) await this.flush();
  }
  async flush() {
    if (!this.n) return;
    await this.batch.commit();
    this.total += this.n;
    this.batch = db.batch();
    this.n = 0;
  }
}

// 可重現的亂數（同一份資料重跑結果一樣）
let seed = 20260930;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pickOne = (arr) => arr[Math.floor(rand() * arr.length)];

/* ------------------------------------------------------------------ *
 * 原物料與半成品（模板共用）。grams＝每份熟重（以個計的填個數）。
 * ------------------------------------------------------------------ */
const ING = {
  rice: { name: "生米", category: "米", unit: "g", purchase_unit_label: "袋(30kg)", purchase_unit_size: 30000, yield_rate: 2.2, loss_rate: 0.02, shelf_days: 180, frequency: "monthly", unit_price: 1500 },
  brown_rice: { name: "五穀米", category: "米", unit: "g", purchase_unit_label: "袋(5kg)", purchase_unit_size: 5000, yield_rate: 2.1, loss_rate: 0.02, shelf_days: 180, frequency: "monthly", unit_price: 520 },
  noodle: { name: "油麵", category: "麵", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 1.3, loss_rate: 0.03, shelf_days: 3, frequency: "weekly", unit_price: 60 },
  chicken_leg: { name: "雞腿", category: "雞", unit: "個", purchase_unit_label: "箱(40支)", purchase_unit_size: 40, yield_rate: 1, loss_rate: 0.02, shelf_days: 30, frequency: "weekly", unit_price: 1400 },
  chicken_breast: { name: "雞胸肉", category: "雞", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 0.75, loss_rate: 0.03, shelf_days: 30, frequency: "weekly", unit_price: 180 },
  pork_chop: { name: "里肌排", category: "豬", unit: "個", purchase_unit_label: "箱(30片)", purchase_unit_size: 30, yield_rate: 1, loss_rate: 0.02, shelf_days: 30, frequency: "weekly", unit_price: 900 },
  pork_mince: { name: "豬絞肉", category: "豬", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 0.8, loss_rate: 0.02, shelf_days: 3, frequency: "weekly", unit_price: 220 },
  beef: { name: "牛五花片", category: "牛", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 0.7, loss_rate: 0.03, shelf_days: 30, frequency: "weekly", unit_price: 420 },
  egg: { name: "雞蛋", category: "蛋", unit: "個", purchase_unit_label: "盒(30顆)", purchase_unit_size: 30, yield_rate: 1, loss_rate: 0.02, shelf_days: 14, frequency: "weekly", unit_price: 180 },
  tofu_dry: { name: "豆干", category: "豆", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 1, loss_rate: 0, shelf_days: 5, frequency: "weekly", unit_price: 90 },
  tofu: { name: "板豆腐", category: "豆", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 0.95, loss_rate: 0.05, shelf_days: 3, frequency: "weekly", unit_price: 70 },
  cabbage: { name: "高麗菜", category: "葉菜", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 0.9, loss_rate: 0.15, shelf_days: 5, frequency: "weekly", unit_price: 45 },
  bokchoy: { name: "小白菜", category: "葉菜", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 0.85, loss_rate: 0.2, shelf_days: 2, frequency: "weekly", unit_price: 55 },
  sweet_potato_leaf: { name: "地瓜葉", category: "葉菜", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 0.85, loss_rate: 0.25, shelf_days: 2, frequency: "weekly", unit_price: 50 },
  water_bamboo: { name: "筊白筍", category: "根莖", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 0.9, loss_rate: 0.2, shelf_days: 4, frequency: "weekly", unit_price: 180 },
  corn: { name: "玉米粒", category: "其他", unit: "g", purchase_unit_label: "包(1kg)", purchase_unit_size: 1000, yield_rate: 1, loss_rate: 0, shelf_days: 90, frequency: "weekly", unit_price: 80 },
  tomato: { name: "牛番茄", category: "瓜類", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 0.9, loss_rate: 0.1, shelf_days: 5, frequency: "weekly", unit_price: 70 },
  broccoli: { name: "花椰菜", category: "葉菜", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 0.9, loss_rate: 0.3, shelf_days: 4, frequency: "weekly", unit_price: 90 },
  pumpkin: { name: "南瓜", category: "瓜類", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000, yield_rate: 0.9, loss_rate: 0.15, shelf_days: 14, frequency: "weekly", unit_price: 50 },
  soy_sauce: { name: "醬油", category: "調味", unit: "ml", purchase_unit_label: "瓶(1L)", purchase_unit_size: 1000, yield_rate: 1, loss_rate: 0, shelf_days: 365, frequency: "monthly", unit_price: 120 },
  oil: { name: "沙拉油", category: "調味", unit: "ml", purchase_unit_label: "桶(3L)", purchase_unit_size: 3000, yield_rate: 1, loss_rate: 0, shelf_days: 365, frequency: "monthly", unit_price: 350 },
  chili: { name: "辣椒醬", category: "調味", unit: "ml", purchase_unit_label: "罐(500ml)", purchase_unit_size: 500, yield_rate: 1, loss_rate: 0, shelf_days: 180, frequency: "monthly", unit_price: 90 },
  box: { name: "便當盒", category: "包材", unit: "個", purchase_unit_label: "包(100個)", purchase_unit_size: 100, yield_rate: 1, loss_rate: 0, shelf_days: 999, frequency: "monthly", unit_price: 250 },
};

const COMP = {
  white_rice: { name: "白飯", portion_grams: 200, ingredients: [["rice", 200], ["box", 1]], prep_minutes: 40, equipment: "電鍋", batch_capacity: 25, advance_hours: 0, method: "煮", flavors: [] },
  grain_rice: { name: "五穀飯", portion_grams: 180, ingredients: [["brown_rice", 180], ["box", 1]], prep_minutes: 50, equipment: "電鍋", batch_capacity: 20, advance_hours: 0, method: "煮", flavors: ["清淡"] },
  braised_leg: { name: "滷雞腿", portion_grams: 180, ingredients: [["chicken_leg", 1], ["soy_sauce", 10]], prep_minutes: 90, equipment: "滷鍋", batch_capacity: 40, advance_hours: 12, method: "滷", flavors: [] },
  fried_chop: { name: "炸排骨", portion_grams: 150, ingredients: [["pork_chop", 1], ["oil", 20]], prep_minutes: 12, equipment: "炸鍋", batch_capacity: 10, advance_hours: 0, method: "炸", flavors: [] },
  grilled_breast: { name: "烤雞胸", portion_grams: 120, ingredients: [["chicken_breast", 120]], prep_minutes: 25, equipment: "烤箱", batch_capacity: 20, advance_hours: 0, method: "烤", flavors: ["清淡"] },
  beef_don: { name: "壽喜燒牛", portion_grams: 130, ingredients: [["beef", 110], ["soy_sauce", 15]], prep_minutes: 15, equipment: "炒鍋", batch_capacity: 15, advance_hours: 0, method: "炒", flavors: ["甜"] },
  mapo_tofu: { name: "麻婆豆腐", portion_grams: 150, ingredients: [["tofu", 120], ["pork_mince", 20], ["chili", 10]], prep_minutes: 20, equipment: "炒鍋", batch_capacity: 20, advance_hours: 0, method: "炒", flavors: ["辣"] },
  braised_egg: { name: "滷蛋", portion_grams: 50, ingredients: [["egg", 1], ["soy_sauce", 5]], prep_minutes: 60, equipment: "滷鍋", batch_capacity: 60, advance_hours: 12, method: "滷", flavors: [] },
  cabbage: { name: "炒高麗菜", portion_grams: 80, ingredients: [["cabbage", 80], ["oil", 5]], prep_minutes: 15, equipment: "炒鍋", batch_capacity: 20, advance_hours: 0, method: "炒", flavors: ["清淡"] },
  bokchoy: { name: "炒小白菜", portion_grams: 80, ingredients: [["bokchoy", 80], ["oil", 5]], prep_minutes: 12, equipment: "炒鍋", batch_capacity: 20, advance_hours: 0, method: "炒", flavors: ["清淡"] },
  sweet_potato_leaf: { name: "炒地瓜葉", portion_grams: 80, ingredients: [["sweet_potato_leaf", 80], ["oil", 5]], prep_minutes: 12, equipment: "炒鍋", batch_capacity: 20, advance_hours: 0, method: "炒", flavors: ["清淡"] },
  water_bamboo: { name: "筊白筍", portion_grams: 35, ingredients: [["water_bamboo", 35], ["oil", 3]], prep_minutes: 12, equipment: "炒鍋", batch_capacity: 20, advance_hours: 0, method: "炒", flavors: ["清淡"] },
  corn_pork: { name: "玉米炒肉", portion_grams: 70, ingredients: [["corn", 45], ["pork_mince", 25], ["oil", 5]], prep_minutes: 15, equipment: "炒鍋", batch_capacity: 20, advance_hours: 0, method: "炒", flavors: [] },
  tomato_egg: { name: "番茄炒蛋", portion_grams: 80, ingredients: [["tomato", 50], ["egg", 1], ["oil", 5]], prep_minutes: 12, equipment: "炒鍋", batch_capacity: 20, advance_hours: 0, method: "炒", flavors: ["甜"] },
  braised_tofu: { name: "滷豆干", portion_grams: 60, ingredients: [["tofu_dry", 60], ["soy_sauce", 5]], prep_minutes: 45, equipment: "滷鍋", batch_capacity: 60, advance_hours: 12, method: "滷", flavors: [] },
  broccoli: { name: "燙花椰菜", portion_grams: 70, ingredients: [["broccoli", 70]], prep_minutes: 10, equipment: "湯鍋", batch_capacity: 30, advance_hours: 0, method: "煮", flavors: ["清淡"] },
  pumpkin: { name: "蒸南瓜", portion_grams: 70, ingredients: [["pumpkin", 70]], prep_minutes: 25, equipment: "蒸籠", batch_capacity: 30, advance_hours: 0, method: "蒸", flavors: ["甜", "清淡"] },
  noodle: { name: "乾拌麵", portion_grams: 220, ingredients: [["noodle", 220], ["soy_sauce", 10], ["box", 1]], prep_minutes: 5, equipment: "湯鍋", batch_capacity: 8, advance_hours: 0, method: "煮", flavors: [] },
};

const slot = (category, def, candidates = []) => ({ category, default: { name: COMP[def].name, component: def }, candidates: candidates.map((c) => ({ name: COMP[c].name, component: c, portion_level: 1 })) });

const TEMPLATES = [
  {
    id: "classic", name: "經典便當", structure: "白飯 + 主菜 + 3 配菜 + 滷蛋",
    items: [{ key: "classic", name: "滷雞腿便當", price: 110, category: "便當", description: "經典滷雞腿，三樣配菜＋滷蛋", main: { name: "滷雞腿", component: "braised_leg" }, rice_component: "white_rice", fixed: [{ name: "滷蛋", component: "braised_egg" }], slots: [slot("青菜類", "cabbage", ["bokchoy", "sweet_potato_leaf", "water_bamboo"]), slot("肉類配菜", "corn_pork"), slot("蛋豆類", "braised_tofu", ["tomato_egg"])] }],
  },
  {
    id: "weekly_rotation", name: "週菜單輪替", structure: "主菜週一至週五輪替（經典便當結構）",
    items: [
      { key: "rot_mon", name: "週一 滷雞腿便當", price: 110, category: "本週主菜", weekdays: [1, 3, 5], main: { name: "滷雞腿", component: "braised_leg" }, rice_component: "white_rice", fixed: [{ name: "滷蛋", component: "braised_egg" }], slots: [slot("青菜類", "cabbage", ["bokchoy", "sweet_potato_leaf"]), slot("肉類配菜", "corn_pork"), slot("蛋豆類", "braised_tofu")] },
      { key: "rot_tue", name: "週二 炸排骨便當", price: 105, category: "本週主菜", weekdays: [2, 4], main: { name: "炸排骨", component: "fried_chop" }, rice_component: "white_rice", fixed: [{ name: "滷蛋", component: "braised_egg" }], slots: [slot("青菜類", "cabbage", ["bokchoy"]), slot("肉類配菜", "corn_pork"), slot("蛋豆類", "tomato_egg")] },
    ],
  },
  {
    id: "healthy", name: "健康餐盒", structure: "糙米或五穀飯 + 主蛋白 + 4 配菜",
    items: [{ key: "healthy", name: "烤雞胸健康餐盒", price: 130, category: "健康餐盒", main: { name: "烤雞胸", component: "grilled_breast" }, rice_component: "grain_rice", slots: [slot("青菜類", "broccoli", ["cabbage"]), slot("青菜類", "sweet_potato_leaf", ["bokchoy"]), slot("根莖類", "pumpkin"), slot("蛋豆類", "tomato_egg", ["braised_tofu"])] }],
  },
  {
    id: "veggie", name: "素食便當", structure: "白飯 + 素主菜 + 3 配菜",
    items: [{ key: "veggie", name: "麻婆豆腐素食便當", price: 95, category: "素食", dietary_tags: ["素食"], main: { name: "麻婆豆腐", component: "mapo_tofu" }, rice_component: "white_rice", slots: [slot("青菜類", "cabbage", ["bokchoy", "sweet_potato_leaf"]), slot("根莖類", "pumpkin"), slot("蛋豆類", "braised_tofu")] }],
  },
  {
    id: "don", name: "丼飯", structure: "白飯 + 主菜 + 1 配菜",
    items: [{ key: "don", name: "壽喜燒牛丼", price: 120, category: "丼飯", main: { name: "壽喜燒牛", component: "beef_don" }, rice_component: "white_rice", slots: [slot("青菜類", "cabbage", ["broccoli"])] }],
  },
  {
    id: "noodle", name: "麵食", structure: "麵 + 湯底 + 配料",
    items: [{ key: "noodle", name: "古早味乾拌麵", price: 80, category: "麵食", main: { name: "乾拌麵", component: "noodle" }, slots: [slot("青菜類", "bokchoy", ["cabbage"]), slot("蛋豆類", "braised_egg", ["braised_tofu"])] }],
  },
];

const DISHES = [
  ["炒高麗菜", "青菜類", ["高麗菜"], ["葉菜", "炒", "清淡"]], ["炒小白菜", "青菜類", ["小白菜"], ["葉菜", "炒", "清淡"]],
  ["炒地瓜葉", "青菜類", ["地瓜葉", "番薯葉"], ["葉菜", "炒", "清淡"]], ["空心菜", "青菜類", ["蕹菜"], ["葉菜", "炒"]],
  ["燙花椰菜", "青菜類", ["花椰菜", "青花菜"], ["葉菜", "清淡"]], ["筊白筍", "根莖類", ["茭白筍", "美人腿"], ["根莖", "炒"]],
  ["蒸南瓜", "根莖類", ["南瓜"], ["瓜類", "蒸", "甜"]], ["涼拌小黃瓜", "青菜類", ["小黃瓜"], ["瓜類", "清淡"]],
  ["玉米炒肉", "肉類配菜", ["玉米肉末"], ["豬", "炒"]], ["瓜仔肉", "肉類配菜", ["瓜子肉"], ["豬", "滷"]],
  ["宮保雞丁", "肉類配菜", [], ["雞", "炒", "辣"]], ["三杯雞", "肉類配菜", [], ["雞", "炒"]],
  ["番茄炒蛋", "蛋豆類", ["蕃茄炒蛋"], ["素", "炒", "甜"]], ["滷豆干", "蛋豆類", ["豆干"], ["素", "滷"]],
  ["滷蛋", "蛋豆類", [], ["素", "滷"]], ["麻婆豆腐", "蛋豆類", ["麻婆"], ["素", "辣", "炒"]], ["蔥蛋", "蛋豆類", ["菜脯蛋"], ["素", "煎"]],
  ["滷雞腿", "主菜", ["雞腿"], ["雞", "滷"]], ["炸雞腿", "主菜", [], ["雞", "炸"]], ["炸排骨", "主菜", ["排骨"], ["豬", "炸"]],
  ["控肉", "主菜", ["焢肉", "爌肉"], ["豬", "滷"]], ["烤鯖魚", "主菜", ["鯖魚"], ["海鮮", "烤"]], ["烤雞胸", "主菜", ["舒肥雞胸"], ["雞", "烤", "清淡"]],
  ["壽喜燒牛", "主菜", ["牛肉片"], ["牛", "炒", "甜"]], ["紅燒牛腩", "主菜", ["牛腩"], ["牛", "滷"]], ["鹽酥雞", "主菜", [], ["雞", "炸"]],
  ["咖哩雞", "主菜", [], ["雞", "煮", "辣"]], ["糖醋里肌", "主菜", [], ["豬", "炸", "甜"]], ["蒜泥白肉", "主菜", [], ["豬", "清淡"]],
];

// 取餐點座標（嘉義市，仁和雅與王媽媽約 900 公尺）
const LOCATIONS = {
  "cafe-renheya-demo": { lat: 23.4817, lng: 120.4530 },
  "wang-mama-biandang": { lat: 23.4868, lng: 120.4462 },
  "ajia-friedchicken": { lat: 23.4792, lng: 120.4471 },
  "zaoan-sandwich": { lat: 23.4760, lng: 120.4705 },
};

// demo 店使用的模板（固定 menu_items id，重跑會覆蓋）
const DEMO_VENDORS = [
  { id: "cafe-renheya-demo", templates: ["classic", "healthy", "veggie"], daily: 34 },
  { id: "wang-mama-biandang", templates: ["weekly_rotation", "don"], daily: 22 },
];

function resolveTemplate(templateIds) {
  const ingKeys = new Set();
  const compKeys = new Set();
  const items = [];
  for (const id of templateIds) {
    const tpl = TEMPLATES.find((x) => x.id === id);
    for (const item of tpl.items) {
      items.push({ ...item, template: id });
      const comps = [item.main?.component, item.rice_component, ...(item.fixed || []).map((f) => f.component), ...(item.slots || []).flatMap((s) => [s.default.component, ...s.candidates.map((c) => c.component)])].filter(Boolean);
      comps.forEach((c) => compKeys.add(c));
    }
  }
  compKeys.forEach((c) => COMP[c].ingredients.forEach(([i]) => ingKeys.add(i)));
  return { ingKeys: [...ingKeys], compKeys: [...compKeys], items };
}

function componentDoc(key) {
  const c = COMP[key];
  return { ...c, ingredients: c.ingredients.map(([ingredient_id, grams]) => ({ ingredient_id, grams })) };
}

async function seedCatalog(writer) {
  await writer.set(db.collection("platformConfig").doc("global"), { ...DEFAULT_PLATFORM_CONFIG, updated_at: FieldValue.serverTimestamp() });
  for (const [name, category, aliases, tags] of DISHES) {
    await writer.set(db.collection("dishLibrary").doc(`dish-${Buffer.from(name).toString("hex").slice(0, 24)}`), { name, category, aliases, tags });
  }
  for (const tpl of TEMPLATES) {
    const { ingKeys, compKeys } = resolveTemplate([tpl.id]);
    await writer.set(db.collection("templates").doc(tpl.id), {
      name: tpl.name, structure: tpl.structure,
      ingredients: ingKeys.map((k) => ({ key: k, ...ING[k], supplier_id: null })),
      components: compKeys.map((k) => ({ key: k, ...COMP[k], ingredients: COMP[k].ingredients.map(([ingredient, grams]) => ({ ingredient, grams })) })),
      items: tpl.items.map(({ key, ...rest }) => ({ ...rest, allergens: [], dietary_tags: rest.dietary_tags || [] })),
    });
  }
  console.log(`platformConfig, ${DISHES.length} dishes, ${TEMPLATES.length} templates`);
}

/** 兩家 demo 店：原物料、半成品、小盤商、便當品項（份量級距依成本計算） */
async function seedVendorCatalogs(writer) {
  const catalogs = {};
  for (const v of DEMO_VENDORS) {
    const vendorRef = db.collection("vendors").doc(v.id);
    const { ingKeys, compKeys, items } = resolveTemplate(v.templates);
    await writer.set(vendorRef.collection("suppliers").doc("sup-veg"), { name: "嘉義果菜小盤", phone: "05-2222333", line_id: "chiayi-veg", note: "葉菜週一、三到貨" });
    await writer.set(vendorRef.collection("suppliers").doc("sup-dry"), { name: "大同乾貨行", phone: "05-2333444", line_id: "", note: "米油包材，每月叫一次" });
    const ingredientsById = {};
    for (const k of ingKeys) {
      const doc = { ...ING[k], supplier_id: ["葉菜", "根莖", "瓜類"].includes(ING[k].category) ? "sup-veg" : ING[k].frequency === "monthly" ? "sup-dry" : null };
      ingredientsById[k] = { id: k, ...doc };
      await writer.set(vendorRef.collection("ingredients").doc(k), doc);
    }
    const componentsById = {};
    for (const k of compKeys) {
      componentsById[k] = { id: k, ...componentDoc(k) };
      await writer.set(vendorRef.collection("components").doc(k), componentDoc(k));
    }
    const itemsById = {};
    for (const item of items) {
      const id = `${v.id}-${item.key}`;
      // 材料總和（§4.2）的份量文字，跟店家在菜單管理儲存時一樣由配方帶出
      const portion = (component, name) => portionText(componentsById[component], ingredientsById, name);
      const slots = (item.slots || []).map((s) => {
        const base = componentCost(componentsById[s.default.component], ingredientsById);
        return {
          category: s.category,
          default: { name: s.default.name, component_id: s.default.component, portion_text: portion(s.default.component, s.default.name) },
          candidates: s.candidates.map((c, ci) => {
            const level = portionLevelFor(base, componentCost(componentsById[c.component], ingredientsById));
            return { name: c.name, component_id: c.component, portion_text: portion(c.component, c.name), portion_level: level ?? 0.5, disabled: level === null, weekly_cap: ci === 0 ? 60 : null, min_qty: null };
          }),
        };
      });
      const docData = {
        vendor_id: v.id, name: item.name, description: item.description || `${item.main.name}，配菜可許願、可加減飯`, price: item.price,
        category: item.category, is_available: true, image: null, allergens: [], dietary_tags: item.dietary_tags || [], template: item.template,
        main: { name: item.main.name, component_id: item.main.component, portion_text: portion(item.main.component, item.main.name) }, rice_component_id: item.rice_component || null,
        fixed: (item.fixed || []).map((f) => ({ name: f.name, component_id: f.component, portion_text: portion(f.component, f.name) })), slots, weekdays: item.weekdays || [],
        created_at: FieldValue.serverTimestamp(),
      };
      itemsById[id] = { id, ...docData };
      await writer.set(db.collection("menu_items").doc(id), docData);
    }
    await writer.set(vendorRef, { ...LOCATIONS[v.id], pickup_windows: ["11:00-11:30", "11:30-12:00", "12:00-12:30", "12:30-13:00"] }, { merge: true });
    catalogs[v.id] = { itemsById, componentsById, ingredientsById };
  }
  for (const [id, loc] of Object.entries(LOCATIONS)) {
    if (!DEMO_VENDORS.some((v) => v.id === id)) await writer.set(db.collection("vendors").doc(id), loc, { merge: true });
  }
  return catalogs;
}

/* ------------------------------------------------------------------ *
 * 訂單歷史（過去 4 週）＋下一個營業日的訂單
 * ------------------------------------------------------------------ */
const PAYERS = Array.from({ length: 48 }, (_, i) => `demo-payer-${String(i + 1).padStart(2, "0")}`);
const WINDOWS = ["11:00-11:30", "11:30-12:00", "12:00-12:30", "12:30-13:00"];

function tagsFor(item, slots, catalog) {
  const tags = new Set(dishTags(catalog.componentsById[item.main.component_id], catalog.ingredientsById));
  slots.forEach((s, i) => {
    if (s.removed) return;
    const compId = s.wished && s.resolved === s.wished ? s.wished_component_id : item.slots[i].default.component_id;
    dishTags(catalog.componentsById[compId], catalog.ingredientsById).forEach((t) => tags.add(t));
  });
  return [...tags];
}

function buildLock(vendorId, item, date, idx, catalog, { status, wishes }) {
  const slots = item.slots.map((s, i) => {
    const base = { category: s.category, default_dish: s.default.name, default_component_id: s.default.component_id };
    const roll = rand();
    if (i === item.slots.length - 1 && roll < 0.08) return { ...base, removed: true, wished: null, resolved: null, portion_level: null };
    const cand = s.candidates.find((c) => !c.disabled);
    if (cand && roll < 0.25) {
      const ci = s.candidates.indexOf(cand);
      const ok = wishes;
      return { ...base, removed: false, wished: cand.name, wished_component_id: cand.component_id, candidate_index: ci, resolved: ok ? cand.name : s.default.name, portion_level: ok ? cand.portion_level : 1 };
    }
    return { ...base, removed: false, wished: null, resolved: s.default.name, portion_level: 1 };
  });
  const rice = item.rice_component_id ? pickOne(["normal", "normal", "normal", "normal", "add", "less"]) : "normal";
  const removed = slots.filter((s) => s.removed).length;
  const adjust = removed * -5 + (rice === "add" ? 10 : rice === "less" ? -5 : 0);
  const early = Math.round(item.price * 0.8);
  const payer = pickOne(PAYERS);
  return {
    vendor_id: vendorId, menu_item_id: item.id, item_name: item.name, pickup_date: date, pickup_window: pickOne(WINDOWS),
    slots, rice, list_price: item.price, discount_percent: 20, early_bird_amount: item.price - early, adjust_amount: adjust,
    coupon_id: null, coupon_discount: 0, locked_price: early + adjust, resellable: true,
    status, buyer_uid: payer, payer_uid: payer, pickup_code: String(1000 + idx).slice(-4), phone_last3: String(100 + (idx % 900)),
    share_token: `seed${vendorId.length}${idx}`, cutoff_done: status !== "locked", reward_counted: status !== "locked",
    tickets_issued: 0, reward_period: mondayOf(date), tags: tagsFor(item, slots, catalog),
    ...(status === "charity" ? { charity_source: "noshow" } : {}),
    created_at: Timestamp.fromDate(new Date(`${addDays(date, -3)}T10:00:00+08:00`)),
  };
}

async function seedHistory(writer, catalogs) {
  const today = taipeiToday();
  const revenueByVendorWeek = {};
  let count = 0;
  for (const v of DEMO_VENDORS) {
    const catalog = catalogs[v.id];
    const items = Object.values(catalog.itemsById);
    for (let back = 28; back >= 1; back--) {
      const date = addDays(today, -back);
      const wd = weekdayOf(date);
      if (wd === 0 || wd === 6) continue;
      const served = items.filter((it) => !it.weekdays?.length || it.weekdays.includes(wd));
      const n = Math.round(v.daily * (0.85 + rand() * 0.3) * (wd === 5 ? 0.85 : 1));
      let wasted = 0;
      for (let i = 0; i < n; i++) {
        const r = rand();
        const status = r < 0.06 ? "charity" : "fulfilled";
        const lock = buildLock(v.id, pickOne(served), date, i, catalog, { status, wishes: rand() < 0.6 });
        if (status === "charity" && rand() < 0.4) wasted++;
        await writer.set(db.collection("locks").doc(`p1-${v.id}-${date}-${i}`), lock);
        const week = mondayOf(date);
        revenueByVendorWeek[`${v.id}|${week}`] = (revenueByVendorWeek[`${v.id}|${week}`] || 0) + lock.locked_price;
        count++;
      }
      await writer.set(db.collection("vendors").doc(v.id).collection("prepPlans").doc(date), {
        date, week: mondayOf(date), order_count: n, charity_result: { total: Math.round(n * 0.06), reserved_claimed: 1, given_onsite: Math.max(0, Math.round(n * 0.06) - 1 - wasted), wasted },
      }, { merge: true });
    }
  }
  console.log(`${count} historical locks`);
  return revenueByVendorWeek;
}

/** 下一個營業日：12 份訂單，其中 7 份許願小白菜（最低 10 份，顯示 7/10） */
async function seedUpcoming(writer, catalogs) {
  let date = addDays(taipeiToday(), 1);
  while ([0, 6].includes(weekdayOf(date))) date = addDays(date, 1);
  const v = DEMO_VENDORS[0];
  const catalog = catalogs[v.id];
  const item = catalog.itemsById[`${v.id}-classic`];
  const wishCounts = {};
  for (let i = 0; i < 12; i++) {
    const lock = buildLock(v.id, item, date, 500 + i, catalog, { status: "locked", wishes: false });
    lock.slots = lock.slots.map((s, si) => {
      if (si !== 0) return { ...s, resolved: s.wished ? null : s.resolved };
      const cand = i < 7 ? 0 : i < 9 ? 1 : null;
      if (cand === null) return { ...s, removed: false, wished: null, resolved: s.default_dish, portion_level: 1 };
      const c = item.slots[0].candidates[cand];
      wishCounts[cand] = (wishCounts[cand] || 0) + 1;
      return { ...s, removed: false, wished: c.name, wished_component_id: c.component_id, candidate_index: cand, resolved: null, portion_level: c.portion_level };
    });
    lock.cutoff_at = Timestamp.fromDate(new Date(`${addDays(date, -1)}T20:00:00+08:00`));
    lock.reward_counted = false;
    await writer.set(db.collection("locks").doc(`p1-${v.id}-${date}-up${i}`), lock);
  }
  for (const [cand, n] of Object.entries(wishCounts)) {
    await writer.set(db.collection("sideWishes").doc(`${v.id}_${date}_${item.id}_0_${cand}`), {
      vendor_id: v.id, date, week: mondayOf(date), item_id: item.id, slot: 0, candidate: Number(cand), dish: item.slots[0].candidates[cand].name, count: n,
    });
  }
  console.log(`12 upcoming locks on ${date} (wish counts ${JSON.stringify(wishCounts)})`);
}

async function seedOpenWishes(writer) {
  const v = DEMO_VENDORS[0].id;
  const wishes = [["麻婆豆腐", 22], ["番茄炒蛋", 9], ["三杯雞", 5]];
  for (const [dish, people] of wishes) {
    const key = dish;
    for (let i = 0; i < people; i++) {
      const uid = PAYERS[i];
      await writer.set(db.collection("openWishes").doc(`${v}_${uid}_${key}`), {
        user_id: uid, vendor_id: v, dish_id: null, dish_key: key, dish_name: dish, created_at: Timestamp.fromDate(new Date(Date.now() - (i + 1) * 3600000)),
      });
    }
    await writer.set(db.collection("vendors").doc(v).collection("wishTally").doc(key), { name: dish, count: people, notified: people >= 20, updated_at: FieldValue.serverTimestamp() });
  }
  console.log("open wishes (麻婆豆腐 22 people → shortlist)");
}

/** 仁和雅上一期已開池；王媽媽累積中。demo 消費者（若存在）拿到幾張可抽的抽獎券與 2 張折價券。 */
async function seedRewards(writer, revenueByVendorWeek) {
  const lastWeek = addDays(mondayOf(taipeiToday()), -7);
  let demoUid = null;
  try {
    demoUid = (await admin.auth().getUserByEmail("customer@bunnbaa.test")).uid;
  } catch {
    // 正式站沒有 demo 帳號就只發給假使用者
  }
  const cafe = DEMO_VENDORS[0].id;
  const revenue = revenueByVendorWeek[`${cafe}|${lastWeek}`] || 30000;
  const N = Math.max(100, Math.floor(revenue / 100));
  const pool = Math.floor(revenue * DEFAULT_PLATFORM_CONFIG.rewardRate);
  const { counts, spent, leftover } = allocatePool(pool, N);
  const remaining = { ...counts };
  const deadline = Timestamp.fromMillis(Date.now() + 6 * 86400000);
  const couponIds = [];
  for (const [code, n] of Object.entries(counts)) {
    const tier = tierInfo(code);
    for (let i = 0; i < n; i++) {
      const id = `p1-${cafe}-${lastWeek}-${code}-${i}`;
      couponIds.push({ id, code });
      await writer.set(db.collection("coupons").doc(id), { vendor_id: cafe, vendor_name: "仁和雅咖啡", tier: code, label: tier.label, discount: tier.discount, status: "issued", pool_period: lastWeek, issued_at: FieldValue.serverTimestamp() });
    }
  }
  // demo 消費者：已抽中一張五折券、一張八折券，還有 3 張可抽
  if (demoUid) {
    for (const code of ["t50", "t80"]) {
      const c = couponIds.find((x) => x.code === code && remaining[code] > 0);
      if (!c) continue;
      remaining[code]--;
      couponIds.splice(couponIds.indexOf(c), 1);
      await writer.set(db.collection("coupons").doc(c.id), { status: "owned", user_id: demoUid, owned_at: FieldValue.serverTimestamp(), expires_at: Timestamp.fromMillis(Date.now() + 28 * 86400000) }, { merge: true });
    }
  }
  for (let i = 0; i < N; i++) {
    const owner = demoUid && i < 5 ? demoUid : PAYERS[i % PAYERS.length];
    const drawn = demoUid && i < 2;
    await writer.set(db.collection("rewardTickets").doc(`p1-${cafe}-${lastWeek}-${i}`), {
      vendor_id: cafe, vendor_name: "仁和雅咖啡", user_id: owner, period_id: lastWeek, lock_id: null,
      status: drawn ? "drawn" : "drawable", pool_period: lastWeek, draw_deadline: deadline, created_at: FieldValue.serverTimestamp(),
    });
  }
  const periods = db.collection("vendors").doc(cafe).collection("rewardPeriods");
  await writer.set(periods.doc(lastWeek), {
    period_id: lastWeek, status: "pooled", net_revenue: revenue, tickets: N, total_revenue: revenue, total_tickets: N,
    pool, allocation: counts, remaining, spent, leftover, draw_deadline: deadline, opened_at: FieldValue.serverTimestamp(),
  });
  const thisWeek = mondayOf(taipeiToday());
  const cafeNow = revenueByVendorWeek[`${cafe}|${thisWeek}`] || 0;
  await writer.set(periods.doc(thisWeek), { period_id: thisWeek, net_revenue: cafeNow, tickets: Math.floor(cafeNow / 100) }, { merge: true });
  await writer.set(db.collection("rewardStatus").doc(cafe), {
    vendor_name: "仁和雅咖啡", tickets_so_far: Math.floor(cafeNow / 100), min_tickets: 100, amount_to_open: Math.max(0, (100 - Math.floor(cafeNow / 100)) * 100),
    pool_open: true, pool_period: lastWeek, draw_deadline: deadline, remaining_total: Object.values(remaining).reduce((s, n) => s + n, 0), paused: false,
  });
  const wm = DEMO_VENDORS[1].id;
  const wmRevenue = revenueByVendorWeek[`${wm}|${lastWeek}`] || 0;
  const wmTickets = 63;
  await writer.set(db.collection("vendors").doc(wm).collection("rewardPeriods").doc(lastWeek), { period_id: lastWeek, status: "carried", net_revenue: Math.round(wmRevenue * 0.5), total_tickets: wmTickets });
  await writer.set(db.collection("vendors").doc(wm).collection("rewardPeriods").doc(thisWeek), { period_id: thisWeek, carried_revenue: Math.round(wmRevenue * 0.5), carried_tickets: wmTickets, net_revenue: 0, tickets: 0 }, { merge: true });
  await writer.set(db.collection("rewardStatus").doc(wm), {
    vendor_name: "王媽媽便當", tickets_so_far: wmTickets, min_tickets: 100, amount_to_open: (100 - wmTickets) * 100, pool_open: false, pool_period: null, draw_deadline: null, remaining_total: 0, paused: false,
  });
  console.log(`rewards: 仁和雅 ${lastWeek} pool NT$${pool}, ${N} tickets (${JSON.stringify(counts)}), demo customer ${demoUid ? "found" : "not found"}`);
}

async function main() {
  const writer = new BatchWriter();
  await seedCatalog(writer);
  const catalogs = await seedVendorCatalogs(writer);
  await writer.flush();
  if (CATALOG_ONLY) {
    console.log(`Done (catalog only): ${writer.total} writes`);
    return;
  }
  const revenue = await seedHistory(writer, catalogs);
  await seedUpcoming(writer, catalogs);
  await seedOpenWishes(writer);
  await seedRewards(writer, revenue);
  await writer.flush();
  console.log(`Done: ${writer.total} writes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * 擴充版種子資料：在 seed.js 的 4 家商家之上補成「20 家商家 × 每家 10–20 個品項
 * （多個分類）＋ 100 位虛擬會員 × 每人 1–10 筆訂單」。seed.js 先跑、再跑這支。
 *
 * ── 設計 ─────────────────────────────────────────────────────────────
 * 商家（vendors，20 家）
 *   - 既有 4 家（cafe-renheya-demo／wang-mama-biandang／ajia-friedchicken／
 *     zaoan-sandwich）的商家文件、歷史 locks、payouts、校準報告完全不動，
 *     只補菜單：沿用 seed.js 寫好的 `${id}-item-1`，這裡從 item-2 往下補。
 *   - 新增 16 家（嘉義市、嘉大／中正周邊），各自有 pickup_windows、訂閱狀態，
 *     reliability_tone 依這支產生的訂單履約率算（≥90% stable，其餘 variable）。
 *     不寫 accuracy_reports——等 dailyCalibration 依真實 locks 產生。
 *   - 新商家各有 A／B 兩個計畫方案（meal_plans），跟 seed.js 同一個規則。
 *
 * 品項（menu_items，每家 10–20 個，至少 3 個分類）
 *   - doc id `${vendorId}-item-${n}`，重跑是覆寫同一筆（merge），不會重複。
 *
 * 會員（users，100 位）
 *   - uid `seed-user-001`…`seed-user-100`，欄位同註冊流程（display_name／phone／
 *     school／department／lang），學校＋系所取自 taiwanUnivDepts.json 有的名字。
 *   - emulator 才會另外建 Firebase Auth 帳號：seed001@bunnbaa.test … 密碼 demo1234，
 *     可以直接登入看「我的餐點」。正式站只有 Firestore 資料，登不進去。
 *
 * 訂單（payment_intents＋locks）
 *   - 一筆「訂單」＝一次結帳＝一個 payment_intents（id `seed-order-00001`，
 *     status confirmed），裡面 1–3 個品項、每個 1–2 份；跟正式流程一樣，一份餐
 *     一筆 lock，lock_ids 記在 payment_intents 上。同一筆訂單只會在同一家店、
 *     同一天、同一個取餐時段。
 *   - 每位會員 1–10 筆訂單；每人有 2–3 家常去的店（七成機率挑常去的）。
 *   - 取餐日：約 85% 在過去 60 天、15% 在今天～14 天後。價格照早鳥級距
 *     （當天/隔天 95 折、2–13 天 8 折、14–30 天 7 折，同 pricing.ts）。
 *   - 過去的訂單：fulfilled／resold_and_fulfilled（轉讓給另一位會員取餐）／
 *     no_show（見下一點）。未來的訂單：locked／for_resale／for_gift。
 *   - 固定 6 位會員被封鎖（no_show 達 2 份，同 markLockOutcome 門檻），每人的
 *     未取餐原因（no_show_note）都不同；其他會員最多 1 份 no_show，不會被封鎖。
 *     被封鎖的會員不會有未來訂單；其中 2 位附一筆 pending 的 ban_appeals。
 *   - 取餐日在 2 天前以前的成功 locks 依「商家＋取餐日」結算成 payouts，
 *     昨天的留著給 triggerSettlementNow 現場結算（同 seed.js）。
 *   - 未來的 locks 累加到 slot_counters（份數上限用）。
 *   - 約 35% 已取餐的訂單有一則 reviews（1–5 星），部分 locks 有 consumer_feedback。
 *
 * Gemini：這支不會觸發任何 Gemini 呼叫。translate* 觸發器看到 *_en＋i18n_src
 * 都已經有值就直接略過；onLockCreated 用的 discount_explanations 快取在寫
 * locks 之前先補齊（含英文），已經存在的快取不覆寫。
 *
 * 亂數用固定種子，每次跑出來的會員、訂單內容都一樣（日期相對於執行當天）。
 *
 * 用法：
 *   node scripts/seed.js                       # 先跑原本的種子
 *   node scripts/seed-scale.js                 # 已經有 seed-user-001 就拒絕重跑
 *   node scripts/seed-scale.js --force         # 照樣寫（locks／payouts 會重複）
 *   node scripts/seed-scale.js --catalog-only  # 只寫商家＋菜單＋計畫方案，可重跑
 */
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const { FieldValue, Timestamp } = admin.firestore;

const FORCE = process.argv.includes("--force");
const CATALOG_ONLY = process.argv.includes("--catalog-only");

const USER_COUNT = 100;
const DEMO_PASSWORD = "demo1234";

/* ------------------------------------------------------------------ *
 * Helpers — cacheKeyFor / early-bird pricing duplicated from
 * functions/src/index.js and web/src/lib/pricing.ts (same as seed.js).
 * ------------------------------------------------------------------ */

function cacheKeyFor({ vendor_id, item_name, discount_percent, resellable, pickup_window }) {
  return [vendor_id, item_name, discount_percent, resellable, pickup_window]
    .join("|")
    .replace(/[^a-zA-Z0-9|_.:-]/g, "_")
    .slice(0, 200);
}

const EARLY_BIRD_TIERS = [
  { minDays: 0, maxDays: 1, discountPercent: 5 },
  { minDays: 2, maxDays: 13, discountPercent: 20 },
  { minDays: 14, maxDays: 30, discountPercent: 30 },
];
function priceForDaysAhead(original, daysAhead) {
  const tier = EARLY_BIRD_TIERS.find((t) => daysAhead >= t.minDays && daysAhead <= t.maxDays);
  const discountPercent = tier ? tier.discountPercent : 0;
  return { discountPercent, lockedPrice: Math.round(original * (1 - discountPercent / 100)) };
}

function daysAgo(n, hour = 12, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// mulberry32 — fixed seed so every run produces the same users/orders
let rngState = 20260929;
function rand() {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function randInt(min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}
function choice(arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of pairs) {
    if ((r -= w) < 0) return value;
  }
  return pairs[pairs.length - 1][0];
}
function sample(arr, n) {
  const copy = [...arr];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
}
// Deterministic Firestore-style id (20 alphanumerics). Lock ids double as the
// pickup code (last 8 chars, VendorRedeemPage), so no "seed-" prefix here.
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function autoId() {
  let id = "";
  for (let i = 0; i < 20; i++) id += ID_CHARS[Math.floor(rand() * ID_CHARS.length)];
  return id;
}

class BatchWriter {
  constructor(limit = 400) {
    this.limit = limit;
    this.batch = db.batch();
    this.count = 0;
    this.totalCommitted = 0;
  }
  async set(ref, data, options) {
    if (options) this.batch.set(ref, data, options);
    else this.batch.set(ref, data);
    this.count++;
    if (this.count >= this.limit) await this.flush();
  }
  async flush() {
    if (this.count === 0) return;
    await this.batch.commit();
    this.totalCommitted += this.count;
    this.batch = db.batch();
    this.count = 0;
  }
}

/* ------------------------------------------------------------------ *
 * Catalog data
 *
 * Menu item tuple: [name, name_en, price, description, description_en,
 *                   allergens?, dietary_tags?]
 * ------------------------------------------------------------------ */

const LUNCH = ["11:30-12:00", "12:00-12:30", "12:30-13:00"];
const DINNER = ["17:30-18:00", "18:00-18:30"];

// Existing seed.js vendors: vendor doc + item-1 already exist, only extra items here.
// `windows` = the pickup windows seed.js already uses for that vendor's locks.
const EXISTING_VENDORS = [
  {
    id: "cafe-renheya-demo",
    windows: ["12:00-13:00", "17:30-18:30"],
    menu: [
      { cat: "便當", cat_en: "Bento", items: [
        ["照燒雞腿便當", "Teriyaki Chicken Leg Bento", 150, "炭烤去骨雞腿佐自製照燒醬", "Boneless grilled chicken leg with house teriyaki sauce", ["大豆", "小麥/麩質"], ["葷食"]],
        ["蔬食咖哩便當", "Vegetable Curry Bento", 130, "當季蔬菜燉煮日式咖哩", "Japanese curry with seasonal vegetables", ["小麥/麩質"], ["素食"]],
      ] },
      { cat: "輕食", cat_en: "Light Meals", items: [
        ["燻雞帕尼尼", "Smoked Chicken Panini", 120, "燻雞、起司、番茄夾烤拖鞋麵包", "Smoked chicken, cheese and tomato on grilled ciabatta", ["小麥/麩質", "奶"], ["葷食"]],
        ["凱薩沙拉", "Caesar Salad", 110, "蘿蔓、麵包丁、帕瑪森起司", "Romaine, croutons and parmesan", ["奶", "蛋", "小麥/麩質"], ["素食"]],
        ["鮪魚玉米可頌", "Tuna Corn Croissant", 95, "奶油可頌夾鮪魚玉米沙拉", "Butter croissant with tuna and sweetcorn", ["小麥/麩質", "奶", "海鮮", "蛋"], ["葷食"]],
      ] },
      { cat: "咖啡", cat_en: "Coffee", items: [
        ["美式咖啡", "Americano", 60, "自家烘焙中深焙豆", "House-roasted medium-dark beans", [], ["全素"]],
        ["拿鐵", "Caffè Latte", 80, "濃縮咖啡加鮮奶", "Espresso with fresh milk", ["奶"], ["素食"]],
        ["焦糖瑪奇朵", "Caramel Macchiato", 95, "香草糖漿、鮮奶與焦糖", "Vanilla syrup, milk and caramel drizzle", ["奶"], ["素食"]],
      ] },
      { cat: "茶飲", cat_en: "Tea", items: [
        ["伯爵紅茶", "Earl Grey Tea", 55, "佛手柑香氣紅茶", "Black tea with bergamot", [], ["全素"]],
        ["抹茶拿鐵", "Matcha Latte", 90, "宇治抹茶加鮮奶", "Uji matcha with fresh milk", ["奶"], ["素食"]],
      ] },
      { cat: "甜點", cat_en: "Desserts", items: [
        ["巴斯克乳酪蛋糕", "Basque Cheesecake", 85, "焦香外皮、濕潤內餡", "Caramelized top with a creamy center", ["奶", "蛋", "小麥/麩質"], ["素食"]],
      ] },
    ],
  },
  {
    id: "wang-mama-biandang",
    windows: ["12:00-12:30"],
    menu: [
      { cat: "便當", cat_en: "Bento", items: [
        ["雞腿便當", "Fried Chicken Leg Bento", 120, "酥炸大雞腿配三樣家常菜", "Crispy chicken leg with three home-style sides", ["小麥/麩質"], ["葷食"]],
        ["控肉便當", "Braised Pork Belly Bento", 110, "醬滷五花肉，肥瘦剛好", "Soy-braised pork belly", ["大豆"], ["葷食"]],
        ["鯖魚便當", "Grilled Mackerel Bento", 115, "鹽烤挪威鯖魚", "Salt-grilled Norwegian mackerel", ["海鮮"], ["葷食"]],
        ["三杯雞便當", "Three-Cup Chicken Bento", 110, "麻油、醬油、米酒三杯雞", "Chicken in sesame oil, soy and rice wine", ["大豆", "芝麻"], ["葷食"]],
      ] },
      { cat: "湯品", cat_en: "Soups", items: [
        ["味噌湯", "Miso Soup", 25, "豆腐海帶味噌湯", "Miso soup with tofu and seaweed", ["大豆"], ["素食"]],
        ["蘿蔔排骨湯", "Pork Rib Radish Soup", 45, "白蘿蔔燉排骨", "Pork ribs simmered with daikon", [], ["葷食"]],
      ] },
      { cat: "小菜", cat_en: "Sides", items: [
        ["滷蛋", "Braised Egg", 15, "醬香入味滷蛋", "Soy-braised egg", ["蛋", "大豆"], ["素食"]],
        ["燙青菜", "Blanched Greens", 35, "當日時蔬淋肉燥", "Daily greens with minced pork sauce", ["大豆"], ["葷食"]],
        ["涼拌豆干", "Cold Tofu Strips", 35, "豆干絲拌芹菜", "Dried tofu strips with celery", ["大豆"], ["全素"]],
      ] },
      { cat: "飲料", cat_en: "Drinks", items: [
        ["古早味紅茶", "Old-Fashioned Black Tea", 20, "焦糖香紅茶", "Caramel-note black tea", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "ajia-friedchicken",
    windows: ["17:00-18:00"],
    menu: [
      { cat: "炸物", cat_en: "Fried", items: [
        ["鹽酥雞", "Taiwanese Popcorn Chicken", 70, "九層塔胡椒鹽酥雞", "Popcorn chicken with basil and pepper salt", ["小麥/麩質"], ["葷食"]],
        ["甜不辣", "Fried Tempura Fish Cake", 40, "現炸魚漿甜不辣", "Fried fish cake", ["海鮮", "小麥/麩質"], ["葷食"]],
        ["炸杏鮑菇", "Fried King Oyster Mushroom", 50, "外酥內多汁", "Crispy outside, juicy inside", ["小麥/麩質"], ["素食"]],
        ["黃金薯條", "Golden Fries", 45, "粗薯現炸", "Thick-cut fries", [], ["全素"]],
        ["雞軟骨", "Chicken Cartilage", 60, "酥脆雞軟骨", "Crunchy chicken cartilage", ["小麥/麩質"], ["葷食"]],
      ] },
      { cat: "套餐", cat_en: "Combos", items: [
        ["雞排套餐", "Chicken Cutlet Combo", 130, "雞排＋薯條＋紅茶", "Chicken cutlet, fries and black tea", ["小麥/麩質"], ["葷食"]],
        ["雙人分享餐", "Sharing Box for Two", 260, "雞排兩片、鹽酥雞、薯條", "Two cutlets, popcorn chicken and fries", ["小麥/麩質"], ["葷食"]],
      ] },
      { cat: "小點", cat_en: "Snacks", items: [
        ["起司條", "Cheese Sticks", 45, "牽絲莫札瑞拉起司條", "Stretchy mozzarella sticks", ["奶", "小麥/麩質"], ["素食"]],
      ] },
      { cat: "飲料", cat_en: "Drinks", items: [
        ["冰紅茶", "Iced Black Tea", 25, "大杯冰紅茶", "Large iced black tea", [], ["全素"]],
        ["檸檬綠茶", "Lemon Green Tea", 35, "現榨檸檬綠茶", "Green tea with fresh lemon", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "zaoan-sandwich",
    windows: ["08:00-09:00"],
    menu: [
      { cat: "三明治", cat_en: "Sandwiches", items: [
        ["火腿起司三明治", "Ham & Cheese Sandwich", 45, "火腿、起司、小黃瓜", "Ham, cheese and cucumber", ["小麥/麩質", "奶"], ["葷食"]],
        ["鮪魚三明治", "Tuna Sandwich", 50, "鮪魚沙拉三明治", "Tuna salad sandwich", ["小麥/麩質", "海鮮", "蛋"], ["葷食"]],
        ["總匯三明治", "Club Sandwich", 70, "火腿、培根、蛋、生菜三層", "Triple-decker with ham, bacon and egg", ["小麥/麩質", "蛋"], ["葷食"]],
      ] },
      { cat: "漢堡", cat_en: "Burgers", items: [
        ["豬肉起司堡", "Pork & Cheese Burger", 55, "煎豬排加起司片", "Pork patty with cheese", ["小麥/麩質", "奶"], ["葷食"]],
        ["鱈魚堡", "Fish Burger", 60, "酥炸鱈魚排", "Crispy cod fillet", ["小麥/麩質", "海鮮"], ["葷食"]],
      ] },
      { cat: "蛋餅", cat_en: "Egg Crepes", items: [
        ["原味蛋餅", "Plain Egg Crepe", 30, "手工粉漿蛋餅", "Handmade batter egg crepe", ["小麥/麩質", "蛋"], ["素食"]],
        ["玉米蛋餅", "Corn Egg Crepe", 40, "玉米粒蛋餅", "Egg crepe with sweetcorn", ["小麥/麩質", "蛋"], ["素食"]],
        ["起司蛋餅", "Cheese Egg Crepe", 40, "起司蛋餅", "Egg crepe with cheese", ["小麥/麩質", "蛋", "奶"], ["素食"]],
      ] },
      { cat: "飲品", cat_en: "Drinks", items: [
        ["大冰奶", "Large Iced Milk Tea", 30, "早餐店經典奶茶", "Classic breakfast-shop milk tea", ["奶"], ["素食"]],
        ["豆漿", "Soy Milk", 25, "無糖／微糖豆漿", "Unsweetened or lightly sweet soy milk", ["大豆"], ["全素"]],
      ] },
    ],
  },
];

const NEW_VENDORS = [
  {
    id: "laozhang-beef-noodle", name: "老張牛肉麵", name_en: "Old Zhang Beef Noodles",
    description: "三十年老店，紅燒湯頭慢燉六小時", description_en: "A 30-year-old shop with a six-hour braised beef broth",
    address: "嘉義市東區民族路 318 號", phone: "05-222-3318", windows: [...LUNCH, ...DINNER], verified: true, popularity: 5,
    menu: [
      { cat: "麵類", cat_en: "Noodles", items: [
        ["紅燒牛肉麵", "Braised Beef Noodle Soup", 180, "大塊牛腱配紅燒湯頭", "Beef shank in braised soy broth", ["小麥/麩質", "大豆"], ["葷食", "辣"]],
        ["清燉牛肉麵", "Clear Broth Beef Noodle Soup", 180, "清甜牛骨高湯", "Light beef-bone broth", ["小麥/麩質"], ["葷食"]],
        ["番茄牛肉麵", "Tomato Beef Noodle Soup", 190, "番茄燉牛肉，酸甜開胃", "Beef stewed with tomatoes", ["小麥/麩質"], ["葷食"]],
        ["牛肉湯麵", "Beef Broth Noodles", 110, "只有湯頭沒有牛肉塊", "Noodles in beef broth, no meat chunks", ["小麥/麩質"], ["葷食"]],
        ["炸醬麵", "Zhajiang Noodles", 90, "豆瓣肉末炸醬拌麵", "Noodles with fermented bean pork sauce", ["小麥/麩質", "大豆"], ["葷食"]],
      ] },
      { cat: "飯類", cat_en: "Rice", items: [
        ["牛肉燴飯", "Beef Rice with Gravy", 160, "紅燒牛肉淋白飯", "Braised beef over rice", ["大豆"], ["葷食"]],
        ["滷肉飯", "Braised Pork Rice", 40, "肥瘦均勻的滷肉", "Classic braised minced pork rice", ["大豆"], ["葷食"]],
      ] },
      { cat: "湯品", cat_en: "Soups", items: [
        ["酸辣湯", "Hot and Sour Soup", 45, "豆腐、木耳、蛋花", "Tofu, wood ear and egg ribbons", ["蛋", "大豆"], ["素食", "辣"]],
        ["貢丸湯", "Pork Ball Soup", 40, "新竹貢丸", "Hsinchu-style pork balls", [], ["葷食"]],
      ] },
      { cat: "小菜", cat_en: "Sides", items: [
        ["滷海帶", "Braised Kelp", 30, "滷汁海帶結", "Soy-braised kelp knots", ["大豆"], ["全素"]],
        ["燙青菜", "Blanched Greens", 40, "當日時蔬", "Daily greens", [], ["全素"]],
        ["涼拌小黃瓜", "Smashed Cucumber", 35, "蒜香涼拌", "Garlicky smashed cucumber", [], ["全素", "辣"]],
        ["滷蛋", "Braised Egg", 15, "牛肉湯汁滷蛋", "Egg braised in beef broth", ["蛋"], ["葷食"]],
      ] },
      { cat: "飲料", cat_en: "Drinks", items: [
        ["冬瓜茶", "Winter Melon Tea", 25, "古早味冬瓜茶", "Old-fashioned winter melon tea", [], ["全素"]],
        ["酸梅湯", "Sour Plum Drink", 30, "烏梅山楂熬煮", "Smoked plum and hawthorn", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "xiaodao-ramen", name: "小島拉麵", name_en: "Kojima Ramen",
    description: "濃厚豚骨與雞白湯拉麵", description_en: "Rich tonkotsu and chicken paitan ramen",
    address: "嘉義市西區國華街 126 號", phone: "05-228-6126", windows: [...LUNCH, ...DINNER], verified: true, popularity: 4,
    menu: [
      { cat: "拉麵", cat_en: "Ramen", items: [
        ["豚骨拉麵", "Tonkotsu Ramen", 220, "熬煮十二小時豚骨湯", "12-hour pork bone broth", ["小麥/麩質", "蛋", "大豆"], ["葷食"]],
        ["雞白湯拉麵", "Chicken Paitan Ramen", 210, "濃郁雞白湯", "Creamy chicken broth", ["小麥/麩質", "蛋"], ["葷食"]],
        ["味噌拉麵", "Miso Ramen", 210, "北海道風味噌湯頭", "Hokkaido-style miso broth", ["小麥/麩質", "大豆", "蛋"], ["葷食"]],
        ["辛味噌拉麵", "Spicy Miso Ramen", 230, "辣味噌加蒜油", "Spicy miso with garlic oil", ["小麥/麩質", "大豆", "蛋"], ["葷食", "辣"]],
        ["沾麵", "Tsukemen", 240, "粗麵沾濃縮魚介湯", "Thick noodles with rich dipping broth", ["小麥/麩質", "海鮮"], ["葷食"]],
      ] },
      { cat: "丼飯", cat_en: "Rice Bowls", items: [
        ["叉燒丼", "Chashu Rice Bowl", 120, "炙燒叉燒蓋飯", "Torched chashu over rice", ["大豆"], ["葷食"]],
        ["唐揚雞丼", "Karaage Rice Bowl", 130, "日式炸雞蓋飯", "Japanese fried chicken over rice", ["小麥/麩質"], ["葷食"]],
      ] },
      { cat: "炸物", cat_en: "Fried", items: [
        ["唐揚炸雞", "Karaage", 90, "五塊醬油醃炸雞", "Five soy-marinated fried chicken pieces", ["小麥/麩質", "大豆"], ["葷食"]],
        ["煎餃", "Gyoza", 70, "六顆日式煎餃", "Six pan-fried dumplings", ["小麥/麩質"], ["葷食"]],
      ] },
      { cat: "小菜", cat_en: "Sides", items: [
        ["溏心蛋", "Soft-Boiled Marinated Egg", 30, "醬油漬半熟蛋", "Soy-marinated jammy egg", ["蛋", "大豆"], ["素食"]],
        ["海帶芽", "Wakame Salad", 40, "芝麻海帶芽", "Sesame wakame", ["芝麻"], ["全素"]],
      ] },
      { cat: "飲料", cat_en: "Drinks", items: [
        ["可爾必思", "Calpis", 40, "乳酸飲料", "Cultured milk drink", ["奶"], ["素食"]],
        ["烏龍茶", "Oolong Tea", 30, "冰烏龍茶", "Iced oolong tea", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "amei-turkey-rice", name: "阿美火雞肉飯", name_en: "Amei Turkey Rice",
    description: "嘉義在地火雞肉飯，雞油香氣十足", description_en: "Chiayi-style turkey rice with fragrant chicken fat",
    address: "嘉義市東區中山路 325 號", phone: "05-227-0325", windows: LUNCH, verified: true, popularity: 5,
    menu: [
      { cat: "飯類", cat_en: "Rice", items: [
        ["火雞肉飯", "Turkey Rice", 40, "手撕火雞肉淋雞油", "Shredded turkey with chicken-fat sauce", [], ["葷食"]],
        ["火雞肉片飯", "Sliced Turkey Rice", 60, "厚切火雞肉片", "Thick-sliced turkey", [], ["葷食"]],
        ["雞肉便當", "Turkey Bento", 95, "火雞肉飯配三樣菜", "Turkey rice with three sides", [], ["葷食"]],
        ["滷肉飯", "Braised Pork Rice", 35, "古早味滷肉", "Old-style braised pork", ["大豆"], ["葷食"]],
      ] },
      { cat: "湯品", cat_en: "Soups", items: [
        ["味噌湯", "Miso Soup", 20, "柴魚味噌湯", "Bonito miso soup", ["大豆", "海鮮"], ["葷食"]],
        ["苦瓜排骨湯", "Bitter Melon Rib Soup", 50, "清燉苦瓜排骨", "Pork ribs with bitter melon", [], ["葷食"]],
        ["下水湯", "Chicken Giblet Soup", 40, "雞胗雞心薑絲湯", "Giblets with ginger", [], ["葷食"]],
      ] },
      { cat: "小菜", cat_en: "Sides", items: [
        ["燙青菜", "Blanched Greens", 35, "淋蒜油", "With garlic oil", [], ["全素"]],
        ["筍絲", "Braised Bamboo Shoots", 30, "滷筍絲", "Braised shredded bamboo", ["大豆"], ["全素"]],
        ["荷包蛋", "Fried Egg", 15, "半熟荷包蛋", "Sunny-side-up egg", ["蛋"], ["素食"]],
      ] },
      { cat: "滷味", cat_en: "Braised Snacks", items: [
        ["滷豆腐", "Braised Tofu", 20, "板豆腐滷透", "Soy-braised firm tofu", ["大豆"], ["全素"]],
        ["滷大腸", "Braised Intestine", 60, "Q 彈豬大腸", "Chewy braised pork intestine", ["大豆"], ["葷食"]],
      ] },
    ],
  },
  {
    id: "haoshi-dumplings", name: "好食水餃館", name_en: "Haoshi Dumpling House",
    description: "每天手包水餃與鍋貼", description_en: "Dumplings and potstickers wrapped by hand daily",
    address: "嘉義市東區學府路 56 號", phone: "05-271-0056", windows: [...LUNCH, ...DINNER], verified: false, popularity: 4,
    menu: [
      { cat: "水餃", cat_en: "Dumplings", items: [
        ["高麗菜豬肉水餃（10顆）", "Pork & Cabbage Dumplings (10)", 70, "經典高麗菜豬肉", "Classic pork and cabbage", ["小麥/麩質"], ["葷食"]],
        ["韭菜豬肉水餃（10顆）", "Pork & Chive Dumplings (10)", 70, "韭菜香氣濃", "Fragrant garlic chives", ["小麥/麩質"], ["葷食"]],
        ["玉米豬肉水餃（10顆）", "Pork & Corn Dumplings (10)", 75, "甜玉米粒", "With sweetcorn", ["小麥/麩質"], ["葷食"]],
        ["鮮蝦水餃（10顆）", "Shrimp Dumplings (10)", 110, "整尾鮮蝦", "Whole shrimp inside", ["小麥/麩質", "海鮮"], ["葷食"]],
        ["素水餃（10顆）", "Vegetable Dumplings (10)", 70, "青江菜、香菇、豆干", "Bok choy, shiitake and tofu", ["小麥/麩質", "大豆"], ["全素"]],
      ] },
      { cat: "鍋貼", cat_en: "Potstickers", items: [
        ["招牌鍋貼（10顆）", "Signature Potstickers (10)", 70, "底部煎得金黃酥脆", "Golden crispy bottoms", ["小麥/麩質"], ["葷食"]],
        ["起司鍋貼（10顆）", "Cheese Potstickers (10)", 85, "內餡加莫札瑞拉", "With mozzarella inside", ["小麥/麩質", "奶"], ["葷食"]],
      ] },
      { cat: "湯品", cat_en: "Soups", items: [
        ["酸辣湯", "Hot and Sour Soup", 40, "餃子館必點", "The dumpling-house classic", ["蛋", "大豆"], ["素食", "辣"]],
        ["玉米濃湯", "Corn Chowder", 40, "奶香玉米濃湯", "Creamy corn soup", ["奶"], ["素食"]],
      ] },
      { cat: "麵類", cat_en: "Noodles", items: [
        ["麻醬麵", "Sesame Paste Noodles", 55, "芝麻醬拌麵", "Noodles in sesame sauce", ["小麥/麩質", "芝麻"], ["素食"]],
        ["紅油抄手", "Wontons in Chili Oil", 75, "紅油拌餛飩", "Pork wontons in chili oil", ["小麥/麩質"], ["葷食", "辣"]],
      ] },
      { cat: "小菜", cat_en: "Sides", items: [
        ["皮蛋豆腐", "Century Egg Tofu", 40, "皮蛋、嫩豆腐、柴魚", "Silken tofu with century egg", ["蛋", "大豆", "海鮮"], ["葷食"]],
        ["涼拌木耳", "Wood Ear Salad", 35, "醋拌黑木耳", "Wood ear in vinegar dressing", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "green-bowl-salad", name: "綠碗沙拉", name_en: "Green Bowl Salads",
    description: "高蛋白沙拉碗與穀物碗", description_en: "High-protein salad and grain bowls",
    address: "嘉義市東區新民路 580 號", phone: "05-271-5580", windows: LUNCH, verified: true, popularity: 3,
    menu: [
      { cat: "沙拉", cat_en: "Salads", items: [
        ["舒肥雞胸沙拉", "Sous-Vide Chicken Salad", 160, "舒肥雞胸配綜合生菜", "Sous-vide chicken breast on mixed greens", [], ["葷食"]],
        ["煙燻鮭魚沙拉", "Smoked Salmon Salad", 190, "鮭魚、酪梨、生菜", "Salmon, avocado and greens", ["海鮮"], ["葷食"]],
        ["豆腐藜麥沙拉", "Tofu Quinoa Salad", 150, "香煎豆腐與藜麥", "Seared tofu with quinoa", ["大豆"], ["全素"]],
        ["希臘沙拉", "Greek Salad", 150, "費達起司、橄欖、番茄", "Feta, olives and tomato", ["奶"], ["素食"]],
      ] },
      { cat: "穀物碗", cat_en: "Grain Bowls", items: [
        ["照燒牛肉穀物碗", "Teriyaki Beef Grain Bowl", 190, "糙米、照燒牛、溫泉蛋", "Brown rice, teriyaki beef, onsen egg", ["大豆", "蛋"], ["葷食"]],
        ["夏威夷鮭魚碗", "Salmon Poke Bowl", 200, "生鮭魚丁拌醬油芝麻", "Raw salmon with soy and sesame", ["海鮮", "大豆", "芝麻"], ["葷食"]],
        ["墨西哥雞肉碗", "Mexican Chicken Bowl", 180, "莎莎醬、黑豆、玉米", "Salsa, black beans and corn", [], ["葷食", "辣"]],
      ] },
      { cat: "湯品", cat_en: "Soups", items: [
        ["南瓜濃湯", "Pumpkin Soup", 70, "南瓜與洋蔥慢熬", "Slow-cooked pumpkin and onion", ["奶"], ["素食"]],
        ["蔬菜清湯", "Vegetable Broth", 60, "番茄、高麗菜、紅蘿蔔", "Tomato, cabbage and carrot", [], ["全素"]],
      ] },
      { cat: "飲品", cat_en: "Drinks", items: [
        ["綠拿鐵", "Green Smoothie", 90, "菠菜、香蕉、蘋果", "Spinach, banana and apple", [], ["全素"]],
        ["無糖豆漿", "Unsweetened Soy Milk", 35, "非基改黃豆", "Non-GMO soybeans", ["大豆"], ["全素"]],
      ] },
      { cat: "點心", cat_en: "Snacks", items: [
        ["希臘優格杯", "Greek Yogurt Cup", 80, "優格、燕麥、莓果", "Yogurt, oats and berries", ["奶", "小麥/麩質"], ["素食"]],
      ] },
    ],
  },
  {
    id: "seoul-kitchen", name: "首爾廚房", name_en: "Seoul Kitchen",
    description: "韓式拌飯、鍋物與炸雞", description_en: "Korean bibimbap, stews and fried chicken",
    address: "嘉義市西區垂楊路 402 號", phone: "05-233-0402", windows: [...LUNCH, ...DINNER], verified: false, popularity: 4,
    menu: [
      { cat: "拌飯", cat_en: "Bibimbap", items: [
        ["石鍋拌飯", "Stone Pot Bibimbap", 170, "牛肉、野菜、半熟蛋", "Beef, vegetables and a runny egg", ["蛋", "大豆", "芝麻"], ["葷食", "辣"]],
        ["泡菜炒飯", "Kimchi Fried Rice", 140, "泡菜與豬五花", "Kimchi and pork belly", ["蛋", "海鮮"], ["葷食", "辣"]],
        ["韓式烤肉飯", "Bulgogi Rice", 160, "甜醬油醃牛肉", "Sweet soy-marinated beef", ["大豆", "芝麻"], ["葷食"]],
      ] },
      { cat: "鍋物", cat_en: "Stews", items: [
        ["泡菜豆腐鍋", "Kimchi Tofu Stew", 170, "嫩豆腐泡菜湯", "Silken tofu in kimchi broth", ["大豆", "海鮮"], ["葷食", "辣"]],
        ["部隊鍋", "Army Stew", 190, "火腿、泡麵、起司", "Ham, instant noodles and cheese", ["小麥/麩質", "奶"], ["葷食", "辣"]],
        ["大醬湯", "Doenjang Stew", 160, "韓式味噌蔬菜湯", "Korean soybean paste stew", ["大豆"], ["素食"]],
      ] },
      { cat: "炸雞", cat_en: "Fried Chicken", items: [
        ["原味炸雞（半隻）", "Original Fried Chicken (Half)", 220, "雙重酥炸", "Double-fried", ["小麥/麩質"], ["葷食"]],
        ["洋釀炸雞（半隻）", "Yangnyeom Chicken (Half)", 240, "甜辣醬裹炸雞", "Glazed in sweet chili sauce", ["小麥/麩質", "大豆"], ["葷食", "辣"]],
      ] },
      { cat: "小菜", cat_en: "Sides", items: [
        ["韓式煎餅", "Korean Pancake", 120, "海鮮蔥煎餅", "Seafood and scallion pancake", ["小麥/麩質", "海鮮", "蛋"], ["葷食"]],
        ["辣炒年糕", "Tteokbokki", 110, "甜辣年糕與魚板", "Rice cakes and fish cake in chili sauce", ["海鮮"], ["葷食", "辣"]],
        ["韓式泡菜", "Kimchi", 40, "自製發酵泡菜", "House-fermented kimchi", ["海鮮"], ["葷食", "辣"]],
      ] },
      { cat: "飲料", cat_en: "Drinks", items: [
        ["韓國米釀", "Sikhye Rice Punch", 45, "甜米釀", "Sweet rice drink", [], ["全素"]],
        ["水梨汁", "Korean Pear Juice", 50, "韓國水梨汁", "Korean pear juice", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "bangkok-spice", name: "曼谷香料", name_en: "Bangkok Spice",
    description: "道地泰式料理，辣度可調整", description_en: "Authentic Thai food with adjustable spice",
    address: "嘉義市東區公明路 211 號", phone: "05-278-0211", windows: [...LUNCH, ...DINNER], verified: false, popularity: 3,
    menu: [
      { cat: "主餐", cat_en: "Mains", items: [
        ["打拋豬飯", "Pad Krapow Pork Rice", 130, "九層塔炒豬絞肉配荷包蛋", "Holy basil pork with fried egg", ["蛋", "大豆", "海鮮"], ["葷食", "辣"]],
        ["泰式炒河粉", "Pad Thai", 140, "蝦仁、花生、豆芽", "Shrimp, peanuts and bean sprouts", ["花生", "海鮮", "蛋"], ["葷食"]],
        ["海南雞飯", "Hainanese Chicken Rice", 140, "雞油飯配白斬雞", "Poached chicken with chicken-fat rice", [], ["葷食"]],
        ["鳳梨炒飯", "Pineapple Fried Rice", 150, "鳳梨、蝦仁、腰果", "Pineapple, shrimp and cashews", ["海鮮", "堅果", "蛋"], ["葷食"]],
      ] },
      { cat: "咖哩", cat_en: "Curries", items: [
        ["綠咖哩雞", "Green Curry Chicken", 160, "椰奶綠咖哩", "Coconut green curry", ["海鮮"], ["葷食", "辣"]],
        ["紅咖哩牛", "Red Curry Beef", 180, "紅咖哩燉牛肉", "Beef in red curry", ["海鮮"], ["葷食", "辣"]],
        ["黃咖哩蔬菜", "Yellow Curry Vegetables", 140, "馬鈴薯、南瓜、豆腐", "Potato, pumpkin and tofu", ["大豆"], ["全素"]],
      ] },
      { cat: "湯品", cat_en: "Soups", items: [
        ["酸辣海鮮湯", "Tom Yum Seafood", 150, "檸檬葉、香茅、海鮮", "Lime leaf, lemongrass and seafood", ["海鮮"], ["葷食", "辣"]],
        ["椰汁雞湯", "Tom Kha Gai", 140, "南薑椰奶雞湯", "Galangal coconut chicken soup", [], ["葷食"]],
      ] },
      { cat: "小點", cat_en: "Small Plates", items: [
        ["月亮蝦餅", "Moon Shrimp Cake", 180, "酥炸蝦餅佐梅醬", "Crispy shrimp cake with plum sauce", ["海鮮", "小麥/麩質"], ["葷食"]],
        ["涼拌青木瓜", "Green Papaya Salad", 90, "青木瓜絲、花生、小番茄", "Papaya, peanuts and cherry tomatoes", ["花生", "海鮮"], ["葷食", "辣"]],
      ] },
      { cat: "飲料", cat_en: "Drinks", items: [
        ["泰式奶茶", "Thai Milk Tea", 55, "煉乳泰奶", "With condensed milk", ["奶"], ["素食"]],
        ["檸檬香茅茶", "Lemongrass Tea", 45, "清爽解辣", "Refreshing lemongrass tea", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "yixiang-pasta", name: "義享麵坊", name_en: "Yixiang Pasta House",
    description: "平價義大利麵與焗烤", description_en: "Affordable pasta and baked dishes",
    address: "嘉義市西區友愛路 188 號", phone: "05-231-0188", windows: [...LUNCH, ...DINNER], verified: true, popularity: 3,
    menu: [
      { cat: "義大利麵", cat_en: "Pasta", items: [
        ["白酒蛤蜊麵", "Clams in White Wine Pasta", 180, "新鮮蛤蜊、蒜片、白酒", "Fresh clams, garlic and white wine", ["小麥/麩質", "海鮮"], ["葷食"]],
        ["奶油培根麵", "Carbonara", 170, "培根、蛋黃、帕瑪森", "Bacon, egg yolk and parmesan", ["小麥/麩質", "奶", "蛋"], ["葷食"]],
        ["番茄肉醬麵", "Bolognese", 160, "慢燉牛肉番茄醬", "Slow-cooked beef ragù", ["小麥/麩質"], ["葷食"]],
        ["青醬雞肉麵", "Pesto Chicken Pasta", 180, "羅勒松子青醬", "Basil and pine-nut pesto", ["小麥/麩質", "堅果", "奶"], ["葷食"]],
        ["蒜辣蔬菜麵", "Aglio Olio with Vegetables", 150, "橄欖油蒜辣炒時蔬", "Garlic, chili and olive oil", ["小麥/麩質"], ["全素", "辣"]],
      ] },
      { cat: "燉飯", cat_en: "Risotto", items: [
        ["蘑菇燉飯", "Mushroom Risotto", 180, "綜合菇與奶油", "Mixed mushrooms and butter", ["奶"], ["素食"]],
        ["海鮮番茄燉飯", "Seafood Tomato Risotto", 210, "蝦、花枝、淡菜", "Shrimp, squid and mussels", ["海鮮"], ["葷食"]],
      ] },
      { cat: "焗烤", cat_en: "Baked", items: [
        ["焗烤千層麵", "Lasagna", 200, "肉醬與白醬層層堆疊", "Layers of ragù and béchamel", ["小麥/麩質", "奶"], ["葷食"]],
        ["焗烤雞肉飯", "Baked Chicken Rice", 170, "雞肉白醬焗飯", "Chicken rice baked with cream sauce", ["奶"], ["葷食"]],
      ] },
      { cat: "湯品", cat_en: "Soups", items: [
        ["蘑菇濃湯", "Cream of Mushroom", 60, "附麵包", "Served with bread", ["奶", "小麥/麩質"], ["素食"]],
        ["義式蔬菜湯", "Minestrone", 60, "番茄蔬菜湯", "Tomato vegetable soup", [], ["全素"]],
      ] },
      { cat: "飲料", cat_en: "Drinks", items: [
        ["檸檬氣泡飲", "Lemon Sparkling Drink", 50, "檸檬汁加氣泡水", "Lemon with sparkling water", [], ["全素"]],
        ["熱紅茶", "Hot Black Tea", 40, "錫蘭紅茶", "Ceylon black tea", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "shuhuo-vegan", name: "蔬活素食", name_en: "Veggie Life",
    description: "全素便當與健康麵食", description_en: "Vegan bento and wholesome noodles",
    address: "嘉義市東區忠孝路 612 號", phone: "05-276-0612", windows: LUNCH, verified: true, popularity: 2,
    menu: [
      { cat: "便當", cat_en: "Bento", items: [
        ["素排便當", "Vegan Cutlet Bento", 100, "猴頭菇素排配四樣菜", "Lion's mane cutlet with four sides", ["小麥/麩質", "大豆"], ["全素"]],
        ["五穀雜糧便當", "Multigrain Bento", 95, "五穀飯與季節蔬菜", "Multigrain rice with seasonal vegetables", ["大豆"], ["全素"]],
        ["麻油猴頭菇便當", "Sesame Oil Mushroom Bento", 110, "麻油老薑猴頭菇", "Mushrooms in sesame oil and ginger", ["芝麻"], ["全素"]],
      ] },
      { cat: "麵類", cat_en: "Noodles", items: [
        ["素炸醬麵", "Vegan Zhajiang Noodles", 70, "香菇豆干炸醬", "Shiitake and tofu sauce", ["小麥/麩質", "大豆"], ["全素"]],
        ["番茄蔬菜麵", "Tomato Vegetable Noodles", 80, "番茄湯麵", "Noodles in tomato soup", ["小麥/麩質"], ["全素"]],
        ["麻醬涼麵", "Cold Sesame Noodles", 60, "芝麻醬涼麵", "Chilled sesame noodles", ["小麥/麩質", "芝麻", "花生"], ["全素"]],
      ] },
      { cat: "湯品", cat_en: "Soups", items: [
        ["味噌豆腐湯", "Miso Tofu Soup", 35, "昆布高湯", "Kombu broth", ["大豆"], ["全素"]],
        ["藥膳湯", "Herbal Soup", 60, "當歸枸杞", "Angelica and goji", [], ["全素"]],
      ] },
      { cat: "點心", cat_en: "Snacks", items: [
        ["素春捲", "Vegan Spring Rolls", 50, "三條炸春捲", "Three fried spring rolls", ["小麥/麩質"], ["全素"]],
        ["蘿蔔糕", "Turnip Cake", 45, "煎蘿蔔糕", "Pan-fried turnip cake", [], ["全素"]],
      ] },
      { cat: "飲品", cat_en: "Drinks", items: [
        ["黑豆漿", "Black Soy Milk", 35, "黑豆熬煮", "Made from black soybeans", ["大豆"], ["全素"]],
        ["洛神花茶", "Roselle Tea", 35, "酸甜洛神", "Sweet-tart roselle", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "acheng-porridge", name: "阿成鹹粥", name_en: "Ah Cheng Savory Porridge",
    description: "虱目魚粥與台式早午餐", description_en: "Milkfish porridge and Taiwanese brunch",
    address: "嘉義市西區光彩街 77 號", phone: "05-222-0077", windows: ["07:30-08:00", "08:00-08:30", ...LUNCH], verified: false, popularity: 3,
    menu: [
      { cat: "粥品", cat_en: "Porridge", items: [
        ["虱目魚粥", "Milkfish Porridge", 90, "新鮮虱目魚肚", "Fresh milkfish belly", ["海鮮"], ["葷食"]],
        ["海鮮粥", "Seafood Porridge", 110, "鮮蝦、蚵仔、花枝", "Shrimp, oysters and squid", ["海鮮"], ["葷食"]],
        ["肉絲粥", "Shredded Pork Porridge", 60, "古早味肉絲粥", "Old-style pork porridge", [], ["葷食"]],
        ["皮蛋瘦肉粥", "Century Egg & Pork Porridge", 70, "港式口味", "Cantonese-style", ["蛋"], ["葷食"]],
      ] },
      { cat: "小菜", cat_en: "Sides", items: [
        ["滷白菜", "Braised Napa Cabbage", 40, "扁魚滷白菜", "Braised with dried flounder", ["海鮮"], ["葷食"]],
        ["燙地瓜葉", "Sweet Potato Leaves", 35, "淋醬油膏", "With soy glaze", ["大豆"], ["全素"]],
        ["魚皮", "Milkfish Skin", 50, "汆燙魚皮沾醬", "Blanched fish skin with dip", ["海鮮"], ["葷食"]],
      ] },
      { cat: "炸物", cat_en: "Fried", items: [
        ["油條", "Fried Dough Stick", 20, "配粥剛好", "Perfect with porridge", ["小麥/麩質"], ["全素"]],
        ["炸蚵嗲", "Oyster Fritter", 50, "蚵仔韭菜炸餅", "Oyster and chive fritter", ["海鮮", "小麥/麩質"], ["葷食"]],
        ["紅燒肉", "Fried Red Pork", 60, "五香炸豬肉", "Five-spice fried pork", ["小麥/麩質"], ["葷食"]],
      ] },
      { cat: "飲料", cat_en: "Drinks", items: [
        ["米漿", "Peanut Rice Milk", 25, "花生米漿", "Peanut and rice drink", ["花生"], ["全素"]],
        ["紅茶", "Black Tea", 20, "古早味紅茶", "Old-fashioned black tea", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "xinyi-hotpot", name: "心意小火鍋", name_en: "Xinyi Personal Hot Pot",
    description: "一人一鍋，湯頭現煮外帶", description_en: "One pot per person, packed to go",
    address: "嘉義市東區北興街 99 號", phone: "05-275-0099", windows: DINNER, verified: false, popularity: 3,
    menu: [
      { cat: "鍋物", cat_en: "Hot Pots", items: [
        ["豬肉小火鍋", "Pork Hot Pot", 180, "梅花豬肉片配蔬菜盤", "Pork shoulder slices and vegetables", ["大豆"], ["葷食"]],
        ["牛肉小火鍋", "Beef Hot Pot", 210, "雪花牛肉片", "Marbled beef slices", ["大豆"], ["葷食"]],
        ["麻辣鴨血鍋", "Spicy Duck Blood Hot Pot", 200, "麻辣湯底加鴨血豆腐", "Spicy broth with duck blood and tofu", ["大豆"], ["葷食", "辣"]],
        ["海鮮小火鍋", "Seafood Hot Pot", 240, "蝦、蛤蜊、魚片", "Shrimp, clams and fish", ["海鮮"], ["葷食"]],
        ["牛奶鍋", "Milk Hot Pot", 200, "牛奶湯底配雞肉", "Milk broth with chicken", ["奶"], ["葷食"]],
        ["蔬食鍋", "Vegetable Hot Pot", 170, "昆布湯底、菇類、豆腐", "Kombu broth, mushrooms and tofu", ["大豆"], ["全素"]],
      ] },
      { cat: "加點", cat_en: "Add-ons", items: [
        ["加肉盤", "Extra Meat", 80, "同鍋款肉片", "More of your pot's meat", [], ["葷食"]],
        ["手工蛋餃", "Egg Dumplings", 40, "四顆蛋餃", "Four egg dumplings", ["蛋"], ["葷食"]],
        ["綜合菇盤", "Mushroom Platter", 50, "金針菇、香菇、杏鮑菇", "Enoki, shiitake and king oyster", [], ["全素"]],
      ] },
      { cat: "飯麵", cat_en: "Rice & Noodles", items: [
        ["白飯", "Steamed Rice", 15, "吃到飽改外帶一碗", "One bowl to go", [], ["全素"]],
        ["烏龍麵", "Udon", 30, "Q 彈烏龍麵", "Chewy udon", ["小麥/麩質"], ["全素"]],
        ["冬粉", "Glass Noodles", 20, "綠豆冬粉", "Mung bean noodles", [], ["全素"]],
      ] },
      { cat: "飲料", cat_en: "Drinks", items: [
        ["蜂蜜檸檬", "Honey Lemon", 45, "現擠檸檬", "Fresh-squeezed lemon", [], ["素食"]],
      ] },
    ],
  },
  {
    id: "chenguang-breakfast", name: "晨光蛋餅屋", name_en: "Morning Light Breakfast",
    description: "粉漿蛋餅與手作早午餐", description_en: "Batter egg crepes and handmade brunch",
    address: "嘉義市東區大雅路二段 45 號", phone: "05-276-2045", windows: ["07:00-07:30", "07:30-08:00", "08:00-08:30"], verified: false, popularity: 4,
    menu: [
      { cat: "蛋餅", cat_en: "Egg Crepes", items: [
        ["粉漿蛋餅", "Batter Egg Crepe", 35, "古早味粉漿", "Old-style batter", ["小麥/麩質", "蛋"], ["素食"]],
        ["培根蛋餅", "Bacon Egg Crepe", 45, "酥脆培根", "Crispy bacon", ["小麥/麩質", "蛋"], ["葷食"]],
        ["鮪魚蛋餅", "Tuna Egg Crepe", 45, "鮪魚玉米", "Tuna and corn", ["小麥/麩質", "蛋", "海鮮"], ["葷食"]],
        ["九層塔蛋餅", "Basil Egg Crepe", 40, "九層塔炒蛋", "Egg with Thai basil", ["小麥/麩質", "蛋"], ["素食"]],
      ] },
      { cat: "吐司", cat_en: "Toast", items: [
        ["花生厚片", "Peanut Butter Toast", 35, "厚片吐司抹花生醬", "Thick toast with peanut butter", ["小麥/麩質", "花生"], ["素食"]],
        ["起司蛋吐司", "Cheese & Egg Toast", 40, "起司、煎蛋", "Cheese and fried egg", ["小麥/麩質", "蛋", "奶"], ["素食"]],
        ["肉鬆蛋吐司", "Pork Floss Egg Toast", 45, "肉鬆、煎蛋、美乃滋", "Pork floss, egg and mayo", ["小麥/麩質", "蛋"], ["葷食"]],
      ] },
      { cat: "漢堡", cat_en: "Burgers", items: [
        ["卡拉雞腿堡", "Crispy Chicken Burger", 70, "酥炸去骨雞腿", "Fried boneless chicken leg", ["小麥/麩質"], ["葷食"]],
        ["牛肉起司堡", "Beef Cheeseburger", 65, "牛肉排加起司", "Beef patty with cheese", ["小麥/麩質", "奶"], ["葷食"]],
      ] },
      { cat: "點心", cat_en: "Sides", items: [
        ["薯餅", "Hash Brown", 25, "金黃薯餅", "Golden hash brown", [], ["全素"]],
        ["鐵板麵", "Teppan Noodles", 55, "黑胡椒醬鐵板麵", "Black pepper teppan noodles", ["小麥/麩質", "蛋"], ["葷食"]],
        ["蘿蔔糕", "Turnip Cake", 35, "煎到兩面焦香", "Pan-fried until crisp", [], ["葷食"]],
      ] },
      { cat: "飲品", cat_en: "Drinks", items: [
        ["鮮奶茶", "Fresh Milk Tea", 45, "紅茶加鮮奶", "Black tea with fresh milk", ["奶"], ["素食"]],
        ["黑咖啡", "Black Coffee", 40, "美式黑咖啡", "Americano", [], ["全素"]],
        ["柳橙汁", "Orange Juice", 40, "現榨柳橙", "Fresh-squeezed orange", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "yamato-don", name: "大和丼飯屋", name_en: "Yamato Donburi",
    description: "日式丼飯與咖哩飯", description_en: "Japanese rice bowls and curry rice",
    address: "嘉義市西區文化路 520 號", phone: "05-225-0520", windows: [...LUNCH, ...DINNER], verified: true, popularity: 4,
    menu: [
      { cat: "丼飯", cat_en: "Donburi", items: [
        ["親子丼", "Oyakodon", 130, "雞肉滑蛋蓋飯", "Chicken and egg over rice", ["蛋", "大豆"], ["葷食"]],
        ["牛丼", "Gyudon", 140, "洋蔥燉牛肉片", "Beef simmered with onion", ["大豆"], ["葷食"]],
        ["豬排丼", "Katsudon", 150, "炸豬排滑蛋", "Pork cutlet with egg", ["小麥/麩質", "蛋", "大豆"], ["葷食"]],
        ["鮭魚親子丼", "Salmon & Roe Bowl", 280, "生鮭魚與鮭魚卵", "Raw salmon with salmon roe", ["海鮮"], ["葷食"]],
        ["炙燒豚丼", "Torched Pork Bowl", 140, "炙燒豬五花", "Torched pork belly", ["大豆"], ["葷食"]],
      ] },
      { cat: "咖哩", cat_en: "Curry", items: [
        ["豬排咖哩飯", "Katsu Curry", 160, "日式咖哩配炸豬排", "Japanese curry with pork cutlet", ["小麥/麩質"], ["葷食"]],
        ["蔬菜咖哩飯", "Vegetable Curry", 120, "根莖蔬菜咖哩", "Root vegetable curry", ["小麥/麩質"], ["素食"]],
        ["起司漢堡排咖哩", "Cheese Hamburg Curry", 170, "漢堡排加起司", "Hamburg steak with cheese", ["小麥/麩質", "奶", "蛋"], ["葷食"]],
      ] },
      { cat: "小菜", cat_en: "Sides", items: [
        ["日式炸豆腐", "Agedashi Tofu", 60, "柴魚醬汁", "In bonito dashi", ["大豆", "海鮮"], ["葷食"]],
        ["茶碗蒸", "Chawanmushi", 45, "日式蒸蛋", "Japanese steamed egg", ["蛋", "海鮮"], ["葷食"]],
        ["毛豆", "Edamame", 40, "鹽味毛豆", "Salted edamame", ["大豆"], ["全素"]],
      ] },
      { cat: "湯品", cat_en: "Soups", items: [
        ["味噌湯", "Miso Soup", 25, "豆腐海帶芽", "Tofu and wakame", ["大豆"], ["素食"]],
        ["豚汁", "Tonjiru Pork Soup", 50, "豬肉根莖味噌湯", "Pork and root vegetable miso soup", ["大豆"], ["葷食"]],
      ] },
      { cat: "飲料", cat_en: "Drinks", items: [
        ["麥茶", "Barley Tea", 20, "冰麥茶", "Iced barley tea", ["小麥/麩質"], ["全素"]],
        ["抹茶牛奶", "Matcha Milk", 60, "抹茶加鮮奶", "Matcha with fresh milk", ["奶"], ["素食"]],
      ] },
    ],
  },
  {
    id: "chaju-tea", name: "茶聚手搖", name_en: "Chaju Tea Bar",
    description: "現泡手搖茶與鮮奶茶", description_en: "Freshly brewed tea and milk tea",
    address: "嘉義市東區興業東路 260 號", phone: "05-277-0260", windows: ["12:00-12:30", "12:30-13:00", "15:00-15:30", "17:30-18:00"], verified: false, popularity: 5,
    menu: [
      { cat: "原味茶", cat_en: "Pure Tea", items: [
        ["四季春青茶", "Four Seasons Oolong", 30, "清香花果調", "Floral and light", [], ["全素"]],
        ["錫蘭紅茶", "Ceylon Black Tea", 30, "濃郁紅茶", "Rich black tea", [], ["全素"]],
        ["茉莉綠茶", "Jasmine Green Tea", 30, "茉莉花香", "Jasmine-scented", [], ["全素"]],
        ["炭焙烏龍", "Roasted Oolong", 35, "炭火焙香", "Charcoal-roasted", [], ["全素"]],
      ] },
      { cat: "奶茶", cat_en: "Milk Tea", items: [
        ["珍珠奶茶", "Bubble Milk Tea", 55, "黑糖珍珠", "Brown sugar pearls", ["奶"], ["素食"]],
        ["布丁奶茶", "Pudding Milk Tea", 60, "雞蛋布丁", "With egg pudding", ["奶", "蛋"], ["素食"]],
        ["烏龍奶茶", "Oolong Milk Tea", 50, "烏龍茶底", "Oolong base", ["奶"], ["素食"]],
      ] },
      { cat: "鮮奶", cat_en: "Fresh Milk", items: [
        ["黑糖珍珠鮮奶", "Brown Sugar Boba Milk", 70, "虎紋黑糖", "Tiger-stripe brown sugar", ["奶"], ["素食"]],
        ["紅茶拿鐵", "Black Tea Latte", 60, "紅茶加鮮奶", "Black tea with fresh milk", ["奶"], ["素食"]],
        ["芋頭鮮奶", "Taro Milk", 70, "大甲芋泥", "Dajia taro paste", ["奶"], ["素食"]],
      ] },
      { cat: "果茶", cat_en: "Fruit Tea", items: [
        ["百香綠茶", "Passion Fruit Green Tea", 50, "新鮮百香果", "Fresh passion fruit", [], ["全素"]],
        ["芒果冰沙", "Mango Smoothie", 70, "愛文芒果", "Irwin mango", [], ["全素"]],
        ["多多綠", "Yakult Green Tea", 50, "養樂多加綠茶", "Yakult with green tea", ["奶"], ["素食"]],
        ["鮮榨柳橙綠", "Orange Green Tea", 55, "現榨柳橙", "Fresh orange", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "tianmi-douhua", name: "甜蜜豆花", name_en: "Sweet Tofu Pudding",
    description: "手工豆花、剉冰與燒仙草", description_en: "Handmade tofu pudding, shaved ice and grass jelly",
    address: "嘉義市西區蘭井街 150 號", phone: "05-222-0150", windows: ["12:30-13:00", "15:00-15:30", "18:00-18:30"], verified: false, popularity: 2,
    menu: [
      { cat: "豆花", cat_en: "Tofu Pudding", items: [
        ["花生豆花", "Peanut Tofu Pudding", 45, "綿密花生", "Soft-cooked peanuts", ["大豆", "花生"], ["全素"]],
        ["珍珠豆花", "Boba Tofu Pudding", 45, "手工珍珠", "Handmade pearls", ["大豆"], ["全素"]],
        ["綜合豆花", "Mixed Tofu Pudding", 55, "花生、粉圓、紅豆", "Peanuts, pearls and red beans", ["大豆", "花生"], ["全素"]],
        ["豆漿豆花", "Soy Milk Tofu Pudding", 50, "濃豆漿底", "In thick soy milk", ["大豆"], ["全素"]],
      ] },
      { cat: "剉冰", cat_en: "Shaved Ice", items: [
        ["芒果雪花冰", "Mango Snow Ice", 120, "季節限定", "Seasonal special", ["奶"], ["素食"]],
        ["紅豆牛奶冰", "Red Bean Milk Ice", 70, "蜜紅豆加煉乳", "Sweet red beans and condensed milk", ["奶"], ["素食"]],
        ["四果冰", "Four-Topping Ice", 60, "任選四種配料", "Choose any four toppings", [], ["全素"]],
      ] },
      { cat: "湯圓", cat_en: "Tangyuan", items: [
        ["芝麻湯圓", "Sesame Tangyuan", 50, "黑芝麻內餡", "Black sesame filling", ["芝麻"], ["全素"]],
        ["桂圓紅豆湯", "Longan Red Bean Soup", 50, "加小湯圓", "With mini tangyuan", [], ["全素"]],
      ] },
      { cat: "燒仙草", cat_en: "Grass Jelly", items: [
        ["燒仙草", "Hot Grass Jelly", 50, "配花生、芋圓", "With peanuts and taro balls", ["花生"], ["全素"]],
        ["仙草凍奶", "Grass Jelly Milk", 55, "冰仙草加鮮奶", "Iced grass jelly with milk", ["奶"], ["素食"]],
      ] },
      { cat: "飲品", cat_en: "Drinks", items: [
        ["古早味冬瓜露", "Winter Melon Drink", 30, "冬瓜糖熬煮", "Simmered winter melon", [], ["全素"]],
      ] },
    ],
  },
  {
    id: "gangwei-roast", name: "港味燒臘", name_en: "Canton Roast House",
    description: "港式燒臘飯與雲吞麵", description_en: "Cantonese roast meat rice and wonton noodles",
    address: "嘉義市東區吳鳳北路 233 號", phone: "05-228-0233", windows: [...LUNCH, ...DINNER], verified: true, popularity: 4,
    menu: [
      { cat: "燒臘飯", cat_en: "Roast Rice", items: [
        ["叉燒飯", "Char Siu Rice", 110, "蜜汁叉燒", "Honey-glazed char siu", ["大豆"], ["葷食"]],
        ["燒鴨飯", "Roast Duck Rice", 120, "脆皮燒鴨", "Crispy-skin roast duck", ["大豆"], ["葷食"]],
        ["油雞飯", "Soy Sauce Chicken Rice", 110, "豉油雞腿", "Soy-poached chicken", ["大豆"], ["葷食"]],
        ["雙拼飯", "Two-Roast Rice", 140, "任選兩種燒臘", "Choose any two roasts", ["大豆"], ["葷食"]],
        ["三寶飯", "Three-Roast Rice", 160, "叉燒、燒鴨、油雞", "Char siu, duck and chicken", ["大豆"], ["葷食"]],
      ] },
      { cat: "麵類", cat_en: "Noodles", items: [
        ["鮮蝦雲吞麵", "Shrimp Wonton Noodles", 110, "竹昇麵配鮮蝦雲吞", "Egg noodles with shrimp wontons", ["小麥/麩質", "海鮮", "蛋"], ["葷食"]],
        ["叉燒撈麵", "Char Siu Lo Mein", 120, "蠔油拌麵", "Tossed in oyster sauce", ["小麥/麩質", "海鮮"], ["葷食"]],
      ] },
      { cat: "湯品", cat_en: "Soups", items: [
        ["例湯", "Soup of the Day", 40, "每日老火湯", "Daily slow-cooked soup", [], ["葷食"]],
        ["鮮蝦雲吞湯", "Shrimp Wonton Soup", 80, "六顆雲吞", "Six wontons", ["小麥/麩質", "海鮮"], ["葷食"]],
      ] },
      { cat: "小菜", cat_en: "Sides", items: [
        ["蠔油芥蘭", "Gai Lan with Oyster Sauce", 60, "燙芥蘭淋蠔油", "Chinese broccoli with oyster sauce", ["海鮮"], ["葷食"]],
        ["滷蛋", "Braised Egg", 15, "燒臘滷汁", "In roast-meat braising liquid", ["蛋", "大豆"], ["葷食"]],
      ] },
      { cat: "飲料", cat_en: "Drinks", items: [
        ["港式凍檸茶", "HK Iced Lemon Tea", 50, "錫蘭紅茶加檸檬片", "Ceylon tea with lemon slices", [], ["全素"]],
        ["鴛鴦奶茶", "Yuenyeung", 55, "咖啡加奶茶", "Coffee with milk tea", ["奶"], ["素食"]],
      ] },
    ],
  },
];

const MEAL_PLAN_DEFS = [
  { key: "a", label: "A方案", label_en: "Plan A", days: 5, priceFactor: 0.9, name: "五日輕食計畫", name_en: "5-Day Light Meal Plan" },
  { key: "b", label: "B方案", label_en: "Plan B", days: 7, priceFactor: 0.95, name: "七日安心餐", name_en: "7-Day Worry-Free Meals" },
];

// Popularity of the seed.js vendors for the new orders (new vendors carry their own).
const EXISTING_POPULARITY = { "cafe-renheya-demo": 5, "wang-mama-biandang": 4, "ajia-friedchicken": 4, "zaoan-sandwich": 3 };

/** Flattens a vendor's menu into menu_items drafts, numbered from `startAt`. */
function menuDrafts(vendorId, menu, startAt) {
  const out = [];
  let n = startAt;
  for (const group of menu) {
    for (const [name, name_en, price, description, description_en, allergens = [], dietary_tags = []] of group.items) {
      out.push({
        id: `${vendorId}-item-${n++}`,
        vendor_id: vendorId,
        name, name_en, price, description, description_en,
        category: group.cat, category_en: group.cat_en,
        allergens, dietary_tags,
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Catalog writes
 * ------------------------------------------------------------------ */

async function loadExistingItem1(vendorId) {
  const snap = await db.collection("menu_items").doc(`${vendorId}-item-1`).get();
  if (!snap.exists) {
    console.error(`menu_items/${vendorId}-item-1 not found — run node scripts/seed.js (or --catalog-only) first.`);
    process.exit(1);
  }
  const d = snap.data();
  return { id: snap.id, vendor_id: vendorId, name: d.name, name_en: d.name_en ?? null, price: d.price, category: d.category };
}

// Returns { vendorId: { windows, popularity, items: [{ id, name, name_en, price }] } } for order generation.
async function seedCatalog(writer) {
  const catalog = {};
  const createdAt = Timestamp.fromDate(daysAgo(95));

  for (const v of EXISTING_VENDORS) {
    const item1 = await loadExistingItem1(v.id);
    const drafts = menuDrafts(v.id, v.menu, 2);
    for (const d of drafts) await writeMenuItem(writer, d, createdAt);
    catalog[v.id] = { windows: v.windows, popularity: EXISTING_POPULARITY[v.id], items: [item1, ...drafts] };
  }

  const existingVendorDocs = new Set(
    (await db.getAll(...NEW_VENDORS.map((v) => db.collection("vendors").doc(v.id)))).filter((s) => s.exists).map((s) => s.id)
  );

  for (const v of NEW_VENDORS) {
    const drafts = menuDrafts(v.id, v.menu, 1);
    const vendorDoc = {
      name: v.name,
      name_en: v.name_en,
      description: v.description,
      description_en: v.description_en,
      i18n_src: { name: v.name, description: v.description },
      item_focus: drafts[0].name,
      verified: v.verified,
      address: v.address,
      phone: v.phone,
      pickup_windows: v.windows,
      created_at: createdAt,
    };
    // Brand-new doc only: fields later owned by other code paths (the order
    // phase / calibration for reliability_tone, the admin for owner_uid).
    if (!existingVendorDocs.has(v.id)) {
      vendorDoc.reliability_tone = "new";
      vendorDoc.owner_uid = null;
    }
    await writer.set(db.collection("vendors").doc(v.id), vendorDoc, { merge: true });

    for (const d of drafts) await writeMenuItem(writer, d, createdAt);

    const planItem = drafts[0];
    for (const def of MEAL_PLAN_DEFS) {
      const plan = {
        label: def.label,
        name: `${def.name}（${def.days}天）`,
        description: `每日供餐${planItem.name}，連續 ${def.days} 天`,
        fastest_booking: "明天起",
      };
      await writer.set(db.collection("meal_plans").doc(`${v.id}-plan-${def.key}`), {
        vendor_id: v.id,
        ...plan,
        label_en: def.label_en,
        name_en: `${def.name_en} (${def.days} days)`,
        description_en: `${planItem.name_en} every day for ${def.days} days`,
        fastest_booking_en: "From tomorrow",
        i18n_src: plan,
        price_per_meal: Math.round(planItem.price * def.priceFactor),
        days: def.days,
        created_at: createdAt,
      }, { merge: true });
    }
    catalog[v.id] = { windows: v.windows, popularity: v.popularity, items: drafts };
  }

  await writer.flush();
  const itemCount = Object.values(catalog).reduce((s, c) => s + c.items.length, 0);
  console.log(`Catalog: ${Object.keys(catalog).length} vendors, ${itemCount} menu_items (incl. seed.js item-1s), ${NEW_VENDORS.length * MEAL_PLAN_DEFS.length} new meal_plans`);
  return catalog;
}

async function writeMenuItem(writer, d, createdAt) {
  const { id, ...fields } = d;
  await writer.set(db.collection("menu_items").doc(id), {
    ...fields,
    i18n_src: { name: d.name, description: d.description, category: d.category },
    is_available: true,
    image: null,
    created_at: createdAt,
  }, { merge: true });
}

/* ------------------------------------------------------------------ *
 * Users
 * ------------------------------------------------------------------ */

const SURNAMES = ["陳", "林", "黃", "張", "李", "王", "吳", "劉", "蔡", "楊", "許", "鄭", "謝", "郭", "洪", "曾", "邱", "廖", "賴", "周"];
const GIVEN_1 = ["宜", "家", "冠", "詠", "思", "柏", "承", "雅", "佳", "子", "品", "宥", "語", "俊", "欣", "昱", "芷", "彥", "郁", "書"];
const GIVEN_2 = ["庭", "豪", "宇", "晴", "妤", "翰", "恩", "婷", "瑜", "軒", "潔", "辰", "彤", "傑", "妍", "安", "寧", "廷", "涵", "銘"];

const SCHOOLS = [
  { school: "國立嘉義大學", weight: 6, departments: [
    ["企業管理學系", "Business Administration"], ["應用數學系", "Applied Mathematics"], ["外國語言學系", "Foreign Languages"],
    ["幼兒教育學系", "Early Childhood Education"], ["資訊工程學系", "Computer Science"], ["食品科學系", "Food Science"],
    ["電子物理學系", "Electrophysics"], ["獸醫學系", "Veterinary Medicine"], ["生物機電工程學系", "Biomechatronic Engineering"],
  ] },
  { school: "國立中正大學", weight: 4, departments: [
    ["企業管理學系", "Business Administration"], ["傳播學系", "Communication"], ["化學工程學系", "Chemical Engineering"],
    ["資訊工程學系", "Computer Science"], ["經濟學系", "Economics"], ["法律學系", "Law"],
    ["電機工程學系", "Electrical Engineering"], ["心理學系", "Psychology"],
  ] },
];

function buildUsers() {
  const users = [];
  for (let n = 1; n <= USER_COUNT; n++) {
    const num = String(n).padStart(3, "0");
    const school = weighted(SCHOOLS.map((s) => [s, s.weight]));
    const [department, department_en] = choice(school.departments);
    users.push({
      uid: `seed-user-${num}`,
      email: `seed${num}@bunnbaa.test`,
      display_name: choice(SURNAMES) + choice(GIVEN_1) + choice(GIVEN_2),
      phone: `0900-${String(100 + n).padStart(3, "0")}-${String(n * 37 % 1000).padStart(3, "0")}`,
      school: school.school,
      department,
      department_en,
      lang: rand() < 0.1 ? "en" : "zh",
      createdDaysAgo: randInt(62, 95),
    });
  }
  return users;
}

/* ------------------------------------------------------------------ *
 * Orders
 * ------------------------------------------------------------------ */

const NO_SHOW_NOTES = [
  "客人臨時有事沒來",
  "客人忘記取餐時間，已過取餐時段",
  "臨時加班無法前來取餐",
  "當天下大雨，客人説不想出門",
];
// One per banned user, all different: note = no_show_note on that user's
// no-show locks, appeal = their ban_appeals reason (first two users only).
const BAN_REASONS = [
  { note: "期中考週熬夜讀書，連續兩次睡過頭沒來取餐", appeal: "那兩次是期中考週睡過頭，之後會設鬧鐘提醒" },
  { note: "臨時發燒去看醫生，沒有通知店家", appeal: "當天發燒去看醫生，來不及通知店家，附上看診收據" },
  { note: "社團活動拖太晚，錯過取餐時段", appeal: "社團成果展彩排延誤，以後會預留取餐時間" },
  { note: "重複下單沒有取消，多出來的份數沒來拿", appeal: "付款時網路卡住按了兩次，不是故意不取" },
  { note: "打工臨時被調班，無法到店取餐", appeal: "打工排班臨時變動，下次會先轉讓給同學" },
  { note: "下雨改叫外送，已訂的餐沒來拿", appeal: "知道應該要來拿，下雨天也會改用轉讓功能" },
];
const FEEDBACK_TEXTS = [
  "東西很好吃，下次還會訂",
  "份量剛好，口味很不錯",
  "準時可以取餐，體驗很好",
  "包裝很用心，會再回購",
  "提早訂比較便宜，很划算",
];
// [rating, zh, en]
const REVIEW_COMMENTS = {
  5: [["超好吃，已經回購好幾次了！", "So good — I've already ordered it several times!"], ["份量很多，CP 值很高", "Big portions, great value"], ["準時取餐不用排隊，讚", "Picked up on time with no queue. Great!"]],
  4: [["好吃，但希望再多一點配菜", "Tasty, but I'd like a few more sides"], ["口味不錯，取餐很方便", "Good flavor and easy pickup"], ["整體滿意，會再來", "Satisfied overall, will come back"]],
  3: [["普通，沒有特別驚艷", "Okay, nothing special"], ["有點偏鹹", "A little too salty"]],
  2: [["等了有點久，餐點有點冷掉", "Waited a while and the food was a bit cold"]],
  1: [["跟照片差很多", "Very different from the photo"]],
};

function pickupDateFor(offsetDays) {
  return isoDate(daysAgo(offsetDays));
}
// 第一階段只在週一至週五營業（規格 §2）：落在週六、週日的取餐日往前挪到週五
function weekdayOffset(offsetDays) {
  const day = daysAgo(offsetDays).getDay();
  return day === 6 ? offsetDays + 1 : day === 0 ? offsetDays + 2 : offsetDays;
}
function windowStart(window) {
  const [h, m] = window.split("-")[0].split(":").map(Number);
  return { h, m };
}

function buildOrders(users, catalog) {
  const vendorIds = Object.keys(catalog);
  const vendorWeights = vendorIds.map((id) => [id, catalog[id].popularity]);
  const orders = [];
  let orderSeq = 0;

  for (const user of users) {
    const favorites = sample(vendorIds, randInt(2, 3));
    const orderCount = randInt(1, 10);
    for (let k = 0; k < orderCount; k++) {
      const vendorId = rand() < 0.7 ? choice(favorites) : weighted(vendorWeights);
      const vendor = catalog[vendorId];
      const window = choice(vendor.windows);

      // pickupOffset: days ago (past 1–60 days, 85%) or ≤ 0 = today..14 days ahead (15%).
      // lead: days between ordering and pickup, drives the early-bird tier.
      let pickupOffset, lead;
      if (rand() < 0.85) {
        pickupOffset = weekdayOffset(randInt(1, 60));
        lead = weighted([[0, 55], [1, 15], [randInt(2, 13), 25], [randInt(14, 30), 5]]);
        lead = Math.min(lead, user.createdDaysAgo - pickupOffset - 1); // not before sign-up
      } else {
        pickupOffset = weekdayOffset(-randInt(0, 14));
        lead = Math.min(-pickupOffset + weighted([[0, 50], [1, 25], [randInt(2, 5), 25]]), 30); // placed today or a few days ago
      }
      const createdOffset = pickupOffset + lead;

      // Same-day orders are placed a few hours before the window; others at any daytime hour.
      const { h } = windowStart(window);
      let createdAt = lead === 0
        ? daysAgo(createdOffset, Math.max(6, h - randInt(1, 4)), randInt(0, 59))
        : daysAgo(createdOffset, randInt(7, 22), randInt(0, 59));
      if (createdAt > new Date()) createdAt = new Date(Date.now() - randInt(5, 180) * 60 * 1000);

      const lines = sample(vendor.items, weighted([[1, 60], [2, 30], [3, 10]]))
        .map((item) => ({ item, quantity: rand() < 0.8 ? 1 : 2 }));

      orders.push({
        id: `seed-order-${String(++orderSeq).padStart(5, "0")}`,
        user,
        vendorId,
        window,
        pickupOffset,
        pickupDate: pickupDateFor(pickupOffset),
        isFuture: pickupOffset <= 0,
        lead,
        createdAt,
        lines,
      });
    }
  }
  return orders;
}

/**
 * Turns orders into lock docs + outcomes. Mutates users with noPickupCount /
 * orderBanned and drops future orders of users banned by their own past
 * no-shows (they couldn't have checked out).
 */
function resolveOrders(orders, users) {
  const now = Date.now();
  const noShows = new Map(users.map((u) => [u.uid, 0]));

  const units = (o) => o.lines.reduce((s, l) => s + l.quantity, 0);
  const past = orders.filter((o) => !o.isFuture);
  for (const o of past) o.outcome = "fulfilled";

  // Exactly BAN_REASONS.length users get banned, each for a different reason:
  // their most recent past orders become no-shows until they hit the threshold,
  // so no past order of theirs comes after the ban.
  const eligible = users.filter((u) => past.filter((o) => o.user === u).reduce((s, o) => s + units(o), 0) >= 2);
  const bannedUsers = sample(eligible, BAN_REASONS.length);
  bannedUsers.forEach((u, i) => {
    u.banReason = BAN_REASONS[i];
    const mine = past.filter((o) => o.user === u).sort((a, b) => a.pickupOffset - b.pickupOffset);
    for (const o of mine) {
      if (noShows.get(u.uid) >= 2) break;
      o.outcome = "no_show";
      noShows.set(u.uid, noShows.get(u.uid) + units(o));
    }
  });

  // Everyone else: at most one single-meal no-show, which stays under the threshold.
  for (const o of past) {
    if (o.user.banReason || units(o) !== 1 || noShows.get(o.user.uid) > 0 || rand() >= 0.04) continue;
    o.outcome = "no_show";
    noShows.set(o.user.uid, 1);
  }

  for (const u of users) {
    u.noPickupCount = noShows.get(u.uid);
    u.orderBanned = u.noPickupCount >= 2; // functions/src/index.js NO_SHOW_BAN_THRESHOLD
  }

  // A banned user always has past (no-show) orders, so everyone still keeps ≥ 1 order.
  const kept = orders.filter((o) => !(o.isFuture && o.user.orderBanned));

  const otherUsers = (uid) => users.filter((u) => u.uid !== uid && !u.orderBanned);
  for (const o of kept) {
    o.locks = [];
    for (const { item, quantity } of o.lines) {
      const { discountPercent, lockedPrice } = priceForDaysAhead(item.price, o.lead);
      for (let q = 0; q < quantity; q++) {
        const lock = {
          id: autoId(),
          vendor_id: o.vendorId,
          menu_item_id: item.id, // 材料成本、備料都靠它對到配方
          item_name: item.name,
          item_name_en: item.name_en ?? null,
          pickup_window: o.window,
          pickup_date: o.pickupDate,
          discount_percent: discountPercent,
          resellable: true,
          locked_price: lockedPrice,
          buyer_uid: o.user.uid,
          created_at: o.createdAt,
        };
        if (!o.isFuture) {
          if (o.outcome === "no_show") {
            lock.status = "no_show";
            lock.no_show_note = o.user.banReason?.note ?? choice(NO_SHOW_NOTES);
          } else if (rand() < 0.06) {
            // Handed to a classmate on the transfer market, who picked it up.
            lock.status = "resold_and_fulfilled";
            lock.buyer_uid = choice(otherUsers(o.user.uid)).uid;
            lock.transferred_from_uids = [o.user.uid];
          } else {
            lock.status = "fulfilled";
            if (rand() < 0.15) lock.consumer_feedback = choice(FEEDBACK_TEXTS);
          }
        } else {
          lock.status = weighted([["locked", 80], ["for_resale", 12], ["for_gift", 8]]);
          if (lock.status === "for_resale") lock.resale_deadline = new Date(now + randInt(1, 20) * 3600 * 1000);
        }
        o.locks.push(lock);
      }
    }
  }
  return kept;
}

/* ------------------------------------------------------------------ *
 * Order writes
 * ------------------------------------------------------------------ */

// Pre-warms onLockCreated's cache (zh + en) so no lock write reaches Gemini.
// Existing entries (possibly real Gemini output) are left alone.
async function seedDiscountExplanations(orders) {
  const combos = new Map();
  for (const o of orders) {
    for (const l of o.locks) {
      const key = cacheKeyFor({ ...l, resellable: true });
      if (!combos.has(key)) combos.set(key, l);
    }
  }
  const refs = [...combos.keys()].map((k) => db.collection("discount_explanations").doc(k));
  const existing = new Set();
  for (let i = 0; i < refs.length; i += 300) {
    for (const s of await db.getAll(...refs.slice(i, i + 300))) if (s.exists) existing.add(s.id);
  }
  const TEXT = {
    5: ["這是當日／隔日取餐的早鳥價（95折）。鎖定後如果沒辦法來取，可以在取餐前轉賣或贈送給別人。",
        "This is the same-day / next-day early-bird price (5% off). If you can't make it, you can resell or gift it before pickup."],
    20: ["提前 2–13 天預訂可以拿到 8折，店家能更早掌握備料量。取餐前一樣可以轉賣或贈送。",
         "Booking 2–13 days ahead gets 20% off, since the vendor can plan ingredients earlier. You can still resell or gift it."],
    30: ["提前 14–30 天預訂是折扣最高的區間（7折），適合排定得到的固定行程。取餐前一樣可以轉賣或贈送。",
         "Booking 14–30 days ahead gets the best price (30% off), good for fixed schedules. You can still resell or gift it."],
  };
  const writer = new BatchWriter();
  let written = 0;
  for (const [key, l] of combos) {
    if (existing.has(key)) continue;
    const [zh, en] = TEXT[l.discount_percent];
    await writer.set(db.collection("discount_explanations").doc(key), {
      explanation_text: zh,
      explanation_text_en: en,
      disclaimer: "此為鎖定規則說明，非購買建議",
      generated_at: FieldValue.serverTimestamp(),
    });
    written++;
  }
  await writer.flush();
  console.log(`discount_explanations: ${written} new, ${existing.size} already cached`);
}

async function writeUsers(users, writer) {
  for (const u of users) {
    await writer.set(db.collection("users").doc(u.uid), {
      display_name: u.display_name,
      phone: u.phone,
      school: u.school,
      department: u.department,
      lang: u.lang,
      created_at: Timestamp.fromDate(daysAgo(u.createdDaysAgo, 10)),
      noPickupCount: u.noPickupCount,
      orderBanned: u.orderBanned,
    });
  }
  const banned = users.filter((u) => u.orderBanned);
  for (const [i, u] of banned.slice(0, 2).entries()) {
    await writer.set(db.collection("ban_appeals").doc(`seed-appeal-${i + 1}`), {
      buyer_uid: u.uid,
      username: u.email.split("@")[0],
      display_name: u.display_name,
      reason: u.banReason.appeal,
      status: "pending",
      admin_note: null,
      created_at: Timestamp.fromDate(daysAgo(i + 1)),
    });
  }
  console.log(`Users: ${users.length} (${banned.length} banned for no-shows, ${Math.min(2, banned.length)} pending ban_appeals)`);
}

async function writeOrders(orders, writer) {
  const today = isoDate(new Date());
  const settleBefore = isoDate(daysAgo(1)); // yesterday stays unsettled for the live demo
  const payouts = new Map(); // `${vendor}__${date}` -> [lock]
  const slots = new Map(); // `${vendor}__${date}__${window}` -> count
  let lockCount = 0;
  let reviewCount = 0;

  for (const o of orders) {
    const amount = o.locks.reduce((s, l) => s + l.locked_price, 0);
    await writer.set(db.collection("payment_intents").doc(o.id), {
      status: "confirmed",
      buyer_uid: o.user.uid,
      transaction_id: `SEED${o.id.slice(-5)}`,
      amount,
      lock_drafts: o.locks.map((l) => ({
        vendor_id: l.vendor_id, item_name: l.item_name, item_name_en: l.item_name_en,
        pickup_window: l.pickup_window, pickup_date: l.pickup_date,
        discount_percent: l.discount_percent, resellable: true, locked_price: l.locked_price,
      })),
      lock_ids: o.locks.map((l) => l.id),
      created_at: Timestamp.fromDate(o.createdAt),
    });

    for (const l of o.locks) {
      const settled = (l.status === "fulfilled" || l.status === "resold_and_fulfilled") && l.pickup_date < settleBefore;
      const key = `${l.vendor_id}__${l.pickup_date}`;
      if (settled) {
        if (!payouts.has(key)) payouts.set(key, { payoutId: `seed-payout-${l.vendor_id}-${l.pickup_date}`, locks: [] });
        payouts.get(key).locks.push(l);
      }
      if (l.pickup_date >= today) {
        const slotKey = `${l.vendor_id}__${l.pickup_date}__${l.pickup_window}`;
        slots.set(slotKey, (slots.get(slotKey) || 0) + 1);
      }
      const { id, created_at, resale_deadline, ...fields } = l;
      await writer.set(db.collection("locks").doc(id), {
        ...fields,
        no_show_note: fields.no_show_note ?? null,
        consumer_feedback: fields.consumer_feedback ?? null,
        created_at: Timestamp.fromDate(created_at),
        ...(resale_deadline ? { resale_deadline: Timestamp.fromDate(resale_deadline) } : {}),
        ...(settled ? { payout_settled: true, payout_id: payouts.get(key).payoutId } : {}),
      });
      lockCount++;
    }

    // One review per ~35% of picked-up orders, on its first lock, by the original buyer.
    const reviewable = o.locks.find((l) => l.status === "fulfilled");
    if (reviewable && rand() < 0.35) {
      const rating = weighted([[5, 50], [4, 30], [3, 12], [2, 5], [1, 3]]);
      const [comment, comment_en] = rand() < 0.75 ? choice(REVIEW_COMMENTS[rating]) : ["", ""];
      const reviewer_label = `${o.user.department} 同學`.slice(0, 30);
      const reviewer_label_en = `${o.user.department_en} student`;
      const pickupDay = new Date(`${reviewable.pickup_date}T00:00:00`);
      pickupDay.setHours(windowStart(reviewable.pickup_window).h + randInt(1, 8));
      await writer.set(db.collection("reviews").doc(reviewable.id), {
        vendor_id: reviewable.vendor_id,
        meal_plan_id: null,
        item_name: reviewable.item_name,
        rating,
        comment,
        reviewer_label,
        comment_en,
        item_name_en: reviewable.item_name_en ?? "",
        reviewer_label_en,
        i18n_src: { comment, item_name: reviewable.item_name, reviewer_label },
        created_at: Timestamp.fromDate(pickupDay > new Date() ? new Date() : pickupDay),
      });
      reviewCount++;
    }
  }

  for (const { payoutId, locks } of payouts.values()) {
    const l0 = locks[0];
    const created = new Date(`${l0.pickup_date}T20:00:00`);
    await writer.set(db.collection("payouts").doc(payoutId), {
      vendor_id: l0.vendor_id,
      amount: locks.reduce((s, l) => s + l.locked_price, 0),
      lock_ids: locks.map((l) => l.id),
      lock_count: locks.length,
      status: "pending_manual_export",
      created_at: Timestamp.fromDate(created),
    });
  }

  for (const [key, count] of slots) {
    const [vendorId, pickupDate, pickupWindow] = key.split("__");
    await writer.set(db.collection("slot_counters").doc(key), {
      vendor_id: vendorId,
      pickup_date: pickupDate,
      pickup_window: pickupWindow,
      count: FieldValue.increment(count),
      updated_at: FieldValue.serverTimestamp(),
    }, { merge: true });
  }

  console.log(`Orders: ${orders.length} payment_intents → ${lockCount} locks, ${payouts.size} payouts, ${slots.size} slot_counters, ${reviewCount} reviews`);
}

// reliability_tone for the new vendors from their fulfilment rate in this data.
async function updateNewVendorTones(orders, writer) {
  const stats = {};
  for (const o of orders) {
    for (const l of o.locks) {
      if (!["fulfilled", "resold_and_fulfilled", "no_show"].includes(l.status)) continue;
      const s = (stats[l.vendor_id] ??= { ok: 0, total: 0 });
      s.total++;
      if (l.status !== "no_show") s.ok++;
    }
  }
  for (const v of NEW_VENDORS) {
    const s = stats[v.id];
    const tone = !s ? "new" : s.ok / s.total >= 0.9 ? "stable" : "variable";
    await writer.set(db.collection("vendors").doc(v.id), { reliability_tone: tone }, { merge: true });
  }
}

/* ------------------------------------------------------------------ *
 * Emulator-only auth accounts (same idea as seed.js seedDemoAccounts)
 * ------------------------------------------------------------------ */

async function seedAuthAccounts(users) {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) return;
  for (const u of users) {
    try {
      await admin.auth().createUser({ uid: u.uid, email: u.email, password: DEMO_PASSWORD, displayName: u.display_name });
    } catch (err) {
      if (err.code !== "auth/uid-already-exists" && err.code !== "auth/email-already-exists") throw err;
    }
  }
  // One owner account per new vendor, so vendor-portal isolation can be tested locally.
  for (const v of NEW_VENDORS) {
    const email = `vendor-${v.id}@bunnbaa.test`;
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch (err) {
      if (err.code !== "auth/user-not-found") throw err;
      user = await admin.auth().createUser({ email, password: DEMO_PASSWORD, displayName: `${v.name}（店主）` });
    }
    await db.collection("vendors").doc(v.id).set({ owner_uid: user.uid }, { merge: true });
  }
  console.log(`Emulator accounts (password ${DEMO_PASSWORD}): seed001…seed${String(USER_COUNT).padStart(3, "0")}@bunnbaa.test, vendor-<vendorId>@bunnbaa.test`);
}

/* ------------------------------------------------------------------ */

async function main() {
  const writer = new BatchWriter();
  const catalog = await seedCatalog(writer);
  if (CATALOG_ONLY) {
    console.log("\nCatalog-only seed complete.");
    process.exit(0);
  }

  if (!FORCE && (await db.collection("users").doc("seed-user-001").get()).exists) {
    console.error("users/seed-user-001 already exists — refusing to reseed orders (locks/payouts would duplicate). Pass --force to override.");
    process.exit(1);
  }

  const users = buildUsers();
  const orders = resolveOrders(buildOrders(users, catalog), users);

  await seedDiscountExplanations(orders); // must land before any lock write
  await writeUsers(users, writer);
  await writeOrders(orders, writer);
  await updateNewVendorTones(orders, writer);
  await writer.flush();
  await seedAuthAccounts(users);

  const perUser = users.map((u) => orders.filter((o) => o.user === u).length);
  console.log(`\nScale seed complete: orders per user min ${Math.min(...perUser)} / max ${Math.max(...perUser)}, ${writer.totalCommitted} writes.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

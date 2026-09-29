/**
 * 幫店家封面（vendors.cover_image）與品項（menu_items.image）配圖：從 Pexels
 * 免費圖庫搜尋（可商用、不需標示出處），下載後上傳到公開可讀的 GCS bucket
 * （預設 bunnbaa-mvp，路徑 `vendors/{vendorId}/`），
 * 再把下載網址寫回 Firestore。
 *
 * - 只補「還沒有圖」的店家／品項，店主自己上傳過的不會被蓋掉（--overwrite 例外）。
 * - 同一張 Pexels 照片不會用在兩個地方。
 * - 每一筆的搜尋詞、選中的照片、攝影師、Storage 網址都記在 seed-images.json：
 *   Pexels 免費額度每小時 200 次搜尋，額度用完會等到重置再繼續；中斷後重跑會
 *   直接沿用已經選好／上傳過的圖，不會重搜。
 * - 台灣小吃用英文名稱在圖庫常找不到對的圖，QUERY 裡有逐項指定的搜尋詞。
 *
 * 用法：
 *   $env:PEXELS_API_KEY="..."; node scripts/seed-images.js            # 正式站（gcloud 預設憑證）
 *   node scripts/seed-images.js --dry-run                              # 只搜尋挑圖、記 manifest，不上傳不寫 Firestore
 *   node scripts/seed-images.js --overwrite                            # 已經有圖的也換掉
 *   node scripts/seed-images.js --only-vendor=laozhang-beef-noodle     # 只處理一家
 */
const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

// 專門放配圖的 GCS bucket（公開可讀，allUsers: roles/storage.objectViewer）。
// 正式站沒有開通 Firebase Storage（預設的 .firebasestorage.app bucket 不存在），
// 所以不放在店主上傳用的 bucket。
const BUCKET = process.env.IMAGE_BUCKET || "bunnbaa-mvp";
admin.initializeApp({ storageBucket: BUCKET });
const db = admin.firestore();
const bucket = admin.storage().bucket();

const API_KEY = process.env.PEXELS_API_KEY;
const OVERWRITE = process.argv.includes("--overwrite");
const DRY_RUN = process.argv.includes("--dry-run");
const ONLY_VENDOR = process.argv.find((a) => a.startsWith("--only-vendor="))?.split("=")[1];
const MANIFEST_PATH = path.join(__dirname, "seed-images.json");
const SKIP_VENDORS = new Set(["pITejGAUHOwCAxWbiGMi"]); // 測試商家，沒有品項

// 店家封面搜尋詞
const VENDOR_QUERY = {
  "cafe-renheya-demo": "coffee shop counter",
  "wang-mama-biandang": "taiwanese bento box",
  "ajia-friedchicken": "fried chicken street food",
  "zaoan-sandwich": "breakfast sandwich",
  "laozhang-beef-noodle": "beef noodle soup",
  "xiaodao-ramen": "ramen shop",
  "amei-turkey-rice": "chicken rice bowl",
  "haoshi-dumplings": "dumplings",
  "green-bowl-salad": "salad bowl",
  "seoul-kitchen": "korean food",
  "bangkok-spice": "thai food",
  "yixiang-pasta": "pasta restaurant",
  "shuhuo-vegan": "vegetarian dishes",
  "acheng-porridge": "congee",
  "xinyi-hotpot": "hot pot",
  "chenguang-breakfast": "asian breakfast",
  "yamato-don": "japanese rice bowl",
  "chaju-tea": "bubble tea cups",
  "tianmi-douhua": "asian dessert",
  "gangwei-roast": "roast duck",
};

// 品項搜尋詞（以中文品名為 key，同名品項共用；沒列的用 name_en）
const QUERY = {
  招牌鮭魚御飯糰便當: "salmon onigiri", 招牌排骨便當: "pork chop rice", 酥脆雞排: "fried chicken fillet", 手工厚蛋三明治: "egg sandwich",
  照燒雞腿便當: "teriyaki chicken rice", 蔬食咖哩便當: "vegetable curry rice", 燻雞帕尼尼: "panini", 鮪魚玉米可頌: "croissant sandwich",
  控肉便當: "braised pork belly rice", 鯖魚便當: "grilled mackerel", 三杯雞便當: "three cup chicken", 味噌湯: "miso soup", 蘿蔔排骨湯: "pork rib soup",
  滷蛋: "soy sauce egg", 燙青菜: "stir fried greens", 涼拌豆干: "tofu salad", 古早味紅茶: "iced black tea",
  鹽酥雞: "popcorn chicken", 甜不辣: "fish cake", 炸杏鮑菇: "fried mushrooms", 黃金薯條: "french fries", 雞軟骨: "fried chicken bites",
  雞排套餐: "fried chicken meal", 雙人分享餐: "fried chicken platter", 起司條: "mozzarella sticks", 冰紅茶: "iced tea", 檸檬綠茶: "lemon iced tea",
  火腿起司三明治: "ham cheese sandwich", 鮪魚三明治: "tuna salad sandwich", 總匯三明治: "club sandwich", 豬肉起司堡: "burger with cheese", 鱈魚堡: "fish burger",
  原味蛋餅: "omelette roll", 玉米蛋餅: "omelette", 起司蛋餅: "cheese omelette", 大冰奶: "milk tea", 豆漿: "soy milk",
  紅燒牛肉麵: "beef noodle soup", 清燉牛肉麵: "clear beef noodle soup", 番茄牛肉麵: "tomato beef noodle soup", 牛肉湯麵: "noodle soup",
  炸醬麵: "noodles with meat sauce", 牛肉燴飯: "beef rice bowl", 滷肉飯: "braised pork rice", 酸辣湯: "hot and sour soup", 貢丸湯: "meatball soup",
  滷海帶: "seaweed salad", 涼拌小黃瓜: "cucumber salad", 冬瓜茶: "iced tea glass", 酸梅湯: "plum drink",
  火雞肉飯: "chicken rice", 火雞肉片飯: "sliced chicken rice", 雞肉便當: "chicken bento", 苦瓜排骨湯: "bitter melon soup", 下水湯: "chicken soup",
  筍絲: "bamboo shoots", 荷包蛋: "fried egg", 滷豆腐: "braised tofu", 滷大腸: "braised pork intestine",
  "高麗菜豬肉水餃（10顆）": "pork dumplings", "韭菜豬肉水餃（10顆）": "boiled dumplings", "玉米豬肉水餃（10顆）": "dumplings plate",
  "鮮蝦水餃（10顆）": "shrimp dumplings", "素水餃（10顆）": "vegetable dumplings", "招牌鍋貼（10顆）": "potstickers", "起司鍋貼（10顆）": "pan fried dumplings",
  玉米濃湯: "corn soup", 麻醬麵: "sesame noodles", 紅油抄手: "wontons chili oil", 皮蛋豆腐: "century egg tofu", 涼拌木耳: "wood ear mushroom",
  舒肥雞胸沙拉: "chicken salad", 煙燻鮭魚沙拉: "smoked salmon salad", 豆腐藜麥沙拉: "tofu quinoa bowl", 照燒牛肉穀物碗: "beef grain bowl",
  夏威夷鮭魚碗: "poke bowl", 墨西哥雞肉碗: "burrito bowl", 蔬菜清湯: "vegetable soup", 綠拿鐵: "green smoothie", 無糖豆漿: "soy milk glass", 希臘優格杯: "yogurt parfait",
  泡菜炒飯: "kimchi fried rice", 韓式烤肉飯: "bulgogi", 泡菜豆腐鍋: "kimchi stew", 部隊鍋: "budae jjigae", 大醬湯: "doenjang jjigae",
  "原味炸雞（半隻）": "korean fried chicken", "洋釀炸雞（半隻）": "yangnyeom chicken", 韓式煎餅: "korean pancake", 辣炒年糕: "spicy rice cakes",
  海帶芽: "seaweed salad bowl", 韓式泡菜: "kimchi", 韓國米釀: "rice drink", 水梨汁: "pear juice",
  打拋豬飯: "thai basil pork", 泰式炒河粉: "pad thai", 海南雞飯: "hainanese chicken rice", 鳳梨炒飯: "pineapple fried rice",
  綠咖哩雞: "green curry", 紅咖哩牛: "red curry", 黃咖哩蔬菜: "yellow curry", 酸辣海鮮湯: "tom yum", 椰汁雞湯: "tom kha",
  月亮蝦餅: "shrimp cake", 涼拌青木瓜: "som tam", 泰式奶茶: "thai iced tea", 檸檬香茅茶: "lemongrass tea",
  白酒蛤蜊麵: "spaghetti clams", 奶油培根麵: "carbonara", 番茄肉醬麵: "spaghetti bolognese", 青醬雞肉麵: "pesto pasta", 蒜辣蔬菜麵: "aglio olio",
  蘑菇燉飯: "mushroom risotto", 海鮮番茄燉飯: "seafood risotto", 焗烤千層麵: "lasagna", 焗烤雞肉飯: "baked rice cheese",
  蘑菇濃湯: "mushroom soup", 義式蔬菜湯: "minestrone", 檸檬氣泡飲: "lemon soda", 熱紅茶: "hot tea",
  素排便當: "vegetarian bento", 五穀雜糧便當: "multigrain rice bowl", 麻油猴頭菇便當: "mushroom rice bowl", 素炸醬麵: "noodles sauce",
  番茄蔬菜麵: "tomato noodle soup", 麻醬涼麵: "cold noodles", 味噌豆腐湯: "tofu miso soup", 藥膳湯: "herbal soup", 素春捲: "spring rolls",
  蘿蔔糕: "dim sum", 黑豆漿: "black soy milk", 洛神花茶: "hibiscus tea",
  虱目魚粥: "fish congee", 海鮮粥: "seafood congee", 肉絲粥: "pork congee", 皮蛋瘦肉粥: "century egg congee", 滷白菜: "braised cabbage",
  燙地瓜葉: "sweet potato leaves", 魚皮: "fish skin salad", 油條: "fried dough sticks", 炸蚵嗲: "oyster fritter", 紅燒肉: "fried pork", 米漿: "peanut milk drink", 紅茶: "black tea",
  豬肉小火鍋: "pork hot pot", 牛肉小火鍋: "beef hot pot", 麻辣鴨血鍋: "spicy hot pot", 海鮮小火鍋: "seafood hot pot", 牛奶鍋: "creamy hot pot",
  蔬食鍋: "vegetable hot pot", 加肉盤: "sliced raw beef", 手工蛋餃: "egg dumplings", 綜合菇盤: "mushroom platter", 白飯: "steamed rice bowl",
  烏龍麵: "udon", 冬粉: "glass noodles", 蜂蜜檸檬: "honey lemon drink",
  粉漿蛋餅: "egg roll pancake", 培根蛋餅: "breakfast burrito", 鮪魚蛋餅: "egg wrap", 九層塔蛋餅: "basil omelette", 花生厚片: "peanut butter toast",
  起司蛋吐司: "cheese toast egg", 肉鬆蛋吐司: "egg toast sandwich", 卡拉雞腿堡: "chicken burger", 牛肉起司堡: "cheeseburger", 薯餅: "hash brown",
  鐵板麵: "black pepper noodles", 鮮奶茶: "milk tea glass", 黑咖啡: "black coffee", 柳橙汁: "orange juice",
  親子丼: "oyakodon", 牛丼: "gyudon", 豬排丼: "katsudon", 鮭魚親子丼: "salmon rice bowl", 炙燒豚丼: "pork rice bowl", 豬排咖哩飯: "katsu curry",
  蔬菜咖哩飯: "japanese curry", 起司漢堡排咖哩: "hamburg steak curry", 日式炸豆腐: "agedashi tofu", 茶碗蒸: "chawanmushi", 毛豆: "edamame",
  豚汁: "pork miso soup", 麥茶: "roasted barley tea", 抹茶牛奶: "matcha latte",
  四季春青茶: "green tea cup", 錫蘭紅茶: "black tea cup", 茉莉綠茶: "jasmine tea", 炭焙烏龍: "oolong tea", 珍珠奶茶: "bubble tea",
  布丁奶茶: "boba milk tea", 烏龍奶茶: "iced milk tea", 黑糖珍珠鮮奶: "brown sugar boba", 紅茶拿鐵: "tea latte", 芋頭鮮奶: "taro milk tea",
  百香綠茶: "passion fruit tea", 芒果冰沙: "mango smoothie", 多多綠: "iced green tea", 鮮榨柳橙綠: "orange iced tea",
  花生豆花: "tofu pudding", 珍珠豆花: "tapioca dessert", 綜合豆花: "asian dessert bowl", 豆漿豆花: "soy milk dessert",
  芒果雪花冰: "mango shaved ice", 紅豆牛奶冰: "red bean shaved ice", 四果冰: "shaved ice", 芝麻湯圓: "glutinous rice balls",
  桂圓紅豆湯: "red bean soup", 燒仙草: "grass jelly", 仙草凍奶: "iced milk drink", 古早味冬瓜露: "iced drink",
  叉燒飯: "char siu", 燒鴨飯: "roast duck rice", 油雞飯: "soy sauce chicken", 雙拼飯: "roast meat rice", 三寶飯: "cantonese roast meat",
  鮮蝦雲吞麵: "wonton noodles", 叉燒撈麵: "char siu noodles", 例湯: "chinese soup", 鮮蝦雲吞湯: "wonton soup", 蠔油芥蘭: "chinese broccoli",
  港式凍檸茶: "iced lemon tea", 鴛鴦奶茶: "hong kong milk tea",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  } catch {
    return {};
  }
}
function saveManifest(m) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2) + "\n");
}

const searchCache = new Map();
async function searchPexels(query) {
  if (searchCache.has(query)) return searchCache.get(query);
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=30&orientation=landscape`;
  for (;;) {
    const res = await fetch(url, { headers: { Authorization: API_KEY } });
    if (res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
      const wait = Math.max(60_000, reset ? reset - Date.now() + 5_000 : 0);
      console.log(`Pexels 額度用完，等 ${Math.round(wait / 60000)} 分鐘…`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`Pexels ${res.status}: ${await res.text()}`);
    const photos = (await res.json()).photos ?? [];
    searchCache.set(query, photos);
    return photos;
  }
}

async function uploadPhoto(srcUrl, storagePath) {
  const res = await fetch(srcUrl);
  if (!res.ok) throw new Error(`download ${srcUrl} failed: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await bucket.file(storagePath).save(buffer, {
    contentType: "image/jpeg",
    metadata: { cacheControl: "public, max-age=31536000" },
  });
  return `https://storage.googleapis.com/${BUCKET}/${storagePath}`;
}

/**
 * Pexels 的排序常把只沾到邊的圖排前面（搜 peanut milk 會先出花生醬吐司），
 * 所以用照片描述（alt）裡出現幾個搜尋詞來挑，同分才照 Pexels 的順序。
 */
// 描述裡常用別的說法
const SYNONYMS = { congee: ["porridge", "gruel"], potstickers: ["dumpling"], tangyuan: ["rice ball"], youtiao: ["dough"] };

function pickPhoto(photos, query, used) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  // 最後一個字是菜名本體（fish congee 的 congee），比修飾詞重要
  const head = words[words.length - 1];
  const matches = (alt, w) => [w.replace(/s$/, ""), ...(SYNONYMS[w] ?? [])].some((x) => alt.includes(x));
  let best = null;
  let bestScore = -1;
  for (const p of photos) {
    if (used.has(p.id)) continue;
    const alt = (p.alt || "").toLowerCase();
    const score = words.reduce((s, w) => s + (matches(alt, w) ? (w === head ? 2 : 1) : 0), 0);
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 選圖＋上傳，回傳公開網址；搜不到回傳 null。manifest 已經挑好的照片直接沿用
 * （--dry-run 挑過的只差上傳）。--dry-run 只挑圖、記 manifest，回傳 null。
 */
async function resolveImage(manifest, used, key, query, vendorId) {
  let entry = manifest[key]?.query === query ? manifest[key] : null;
  if (entry?.url) return entry.url;

  if (!entry) {
    const photo = pickPhoto(await searchPexels(query), query, used);
    if (!photo) {
      console.warn(`  ✗ ${key}：「${query}」找不到可用的圖`);
      return null;
    }
    used.add(photo.id);
    entry = manifest[key] = {
      query,
      pexels_id: photo.id,
      pexels_url: photo.url,
      photographer: photo.photographer,
      src_large: photo.src.large,
      storage_path: `vendors/${vendorId}/pexels-${photo.id}.jpg`,
    };
    saveManifest(manifest);
  }
  if (DRY_RUN) return null;

  entry.url = await uploadPhoto(entry.src_large, entry.storage_path);
  saveManifest(manifest);
  return entry.url;
}

async function main() {
  if (!API_KEY) {
    console.error("請先設定 PEXELS_API_KEY（https://www.pexels.com/api/ 免費申請）");
    process.exit(1);
  }
  const manifest = loadManifest();
  const used = new Set(Object.values(manifest).map((e) => e.pexels_id));

  const vendors = (await db.collection("vendors").get()).docs
    .filter((d) => !SKIP_VENDORS.has(d.id) && (!ONLY_VENDOR || d.id === ONLY_VENDOR));
  let vendorCount = 0;
  let itemCount = 0;
  const missing = [];

  for (const vDoc of vendors) {
    const v = vDoc.data();
    console.log(`${vDoc.id} ${v.name}`);

    if (OVERWRITE || !v.cover_image) {
      const query = VENDOR_QUERY[vDoc.id] ?? `${v.item_focus ?? "restaurant"} food`;
      const url = await resolveImage(manifest, used, `vendor:${vDoc.id}`, query, vDoc.id);
      if (url) {
        await vDoc.ref.update({ cover_image: url });
        vendorCount++;
      } else missing.push(`vendor:${vDoc.id}`);
    }

    const items = await db.collection("menu_items").where("vendor_id", "==", vDoc.id).get();
    for (const iDoc of items.docs) {
      const item = iDoc.data();
      if (!OVERWRITE && item.image) continue;
      const query = QUERY[item.name] ?? (item.name_en || item.name).replace(/\s*\(.*?\)\s*/g, " ").trim();
      const url = await resolveImage(manifest, used, `item:${iDoc.id}`, query, vDoc.id);
      if (url) {
        await iDoc.ref.update({ image: url });
        itemCount++;
      } else missing.push(`item:${iDoc.id}`);
    }
  }

  if (DRY_RUN) {
    console.log(`\n挑圖完成（dry run，沒有上傳也沒有寫 Firestore）：manifest 共 ${Object.keys(manifest).length} 筆。`);
    process.exit(0);
  }
  console.log(`\n完成：${vendorCount} 家店家封面、${itemCount} 個品項圖。`);
  if (missing.length) console.log(`沒有配到圖（${missing.length}）：${missing.join(", ")}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

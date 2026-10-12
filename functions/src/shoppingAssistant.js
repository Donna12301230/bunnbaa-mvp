// AI feature 2: conversational pre-order assistant (doc/AI功能設計.md). The diner describes
// what they want in one sentence, e.g. "weekday lunches next week, Da'an District, budget 120,
// no beef"; Gemini calls the tools below via function calling to find candidates, then calls
// presentCandidates to return the cards.
//
// Responsible AI:
//   - All tools run server-side; Gemini never touches Firestore. Any id it returns is checked
//     against the catalog and dropped if not found
//   - The assistant never places orders: cards only link to item/vendor pages, payment still
//     goes through LINE Pay, and prices are recomputed by the server
//   - Allergens the member has set are always filtered out server-side, not left to the model
//   - Tone follows consumerExplanation.js: no pressure, no marketing
//
// Usage: ASSISTANT_DAILY_LIMIT questions per person per day (users/{uid}.assistant_usage);
// an identical single-turn question within 10 minutes is served from cache (assistant_cache,
// server-only) to cut free-tier 429s.
const crypto = require("crypto");
const {
  db, onCall, HttpsError, logger, FieldValue, t, assertSignedInUser,
} = require("./common");
const { loadPlatformConfig } = require("./config");
const { runWithTools } = require("./gemini");
const { validatePickup, closedReason, itemWindows, vendorSlotCapacity, applyEarlyBirdPrice, mealPeriodOf, MEAL_PERIODS } = require("./pricing");
const { resolveMain } = require("./bento");
const { taipeiToday, addDays, weekdayOf, lastBookableDate } = require("./calendar");

const ASSISTANT_DAILY_LIMIT = 30;
const MAX_MESSAGES = 10;
const MAX_TEXT = 500;
const MAX_RESULTS = 10;
const MAX_CARDS = 6;
const CACHE_TTL_MS = 10 * 60 * 1000;
const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const PERIOD_ZH = { breakfast: "早餐", lunch: "午餐", dinner: "晚餐" };
const PERIOD_ARG = `餐期，只能用：${MEAL_PERIODS.join("、")}（breakfast=早餐、lunch=午餐、dinner=晚餐）`;

/** Meal-period string from the model; anything unrecognized counts as unspecified */
const periodArg = (v) => (MEAL_PERIODS.includes(v) ? v : null);

/** Whether the item has a pickup slot at this vendor in this meal period (item's meal periods x vendor's slots) */
function itemPeriodWindows(vendor, item, config, period) {
  const windows = itemWindows(vendor, item, config);
  return period ? windows.filter((w) => mealPeriodOf(w, config) === period) : windows;
}

const normalize = (s) => String(s || "").replace(/台/g, "臺").replace(/\s+/g, "");

// The model still sometimes writes just 牛 ("beef/cow"): expand it to specific words so burdock (牛蒡) and milk (牛奶) aren't excluded too (C-AST-05)
const EXCLUDE_EXPAND = { 牛: ["牛肉", "牛腩", "牛排", "牛筋", "牛雜", "牛小排", "牛丼", "牛五花"] };

/** Base price at checkout: the first main if there are several (the item page default), else item.price (same as bento.resolveMain) */
const basePrice = (item) => {
  const price = Number(resolveMain(item, null).price);
  return price > 0 ? price : null;
};

const S = (description) => ({ type: "STRING", description });
const N = (description) => ({ type: "NUMBER", description });
const LIST = (description) => ({ type: "ARRAY", items: { type: "STRING" }, description });

const FUNCTION_DECLARATIONS = [
  {
    name: "searchMenuItems",
    description: "查詢目前上架的單點品項（便當、麵食等）。回傳品項 id、店名、價格、飲食標記、過敏原、主菜與配菜。會員的過敏原已先濾掉。",
    parameters: {
      type: "OBJECT",
      properties: {
        county: S("縣市，例如「臺北市」；沒指定地區就不要填"),
        town: S("鄉鎮市區，例如「大安區」"),
        keyword: S("想吃的東西，例如「雞腿」「咖哩」「麵」"),
        category: S("分類，例如「便當」「素食」"),
        maxPrice: N("單份預算上限（新台幣）"),
        dietaryTags: LIST("必須符合的飲食標記，只能用：葷食、素食、全素、辣"),
        excludeKeywords: LIST("不要出現的食材，用具體的詞，例如「牛肉」「牛腩」「豬」「香菜」；不要只寫「牛」以免排除牛蒡"),
        weekday: N("只看這個星期幾有供應的品項，1=週一 … 5=週五"),
        mealPeriod: S(PERIOD_ARG),
      },
    },
  },
  {
    name: "checkAvailability",
    description: "查某個品項在指定日期能不能預訂：店家公休、是否已截單、品項當天有沒有供應、各取餐時段剩餘份數，以及早鳥價（實際金額結帳時由伺服器重算）。",
    parameters: {
      type: "OBJECT",
      properties: {
        menuItemId: S("searchMenuItems 回傳的品項 id"),
        dates: LIST("要查的日期 YYYY-MM-DD，最多 10 天"),
        mealPeriod: S(`${PERIOD_ARG}；有指定就只查這個餐期的取餐時段`),
      },
      required: ["menuItemId", "dates"],
    },
  },
  {
    name: "searchMealPlans",
    description: "查詢多日計畫方案（例如一週五天固定在同一家店取餐），適合「一整週」「連續幾天」這類需求。",
    parameters: {
      type: "OBJECT",
      properties: {
        county: S("縣市"),
        town: S("鄉鎮市區"),
        maxPricePerMeal: N("每餐預算上限"),
        minDays: N("至少幾天"),
      },
    },
  },
  {
    name: "getVendorInsights",
    description: "查店家的需求預估與常一起買的品項（BigQuery 每天的預測與每週的購物籃分析）。預估份數是參考值，可以用來把預估較不擁擠的店排前面、或補一句「這家常一起點 X」；不要用來催促。",
    parameters: {
      type: "OBJECT",
      properties: {
        vendorIds: LIST("searchMenuItems 回傳的 vendor_id，最多 5 家"),
        dates: LIST("要看預估的日期 YYYY-MM-DD，最多 5 天"),
      },
      required: ["vendorIds"],
    },
  },
  {
    name: "presentCandidates",
    description: "查完之後呼叫這個工具，把要給使用者看的候選交回去，結束這一輪。",
    parameters: {
      type: "OBJECT",
      properties: {
        reply: S("給使用者的簡短說明（2–4 句），說明挑了哪些、為什麼、有什麼限制；不催促、不行銷"),
        menuItemIds: LIST("推薦的單點品項 id（最多 6 個，照推薦順序）"),
        mealPlanIds: LIST("推薦的計畫方案 id（最多 3 個）"),
        suggestedDates: LIST("建議的取餐日期 YYYY-MM-DD（依使用者需求，可空）"),
        suggestedWindow: S("建議的取餐時段，例如「12:00-12:30」（可空）"),
        mealPeriod: S(`${PERIOD_ARG}（使用者有指定餐期時填）`),
      },
      required: ["reply"],
    },
  },
];

function systemInstruction({ lang, today, dates, area, taste, config }) {
  const businessDays = (config.businessWeekdays || [1, 2, 3, 4, 5]).map((d) => WEEKDAY_ZH[d]).join("、");
  const periods = MEAL_PERIODS.map((p) => `${PERIOD_ZH[p]}（${config.mealPeriods?.[p] || ""}）`).join("、");
  return `你是 BunnBaa 飯飽（台灣校園周邊便當預購平台）的預購助理。消費者會用一句話描述需求，你用工具查詢後，挑出符合條件、還有名額的候選。
規則：
- 只推薦工具查到的品項與方案，不要編造店名、價格、id；查不到就老實說，並建議放寬哪個條件。
- 你不能幫使用者下單或付款，只提供候選；價格以結帳時伺服器計算為準。
- 語氣平實，不催促、不使用行銷語句（例如「手刀」「快搶」「限時」）。
- 有指定日期時，用 checkAvailability 確認推薦的品項那幾天能訂（最多查 3 個品項）；額滿、公休或已截單的要避開或說明。
- 「不吃牛」之類的需求用 excludeKeywords 帶具體詞（牛肉、牛腩、牛排）；素食用 dietaryTags。
- searchMenuItems 一次把已知條件帶齊（地區、預算、餐期、星期、不吃的食材），換關鍵字最多再查 3 次，不要一個條件查一次。
- 「一週／連續幾天」的需求，也查 searchMealPlans；方案也要符合使用者要的餐期（看方案內容與 vendor_focus，例如早餐店、飲料店的方案不適合當午餐正餐）。
- 「常一起買」是兩個特定品項的配對，只能套用在配對裡的那兩個品項，不要套到同店的其他品項。
- 候選來自好幾家店、而且有指定日期時，可以用 getVendorInsights 看各店當天的預估份數與常一起買的品項：差不多的候選可以把預估份數相對平常較少的店排前面，或補一句常一起點的品項。預估只是參考，不要說成一定，也不要用「很多人訂」來催促。
- 使用者說早餐、午餐、晚餐（或「明天晚上」「早上」）時，searchMenuItems、checkAvailability、presentCandidates 都要帶 mealPeriod；沒說就不要帶。
- 使用者在對話裡提到的過敏或不吃的東西，要用 excludeKeywords 帶具體食材詞；查到的 allergens 欄位跟他說的過敏原相符就不要推薦。
- allergens 是空陣列代表「店家沒有標示」，不是「不含」：不能說某品項不含某過敏原。使用者有過敏時，優先推薦有標示過敏原、而且不含他的過敏原的品項；按常識很可能含有的不要推薦（例如麩質過敏不推麵衣炸物、麵、麵包，大豆過敏不推醬油滷味、豆製品，蛋過敏不推蛋餅、滷蛋）；沒有把握的選項要說清楚需向店家確認，找不到確定安全的就老實說。
- 使用者指定的地區查不到任何店家時，老實說這個地區目前沒有合作店家，並說明平台目前有店家的地區（從查詢結果的 address 判斷），不要建議他跨區訂餐。
- 使用者要的時段不在平台的三個餐期內（例如下午茶、宵夜）時，先說明平台只有早、中、晚三個餐期，再推薦最接近的餐期並講明是哪一個。
- 最後一定要呼叫 presentCandidates，reply 用${lang === "en" ? "英文" : "繁體中文"}回答${lang === "en" ? "；店名與品名用工具回傳的 vendor_en／name_en（沒有才自己翻譯），跟卡片一致" : ""}。
背景：
- 今天 ${today}（台北時間）。平台是預購自取，營業日是週${businessDays}，分 ${periods} 三個餐期（各店家供應的餐期不同），取餐日前一天晚上截單，最遠可以訂到 ${dates[dates.length - 1]?.date ?? today}。
- 可預訂的日期：${dates.map((d) => `${d.date}(週${WEEKDAY_ZH[d.weekday]})`).join("、") || "無"}
- 使用者目前選的地區：${area ? `${area.county}${area.town ? ` ${area.town}` : ""}` : "未選"}（使用者沒另外指定時就用這個）
- 使用者自己設定的口味：${taste.prefs.length ? taste.prefs.join("、") : "無"}；過敏原（已自動排除）：${taste.allergies.length ? taste.allergies.join("、") : "無"}`;
}

const PREF_LABELS = { spicy: "愛吃辣", no_beef: "不吃牛", vegetarian: "素食", light: "偏好清淡" };

async function loadTaste(uid) {
  const snap = await db().collection("tasteProfiles").doc(uid).get();
  const data = snap.data() || {};
  return {
    prefs: Object.entries(data.prefs || {}).filter(([, on]) => on).map(([k]) => PREF_LABELS[k]).filter(Boolean),
    allergies: Array.isArray(data.allergies) ? data.allergies.filter((a) => typeof a === "string") : [],
  };
}

/** Catalog for this request, loaded lazily on first use (at most once per request) */
function catalogLoader() {
  let promise = null;
  return () => {
    promise ??= (async () => {
      const [vendorSnap, itemSnap, planSnap] = await Promise.all([
        db().collection("vendors").get(),
        db().collection("menu_items").where("is_available", "==", true).get(),
        db().collection("meal_plans").get(),
      ]);
      const vendors = new Map(vendorSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]).filter(([, v]) => v.status !== "disabled"));
      const items = new Map(itemSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]).filter(([, i]) => vendors.has(i.vendor_id)));
      const plans = new Map(planSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]).filter(([, p]) => vendors.has(p.vendor_id)));
      return { vendors, items, plans };
    })();
    return promise;
  };
}

function inArea(vendor, county, town) {
  const address = normalize(vendor?.address);
  if (county && !address.includes(normalize(county))) return false;
  if (town && !address.includes(normalize(town))) return false;
  return true;
}

function itemText(item) {
  const sides = (item.slots || []).flatMap((s) => [s.default?.name, ...(s.candidates || []).map((c) => c.name)]);
  return [
    item.name, item.name_en, item.description, item.description_en, item.category, item.main?.name,
    ...(item.mains || []).map((m) => m?.name),
    ...(item.fixed || []).map((f) => f.name), ...sides,
  ].filter(Boolean).join(" ");
}

function hasDietaryTag(item, tag) {
  const tags = item.dietary_tags || [];
  if (tag === "素食") return tags.includes("素食") || tags.includes("全素");
  return tags.includes(tag);
}

function summarizeItem(item, vendor, config) {
  return {
    id: item.id,
    vendor_id: item.vendor_id,
    vendor: vendor.name,
    vendor_en: vendor.name_en || null,
    address: vendor.address || "",
    name: item.name,
    name_en: item.name_en || null,
    price: basePrice(item),
    category: item.category,
    dietary_tags: item.dietary_tags || [],
    allergens: item.allergens || [],
    main: item.mains?.length ? item.mains.map((m) => m?.name).filter(Boolean).join("／") : item.main?.name || null,
    sides: (item.slots || []).map((s) => s.default?.name).filter(Boolean),
    weekdays: item.weekdays?.length ? item.weekdays : [1, 2, 3, 4, 5],
    meal_periods: MEAL_PERIODS.filter((p) => itemPeriodWindows(vendor, item, config, p).length > 0),
    description: String(item.description || "").slice(0, 80),
  };
}

/**
 * Whether the item can be ordered on these dates, using the same checks as ordering (orders.buildDrafts):
 * business days / closed days, the item's weekdays and meal periods, work-suspension days, cut-off,
 * and slot capacity.
 */
async function checkDates(item, vendor, dates, config, now = new Date(), period = null) {
  const capacity = vendorSlotCapacity(vendor);
  const price = basePrice(item);
  const out = [];
  for (const date of dates) {
    const closed = closedReason(date, vendor, config);
    if (closed) {
      out.push({ date, available: false, reason: closed });
      continue;
    }
    if (item.weekdays?.length && !item.weekdays.includes(weekdayOf(date))) {
      out.push({ date, available: false, reason: t("這個品項當天沒有供應", "Not served that day") });
      continue;
    }
    if (Array.isArray(vendor.disaster_dates) && vendor.disaster_dates.includes(date)) {
      out.push({ date, available: false, reason: t(`${date} 因停班停課暫停供餐`, `No service on ${date} (work suspension)`) });
      continue;
    }
    const windows = [];
    let problem = null;
    for (const window of itemPeriodWindows(vendor, item, config, period)) {
      problem = validatePickup(date, window, vendor, config, now, item);
      if (problem) continue;
      let left = null;
      if (capacity !== null) {
        const counter = await db().collection("slot_counters").doc(`${vendor.id}__${date}__${window}`).get();
        left = Math.max(0, capacity - (counter.exists ? counter.data().count ?? 0 : 0));
        if (left === 0) continue;
      }
      windows.push({ window, left });
    }
    if (windows.length) {
      const { discountPercent, lockedPrice } = applyEarlyBirdPrice(price, date, now);
      out.push({ date, available: true, windows, early_bird_percent: discountPercent, estimated_price: lockedPrice });
    } else {
      out.push({ date, available: false, reason: problem || (period && itemPeriodWindows(vendor, item, config, period).length === 0
        ? t(`這個品項沒有供應${PERIOD_ZH[period]}`, `Not served at ${period}`)
        : t("各時段已額滿", "All slots are full")) });
    }
  }
  return out;
}

function toolHandlers({ loadCatalog, taste, config, availability, seen = new Set() }) {
  return {
    async searchMenuItems(args) {
      const period = periodArg(args.mealPeriod);
      const { vendors, items } = await loadCatalog();
      const keyword = normalize(args.keyword);
      const category = normalize(args.category);
      const maxPrice = Number(args.maxPrice) > 0 ? Number(args.maxPrice) : null;
      const needTags = Array.isArray(args.dietaryTags) ? args.dietaryTags : [];
      const exclude = (Array.isArray(args.excludeKeywords) ? args.excludeKeywords : [])
        .map(normalize).filter(Boolean).flatMap((w) => EXCLUDE_EXPAND[w] || [w]);
      const weekday = Number(args.weekday);
      const results = [];
      for (const item of items.values()) {
        const vendor = vendors.get(item.vendor_id);
        if (!inArea(vendor, args.county, args.town)) continue;
        const price = basePrice(item);
        if (!price) continue;
        if (maxPrice && price > maxPrice) continue;
        if ((item.allergens || []).some((a) => taste.allergies.includes(a))) continue;
        if (!needTags.every((tag) => hasDietaryTag(item, tag))) continue;
        if (weekday >= 1 && weekday <= 5 && item.weekdays?.length && !item.weekdays.includes(weekday)) continue;
        if (period && itemPeriodWindows(vendor, item, config, period).length === 0) continue;
        const text = normalize(itemText(item));
        if (exclude.some((word) => text.includes(word))) continue;
        if (category && !normalize(item.category).includes(category) && !text.includes(category)) continue;
        const score = keyword ? (normalize(item.name).includes(keyword) ? 2 : text.includes(keyword) ? 1 : 0) : 1;
        if (keyword && score === 0) continue;
        results.push({ score, price, item, vendor });
      }
      results.sort((a, b) => b.score - a.score || a.price - b.price);
      return {
        count: results.length,
        allergies_excluded: taste.allergies,
        items: results.slice(0, MAX_RESULTS).map((r) => {
          seen.add(r.item.id);
          return summarizeItem(r.item, r.vendor, config);
        }),
      };
    },

    async checkAvailability(args) {
      const { vendors, items } = await loadCatalog();
      const item = items.get(String(args.menuItemId || ""));
      if (!item) return { error: "unknown menuItemId" };
      const vendor = vendors.get(item.vendor_id);
      const dates = (Array.isArray(args.dates) ? args.dates : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 10);
      const out = await checkDates(item, vendor, dates, config, new Date(), periodArg(args.mealPeriod));
      availability.set(item.id, out);
      return { menuItemId: item.id, list_price: basePrice(item), results: out };
    },

    async getVendorInsights(args) {
      const { vendors, items } = await loadCatalog();
      const vendorIds = [...new Set(Array.isArray(args.vendorIds) ? args.vendorIds.map(String) : [])].filter((id) => vendors.has(id)).slice(0, 5);
      const dates = (Array.isArray(args.dates) ? args.dates : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 5);
      const out = [];
      for (const vendorId of vendorIds) {
        const vendorRef = db().collection("vendors").doc(vendorId);
        const [forecastSnap, basketSnap] = await Promise.all([
          vendorRef.collection("forecast").where("day", ">=", taipeiToday()).orderBy("day").limit(7).get(),
          vendorRef.collection("analytics").doc("basket").get(),
        ]);
        const forecast = forecastSnap.docs.map((d) => d.data());
        // "Relative to usual": compared with this vendor's 7-day forecast average, so the model doesn't have to compute it
        const avg = forecast.length ? forecast.reduce((sum, f) => sum + (f.forecast || 0), 0) / forecast.length : null;
        const byName = new Map();
        for (const item of items.values()) {
          if (item.vendor_id !== vendorId) continue;
          if ((item.allergens || []).some((a) => taste.allergies.includes(a))) continue;
          byName.set(normalize(item.name), item);
        }
        // Only expose ids returned by searchMenuItems this turn (already filtered for the diner's excluded ingredients etc.); others get just the name and won't become cards
        const idOf = (name) => {
          const item = byName.get(normalize(name));
          return item && seen.has(item.id) ? item.id : null;
        };
        out.push({
          vendor_id: vendorId,
          vendor: vendors.get(vendorId).name,
          forecast: (dates.length ? forecast.filter((f) => dates.includes(f.day)) : forecast).map((f) => ({
            date: f.day,
            estimated_meals: f.forecast,
            range: `${f.lower}-${f.upper}`,
            vs_usual: avg ? (f.forecast > avg * 1.15 ? "busier" : f.forecast < avg * 0.85 ? "quieter" : "typical") : null,
          })),
          often_bought_together: (basketSnap.data()?.pairs || []).slice(0, 3).map((p) => ({
            items: [p.item_a, p.item_b],
            menu_item_ids: [idOf(p.item_a), idOf(p.item_b)],
            customers: p.buyers,
          })),
        });
      }
      return { note: "預估份數是 BigQuery AI.FORECAST 的參考值，不是名額；名額以 checkAvailability 為準", vendors: out };
    },

    async searchMealPlans(args) {
      const { vendors, plans } = await loadCatalog();
      const maxPrice = Number(args.maxPricePerMeal) > 0 ? Number(args.maxPricePerMeal) : null;
      const minDays = Number(args.minDays) > 0 ? Number(args.minDays) : 0;
      const results = [...plans.values()]
        .filter((p) => Number.isInteger(p.days) && p.days > 0 && typeof p.price_per_meal === "number" && p.price_per_meal > 0)
        .filter((p) => inArea(vendors.get(p.vendor_id), args.county, args.town))
        .filter((p) => !maxPrice || p.price_per_meal <= maxPrice)
        .filter((p) => (p.days || 0) >= minDays)
        .sort((a, b) => a.price_per_meal - b.price_per_meal)
        .slice(0, MAX_RESULTS);
      return {
        count: results.length,
        plans: results.map((p) => ({
          id: p.id,
          vendor_id: p.vendor_id,
          vendor: vendors.get(p.vendor_id)?.name,
          vendor_focus: vendors.get(p.vendor_id)?.item_focus || null,
          label: p.label,
          name: p.name,
          price_per_meal: p.price_per_meal,
          days: p.days,
          description: String(p.description || "").slice(0, 80),
        })),
      };
    },
  };
}

/**
 * Check the model's ids against the catalog and drop missing or unlisted ones; prices always come from the server.
 * 2026-10-09 added two guards: only accept items that searchMenuItems actually returned this turn (seen),
 * and filter the member's allergens once more, rather than relying on the model to remember.
 */
async function buildCards(finish, loadCatalog, availability, lang, config, now = new Date(), { seen = null, taste = null } = {}) {
  const { vendors, items, plans } = await loadCatalog();
  const en = lang === "en";
  const pick = (v, key) => (en && v?.[`${key}_en`]) || v?.[key] || "";
  const suggestedDates = (Array.isArray(finish.suggestedDates) ? finish.suggestedDates : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const period = periodArg(finish.mealPeriod);
  const cards = [];
  for (const id of [...new Set(Array.isArray(finish.menuItemIds) ? finish.menuItemIds : [])]) {
    const item = items.get(String(id));
    if (!item || cards.length >= MAX_CARDS) continue;
    if (seen && !seen.has(item.id)) continue;
    if (taste && (item.allergens || []).some((a) => taste.allergies.includes(a))) continue;
    const vendor = vendors.get(item.vendor_id);
    const price = basePrice(item);
    if (!price) continue;
    // Check suggested dates the model didn't look up, so cards never show closed, cut-off or full days
    const checked = [...(availability.get(item.id) || [])];
    const unchecked = suggestedDates.filter((d) => !checked.some((c) => c.date === d)).slice(0, 5);
    if (unchecked.length) {
      checked.push(...(await checkDates(item, vendor, unchecked, config, now, period)));
      checked.sort((a, b) => a.date.localeCompare(b.date));
    }
    const open = checked.filter((c) => c.available);
    const firstOpen = open.find((c) => suggestedDates.includes(c.date)) || open[0] || null;
    const date = firstOpen?.date || null;
    const earlyBird = date ? applyEarlyBirdPrice(price, date, now) : null;
    cards.push({
      type: "item",
      id: item.id,
      vendor_id: item.vendor_id,
      vendor_name: pick(vendor, "name"),
      name: pick(item, "name"),
      image: item.image || null,
      list_price: price,
      dietary_tags: item.dietary_tags || [],
      allergens: item.allergens || [],
      date,
      window: firstOpen?.windows?.find((w) => w.window === finish.suggestedWindow)?.window || firstOpen?.windows?.[0]?.window || null,
      estimated_price: earlyBird?.lockedPrice ?? null,
      early_bird_percent: earlyBird?.discountPercent ?? 0,
      open_dates: open.map((c) => c.date),
      closed_dates: checked.filter((c) => !c.available).map((c) => c.date),
    });
  }
  for (const id of [...new Set(Array.isArray(finish.mealPlanIds) ? finish.mealPlanIds : [])].slice(0, 3)) {
    const plan = plans.get(String(id));
    if (!plan || !(plan.price_per_meal > 0) || !(plan.days > 0)) continue;
    const vendor = vendors.get(plan.vendor_id);
    cards.push({
      type: "plan",
      id: plan.id,
      vendor_id: plan.vendor_id,
      vendor_name: pick(vendor, "name"),
      name: pick(plan, "name"),
      label: pick(plan, "label"),
      price_per_meal: plan.price_per_meal,
      days: plan.days,
    });
  }
  return cards;
}

function cleanMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpsError("invalid-argument", "messages is required");
  const messages = raw.slice(-MAX_MESSAGES).map((m) => ({
    role: m?.role === "assistant" ? "assistant" : "user",
    text: String(m?.text || "").trim().slice(0, MAX_TEXT),
  })).filter((m) => m.text);
  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    throw new HttpsError("invalid-argument", "The last message must be from the user");
  }
  return messages;
}

async function takeUsage(uid, today) {
  const ref = db().collection("users").doc(uid);
  const ok = await db().runTransaction(async (tx) => {
    const usage = (await tx.get(ref)).data()?.assistant_usage;
    const count = usage?.date === today ? usage.count || 0 : 0;
    if (count >= ASSISTANT_DAILY_LIMIT) return false;
    tx.set(ref, { assistant_usage: { date: today, count: count + 1 } }, { merge: true });
    return true;
  });
  if (!ok) {
    throw new HttpsError("resource-exhausted", t(`今天已經問了 ${ASSISTANT_DAILY_LIMIT} 次，明天再來，或直接用上方的篩選找餐`, `You've reached today's ${ASSISTANT_DAILY_LIMIT} questions. Try again tomorrow or use the filters.`));
  }
}

/** A Gemini failure (429/503 etc.) doesn't count against the member: refund the use taken by takeUsage */
async function refundUsage(uid, today) {
  const ref = db().collection("users").doc(uid);
  await db().runTransaction(async (tx) => {
    const usage = (await tx.get(ref)).data()?.assistant_usage;
    if (usage?.date !== today || !(usage.count > 0)) return;
    tx.set(ref, { assistant_usage: { date: today, count: usage.count - 1 } }, { merge: true });
  }).catch((err) => logger.warn("refundUsage failed", err));
}

/**
 * Core assistant (without sign-in, usage limits or caching), shared by askShoppingAssistant and the
 * answer-quality eval (scripts/eval/assistantEval.js).
 * onToolCall(name, args, result) can record tool calls, used as reference data for the groundedness check.
 */
async function runAssistant({ messages, lang, area, taste, now = new Date(), onToolCall = null }) {
  const today = taipeiToday(now);
  const config = await loadPlatformConfig(db());
  const last = lastBookableDate(today, config.bookingRangeDays);
  const dates = [];
  for (let d = today; d <= last; d = addDays(d, 1)) {
    if (config.businessWeekdays.includes(weekdayOf(d))) dates.push({ date: d, weekday: weekdayOf(d) });
  }
  const loadCatalog = catalogLoader();
  const availability = new Map();
  const seen = new Set(); // item ids returned by the search tool this turn
  const handlers = toolHandlers({ loadCatalog, taste, config, availability, seen });
  if (onToolCall) {
    for (const [name, fn] of Object.entries(handlers)) {
      handlers[name] = async (args) => {
        const result = await fn(args);
        onToolCall(name, args, result);
        return result;
      };
    }
  }

  const result = await runWithTools({
    systemInstruction: systemInstruction({ lang, today, dates, area, taste, config }),
    contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] })),
    functionDeclarations: FUNCTION_DECLARATIONS,
    handlers,
    finishTool: "presentCandidates",
    maxRounds: 7,
    finalNudge: "（系統）查詢次數已到上限，請根據目前已查到的結果呼叫 presentCandidates：有合適的就推薦，沒有就老實說明並建議放寬哪個條件。",
  });

  const finish = result.finish || { reply: result.text, menuItemIds: [], mealPlanIds: [] };
  const cards = await buildCards(finish, loadCatalog, availability, lang, config, now, { seen, taste });
  const reply = String(finish.reply || "").trim().slice(0, 1200)
    || t("抱歉，這次沒找到合適的選項，可以換個條件再問一次。", "Sorry, I couldn't find a good match. Try different conditions.");
  return { reply, cards, config, loadCatalog };
}

/**
 * data: { messages: [{ role: "user"|"assistant", text }], area?: { county, town } }
 * Returns { reply, cards[], disclaimer }.
 */
exports.askShoppingAssistant = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  assertSignedInUser(request, "使用預購助理");
  const uid = request.auth.uid;
  const lang = request.data?.lang === "en" ? "en" : "zh";
  const messages = cleanMessages(request.data?.messages);
  const rawArea = request.data?.area;
  const area = rawArea && typeof rawArea.county === "string" && rawArea.county
    ? { county: rawArea.county.slice(0, 10), town: typeof rawArea.town === "string" ? rawArea.town.slice(0, 10) : "" }
    : null;
  const today = taipeiToday();
  const disclaimer = t("助理只提供候選，不會幫你下單；實際價格與名額以結帳時為準", "The assistant only suggests options and never places orders; price and availability are confirmed at checkout");

  const taste = await loadTaste(uid);
  const cacheKey = messages.length === 1
    ? crypto.createHash("sha256").update(JSON.stringify([lang, today, area, messages[0].text, taste])).digest("hex").slice(0, 40)
    : null;
  const cacheRef = cacheKey ? db().collection("assistant_cache").doc(cacheKey) : null;
  if (cacheRef) {
    const cached = await cacheRef.get();
    if (cached.exists && Date.now() - (cached.data().created_at?.toMillis?.() ?? 0) < CACHE_TTL_MS) {
      return { reply: cached.data().reply, cards: cached.data().cards, disclaimer, cached: true };
    }
  }

  await takeUsage(uid, today);

  let reply;
  let cards;
  try {
    ({ reply, cards } = await runAssistant({ messages, lang, area, taste }));
  } catch (err) {
    logger.warn("askShoppingAssistant failed", err);
    await refundUsage(uid, today);
    throw new HttpsError("unavailable", t("助理暫時忙不過來，請稍後再試", "The assistant is busy right now. Please try again shortly."));
  }

  if (cacheRef) {
    await cacheRef.set({ reply, cards, created_at: FieldValue.serverTimestamp() }).catch(() => undefined);
  }
  return { reply, cards, disclaimer };
});

module.exports.helpers = { toolHandlers, buildCards, checkDates, basePrice, catalogLoader, runAssistant, loadTaste, itemText };

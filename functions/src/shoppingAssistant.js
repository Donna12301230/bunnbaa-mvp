// AI 功能 2：對話式預購助理（doc/AI功能設計.md）。消費者用一句話描述需求，例如
// 「下週一到五中午，大安區，預算 120，不吃牛」，Gemini 透過 function calling 呼叫下面的工具
// 查候選，最後呼叫 presentCandidates 交回卡片。
//
// 負責任 AI：
//   - 工具都在伺服器端執行，Gemini 不直接碰 Firestore；它給的 id 會再比對目錄，查無就丟掉
//   - 助理不下單：卡片只連到品項頁／店家頁，付款照舊走 LINE Pay，價格由伺服器重算
//   - 會員自己設定的過敏原一律在伺服器端先濾掉，不靠模型記得
//   - 語氣沿用 consumerExplanation.js：不催促、不行銷
//
// 用量：每人每天 ASSISTANT_DAILY_LIMIT 次（users/{uid}.assistant_usage）；單輪問題相同時
// 10 分鐘內直接回快取（assistant_cache，伺服器專用），減少免費層 429。
const crypto = require("crypto");
const {
  db, onCall, HttpsError, logger, FieldValue, t, assertSignedInUser,
} = require("./common");
const { loadPlatformConfig } = require("./config");
const { runWithTools } = require("./gemini");
const { validatePickup, closedReason, itemWindows, vendorSlotCapacity, applyEarlyBirdPrice } = require("./pricing");
const { resolveMain } = require("./bento");
const { taipeiToday, addDays, weekdayOf, lastBookableDate } = require("./calendar");

const ASSISTANT_DAILY_LIMIT = 30;
const MAX_MESSAGES = 10;
const MAX_TEXT = 500;
const MAX_RESULTS = 10;
const MAX_CARDS = 6;
const CACHE_TTL_MS = 10 * 60 * 1000;
const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];

const normalize = (s) => String(s || "").replace(/台/g, "臺").replace(/\s+/g, "");

// 模型偶爾還是只寫「牛」：換成具體的詞，免得把牛蒡、牛奶也排掉（C-AST-05）
const EXCLUDE_EXPAND = { 牛: ["牛肉", "牛腩", "牛排", "牛筋", "牛雜", "牛小排", "牛丼", "牛五花"] };

/** 結帳時的原價：有多個主菜就用第一個（品項頁預設），沒有就用 item.price（同 bento.resolveMain） */
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
      },
      required: ["reply"],
    },
  },
];

function systemInstruction({ lang, today, dates, area, taste }) {
  return `你是 BunnBaa 飯飽（台灣校園周邊午餐預購平台）的預購助理。消費者會用一句話描述需求，你用工具查詢後，挑出符合條件、還有名額的候選。
規則：
- 只推薦工具查到的品項與方案，不要編造店名、價格、id；查不到就老實說，並建議放寬哪個條件。
- 你不能幫使用者下單或付款，只提供候選；價格以結帳時伺服器計算為準。
- 語氣平實，不催促、不使用行銷語句（例如「手刀」「快搶」「限時」）。
- 有指定日期時，用 checkAvailability 確認推薦的品項那幾天能訂（最多查 3 個品項）；額滿、公休或已截單的要避開或說明。
- 「不吃牛」之類的需求用 excludeKeywords 帶具體詞（牛肉、牛腩、牛排）；素食用 dietaryTags。
- 「一週／連續幾天」的需求，也查 searchMealPlans。
- 最後一定要呼叫 presentCandidates，reply 用${lang === "en" ? "英文" : "繁體中文"}回答。
背景：
- 今天 ${today}（台北時間）。平台只做週一至週五午餐自取，取餐日前一天晚上截單，最遠可以訂到 ${dates[dates.length - 1]?.date ?? today}。
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

/** 這次請求用到的目錄，第一次用到才讀（每次請求最多讀一次） */
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

function summarizeItem(item, vendor) {
  return {
    id: item.id,
    vendor_id: item.vendor_id,
    vendor: vendor.name,
    address: vendor.address || "",
    name: item.name,
    price: basePrice(item),
    category: item.category,
    dietary_tags: item.dietary_tags || [],
    allergens: item.allergens || [],
    main: item.mains?.length ? item.mains.map((m) => m?.name).filter(Boolean).join("／") : item.main?.name || null,
    sides: (item.slots || []).map((s) => s.default?.name).filter(Boolean),
    weekdays: item.weekdays?.length ? item.weekdays : [1, 2, 3, 4, 5],
    description: String(item.description || "").slice(0, 80),
  };
}

/**
 * 品項在這幾天能不能訂，判斷跟下單（orders.buildDrafts）一致：營業日／公休、品項供應的星期與餐期、
 * 停班停課、截單、時段名額。
 */
async function checkDates(item, vendor, dates, config, now = new Date()) {
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
    for (const window of itemWindows(vendor, item, config)) {
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
      out.push({ date, available: false, reason: problem || t("各時段已額滿", "All slots are full") });
    }
  }
  return out;
}

function toolHandlers({ loadCatalog, taste, config, availability }) {
  return {
    async searchMenuItems(args) {
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
        items: results.slice(0, MAX_RESULTS).map((r) => summarizeItem(r.item, r.vendor)),
      };
    },

    async checkAvailability(args) {
      const { vendors, items } = await loadCatalog();
      const item = items.get(String(args.menuItemId || ""));
      if (!item) return { error: "unknown menuItemId" };
      const vendor = vendors.get(item.vendor_id);
      const dates = (Array.isArray(args.dates) ? args.dates : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 10);
      const out = await checkDates(item, vendor, dates, config);
      availability.set(item.id, out);
      return { menuItemId: item.id, list_price: basePrice(item), results: out };
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

/** 模型給的 id 比對目錄，查無、下架的丟掉；價格一律用伺服器的 */
async function buildCards(finish, loadCatalog, availability, lang, config, now = new Date()) {
  const { vendors, items, plans } = await loadCatalog();
  const en = lang === "en";
  const pick = (v, key) => (en && v?.[`${key}_en`]) || v?.[key] || "";
  const suggestedDates = (Array.isArray(finish.suggestedDates) ? finish.suggestedDates : []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const cards = [];
  for (const id of [...new Set(Array.isArray(finish.menuItemIds) ? finish.menuItemIds : [])]) {
    const item = items.get(String(id));
    if (!item || cards.length >= MAX_CARDS) continue;
    const vendor = vendors.get(item.vendor_id);
    const price = basePrice(item);
    if (!price) continue;
    // 模型沒查過的建議日期，這裡補查，卡片不會帶到公休、截單或額滿的日子
    const checked = [...(availability.get(item.id) || [])];
    const unchecked = suggestedDates.filter((d) => !checked.some((c) => c.date === d)).slice(0, 5);
    if (unchecked.length) {
      checked.push(...(await checkDates(item, vendor, unchecked, config, now)));
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

/** Gemini 失敗（429／503 等）不算會員的次數：退回 takeUsage 扣的那一次 */
async function refundUsage(uid, today) {
  const ref = db().collection("users").doc(uid);
  await db().runTransaction(async (tx) => {
    const usage = (await tx.get(ref)).data()?.assistant_usage;
    if (usage?.date !== today || !(usage.count > 0)) return;
    tx.set(ref, { assistant_usage: { date: today, count: usage.count - 1 } }, { merge: true });
  }).catch((err) => logger.warn("refundUsage failed", err));
}

/**
 * data: { messages: [{ role: "user"|"assistant", text }], area?: { county, town } }
 * 回傳 { reply, cards[], disclaimer }。
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

  const config = await loadPlatformConfig(db());
  const last = lastBookableDate(today, config.bookingRangeDays);
  const dates = [];
  for (let d = today; d <= last; d = addDays(d, 1)) {
    if (config.businessWeekdays.includes(weekdayOf(d))) dates.push({ date: d, weekday: weekdayOf(d) });
  }
  const loadCatalog = catalogLoader();
  const availability = new Map();

  let result;
  try {
    result = await runWithTools({
      systemInstruction: systemInstruction({ lang, today, dates, area, taste }),
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.text }] })),
      functionDeclarations: FUNCTION_DECLARATIONS,
      handlers: toolHandlers({ loadCatalog, taste, config, availability }),
      finishTool: "presentCandidates",
    });
  } catch (err) {
    logger.warn("askShoppingAssistant failed", err);
    await refundUsage(uid, today);
    throw new HttpsError("unavailable", t("助理暫時忙不過來，請稍後再試", "The assistant is busy right now. Please try again shortly."));
  }

  const finish = result.finish || { reply: result.text, menuItemIds: [], mealPlanIds: [] };
  const cards = await buildCards(finish, loadCatalog, availability, lang, config);
  const reply = String(finish.reply || "").trim().slice(0, 1200)
    || t("抱歉，這次沒找到合適的選項，可以換個條件再問一次。", "Sorry, I couldn't find a good match. Try different conditions.");

  if (cacheRef) {
    await cacheRef.set({ reply, cards, created_at: FieldValue.serverTimestamp() }).catch(() => undefined);
  }
  return { reply, cards, disclaimer };
});

module.exports.helpers = { toolHandlers, buildCards, checkDates, basePrice };

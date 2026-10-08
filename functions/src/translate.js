/**
 * 資料庫內容的英文版：用 Gemini 把中文翻成英文，存成同名的 *_en 欄位
 * （例：menu_items.name → name_en）。前端英文介面優先讀 *_en，沒有就顯示中文。
 *
 * 每份文件記下「翻譯時的原文」(i18n_src)，原文沒變就不重翻——Firestore 觸發器
 * 寫回 *_en 會再觸發一次自己，靠這個比對停下來，不會無限迴圈。
 */
const { generateJSON } = require("./gemini");

const SYSTEM_INSTRUCTION = `You translate Traditional Chinese text from a Taiwanese campus meal pre-order app (BunnBaa) into natural, concise English for international students.
Rules:
- Return JSON: {"translations": [...]} with exactly one English string per input string, in the same order.
- Store and dish names: give a natural English rendering (translate descriptive words, romanise proper nouns in Hanyu Pinyin), e.g. "阿嬤滷肉飯" -> "Grandma's Braised Pork Rice".
- Keep numbers, prices, dates, times and emoji unchanged. Do not add explanations.
- If an input is empty, return an empty string for it.`;

/** 一次翻一批字串，回傳同樣順序的英文陣列 */
async function translateTexts(texts) {
  if (texts.length === 0) return [];
  const result = await generateJSON({
    systemInstruction: SYSTEM_INSTRUCTION,
    userPrompt: JSON.stringify({ inputs: texts }),
    temperature: 0.2,
  });
  const out = Array.isArray(result?.translations) ? result.translations : [];
  if (out.length !== texts.length) {
    throw new Error(`Translation count mismatch: expected ${texts.length}, got ${out.length}`);
  }
  return out.map((s) => (typeof s === "string" ? s.trim() : ""));
}

/**
 * 算出這份文件要寫回的英文欄位；原文跟上次翻譯時一樣就回傳 null（不用寫）。
 * fields：要翻的中文欄位名，例 ["name", "description"]。
 */
async function translationPatch(data, fields) {
  const src = {};
  for (const f of fields) src[f] = typeof data?.[f] === "string" ? data[f] : "";
  const prev = data?.i18n_src ?? {};
  const changed = fields.filter((f) => src[f] !== (prev[f] ?? null) || typeof data?.[`${f}_en`] !== "string");
  if (changed.length === 0) return null;

  const toTranslate = changed.filter((f) => src[f].trim() !== "");
  const english = await translateTexts(toTranslate.map((f) => src[f]));
  const patch = { i18n_src: src };
  changed.forEach((f) => {
    const i = toTranslate.indexOf(f);
    patch[`${f}_en`] = i >= 0 ? english[i] : "";
  });
  return patch;
}

// 各 collection 要翻的欄位（地址不翻：比對地區篩選、實際找店都要用中文地址）
const TRANSLATED_FIELDS = {
  vendors: ["name", "description"],
  menu_items: ["name", "description", "category", "catalog"],
  meal_plans: ["label", "name", "description", "fastest_booking"],
  // 評價（使用者寫的心得、系所署名）與抽獎紀錄的品名
  reviews: ["comment", "item_name", "reviewer_label"],
  draws: ["item_name"],
};

module.exports = { translateTexts, translationPatch, TRANSLATED_FIELDS };

/**
 * English versions of database content: Gemini translates the Chinese into English and stores it
 * in a matching *_en field (e.g. menu_items.name -> name_en). The English UI reads *_en first and
 * falls back to the Chinese.
 *
 * Each document records the source text it was translated from (i18n_src) and is not re-translated
 * while the source is unchanged. Writing *_en back re-fires the Firestore trigger on the same
 * document; this comparison stops it there instead of looping forever.
 */
const { generateJSON } = require("./gemini");

const SYSTEM_INSTRUCTION = `You translate Traditional Chinese text from a Taiwanese campus meal pre-order app (BunnBaa) into natural, concise English for international students.
Rules:
- Return JSON: {"translations": [...]} with exactly one English string per input string, in the same order.
- Store and dish names: give a natural English rendering (translate descriptive words, romanise proper nouns in Hanyu Pinyin), e.g. "阿嬤滷肉飯" -> "Grandma's Braised Pork Rice".
- Keep numbers, prices, dates, times and emoji unchanged. Do not add explanations.
- If an input is empty, return an empty string for it.`;

/** Translate a batch of strings; returns the English strings in the same order */
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
 * Compute the English fields to write back for this document; returns null (nothing to write)
 * when the source matches the last translation.
 * fields: names of the Chinese fields to translate, e.g. ["name", "description"].
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

// Fields to translate per collection (addresses are not translated: area filtering and finding the actual shop both need the Chinese address)
const TRANSLATED_FIELDS = {
  vendors: ["name", "description"],
  menu_items: ["name", "description", "category", "catalog"],
  meal_plans: ["label", "name", "description", "fastest_booking"],
  // Reviews (the user's comment and department signature) and item names on draw records
  reviews: ["comment", "item_name", "reviewer_label"],
  draws: ["item_name"],
};

module.exports = { translateTexts, translationPatch, TRANSLATED_FIELDS };

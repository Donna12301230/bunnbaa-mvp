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
- Taiwanese addresses: use the standard English postal format, smallest unit first, e.g. "嘉義市東區民族路 318 號" -> "No. 318, Minzu Rd., East Dist., Chiayi City".
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

/** Dish names, side categories and custom-field text inside a menu item (main, mains, fixed, slots, custom_fields), sorted and de-duplicated */
function dishNames(data) {
  const names = new Set();
  const add = (s) => { if (typeof s === "string" && s.trim()) names.add(s); };
  const addDish = (d) => { add(d?.name); add(d?.portion_text); };
  addDish(data?.main);
  (data?.mains ?? []).forEach(addDish);
  (data?.fixed ?? []).forEach(addDish);
  (data?.slots ?? []).forEach((s) => {
    add(s?.category);
    addDish(s?.default);
    (s?.candidates ?? []).forEach(addDish);
  });
  (data?.custom_fields ?? []).forEach((f) => {
    add(f?.label);
    (f?.options ?? []).forEach((o) => add(o?.name));
  });
  return [...names].sort();
}

/**
 * English names for the dishes inside a menu item, stored as a zh -> en map (dish_names_en). The
 * components these dishes link to are vendor-private, so diners can't read their name_en.
 * Returns null when the dish list matches the last translation; only names without an English
 * version are sent to Gemini.
 */
async function dishNamesPatch(data) {
  const names = dishNames(data);
  const have = data?.dish_names_en ?? {};
  const prev = data?.i18n_src?.dish_names;
  const missing = names.filter((n) => typeof have[n] !== "string");
  if (missing.length === 0 && Array.isArray(prev) && prev.join("\n") === names.join("\n")) return null;

  const english = await translateTexts(missing);
  const map = {};
  names.forEach((n) => { map[n] = typeof have[n] === "string" ? have[n] : english[missing.indexOf(n)]; });
  return { dish_names_en: map, i18n_src: { dish_names: names } };
}

// Fields to translate per collection (address_en is only for display in the English UI; area filtering still matches the Chinese address)
const TRANSLATED_FIELDS = {
  vendors: ["name", "description", "address"],
  menu_items: ["name", "description", "category", "catalog"],
  meal_plans: ["label", "name", "description", "fastest_booking"],
  // Reviews (the user's comment and department signature) and item names on draw records
  reviews: ["comment", "item_name", "reviewer_label"],
  draws: ["item_name"],
  // Vendors' semi-finished items (vendors/{id}/components), shown on the prep page
  components: ["name"],
  // Vendors' raw ingredients (vendors/{id}/ingredients), named in cost warnings on the menu page
  ingredients: ["name"],
};

module.exports = { translateTexts, translationPatch, dishNames, dishNamesPatch, TRANSLATED_FIELDS };

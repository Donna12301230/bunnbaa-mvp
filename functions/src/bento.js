// Bento composition, pricing and recipe conversion. Pure functions, no Firestore; the frontend's
// web/src/lib/bento.ts has the same rules (for display), but the server is authoritative.
//
// Bento fields on menu_items:
//   item_type: bento|single                      single items are ordered directly, no composition
//   meal_periods: ["breakfast"|"lunch"|"dinner"] meal periods served (unset = all of the vendor's pickup slots)
//   mains: [{ name, component_id, price, image_url }] selectable mains, each with its own price (bento price follows the chosen main)
//   main: { name, component_id }                 legacy single main (used when there are no mains)
//   rice_component_id                            staple component (white rice etc.); extra/less rice applies to it
//   fixed: [{ name, component_id, portions }]    prep components / fixed sides; can't be swapped or removed (e.g. braised egg; all components of a single item)
//   slots: [{ category, default: { name, component_id },
//             candidates: [{ name, component_id, portion_level, weekly_cap, min_qty }] }]
//   weekdays: [1..5]                             weekly menu rotation: served only on these days (unset = every day)
// Legacy items without slots (coffee and light meals, rice balls) are still sold as single items; rice and sides can't be adjusted.
//
// vendors/{id}/components/{id} (components):
//   name, portion_grams, ingredients: [{ ingredient_id, grams }] (cooked weight per portion),
//   prep_minutes, equipment, batch_capacity (portions per batch), advance_hours, method, flavors[]
// vendors/{id}/ingredients/{id} (ingredients):
//   name, category, unit, purchase_unit_label, purchase_unit_size, yield_rate, loss_rate,
//   shelf_days, frequency: monthly|weekly|daily, supplier_id, unit_price (per purchase unit)

const { DEFAULT_PLATFORM_CONFIG } = require("./config");

const RICE_OPTIONS = ["add", "normal", "less"];

/** Raw amount = cooked weight × portions ÷ (yield rate × (1 − loss rate)) */
function rawAmount(cookedAmount, ingredient) {
  const yieldRate = Number(ingredient?.yield_rate) > 0 ? Number(ingredient.yield_rate) : 1;
  const lossRate = Number(ingredient?.loss_rate) >= 0 && Number(ingredient?.loss_rate) < 1 ? Number(ingredient.loss_rate) : 0;
  return cookedAmount / (yieldRate * (1 - lossRate));
}

/** Cost per portion of a component (NT$); ingredients with missing data count as 0 */
function componentCost(component, ingredientsById) {
  if (!component) return 0;
  let cost = 0;
  for (const line of component.ingredients || []) {
    const ing = ingredientsById[line.ingredient_id];
    if (!ing) continue;
    const size = Number(ing.purchase_unit_size) > 0 ? Number(ing.purchase_unit_size) : 1;
    cost += (rawAmount(Number(line.grams) || 0, ing) / size) * (Number(ing.unit_price) || 0);
  }
  return cost;
}

/** Portion level (phase 1 only has full/half): default dish cost ÷ candidate dish cost ≥ 0.75 is full, 0.5–0.75 half; < 0.5 returns null (not allowed as a candidate) */
function portionLevelFor(defaultCost, candidateCost) {
  if (!(candidateCost > 0)) return 1;
  const ratio = defaultCost / candidateCost;
  if (ratio >= 0.75) return 1;
  if (ratio >= 0.5) return 0.5;
  return null;
}

// Ingredient categories left out of the ingredient summary: seasonings and packaging aren't "food in this portion"
const PORTION_SKIP_CATEGORIES = ["調味", "包材"];
const UNIT_TEXT = { g: "克", ml: "毫升" };

/**
 * Portion text for the ingredient summary, derived from the recipe, e.g. "braised chicken leg 1 pc", "stir-fried cabbage 80 g".
 * Uses the dish's main ingredient (excluding seasonings and packaging; among the same unit, the largest amount; count units win over grams,
 * since "1 chicken leg" says more about the dish than "10 ml soy sauce"). Without a recipe, returns just the dish name.
 * portionTextFor in the frontend's web/src/components/BentoEditor.tsx follows the same rules; change both together.
 */
function portionText(component, ingredientsById, dishName) {
  const lines = (component?.ingredients || [])
    .map((line) => ({ line, ing: ingredientsById[line.ingredient_id] }))
    .filter(({ ing }) => ing && !PORTION_SKIP_CATEGORIES.includes(ing.category));
  if (lines.length === 0) return dishName;
  const countable = lines.filter(({ ing }) => !UNIT_TEXT[ing.unit]);
  const pool = countable.length > 0 ? countable : lines;
  const { line, ing } = pool.reduce((a, b) => ((Number(b.line.grams) || 0) > (Number(a.line.grams) || 0) ? b : a));
  const amount = Math.round((Number(line.grams) || 0) * 10) / 10;
  return `${dishName} ${amount} ${UNIT_TEXT[ing.unit] || ing.unit}`;
}

function portionLabel(level) {
  if (level != null && level < 1) return "半份";
  return "全份";
}

/**
 * Mains: menu_items.mains = [{ name, component_id, price, image_url }], each priced separately;
 * the bento price is based on the chosen main. Legacy items without mains use item.main + item.price.
 * Returns { main: { name, component_id, index }, price } or { problem }.
 */
function resolveMain(item, mainIndex) {
  const mains = Array.isArray(item?.mains) ? item.mains.filter((m) => m && Number(m.price) > 0) : [];
  if (mains.length === 0) {
    return { main: item?.main ? { name: item.main.name || "", component_id: item.main.component_id || null, index: null } : null, price: item?.price };
  }
  const idx = mainIndex == null || mainIndex === "" ? 0 : Number(mainIndex);
  const main = Number.isInteger(idx) ? mains[idx] : null;
  if (!main) return { problem: "選的主菜不存在" };
  return { main: { name: main.name || "", component_id: main.component_id || null, index: idx }, price: Number(main.price) };
}

/** All sides selectable for a bento: each slot's default dish + candidate dishes (the fourth side is picked from these) */
function sideOptions(item) {
  const out = [];
  (item?.slots || []).forEach((slot, slotIdx) => {
    if (slot.default?.name) out.push({ slot: slotIdx, candidate: null, name: slot.default.name, component_id: slot.default.component_id || null, portion_level: 1 });
    (slot.candidates || []).forEach((c, ci) => {
      if (c?.name && !c.disabled) out.push({ slot: slotIdx, candidate: ci, name: c.name, component_id: c.component_id || null, portion_level: c.portion_level ?? 1, weekly_cap: c.weekly_cap, min_qty: c.min_qty });
    });
  });
  return out;
}

/**
 * Fourth side: extra = { slot, candidate: null|index, mode: "backup"|"addon" }.
 * Allowed only once the standard number of sides is chosen (no slot set to "none"); can't duplicate a chosen dish; total can't exceed maxSides.
 * Returns { extra }, { extra: null } or { problem }.
 */
function resolveExtraSide(item, extra, resolvedSlots, config = DEFAULT_PLATFORM_CONFIG) {
  if (!extra || extra.mode == null) return { extra: null };
  if (!["backup", "addon"].includes(extra.mode)) return { problem: "第四道只能選「備案」或「加菜」" };
  if (!isBento(item)) return { problem: "這個品項不能加配菜" };
  const standard = item.slots.length;
  if (standard + 1 > (config.maxSides || 4)) return { problem: `配菜最多 ${config.maxSides || 4} 道` };
  if (resolvedSlots.some((s) => s.removed)) return { problem: "要先選滿標準配菜數，才能加第四道" };
  const slotIdx = Number(extra.slot);
  const cand = extra.candidate == null || extra.candidate === "default" ? null : Number(extra.candidate);
  const option = sideOptions(item).find((o) => o.slot === slotIdx && o.candidate === cand);
  if (!option) return { problem: "第四道選的配菜不存在" };
  const chosen = new Set(resolvedSlots.map((s) => s.wished || s.default_dish));
  if (chosen.has(option.name)) return { problem: `「${option.name}」已經在便當裡了，請選別道` };
  return {
    extra: {
      slot: slotIdx,
      candidate_index: cand,
      dish: option.name,
      component_id: option.component_id,
      portion_level: option.portion_level ?? 1,
      mode: extra.mode,
      // A candidate dish picked as the fourth side also counts as a wish; resolved is filled after the cut-off decision (backup: which slot it fills in for)
      wished: cand != null,
      resolved: null,
      used_for_slot: null,
    },
  };
}

function isBento(item) {
  return Array.isArray(item?.slots) && item.slots.length > 0;
}

/**
 * Validates the frontend's choices (slots[i].choice = "default" | "none" | candidate index) and expands them into
 * the slots content written to locks. Returns { slots, removedCount } or { problem }.
 */
function resolveChoices(item, choices) {
  if (!isBento(item)) return { slots: [], removedCount: 0 };
  const list = Array.isArray(choices) ? choices : [];
  const out = [];
  let removedCount = 0;
  item.slots.forEach((slot, i) => {
    const choice = list[i]?.choice ?? "default";
    const base = { category: slot.category || "", default_dish: slot.default?.name || "", default_component_id: slot.default?.component_id || null };
    if (choice === "none") {
      removedCount++;
      out.push({ ...base, removed: true, wished: null, resolved: null, portion_level: null });
      return;
    }
    if (choice === "default") {
      out.push({ ...base, removed: false, wished: null, resolved: base.default_dish, portion_level: 1 });
      return;
    }
    const idx = Number(choice);
    const cand = Number.isInteger(idx) ? slot.candidates?.[idx] : null;
    if (!cand) {
      out.push({ problem: `第 ${i + 1} 格的選擇不存在` });
      return;
    }
    out.push({
      ...base,
      removed: false,
      wished: cand.name,
      wished_component_id: cand.component_id || null,
      candidate_index: idx,
      // Before cut-off we don't know whether the candidate goes ahead, so record the default dish; lockOrders updates resolved after deciding
      resolved: null,
      portion_level: cand.portion_level ?? 1,
    });
  });
  const problem = out.find((s) => s.problem)?.problem;
  if (problem) return { problem };
  return { slots: out, removedCount };
}

/**
 * Vendor-defined fields (dropdowns below the sides): picks[i] is the option index chosen for field i; not sent = the first one.
 * Returns { custom: [{ label, index, choice, price }], amount } or { problem }; amounts come from the item settings, never trust the frontend.
 */
function resolveCustomPicks(item, picks) {
  const fields = Array.isArray(item.custom_fields) ? item.custom_fields.filter((f) => f?.label && f.options?.length) : [];
  const list = Array.isArray(picks) ? picks : [];
  const custom = [];
  for (let i = 0; i < fields.length; i++) {
    const idx = list[i] ?? 0;
    const opt = Number.isInteger(idx) ? fields[i].options[idx] : null;
    if (!opt) return { problem: `「${fields[i].label}」的選擇不存在` };
    custom.push({ label: fields[i].label, index: idx, choice: opt.name, price: Number(opt.price) || 0 });
  }
  return { custom, amount: custom.reduce((s, c) => s + c.price, 0) };
}

/** Price adjustments: 1.5 bowls of rice +10, half bowl −5, one fewer side −5, fourth side as add-on +10 (backup 0); applied directly to the order amount */
function adjustAmount({ rice, removedCount, extraMode }, config = DEFAULT_PLATFORM_CONFIG) {
  let amount = removedCount > 0 ? removedCount * config.slotRemovePrice : 0;
  if (rice === "add") amount += config.riceAddPrice;
  if (rice === "less") amount += config.riceLessPrice;
  if (extraMode === "addon") amount += config.addonSidePrice ?? 10;
  return amount;
}

// ── Auto tags: derived from the recipe ──
const PROTEIN_CATEGORIES = { 雞: "雞", 豬: "豬", 牛: "牛", 海鮮: "海鮮", 魚: "海鮮", 素: "素", 豆: "素", 蛋: "素" };
const VEG_CATEGORIES = ["葉菜", "根莖", "瓜類"];

/** A dish's tags: { protein[], method[], flavor[], veg[] } flattened into a string array */
function dishTags(component, ingredientsById) {
  const tags = new Set();
  if (!component) return [];
  if (component.method) tags.add(component.method);
  for (const f of component.flavors || []) tags.add(f);
  for (const line of component.ingredients || []) {
    const cat = ingredientsById[line.ingredient_id]?.category;
    if (!cat) continue;
    if (PROTEIN_CATEGORIES[cat]) tags.add(PROTEIN_CATEGORIES[cat]);
    if (VEG_CATEGORIES.includes(cat)) tags.add(cat);
  }
  return [...tags];
}

module.exports = {
  RICE_OPTIONS, rawAmount, componentCost, portionLevelFor, portionText, portionLabel, isBento, resolveChoices, resolveMain, sideOptions,
  resolveExtraSide, resolveCustomPicks, adjustAmount, dishTags,
};

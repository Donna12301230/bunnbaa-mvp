// 便當組成、計價、配方換算（規格 §3、§4）。純函式，不碰 Firestore；前端
// web/src/lib/bento.ts 有同一套規則（顯示用），伺服器以這裡為準。
//
// menu_items 的便當欄位：
//   main: { name, component_id }                 主菜（固定一道，不可減）
//   rice_component_id                            主食半成品（白飯等），加飯／減飯作用在它
//   fixed: [{ name, component_id }]              固定附餐，不能換也不能減（例：經典便當的滷蛋）
//   slots: [{ category, default: { name, component_id },
//             candidates: [{ name, component_id, portion_level, weekly_cap, min_qty }] }]
//   weekdays: [1..5]                             週菜單輪替：只在這幾天供應（沒設＝每天）
// 沒有 slots 的舊品項（咖啡輕食、飯糰）照舊當成單一品項賣，不能加減飯菜。
//
// vendors/{id}/components/{id}（半成品）：
//   name, portion_grams, ingredients: [{ ingredient_id, grams }]（每份熟重）,
//   prep_minutes, equipment, batch_capacity（每批份數）, advance_hours, method, flavors[]
// vendors/{id}/ingredients/{id}（原物料）：
//   name, category, unit, purchase_unit_label, purchase_unit_size, yield_rate, loss_rate,
//   shelf_days, frequency: monthly|weekly|daily, supplier_id, unit_price（每採購單位）

const { DEFAULT_PLATFORM_CONFIG } = require("./config");

const RICE_OPTIONS = ["add", "normal", "less"];

/** 生料用量 = 熟重 × 份數 ÷ (熟成率 × (1 − 損耗率)) */
function rawAmount(cookedAmount, ingredient) {
  const yieldRate = Number(ingredient?.yield_rate) > 0 ? Number(ingredient.yield_rate) : 1;
  const lossRate = Number(ingredient?.loss_rate) >= 0 && Number(ingredient?.loss_rate) < 1 ? Number(ingredient.loss_rate) : 0;
  return cookedAmount / (yieldRate * (1 - lossRate));
}

/** 半成品每份成本（元）；缺資料的原物料當 0 */
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

/** 份量級距（§3.3）：預設菜成本 ÷ 候選菜成本 → 1、0.75、0.5；< 0.5 回傳 null（不得列為候選） */
function portionLevelFor(defaultCost, candidateCost) {
  if (!(candidateCost > 0)) return 1;
  const ratio = defaultCost / candidateCost;
  if (ratio >= 1) return 1;
  if (ratio >= 0.75) return 0.75;
  if (ratio >= 0.5) return 0.5;
  return null;
}

function portionLabel(level) {
  if (level === 0.75) return "3/4 份";
  if (level === 0.5) return "半份";
  return "全份";
}

function isBento(item) {
  return Array.isArray(item?.slots) && item.slots.length > 0;
}

/**
 * 把前端送來的選擇（slots[i].choice = "default" | "none" | 候選 index）驗證並展開成
 * 要寫進 locks 的 slots 內容。回傳 { slots, removedCount } 或 { problem }。
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
      // 截單前還不知道成不成立，先記預設菜；lockOrders 判定後改 resolved
      resolved: null,
      portion_level: cand.portion_level ?? 1,
    });
  });
  const problem = out.find((s) => s.problem)?.problem;
  if (problem) return { problem };
  return { slots: out, removedCount };
}

/** 加減金額（§4.2）：加飯 +10、減飯 −5、每格不要 −5；直接反映在訂單金額 */
function adjustAmount({ rice, removedCount }, config = DEFAULT_PLATFORM_CONFIG) {
  let amount = removedCount * config.slotRemovePrice;
  if (rice === "add") amount += config.riceAddPrice;
  if (rice === "less") amount += config.riceLessPrice;
  return amount;
}

// ── 自動標籤（§3.4）：由配方推導 ──
const PROTEIN_CATEGORIES = { 雞: "雞", 豬: "豬", 牛: "牛", 海鮮: "海鮮", 魚: "海鮮", 素: "素", 豆: "素", 蛋: "素" };
const VEG_CATEGORIES = ["葉菜", "根莖", "瓜類"];

/** 一道菜的標籤：{ protein[], method[], flavor[], veg[] } 攤平成字串陣列 */
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
  RICE_OPTIONS, rawAmount, componentCost, portionLevelFor, portionLabel, isBento, resolveChoices, adjustAmount, dishTags,
};

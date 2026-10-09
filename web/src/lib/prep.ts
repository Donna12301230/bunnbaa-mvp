import { componentCost, rawAmount } from "@/lib/bento";
import { DEFAULT_PLATFORM_CONFIG } from "@/lib/platformConfig";
import { tr } from "@/lib/i18n";
import type { Component, Ingredient, Lock, MenuItem, RiceOption } from "@/types";

// 備料的份數／生料計算（前端版）。跟 functions/src/prep.js 的 componentPortionsForLock、rawNeeds 同一套規則，要一起改：
// 菜單的材料總和、截單前的備料預估都用這裡，截單後以後端算出的 prepPlans 為準。

type Portions = Map<string, number>;

function add(map: Map<string, number>, key: string | null | undefined, amount: number) {
  if (!key || !(amount > 0)) return;
  map.set(key, (map.get(key) || 0) + amount);
}

/** 白飯份數：半碗 0.5、一碗 1、一碗半 1 ＋ 多加克數 ÷ 每份熟重 */
export function ricePortions(rice: RiceOption | undefined, riceComponent: Component | undefined, config = DEFAULT_PLATFORM_CONFIG): number {
  const grams = Number(riceComponent?.portion_grams) || 0;
  let portions = rice === "less" ? 0.5 : 1;
  if (rice === "add") portions += grams > 0 ? (config.riceAddGrams || 100) / grams : 0.5;
  return portions;
}

/** 一筆訂單（或預估用的組合）要用到哪些半成品、各幾份 */
export function componentPortionsForLock(
  lock: Pick<Lock, "rice" | "slots" | "extra_side"> & { main_component_id?: string | null },
  item: MenuItem | undefined,
  componentsById: Record<string, Component>,
  config = DEFAULT_PLATFORM_CONFIG,
): Portions {
  const out: Portions = new Map();
  if (!item) return out;
  const mainId = lock.main_component_id || item.main?.component_id || item.mains?.[0]?.component_id || null;
  if (mainId) add(out, mainId, 1);
  if (!mainId && item.component_id) add(out, item.component_id, 1);
  for (const f of item.fixed ?? []) add(out, f.component_id, Number(f.portions) > 0 ? Number(f.portions) : 1);
  if (item.rice_component_id) add(out, item.rice_component_id, ricePortions(lock.rice, componentsById[item.rice_component_id], config));
  const slots = lock.slots?.length
    ? lock.slots
    : (item.slots ?? []).map((s) => ({ removed: false, wished: null, resolved: null, default_component_id: s.default?.component_id, portion_level: 1 }));
  slots.forEach((slot, i) => {
    const s = slot as typeof slot & { resolved_component_id?: string | null; wished_component_id?: string | null; backup_used?: boolean };
    if (s.removed) return;
    if (s.backup_used) {
      add(out, s.resolved_component_id, s.portion_level ?? 1);
      return;
    }
    const wishedOk = !!s.wished && s.resolved === s.wished;
    const componentId = wishedOk ? s.wished_component_id : s.default_component_id || item.slots?.[i]?.default?.component_id;
    add(out, componentId, wishedOk ? s.portion_level ?? 1 : 1);
  });
  const extra = lock.extra_side as (Lock["extra_side"] & { resolved_component_id?: string | null }) | null | undefined;
  if (extra?.mode === "addon") add(out, extra.resolved_component_id || extra.component_id, extra.portion_level ?? 1);
  return out;
}

/** 多筆訂單合計的半成品份數 */
export function componentPortions(locks: (Lock & { main_component_id?: string | null })[], itemsById: Record<string, MenuItem>, componentsById: Record<string, Component>, config = DEFAULT_PLATFORM_CONFIG): Portions {
  const total: Portions = new Map();
  for (const lock of locks) {
    for (const [id, n] of componentPortionsForLock(lock, itemsById[lock.menu_item_id ?? ""], componentsById, config)) add(total, id, n);
  }
  return total;
}

/** 半成品份數 → 各原物料生料用量（原物料自己的單位） */
export function rawNeeds(portions: Portions, componentsById: Record<string, Component>, ingredientsById: Record<string, Ingredient>): Map<string, number> {
  const needs = new Map<string, number>();
  for (const [componentId, n] of portions) {
    for (const line of componentsById[componentId]?.ingredients ?? []) {
      const ing = ingredientsById[line.ingredient_id];
      if (ing) add(needs, line.ingredient_id, rawAmount((Number(line.grams) || 0) * n, ing));
    }
  }
  return needs;
}

/** 半成品份數 → 成本 */
export function portionsCost(portions: Portions, componentsById: Record<string, Component>, ingredientsById: Record<string, Ingredient>): number {
  let sum = 0;
  for (const [id, n] of portions) sum += componentCost(componentsById[id], ingredientsById) * n;
  return sum;
}

// ---------------- 資料缺漏（成本算不出來的原因） ----------------

export type CostIssue =
  | { kind: "unlinked" } // 沒接半成品
  | { kind: "missing"; componentId: string } // 接的半成品已被刪除
  | { kind: "no_ingredients"; componentId: string } // 半成品沒有原物料
  | { kind: "no_price"; componentId: string; ingredientId: string; name: string }; // 原物料沒單價

/** 一道菜的成本為什麼算不出來（null＝沒問題） */
export function costIssue(componentId: string | null | undefined, componentsById: Record<string, Component>, ingredientsById: Record<string, Ingredient>): CostIssue | null {
  if (!componentId) return { kind: "unlinked" };
  const comp = componentsById[componentId];
  if (!comp) return { kind: "missing", componentId };
  const lines = (comp.ingredients ?? []).filter((l) => ingredientsById[l.ingredient_id]);
  if (lines.length === 0) return { kind: "no_ingredients", componentId };
  const unpriced = lines.map((l) => ingredientsById[l.ingredient_id]).find((i) => !(i.unit_price > 0));
  if (unpriced) return { kind: "no_price", componentId, ingredientId: unpriced.id, name: unpriced.name };
  return null;
}

export function costIssueText(issue: CostIssue): string {
  switch (issue.kind) {
    case "unlinked": return tr("未接配方", "No recipe linked");
    case "missing": return tr("配方已被刪除", "Recipe deleted");
    case "no_ingredients": return tr("配方沒有原物料", "Recipe has no ingredients");
    case "no_price": return tr(`${issue.name} 未填單價`, `${issue.name} has no price`);
  }
}

/** 品項上每一道菜（主菜、白飯、固定附餐、配菜、候選菜）與它接的半成品 */
export function itemDishes(item: Pick<MenuItem, "item_type" | "mains" | "main" | "rice_component_id" | "fixed" | "slots" | "component_id">): { label: string; name: string; component_id: string | null }[] {
  const out: { label: string; name: string; component_id: string | null }[] = [];
  const isBento = item.item_type ? item.item_type === "bento" : (item.slots?.length ?? 0) > 0;
  if (isBento) {
    const mains = item.mains?.length ? item.mains : item.main ? [item.main] : [];
    mains.forEach((m) => out.push({ label: tr("主菜", "Main"), name: m.name, component_id: m.component_id ?? null }));
    if (item.rice_component_id) out.push({ label: tr("白飯", "Rice"), name: tr("白飯", "Rice"), component_id: item.rice_component_id });
  } else if (item.component_id) {
    out.push({ label: tr("組成", "Part"), name: "", component_id: item.component_id });
  }
  (item.fixed ?? []).forEach((f) => out.push({ label: isBento ? tr("附餐", "Extra") : tr("組成", "Part"), name: f.name, component_id: f.component_id ?? null }));
  (item.slots ?? []).forEach((s, i) => {
    if (s.default?.name) out.push({ label: tr(`配菜 ${i + 1}`, `Side ${i + 1}`), name: s.default.name, component_id: s.default.component_id ?? null });
    s.candidates.forEach((c) => c.name && out.push({ label: tr(`配菜 ${i + 1} 候選`, `Side ${i + 1} option`), name: c.name, component_id: c.component_id ?? null }));
  });
  return out;
}

/** 品項的配方缺漏，例：「配菜 2 茄子：未接配方」 */
export function itemIssues(item: MenuItem, componentsById: Record<string, Component>, ingredientsById: Record<string, Ingredient>): { label: string; name: string; issue: CostIssue }[] {
  const dishes = itemDishes(item);
  if (dishes.length === 0) return [{ label: tr("組成", "Part"), name: item.name, issue: { kind: "unlinked" } }];
  return dishes.flatMap((d) => {
    const issue = costIssue(d.component_id, componentsById, ingredientsById);
    return issue ? [{ ...d, issue }] : [];
  });
}

/** 半成品被哪些品項用到：component_id → 品項清單 */
export function componentUsage(items: MenuItem[]): Map<string, MenuItem[]> {
  const map = new Map<string, MenuItem[]>();
  for (const item of items) {
    const ids = new Set(itemDishes(item).map((d) => d.component_id).filter(Boolean) as string[]);
    for (const id of ids) map.set(id, [...(map.get(id) ?? []), item]);
  }
  return map;
}

/** 原物料的缺漏標記；unused 只是提醒，不影響成本與叫貨 */
export function ingredientIssues(ing: Ingredient, usedIngredientIds: Set<string>): { code: "no_price" | "no_supplier" | "unused"; text: string }[] {
  const out: { code: "no_price" | "no_supplier" | "unused"; text: string }[] = [];
  if (!(ing.unit_price > 0)) out.push({ code: "no_price", text: tr("未填單價", "No price") });
  if (!ing.supplier_id) out.push({ code: "no_supplier", text: tr("未選供應商", "No supplier") });
  if (!usedIngredientIds.has(ing.id)) out.push({ code: "unused", text: tr("沒有配方用到", "Unused") });
  return out;
}

/** 數量顯示：克數大於 1000 換成公斤，其他保留一位小數 */
export function amountText(amount: number, unit: string): string {
  if ((unit === "g" || unit === "克") && amount >= 1000) return `${Math.round(amount / 100) / 10} kg`;
  if ((unit === "ml" || unit === "毫升") && amount >= 1000) return `${Math.round(amount / 100) / 10} L`;
  return `${Math.round(amount * 10) / 10}${unit === "g" ? " g" : unit === "ml" ? " ml" : ` ${unit}`}`;
}

/** 調味料、包材在材料總和裡預設收合（跟 BentoEditor 的 portionTextFor 同一組分類） */
export const MINOR_CATEGORIES = ["調味", "包材"];

/** 生料需求 → 合成格子的材料（依需要量由多到少；有 stock 就帶現有量） */
export function craftItems(needs: Map<string, number>, ingredientsById: Record<string, Ingredient>, stock?: Record<string, number>) {
  return [...needs].flatMap(([id, need]) => {
    const ing = ingredientsById[id];
    if (!ing || !(need > 0)) return [];
    return [{ id, name: ing.name, need, unit: ing.unit || "g", have: stock ? stock[id] ?? 0 : undefined, minor: MINOR_CATEGORIES.includes(ing.category) }];
  }).sort((a, b) => Number(a.minor) - Number(b.minor) || b.need - a.need);
}

/**
 * 上架中品項用到、但還是 AI 草稿（ai_draft，店家還沒按儲存確認）的半成品。
 * 草稿的份量是 AI 估的，備料、叫貨、成本照它算會不準——這些頁面要提醒店家先確認（2026-10-09）。
 */
export function aiDraftComponentsInUse(items: MenuItem[], componentsById: Record<string, Component>): { component: Component; items: MenuItem[] }[] {
  const usage = componentUsage(items.filter((i) => i.is_available !== false));
  return [...usage.entries()]
    .map(([id, used]) => ({ component: componentsById[id], items: used }))
    .filter((x): x is { component: Component; items: MenuItem[] } => !!x.component?.ai_draft);
}

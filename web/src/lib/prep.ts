import { componentCost, rawAmount } from "@/lib/bento";
import { liveConfig } from "@/lib/platformConfig";
import { loc, tr } from "@/lib/i18n";
import type { Component, Ingredient, Lock, MenuItem, RiceOption } from "@/types";

// Prep portion / raw-ingredient calculations (frontend copy). Same rules as componentPortionsForLock and rawNeeds in functions/src/prep.js; change both together:
// the menu's ingredient totals and pre-cut-off prep estimates use this; after cut-off the prepPlans computed by the backend are authoritative.

type Portions = Map<string, number>;

function add(map: Map<string, number>, key: string | null | undefined, amount: number) {
  if (!key || !(amount > 0)) return;
  map.set(key, (map.get(key) || 0) + amount);
}

/** Rice portions: half bowl 0.5, one bowl 1, 1.5 bowls = 1 + extra grams ÷ cooked weight per portion */
export function ricePortions(rice: RiceOption | undefined, riceComponent: Component | undefined, config = liveConfig()): number {
  const grams = Number(riceComponent?.portion_grams) || 0;
  let portions = rice === "less" ? 0.5 : 1;
  if (rice === "add") portions += grams > 0 ? (config.riceAddGrams || 100) / grams : 0.5;
  return portions;
}

/** Which components an order (or an estimate combination) uses, and how many portions of each */
export function componentPortionsForLock(
  lock: Pick<Lock, "rice" | "slots" | "extra_side"> & { main_component_id?: string | null },
  item: MenuItem | undefined,
  componentsById: Record<string, Component>,
  config = liveConfig(),
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

/** Component portions summed over multiple orders */
export function componentPortions(locks: (Lock & { main_component_id?: string | null })[], itemsById: Record<string, MenuItem>, componentsById: Record<string, Component>, config = liveConfig()): Portions {
  const total: Portions = new Map();
  for (const lock of locks) {
    for (const [id, n] of componentPortionsForLock(lock, itemsById[lock.menu_item_id ?? ""], componentsById, config)) add(total, id, n);
  }
  return total;
}

/** Component portions → raw amount of each ingredient (in the ingredient's own unit) */
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

/** Component portions → cost */
export function portionsCost(portions: Portions, componentsById: Record<string, Component>, ingredientsById: Record<string, Ingredient>): number {
  let sum = 0;
  for (const [id, n] of portions) sum += componentCost(componentsById[id], ingredientsById) * n;
  return sum;
}

// ---------------- Missing data (why the cost cannot be computed) ----------------

export type CostIssue =
  | { kind: "unlinked" } // no component linked
  | { kind: "missing"; componentId: string } // linked component has been deleted
  | { kind: "no_ingredients"; componentId: string } // component has no ingredients
  | { kind: "no_price"; componentId: string; ingredientId: string; name: string }; // ingredient has no unit price

/** Why a dish's cost cannot be computed (null = no problem) */
export function costIssue(componentId: string | null | undefined, componentsById: Record<string, Component>, ingredientsById: Record<string, Ingredient>): CostIssue | null {
  if (!componentId) return { kind: "unlinked" };
  const comp = componentsById[componentId];
  if (!comp) return { kind: "missing", componentId };
  const lines = (comp.ingredients ?? []).filter((l) => ingredientsById[l.ingredient_id]);
  if (lines.length === 0) return { kind: "no_ingredients", componentId };
  const unpriced = lines.map((l) => ingredientsById[l.ingredient_id]).find((i) => !(i.unit_price > 0));
  if (unpriced) return { kind: "no_price", componentId, ingredientId: unpriced.id, name: loc(unpriced, "name") };
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

/** Every dish on an item (main, rice, fixed extras, sides, candidate dishes) and the component it links to */
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

/** Missing recipe data for an item, e.g. "Side 2 eggplant: no recipe linked" */
export function itemIssues(item: MenuItem, componentsById: Record<string, Component>, ingredientsById: Record<string, Ingredient>): { label: string; name: string; issue: CostIssue }[] {
  const dishes = itemDishes(item);
  if (dishes.length === 0) return [{ label: tr("組成", "Part"), name: item.name, issue: { kind: "unlinked" } }];
  return dishes.flatMap((d) => {
    const issue = costIssue(d.component_id, componentsById, ingredientsById);
    return issue ? [{ ...d, issue }] : [];
  });
}

/** Which items use each component: component_id → list of items */
export function componentUsage(items: MenuItem[]): Map<string, MenuItem[]> {
  const map = new Map<string, MenuItem[]>();
  for (const item of items) {
    const ids = new Set(itemDishes(item).map((d) => d.component_id).filter(Boolean) as string[]);
    for (const id of ids) map.set(id, [...(map.get(id) ?? []), item]);
  }
  return map;
}

/** Missing-data flags for an ingredient; unused is only a reminder and does not affect cost or purchasing */
export function ingredientIssues(ing: Ingredient, usedIngredientIds: Set<string>): { code: "no_price" | "no_supplier" | "unused"; text: string }[] {
  const out: { code: "no_price" | "no_supplier" | "unused"; text: string }[] = [];
  if (!(ing.unit_price > 0)) out.push({ code: "no_price", text: tr("未填單價", "No price") });
  if (!ing.supplier_id) out.push({ code: "no_supplier", text: tr("未選供應商", "No supplier") });
  if (!usedIngredientIds.has(ing.id)) out.push({ code: "unused", text: tr("沒有配方用到", "Unused") });
  return out;
}

/** Quantity display: above 1000 g switch to kg, otherwise keep one decimal place */
export function amountText(amount: number, unit: string): string {
  if ((unit === "g" || unit === "克") && amount >= 1000) return `${Math.round(amount / 100) / 10} kg`;
  if ((unit === "ml" || unit === "毫升") && amount >= 1000) return `${Math.round(amount / 100) / 10} L`;
  return `${Math.round(amount * 10) / 10}${unit === "g" ? " g" : unit === "ml" ? " ml" : ` ${unit}`}`;
}

/** Seasonings and packaging are collapsed by default in the ingredient totals (same categories as portionTextFor in BentoEditor) */
export const MINOR_CATEGORIES = ["調味", "包材"];

/** Raw needs → materials for the merged grid (sorted by amount needed, descending; includes current stock when present) */
export function craftItems(needs: Map<string, number>, ingredientsById: Record<string, Ingredient>, stock?: Record<string, number>) {
  return [...needs].flatMap(([id, need]) => {
    const ing = ingredientsById[id];
    if (!ing || !(need > 0)) return [];
    return [{ id, name: loc(ing, "name"), need, unit: ing.unit || "g", have: stock ? stock[id] ?? 0 : undefined, minor: MINOR_CATEGORIES.includes(ing.category) }];
  }).sort((a, b) => Number(a.minor) - Number(b.minor) || b.need - a.need);
}

/**
 * Components used by listed items that are still AI drafts (ai_draft; the vendor has not saved to confirm them).
 * Draft portions are AI estimates, so prep, purchasing and cost based on them will be off; those pages should remind the vendor to confirm first (2026-10-09).
 */
export function aiDraftComponentsInUse(items: MenuItem[], componentsById: Record<string, Component>): { component: Component; items: MenuItem[] }[] {
  const usage = componentUsage(items.filter((i) => i.is_available !== false));
  return [...usage.entries()]
    .map(([id, used]) => ({ component: componentsById[id], items: used }))
    .filter((x): x is { component: Component; items: MenuItem[] } => !!x.component?.ai_draft);
}

import type { Component, Ingredient } from "@/types";
import { tr } from "@/lib/i18n";

// Fixed colors per ingredient category: rice yellow, meat / fish coral, vegetables green, packaging purple, shared site-wide.
// Bento cells, prep cards and composition cells all use these colors, so vendors can tell the category by color.

export type FoodGroup = "rice" | "protein" | "veg" | "pack" | "other";

const GROUP_OF_CATEGORY: Record<string, FoodGroup> = {
  米: "rice", 麵: "rice",
  雞: "protein", 豬: "protein", 牛: "protein", 海鮮: "protein", 蛋: "protein",
  葉菜: "veg", 根莖: "veg", 瓜類: "veg", 素: "veg", 豆: "veg",
  包材: "pack",
};

export function ingredientGroup(category: string | undefined): FoodGroup {
  return GROUP_OF_CATEGORY[category ?? ""] ?? "other";
}

/** Color of a dish (semi-finished component): the category of its main ingredient by quantity (excluding seasoning and packaging) */
export function componentGroup(comp: Component | undefined, ingredientsById: Record<string, Ingredient>): FoodGroup {
  let best: { grams: number; group: FoodGroup } | null = null;
  for (const line of comp?.ingredients ?? []) {
    const ing = ingredientsById[line.ingredient_id];
    if (!ing || ing.category === "調味" || ing.category === "包材") continue;
    // Ingredients counted by piece or slice (1 chicken leg) represent the dish better than grams, so apply a weight first
    const grams = (Number(line.grams) || 0) * (ing.unit === "g" || ing.unit === "ml" || ing.unit === "克" || ing.unit === "毫升" ? 1 : 100);
    if (!best || grams > best.grams) best = { grams, group: ingredientGroup(ing.category) };
  }
  return best?.group ?? "other";
}

/** Cell background, border and text colors */
export const GROUP_CELL: Record<FoodGroup, string> = {
  rice: "bg-warning-soft border-warning text-warning-text",
  protein: "bg-danger-soft border-danger text-danger-text",
  veg: "bg-success-soft border-success text-success-text",
  pack: "bg-plum-soft border-plum text-plum-text",
  other: "bg-muted border-input text-foreground",
};

/** Color dot (legends, small markers) */
export const GROUP_DOT: Record<FoodGroup, string> = {
  rice: "bg-warning",
  protein: "bg-danger",
  veg: "bg-success-strong",
  pack: "bg-plum",
  other: "bg-muted-foreground/50",
};

export const groupLabel = (g: FoodGroup) => ({
  rice: tr("飯類", "Rice"),
  protein: tr("肉／魚", "Meat / fish"),
  veg: tr("蔬菜", "Veg"),
  pack: tr("包材", "Packaging"),
  other: tr("其他", "Other"),
}[g]);

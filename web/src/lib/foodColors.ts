import type { Component, Ingredient } from "@/types";
import { tr } from "@/lib/i18n";

// 食材類別固定配色（簡化提案 §4）：飯類黃、肉／魚珊瑚、蔬菜綠、包材紫，全站共用。
// 便當格子、備料卡片、合成格子都用這裡的顏色，商家看顏色就知道是哪一類。

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

/** 一道菜（半成品）的顏色：用量最多的主要原物料（不算調味、包材）的類別 */
export function componentGroup(comp: Component | undefined, ingredientsById: Record<string, Ingredient>): FoodGroup {
  let best: { grams: number; group: FoodGroup } | null = null;
  for (const line of comp?.ingredients ?? []) {
    const ing = ingredientsById[line.ingredient_id];
    if (!ing || ing.category === "調味" || ing.category === "包材") continue;
    // 以個、片計的（雞腿 1 支）比克數更代表這道菜，先乘個權重
    const grams = (Number(line.grams) || 0) * (ing.unit === "g" || ing.unit === "ml" || ing.unit === "克" || ing.unit === "毫升" ? 1 : 100);
    if (!best || grams > best.grams) best = { grams, group: ingredientGroup(ing.category) };
  }
  return best?.group ?? "other";
}

/** 格子底色、框線、字色 */
export const GROUP_CELL: Record<FoodGroup, string> = {
  rice: "bg-warning-soft border-warning text-warning-text",
  protein: "bg-danger-soft border-danger text-danger-text",
  veg: "bg-success-soft border-success text-success-text",
  pack: "bg-plum-soft border-plum text-plum-text",
  other: "bg-muted border-input text-foreground",
};

/** 色點（圖例、小標記） */
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

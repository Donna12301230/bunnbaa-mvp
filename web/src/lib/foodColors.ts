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
  rice: "bg-amber-100 border-amber-400 text-amber-950",
  protein: "bg-rose-100 border-rose-400 text-rose-950",
  veg: "bg-green-100 border-green-500 text-green-950",
  pack: "bg-violet-100 border-violet-400 text-violet-950",
  other: "bg-stone-100 border-stone-400 text-stone-900",
};

/** 色點（圖例、小標記） */
export const GROUP_DOT: Record<FoodGroup, string> = {
  rice: "bg-amber-400",
  protein: "bg-rose-400",
  veg: "bg-green-500",
  pack: "bg-violet-400",
  other: "bg-stone-400",
};

export const groupLabel = (g: FoodGroup) => ({
  rice: tr("飯類", "Rice"),
  protein: tr("肉／魚", "Meat / fish"),
  veg: tr("蔬菜", "Veg"),
  pack: tr("包材", "Packaging"),
  other: tr("其他", "Other"),
}[g]);

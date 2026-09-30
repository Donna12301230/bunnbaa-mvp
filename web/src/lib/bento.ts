import { tr } from "@/lib/i18n";
import { applyEarlyBirdPrice } from "@/lib/pricing";
import { DEFAULT_PLATFORM_CONFIG } from "@/lib/platformConfig";
import type { Component, Ingredient, LockSlot, MenuItem, RiceOption, SlotChoice } from "@/types";

// 便當計價與配方換算（規格 §3、§4）。跟 functions/src/bento.js 同一套規則；
// 這裡只給畫面預覽與店家菜單編輯用，下單金額以伺服器為準。

export function isBento(item: Pick<MenuItem, "slots"> | null | undefined): boolean {
  return Array.isArray(item?.slots) && item!.slots!.length > 0;
}

export function portionLabel(level: number | null | undefined): string {
  if (level === 0.75) return tr("3/4 份", "3/4 portion");
  if (level === 0.5) return tr("半份", "half portion");
  return tr("全份", "full portion");
}

export function riceLabel(rice: RiceOption | undefined): string | null {
  if (rice === "add") return tr("加飯", "Extra rice");
  if (rice === "less") return tr("減飯", "Less rice");
  return null;
}

/** 加減金額：加飯 +10、減飯 −5、每格不要 −5 */
export function adjustAmount(rice: RiceOption, choices: SlotChoice[], config = DEFAULT_PLATFORM_CONFIG): number {
  let amount = choices.filter((c) => c === "none").length * config.slotRemovePrice;
  if (rice === "add") amount += config.riceAddPrice;
  if (rice === "less") amount += config.riceLessPrice;
  return amount;
}

/** 一份便當的金額拆解（早鳥只打在品項原價上，加減金額不打折） */
export function priceBreakdown(item: Pick<MenuItem, "price">, pickupDate: string, rice: RiceOption, choices: SlotChoice[], couponDiscount = 0) {
  const { lockedPrice: early, discountPercent } = applyEarlyBirdPrice(item.price, pickupDate);
  const adjust = adjustAmount(rice, choices);
  const subtotal = Math.max(0, early + adjust);
  const coupon = Math.min(couponDiscount, subtotal);
  return { listPrice: item.price, discountPercent, earlyBird: item.price - early, adjust, subtotal, coupon, total: subtotal - coupon };
}

/** 生料用量 = 熟重 × 份數 ÷ (熟成率 × (1 − 損耗率)) */
export function rawAmount(cooked: number, ing: Pick<Ingredient, "yield_rate" | "loss_rate">): number {
  const y = ing.yield_rate > 0 ? ing.yield_rate : 1;
  const l = ing.loss_rate >= 0 && ing.loss_rate < 1 ? ing.loss_rate : 0;
  return cooked / (y * (1 - l));
}

/** 半成品每份成本 */
export function componentCost(component: Component | undefined, ingredientsById: Record<string, Ingredient>): number {
  if (!component) return 0;
  return (component.ingredients || []).reduce((sum, line) => {
    const ing = ingredientsById[line.ingredient_id];
    if (!ing) return sum;
    const size = ing.purchase_unit_size > 0 ? ing.purchase_unit_size : 1;
    return sum + (rawAmount(line.grams || 0, ing) / size) * (ing.unit_price || 0);
  }, 0);
}

/** 份量級距：預設菜成本 ÷ 候選菜成本 → 1、0.75、0.5；< 0.5 回傳 null（不得列為候選） */
export function portionLevelFor(defaultCost: number, candidateCost: number): number | null {
  if (!(candidateCost > 0)) return 1;
  const ratio = defaultCost / candidateCost;
  if (ratio >= 1) return 1;
  if (ratio >= 0.75) return 0.75;
  if (ratio >= 0.5) return 0.5;
  return null;
}

/** 訂單上每格實際的配菜文字（截單前顯示許願中） */
export function slotText(slot: LockSlot): string {
  if (slot.removed) return tr(`${slot.category || "配菜"}：不要`, `${slot.category || "Side"}: none`);
  if (slot.resolved) {
    const note = slot.substituted_from ? tr(`（原 ${slot.substituted_from}，等值替換）`, ` (replaced ${slot.substituted_from})`) : "";
    return `${slot.resolved}${slot.wished && slot.resolved !== slot.wished ? tr("（許願未成立）", " (wish not met)") : ""}${note}`;
  }
  if (slot.wished) return tr(`許願：${slot.wished}（截單時判定，未成立改 ${slot.default_dish}）`, `Wish: ${slot.wished} (decided at cutoff, else ${slot.default_dish})`);
  return slot.default_dish;
}

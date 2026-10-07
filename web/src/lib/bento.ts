import { tr } from "@/lib/i18n";
import { applyEarlyBirdPrice } from "@/lib/pricing";
import { DEFAULT_PLATFORM_CONFIG } from "@/lib/platformConfig";
import type { BentoCustomField, BentoMain, Component, ExtraSideChoice, Ingredient, LockExtraSide, LockSlot, MenuItem, RiceOption, SlotChoice } from "@/types";

// 便當計價與配方換算（規格 §3、§4）。跟 functions/src/bento.js 同一套規則；
// 這裡只給畫面預覽與店家菜單編輯用，下單金額以伺服器為準。

export function isBento(item: Pick<MenuItem, "slots"> | null | undefined): boolean {
  return Array.isArray(item?.slots) && item!.slots!.length > 0;
}

export function portionLabel(level: number | null | undefined): string {
  if (level != null && level < 1) return tr("半份", "half portion");
  return tr("全份", "full portion");
}

export const RICE_OPTIONS: { value: RiceOption; label: string; labelEn: string }[] = [
  { value: "less", label: "半碗", labelEn: "Half bowl" },
  { value: "normal", label: "一碗", labelEn: "One bowl" },
  { value: "add", label: "一碗半", labelEn: "1.5 bowls" },
];

export function riceLabel(rice: RiceOption | undefined): string | null {
  if (rice === "add") return tr("白飯一碗半", "1.5 bowls of rice");
  if (rice === "less") return tr("白飯半碗", "Half bowl of rice");
  return null;
}

type PriceSource = Pick<MenuItem, "price" | "mains" | "main" | "image" | "custom_fields">;

/** 可選主菜（mains 各自定價）；舊品項只有 main＋price 時回傳一道 */
export function itemMains(item: PriceSource): BentoMain[] {
  const mains = (item.mains || []).filter((m) => m && m.price > 0);
  if (mains.length > 0) return mains;
  return item.main?.name ? [{ name: item.main.name, component_id: item.main.component_id, price: item.price, image_url: item.image, portion_text: item.main.portion_text }] : [];
}

/** 品項原價：便當以所選主菜為準 */
export function itemListPrice(item: PriceSource, mainIndex?: number | null): number {
  const mains = (item.mains || []).filter((m) => m && m.price > 0);
  if (mains.length === 0) return item.price;
  return (mains[mainIndex ?? 0] ?? mains[0]).price;
}

/** 最低起價（卡片顯示「$50 起」） */
export function itemMinPrice(item: PriceSource): number {
  const mains = (item.mains || []).filter((m) => m && m.price > 0);
  return mains.length > 0 ? Math.min(...mains.map((m) => m.price)) : item.price;
}

export interface SideOption {
  slot: number;
  candidate: number | null; // null＝那一格的預設菜
  name: string;
  image_url?: string | null;
  portion_text?: string | null;
  portion_level: number;
}

/** 便當全部可選配菜：每格的預設菜＋候選菜（第四道從這裡挑） */
export function sideOptions(item: Pick<MenuItem, "slots">): SideOption[] {
  const out: SideOption[] = [];
  (item.slots || []).forEach((slot, slotIdx) => {
    if (slot.default?.name) out.push({ slot: slotIdx, candidate: null, name: slot.default.name, image_url: slot.default.image_url, portion_text: slot.default.portion_text, portion_level: 1 });
    (slot.candidates || []).forEach((c, ci) => {
      if (c?.name && !c.disabled) out.push({ slot: slotIdx, candidate: ci, name: c.name, image_url: c.image_url, portion_text: c.portion_text, portion_level: c.portion_level ?? 1 });
    });
  });
  return out;
}

/** 加減金額：一碗半 +10、半碗 −5、少一道 −5、第四道加菜 +10（備案 0） */
export function adjustAmount(rice: RiceOption, choices: SlotChoice[], config = DEFAULT_PLATFORM_CONFIG, extra?: ExtraSideChoice | null): number {
  const removed = choices.filter((c) => c === "none").length;
  let amount = removed > 0 ? removed * config.slotRemovePrice : 0;
  if (rice === "add") amount += config.riceAddPrice;
  if (rice === "less") amount += config.riceLessPrice;
  if (extra?.mode === "addon") amount += config.addonSidePrice;
  return amount;
}

/** 店家自訂欄位（配菜下方的下拉選單）：只留有名稱、有選項的 */
export function customFields(item: Pick<MenuItem, "custom_fields"> | null | undefined): BentoCustomField[] {
  return (item?.custom_fields || []).filter((f) => f?.label && f.options?.length);
}

/** 自訂欄位選擇的加減價合計；picks[i] 沒給＝第一個選項 */
export function customAmount(item: Pick<MenuItem, "custom_fields"> | null | undefined, picks: number[] | null | undefined): number {
  return customFields(item).reduce((sum, f, i) => sum + (Number(f.options[picks?.[i] ?? 0]?.price) || 0), 0);
}

/** 加減價文字：+10、−5；0 不顯示 */
export function priceDeltaText(price: number): string {
  return price > 0 ? `+${price}` : price < 0 ? `−${Math.abs(price)}` : "";
}

/** 訂單上自訂欄位的文字：「湯品：玉米濃湯（+10）」 */
export function customOptionTexts(options: { label: string; choice: string; price?: number }[] | null | undefined): string[] {
  return (options || []).map((c) => `${c.label}：${c.choice}${c.price ? `（${priceDeltaText(c.price)}）` : ""}`);
}

/** 一份便當的金額拆解（早鳥只打在品項原價上，加減金額不打折） */
export function priceBreakdown(
  item: PriceSource,
  pickupDate: string,
  rice: RiceOption,
  choices: SlotChoice[],
  couponDiscount = 0,
  opts: { mainIndex?: number | null; extra?: ExtraSideChoice | null; customPicks?: number[] | null } = {}
) {
  const listPrice = itemListPrice(item, opts.mainIndex);
  const { lockedPrice: early, discountPercent } = applyEarlyBirdPrice(listPrice, pickupDate);
  const adjust = adjustAmount(rice, choices, DEFAULT_PLATFORM_CONFIG, opts.extra) + customAmount(item, opts.customPicks);
  const subtotal = Math.max(0, early + adjust);
  const coupon = Math.min(couponDiscount, subtotal);
  return { listPrice, discountPercent, earlyBird: listPrice - early, adjust, subtotal, coupon, total: subtotal - coupon };
}

/** 訂單上第四道的文字 */
export function extraSideText(extra: LockExtraSide | null | undefined): string | null {
  if (!extra) return null;
  if (extra.mode === "addon") return tr(`加菜：${extra.resolved || extra.dish}（+10）`, `Add-on: ${extra.resolved || extra.dish} (+10)`);
  if (extra.used_for_slot != null) return tr(`備案：${extra.dish}（已遞補）`, `Backup: ${extra.dish} (used)`);
  return tr(`備案：${extra.dish}（前三道沒成立才遞補）`, `Backup: ${extra.dish} (used only if a wish fails)`);
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

/** 份量級距（第一階段只分全份／半份）：預設菜成本 ÷ 候選菜成本 ≥ 0.75 全份、0.5–0.75 半份；< 0.5 回傳 null（不得列為候選） */
export function portionLevelFor(defaultCost: number, candidateCost: number): number | null {
  if (!(candidateCost > 0)) return 1;
  const ratio = defaultCost / candidateCost;
  if (ratio >= 0.75) return 1;
  if (ratio >= 0.5) return 0.5;
  return null;
}

/** 訂單上每格實際的配菜文字（截單前顯示許願中） */
export function slotText(slot: LockSlot): string {
  if (slot.removed) return tr(`${slot.category || "配菜"}：不要`, `${slot.category || "Side"}: none`);
  if (slot.backup_used) return tr(`${slot.resolved}（${slot.wished} 未成立，遞補備案）`, `${slot.resolved} (backup for ${slot.wished})`);
  if (slot.resolved) {
    const note = slot.substituted_from ? tr(`（原 ${slot.substituted_from}，等值替換）`, ` (replaced ${slot.substituted_from})`) : "";
    return `${slot.resolved}${slot.wished && slot.resolved !== slot.wished ? tr("（許願未成立）", " (wish not met)") : ""}${note}`;
  }
  if (slot.wished) return tr(`許願：${slot.wished}（截單時判定，未成立改 ${slot.default_dish}）`, `Wish: ${slot.wished} (decided at cutoff, else ${slot.default_dish})`);
  return slot.default_dish;
}

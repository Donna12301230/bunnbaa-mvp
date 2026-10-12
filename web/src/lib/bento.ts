import { tr } from "@/lib/i18n";
import { applyEarlyBirdPrice } from "@/lib/pricing";
import { DEFAULT_PLATFORM_CONFIG, liveConfig } from "@/lib/platformConfig";
import type { BentoCustomField, BentoMain, Component, ExtraSideChoice, Ingredient, LockExtraSide, LockSlot, MenuItem, RiceOption, SlotChoice } from "@/types";

// Bento pricing and recipe conversions (spec §3, §4). Same rules as functions/src/bento.js;
// this is only for on-screen previews and vendor menu editing; order amounts are decided by the server.

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

/** Selectable main dishes (each mains entry has its own price); legacy items with only main + price return one dish */
export function itemMains(item: PriceSource): BentoMain[] {
  const mains = (item.mains || []).filter((m) => m && m.price > 0);
  if (mains.length > 0) return mains;
  return item.main?.name ? [{ name: item.main.name, component_id: item.main.component_id, price: item.price, image_url: item.image, portion_text: item.main.portion_text }] : [];
}

/** Item base price: for bentos, the chosen main dish's price */
export function itemListPrice(item: PriceSource, mainIndex?: number | null): number {
  const mains = (item.mains || []).filter((m) => m && m.price > 0);
  if (mains.length === 0) return item.price;
  return (mains[mainIndex ?? 0] ?? mains[0]).price;
}

/** Lowest starting price (the card shows "From $50") */
export function itemMinPrice(item: PriceSource): number {
  const mains = (item.mains || []).filter((m) => m && m.price > 0);
  return mains.length > 0 ? Math.min(...mains.map((m) => m.price)) : item.price;
}

export interface SideOption {
  slot: number;
  candidate: number | null; // null = that slot's default dish
  name: string;
  image_url?: string | null;
  portion_text?: string | null;
  portion_level: number;
}

/** All selectable sides of a bento: each slot's default dish + candidates (the fourth side is picked from these) */
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

/** Adjustments: one and a half bowls of rice +10, half a bowl −5, one fewer side −5, extra fourth side +10 (fallback 0) */
export function adjustAmount(rice: RiceOption, choices: SlotChoice[], config = DEFAULT_PLATFORM_CONFIG, extra?: ExtraSideChoice | null): number {
  const removed = choices.filter((c) => c === "none").length;
  let amount = removed > 0 ? removed * config.slotRemovePrice : 0;
  if (rice === "add") amount += config.riceAddPrice;
  if (rice === "less") amount += config.riceLessPrice;
  if (extra?.mode === "addon") amount += config.addonSidePrice;
  return amount;
}

/** Vendor custom fields (dropdowns below the sides): only those with a name and options */
export function customFields(item: Pick<MenuItem, "custom_fields"> | null | undefined): BentoCustomField[] {
  return (item?.custom_fields || []).filter((f) => f?.label && f.options?.length);
}

/** Total price adjustment of custom field choices; a missing picks[i] = the first option */
export function customAmount(item: Pick<MenuItem, "custom_fields"> | null | undefined, picks: number[] | null | undefined): number {
  return customFields(item).reduce((sum, f, i) => sum + (Number(f.options[picks?.[i] ?? 0]?.price) || 0), 0);
}

/** Adjustment text: +10, −5; 0 is not shown */
export function priceDeltaText(price: number): string {
  return price > 0 ? `+${price}` : price < 0 ? `−${Math.abs(price)}` : "";
}

/** Custom field text on the order: "Soup: Corn soup (+10)" */
export function customOptionTexts(options: { label: string; choice: string; price?: number }[] | null | undefined): string[] {
  return (options || []).map((c) => `${c.label}：${c.choice}${c.price ? `（${priceDeltaText(c.price)}）` : ""}`);
}

/** Price breakdown for one bento (early-bird discount applies only to the item base price, not to adjustments) */
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
  const adjust = adjustAmount(rice, choices, liveConfig(), opts.extra) + customAmount(item, opts.customPicks);
  const subtotal = Math.max(0, early + adjust);
  const coupon = Math.min(couponDiscount, subtotal);
  return { listPrice, discountPercent, earlyBird: listPrice - early, adjust, subtotal, coupon, total: subtotal - coupon };
}

/** Fourth-side text on the order */
export function extraSideText(extra: LockExtraSide | null | undefined): string | null {
  if (!extra) return null;
  if (extra.mode === "addon") return tr(`加菜：${extra.resolved || extra.dish}（+${liveConfig().addonSidePrice}）`, `Add-on: ${extra.resolved || extra.dish} (+${liveConfig().addonSidePrice})`);
  if (extra.used_for_slot != null) return tr(`備案：${extra.dish}（已遞補）`, `Backup: ${extra.dish} (used)`);
  return tr(`備案：${extra.dish}（前三道沒成立才遞補）`, `Backup: ${extra.dish} (used only if a wish fails)`);
}

/** Raw quantity = cooked weight × portions ÷ (cooking yield × (1 − waste rate)) */
export function rawAmount(cooked: number, ing: Pick<Ingredient, "yield_rate" | "loss_rate">): number {
  const y = ing.yield_rate > 0 ? ing.yield_rate : 1;
  const l = ing.loss_rate >= 0 && ing.loss_rate < 1 ? ing.loss_rate : 0;
  return cooked / (y * (1 - l));
}

/** Cost per portion of a semi-finished component */
export function componentCost(component: Component | undefined, ingredientsById: Record<string, Ingredient>): number {
  if (!component) return 0;
  return (component.ingredients || []).reduce((sum, line) => {
    const ing = ingredientsById[line.ingredient_id];
    if (!ing) return sum;
    const size = ing.purchase_unit_size > 0 ? ing.purchase_unit_size : 1;
    return sum + (rawAmount(line.grams || 0, ing) / size) * (ing.unit_price || 0);
  }, 0);
}

/** Portion tier (phase 1 only has full / half): default dish cost ÷ candidate cost ≥ 0.75 full, 0.5–0.75 half; < 0.5 returns null (can't be a candidate) */
export function portionLevelFor(defaultCost: number, candidateCost: number): number | null {
  if (!(candidateCost > 0)) return 1;
  const ratio = defaultCost / candidateCost;
  if (ratio >= 0.75) return 1;
  if (ratio >= 0.5) return 0.5;
  return null;
}

/** Actual side text per slot on the order (shows "wishing" before cut-off) */
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

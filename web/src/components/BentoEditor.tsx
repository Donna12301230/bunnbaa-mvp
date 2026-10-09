import { useState } from "react";
import { AlertTriangle, Plus, Trash2, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageThumbUpload } from "@/components/ImageUploadField";
import DishPicker, { type DishValue } from "@/components/DishPicker";
import RecipeCraft from "@/components/RecipeCraft";
import BentoBox, { dishCell, type BentoCell } from "@/components/BentoBox";
import { ComponentDialog, EMPTY_COMP, IngredientDialog, saveCatalogDoc, type ComponentDraft, type IngredientDraft } from "@/components/CatalogEditors";
import { useStockOnHand } from "@/hooks/useStockOnHand";
import { useToast } from "@/hooks/use-toast";
import { RICE_OPTIONS, componentCost, portionLabel, portionLevelFor, priceDeltaText } from "@/lib/bento";
import { DEFAULT_PLATFORM_CONFIG as PLATFORM_DEFAULTS } from "@/lib/platformConfig";

const COMMISSION_PCT = Math.round(PLATFORM_DEFAULTS.commissionRate * 1000) / 10;
import { componentPortionsForLock, costIssue, costIssueText, craftItems, portionsCost, rawNeeds, type CostIssue } from "@/lib/prep";
import { DEFAULT_PLATFORM_CONFIG } from "@/lib/platformConfig";
import { MEAL_PERIODS, mealPeriodLabel } from "@/lib/pickupSlots";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BentoCustomField, BentoMain, BentoSlot, Component, Ingredient, LockSlot, MealPeriod, MenuItem, RiceOption, SlotChoice } from "@/types";

export interface BentoForm {
  itemType: "bento" | "single";
  mealPeriods: MealPeriod[];
  mains: BentoMain[];
  riceComponentId: string;
  parts: PrepPart[]; // 備料組成（存成 menu_items.fixed）：單品的全部組成、便當的固定附餐
  weekdays: number[];
  slots: BentoSlot[];
  customFields: BentoCustomField[]; // 配菜下方店家自訂的下拉欄位
}

export interface PrepPart {
  component_id: string | null;
  name: string;
  portions: number;
}

export const EMPTY_BENTO: BentoForm = { itemType: "single", mealPeriods: ["lunch"], mains: [], riceComponentId: "", parts: [], weekdays: [], slots: [], customFields: [] };

/** 份數文字：1 份不顯示，其他「×2」「×0.5」 */
export const portionsText = (n: number) => (n && n !== 1 ? ` ×${n}` : "");

/** 毛利低於這個比例時提示（成本 ÷ 售價 > 60%） */
const LOW_MARGIN = 0.4;

const CATEGORIES = ["青菜類", "肉類配菜", "蛋豆類", "根莖類", "其他"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WD = ["日", "一", "二", "三", "四", "五", "六"];

const PORTION_SKIP_CATEGORIES = ["調味", "包材"];
const UNIT_TEXT: Record<string, string> = { g: "克", ml: "毫升" };

/**
 * 材料總和顯示用的份量文字（§4.2），由配方帶出：例「滷雞腿 1 個」「炒高麗菜 80 克」。
 * 取主要原物料：排除調味料、包材；以個／片計的優先於克（「1 個雞腿」比「10 毫升醬油」更代表這道菜），
 * 同一種單位取用量最多的。跟 functions/src/bento.js 的 portionText 同一套規則，要一起改。
 */
export function portionTextFor(component: Component | undefined, ingredientsById: Record<string, Ingredient>, fallback: string): string {
  const lines = (component?.ingredients ?? []).flatMap((line) => {
    const ing = ingredientsById[line.ingredient_id];
    return ing && !PORTION_SKIP_CATEGORIES.includes(ing.category) ? [{ line, ing }] : [];
  });
  if (lines.length === 0) return fallback;
  const countable = lines.filter(({ ing }) => !UNIT_TEXT[ing.unit]);
  const pool = countable.length > 0 ? countable : lines;
  const { line, ing } = pool.reduce((a, b) => ((b.line.grams || 0) > (a.line.grams || 0) ? b : a));
  return `${fallback} ${Math.round((line.grams || 0) * 10) / 10} ${UNIT_TEXT[ing.unit] ?? ing.unit}`;
}

/** 表單 → 跟 menu_items 同形狀的品項（給份數計算用） */
function formAsItem(value: BentoForm): MenuItem {
  const isBento = value.itemType === "bento";
  return {
    item_type: value.itemType,
    mains: isBento ? value.mains.filter((m) => m.name) : [],
    rice_component_id: isBento ? value.riceComponentId || null : null,
    fixed: value.parts.filter((p) => p.component_id).map((p) => ({ name: p.name, component_id: p.component_id, portions: p.portions > 0 ? p.portions : 1 })),
    slots: isBento ? value.slots.filter((s) => s.default.name) : [],
    component_id: null,
  } as unknown as MenuItem;
}

const SELECT_CLASS = "h-9 rounded-md border border-input bg-background px-2 text-sm min-w-0 flex-1";

/**
 * 組合預覽（待修改.docx 第 4 列）：用下拉選單照著上面填的內容組一份（白飯、主菜、配菜、自訂欄位），
 * 下面用合成格子列出這個組合的全部原物料（現有庫存／需要），以及成本、售價、毛利。只是預覽，不會存。
 */
function BentoPreview({ value, itemName, itemPrice, componentsById, ingredientsById, vendorId, orderCount }: {
  value: BentoForm;
  itemName?: string;
  itemPrice?: number;
  componentsById: Record<string, Component>;
  ingredientsById: Record<string, Ingredient>;
  vendorId: string | undefined;
  orderCount?: { label: string; n: number };
}) {
  const [rice, setRice] = useState<RiceOption>("normal");
  const [mainIdx, setMainIdx] = useState(0);
  const [sides, setSides] = useState<SlotChoice[]>([]);
  const [picks, setPicks] = useState<number[]>([]);
  const [qty, setQty] = useState(1);
  const { stock, counted } = useStockOnHand(vendorId);
  const cfg = DEFAULT_PLATFORM_CONFIG;
  const mains = value.mains.filter((m) => m.name);
  const slots = value.slots.filter((s) => s.default.name);
  const fields = value.customFields.filter((f) => f.label && f.options.some((o) => o.name));
  const isBento = value.itemType === "bento";
  const main = isBento ? mains[Math.min(mainIdx, mains.length - 1)] : undefined;
  const hasRice = isBento && !!value.riceComponentId;
  const parts = value.parts.filter((p) => p.name || p.component_id);

  const chips: string[] = [];
  const unlinked: string[] = [];
  const check = (name: string, id: string | null | undefined) => { if (!id) unlinked.push(name); };
  let price = isBento ? main?.price || 0 : itemPrice || 0;
  if (hasRice) {
    const r = RICE_OPTIONS.find((o) => o.value === rice)!;
    chips.push(tr(`白飯 ${r.label}`, `Rice: ${r.labelEn}`));
    price += rice === "add" ? cfg.riceAddPrice : rice === "less" ? cfg.riceLessPrice : 0;
  }
  if (main) { chips.push(main.name); check(main.name, main.component_id); }
  for (const p of parts) { chips.push(`${p.name}${portionsText(p.portions)}`); check(p.name, p.component_id); }
  const lockSlots: Partial<LockSlot>[] = [];
  if (isBento) slots.forEach((slot, i) => {
    const c = sides[i] ?? "default";
    if (c === "none") {
      price += cfg.slotRemovePrice;
      lockSlots.push({ removed: true });
    } else if (c === "default") {
      chips.push(slot.default.name);
      check(slot.default.name, slot.default.component_id);
      lockSlots.push({ removed: false, wished: null, resolved: null, default_component_id: slot.default.component_id ?? null });
    } else {
      const cand = slot.candidates.filter((x) => x.name)[c as number];
      if (cand) {
        chips.push(`${cand.name}${cand.portion_level < 1 ? tr("（半份）", " (half)") : ""}`);
        check(cand.name, cand.component_id);
        lockSlots.push({ removed: false, wished: cand.name, resolved: cand.name, wished_component_id: cand.component_id ?? null, portion_level: cand.portion_level });
      } else lockSlots.push({ removed: false, default_component_id: slot.default.component_id ?? null });
    }
  });
  if (isBento) fields.forEach((f, i) => {
    const opts = f.options.filter((o) => o.name);
    const o = opts[picks[i] ?? 0] ?? opts[0];
    chips.push(`${f.label}：${o.name}`);
    price += o.price || 0;
  });

  if (chips.length === 0) return null;

  // 一份的半成品份數 → × 份數 → 原物料
  const one = componentPortionsForLock({ rice, slots: lockSlots as LockSlot[], extra_side: null, main_component_id: main?.component_id ?? null }, formAsItem(value), componentsById, cfg);
  const scaled = new Map([...one].map(([id, n]) => [id, n * qty]));
  const needs = rawNeeds(scaled, componentsById, ingredientsById);
  const cost = portionsCost(one, componentsById, ingredientsById);
  const incomplete = [...one.keys()].some((id) => costIssue(id, componentsById, ingredientsById)) || unlinked.length > 0;
  const finalPrice = Math.max(0, price);
  const margin = finalPrice > 0 ? (finalPrice - cost) / finalPrice : 0;

  return (
    <div className="rounded-md border-2 border-dashed border-border bg-white p-2 space-y-2">
      <p className="text-xs font-semibold">{isBento ? tr("組合預覽（用下拉選單試組一份，下面算出全部材料；不會存）", "Preview (try a combination; materials below; not saved)") : tr("組合預覽（這一份要備的料）", "Preview (what goes into one)")}</p>
      {hasRice && (
        <label className="flex items-center gap-2 text-sm">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{tr("白飯", "Rice")}</span>
          <select className={SELECT_CLASS} value={rice} onChange={(e) => setRice(e.target.value as RiceOption)}>
            {RICE_OPTIONS.map((o) => {
              const d = o.value === "add" ? cfg.riceAddPrice : o.value === "less" ? cfg.riceLessPrice : 0;
              return <option key={o.value} value={o.value}>{tr(o.label, o.labelEn)}{d ? `（${priceDeltaText(d)}）` : ""}</option>;
            })}
          </select>
        </label>
      )}
      {isBento && mains.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{tr("主菜", "Main")}</span>
          <select className={SELECT_CLASS} value={Math.min(mainIdx, mains.length - 1)} onChange={(e) => setMainIdx(Number(e.target.value))}>
            {mains.map((m, i) => <option key={i} value={i}>{m.name}（{m.price || 0}）</option>)}
          </select>
        </label>
      )}
      {isBento && slots.map((slot, i) => (
        <label key={i} className="flex items-center gap-2 text-sm">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{tr(`配菜 ${i + 1}`, `Side ${i + 1}`)}</span>
          <select
            className={SELECT_CLASS}
            value={String(sides[i] ?? "default")}
            onChange={(e) => {
              const v = e.target.value;
              setSides(slots.map((_, j) => (j === i ? (v === "default" || v === "none" ? v : Number(v)) : sides[j] ?? "default")));
            }}
          >
            <option value="default">{slot.default.name}{tr("（預設）", " (default)")}</option>
            {slot.candidates.filter((c) => c.name).map((c, ci) => <option key={ci} value={ci}>{c.name}（{portionLabel(c.portion_level)}）</option>)}
            <option value="none">{tr(`不要（${priceDeltaText(cfg.slotRemovePrice)}）`, `None (${priceDeltaText(cfg.slotRemovePrice)})`)}</option>
          </select>
        </label>
      ))}
      {isBento && fields.map((f, i) => (
        <label key={`f${i}`} className="flex items-center gap-2 text-sm">
          <span className="w-20 shrink-0 text-xs text-muted-foreground truncate">{f.label}</span>
          <select className={SELECT_CLASS} value={picks[i] ?? 0} onChange={(e) => setPicks(fields.map((_, j) => (j === i ? Number(e.target.value) : picks[j] ?? 0)))}>
            {f.options.filter((o) => o.name).map((o, oi) => <option key={oi} value={oi}>{o.name}{o.price ? `（${priceDeltaText(o.price)}）` : ""}</option>)}
          </select>
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border text-sm">
        {chips.map((c, i) => (
          <span key={i} className="contents">
            {i > 0 && <span className="text-muted-foreground" aria-hidden="true">+</span>}
            <span className="rounded border border-border bg-orange-50 px-2 py-0.5">{c}</span>
          </span>
        ))}
        <span className="text-muted-foreground" aria-hidden="true">→</span>
        <span className="rounded bg-foreground text-background px-2 py-0.5 font-semibold">{itemName || tr("便當", "Bento")}・NT$ {finalPrice}</span>
      </div>

      {/* 材料總和（合成格子） */}
      <div className="pt-2 border-t border-border space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">{tr("材料總和（生料）", "All ingredients (raw)")}</span>
          <span className="text-muted-foreground">{tr("份數", "Servings")}</span>
          {[1, 10, 50].map((n) => <button key={n} type="button" className={cn("rounded-full border px-2 py-0.5", qty === n ? "bg-foreground text-background border-foreground" : "border-border")} onClick={() => setQty(n)}>{n}</button>)}
          {orderCount && orderCount.n > 0 && (
            <button type="button" className={cn("rounded-full border px-2 py-0.5", qty === orderCount.n ? "bg-foreground text-background border-foreground" : "border-border")} onClick={() => setQty(orderCount.n)}>{orderCount.label} {orderCount.n}</button>
          )}
          <Input className="h-7 w-20 text-xs" type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.round(Number(e.target.value) || 1)))} aria-label={tr("份數", "Servings")} />
        </div>
        <RecipeCraft
          items={craftItems(needs, ingredientsById, stock)}
          target={{ name: itemName || tr("便當", "Bento"), sub: qty > 1 ? tr(`× ${qty} 份`, `× ${qty}`) : `NT$ ${finalPrice}` }}
          haveNote={counted ? tr("上週六盤點＋本週到貨−已用", "last count + deliveries − used") : tr("理論庫存（上週六未盤點）", "theoretical stock (not counted)")}
          compact
        />
        {unlinked.length > 0 && (
          <p className="text-xs text-amber-800 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{tr(`${unlinked.join("、")} 未接配方，不會算進材料、備料和叫貨`, `${unlinked.join(", ")}: no recipe — not counted in prep or purchasing`)}</p>
        )}
        <p className="text-sm flex flex-wrap gap-x-3">
          <span>{tr("一份成本", "Cost/serving")} <b>NT$ {cost.toFixed(1)}</b>{incomplete && <span className="text-amber-700 text-xs">{tr("（不完整）", " (incomplete)")}</span>}</span>
          <span>{tr("售價", "Price")} <b>NT$ {finalPrice}</b></span>
          {finalPrice > 0 && cost > 0 && <span className={margin < LOW_MARGIN ? "text-orange-600 font-semibold" : "text-green-700"}>{tr("毛利", "Margin")} {Math.round(margin * 100)}%{margin < LOW_MARGIN ? tr("（偏低）", " (low)") : ""}</span>}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{tr("價格未含早鳥折扣。", "Before early-bird discount.")}</p>
    </div>
  );
}

/**
 * 品項結構編輯（1002 規格 §3.2、§3.3）：
 * - 品項類型：便當（可自組：白飯＋主菜＋配菜）或單品（直接點選，例如鹹粥、蛋餅）
 * - 供應餐期（早／中／晚，可多選）；取餐時段在店家設定裡依餐期設定
 * - 主菜可列多道、各自定價，便當價格以所選主菜為準；每道菜都要有照片（消費者點圖片選菜）
 * - 每道菜用「菜色欄位」：菜名和配方（半成品）同一格，找不到就直接建，成本算不出來時寫原因、點了去補
 * - 配菜格：預設菜＋最多 3 道候選菜（同類別），候選菜不加價，改以份量平衡成本：
 *   比例 ≥ 0.75 全份、0.5–0.75 半份、低於 0.5 不得列為候選
 * - 自訂欄位：配菜下方再加店家自己的下拉選單（例：湯品、飲料、辣度），選項可加減價，第一個選項是預設
 */
export default function BentoEditor({ value, onChange, components, ingredientsById, vendorId, itemName, itemPrice, orderCount }: {
  itemName?: string;
  itemPrice?: number;
  value: BentoForm;
  onChange: (v: BentoForm) => void;
  components: Component[];
  ingredientsById: Record<string, Ingredient>;
  vendorId: string | undefined;
  /** 預覽份數的快捷鍵，例：明天已訂 42 份 */
  orderCount?: { label: string; n: number };
}) {
  const { toast } = useToast();
  const byId = Object.fromEntries(components.map((c) => [c.id, c]));
  const cost = (id?: string | null) => (id ? componentCost(byId[id], ingredientsById) : 0);
  const setSlot = (i: number, slot: BentoSlot) => onChange({ ...value, slots: value.slots.map((s, j) => (j === i ? slot : s)) });
  const setCustom = (i: number, field: BentoCustomField) => onChange({ ...value, customFields: value.customFields.map((f, j) => (j === i ? field : f)) });
  const setMain = (i: number, main: BentoMain) => onChange({ ...value, mains: value.mains.map((m, j) => (j === i ? main : m)) });
  const isBento = value.itemType === "bento";

  // 疊開的配方／原物料視窗；建好後呼叫 assign 把新半成品接回原本那一格
  const [compDraft, setCompDraft] = useState<{ draft: ComponentDraft; assign?: (id: string, name: string) => void } | null>(null);
  const [ingDraft, setIngDraft] = useState<IngredientDraft | null>(null);
  // 「加一格」：先挑或建一道菜，挑好才真的加進去
  const [adding, setAdding] = useState<DishValue | null>(null);
  const [advanced, setAdvanced] = useState(value.weekdays.length > 0 || value.customFields.length > 0);
  // 候選菜的份量級距、週上限、成立最低量多數店家用預設就好（2026-10-09 簡化）：預設收起，有設過才展開
  const [candidateDetails, setCandidateDetails] = useState(() => value.slots.some((sl) => sl.candidates.some((c) => c.weekly_cap != null || c.min_qty != null || c.portion_level < 1)));

  async function createComponent(name: string, withRecipe: boolean, assign: (id: string, name: string) => void) {
    if (withRecipe) {
      setCompDraft({ draft: { ...EMPTY_COMP, name }, assign });
      return;
    }
    if (!vendorId) return;
    try {
      const id = await saveCatalogDoc(vendorId, "components", { ...EMPTY_COMP, name });
      assign(id, name);
      toast({ title: tr(`已建立「${name}」`, `Created ${name}`), description: tr("配方還沒填，記得到配方原物料補上原物料，備料和叫貨才算得到。", "Add its ingredients later in Recipes so prep and purchasing can count it.") });
    } catch (err) {
      toast({ variant: "destructive", title: tr("建立失敗", "Couldn't create"), description: (err as Error).message });
    }
  }

  /** 成本：算得出來顯示金額；算不出來寫原因，點了直接去補 */
  function fixIssue(issue: CostIssue, name: string, assign: (id: string, name: string) => void) {
    if (issue.kind === "unlinked") void createComponent(name || tr("新半成品", "New component"), true, assign);
    else if (issue.kind === "missing") setCompDraft({ draft: { ...EMPTY_COMP, name }, assign });
    else if (issue.kind === "no_ingredients") setCompDraft({ draft: byId[issue.componentId] });
    else setIngDraft(ingredientsById[issue.ingredientId]);
  }
  const costBadge = (componentId: string | null | undefined, name: string, assign: (id: string, name: string) => void, multiplier = 1) => {
    const issue = costIssue(componentId, byId, ingredientsById);
    if (issue) {
      return (
        <button type="button" className="inline-flex items-center gap-0.5 rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[11px] font-medium shrink-0 hover:bg-amber-200" onClick={() => fixIssue(issue, name, assign)} title={tr("點我補上", "Click to fix")}>
          <AlertTriangle className="w-3 h-3" />{costIssueText(issue)}
        </button>
      );
    }
    return <span className="text-xs text-muted-foreground w-16 shrink-0">{tr("成本", "cost")} {(cost(componentId) * multiplier).toFixed(1)}</span>;
  };

  function recalc() {
    onChange({
      ...value,
      slots: value.slots.map((slot) => ({
        ...slot,
        candidates: slot.candidates.map((c) => {
          const level = portionLevelFor(cost(slot.default.component_id), cost(c.component_id));
          return { ...c, portion_level: level ?? 0.5, disabled: level === null };
        }),
      })),
    });
  }

  const picker = (v: DishValue, set: (v: DishValue) => void, placeholder?: string) => (
    <DishPicker value={v} onChange={set} components={components} placeholder={placeholder} onCreate={(name, withRecipe) => createComponent(name, withRecipe, (id, n) => set({ name: v.name || n, component_id: id }))} />
  );

  // 備料組成：每一樣餐點都能拆成幾個半成品，每份各要幾份；店家每日備料、叫貨都照這裡算
  const setPart = (i: number, part: PrepPart) => onChange({ ...value, parts: value.parts.map((p, j) => (j === i ? part : p)) });
  const partsEditor = (
    <div className="rounded-md border border-border bg-white p-2 space-y-2">
      <p className="text-xs font-semibold">
        {isBento
          ? tr("固定附餐（每份都有、不能換，例：滷蛋；備料會一起算）", "Fixed extras (in every box, e.g. braised egg; counted in prep)")
          : tr("備料組成（這一份由哪些半成品組成、各幾份；備料、叫貨照這裡算）", "Prep breakdown (components in one serving; used for prep & purchasing)")}
      </p>
      {value.parts.map((p, i) => (
        <div key={i} className="flex gap-2 items-start flex-wrap sm:flex-nowrap">
          {picker({ name: p.name, component_id: p.component_id }, (v) => setPart(i, { ...p, ...v }), tr("半成品（打字找）", "Component (type to search)"))}
          <Input className="h-9 w-20" type="number" min={0.5} step={0.5} title={tr("份數（每一份餐點要幾份這個半成品）", "Portions per serving")} value={p.portions} onChange={(e) => setPart(i, { ...p, portions: Number(e.target.value) || 1 })} />
          <span className="text-xs text-muted-foreground shrink-0 self-center">{tr("份", "×")}</span>
          <span className="self-center">{costBadge(p.component_id, p.name, (id, n) => setPart(i, { ...p, component_id: id, name: p.name || n }), p.portions || 1)}</span>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={tr("刪除", "Remove")} onClick={() => onChange({ ...value, parts: value.parts.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
        </div>
      ))}
      <div className="flex items-center gap-3 flex-wrap">
        <Button size="sm" variant="outline" onClick={() => onChange({ ...value, parts: [...value.parts, { component_id: null, name: "", portions: 1 }] })}><Plus /> {tr("半成品", "Component")}</Button>
        {value.parts.length > 0 && <span className="text-xs text-muted-foreground">{tr("成本合計", "Total cost")} NT${value.parts.reduce((s, p) => s + cost(p.component_id) * (p.portions || 1), 0).toFixed(1)}</span>}
      </div>
    </div>
  );

  // 便當格子：點一格＝改那道菜的組成與份量；沒組成的格子點了直接建配方
  const openCell = (name: string, componentId: string | null | undefined, assign: (id: string, name: string) => void) => {
    const comp = componentId ? byId[componentId] : undefined;
    if (comp) setCompDraft({ draft: comp });
    else setCompDraft({ draft: { ...EMPTY_COMP, name }, assign });
  };
  const cells: BentoCell[] = [];
  if (isBento) {
    if (value.riceComponentId) cells.push({ ...dishCell("rice", tr("白飯", "Rice"), value.riceComponentId, byId, ingredientsById, 1, true), onClick: () => openCell(tr("白飯", "Rice"), value.riceComponentId, (id) => onChange({ ...value, riceComponentId: id })) });
    const m = value.mains[0];
    if (m?.name) cells.push({ ...dishCell("main", m.name, m.component_id, byId, ingredientsById), onClick: () => openCell(m.name, m.component_id, (id, n) => setMain(0, { ...m, component_id: id, name: m.name || n })) });
  }
  value.parts.forEach((p, i) => (p.name || p.component_id) && cells.push({ ...dishCell(`part${i}`, p.name, p.component_id, byId, ingredientsById, p.portions || 1), onClick: () => openCell(p.name, p.component_id, (id, n) => setPart(i, { ...p, component_id: id, name: p.name || n })) }));
  if (isBento) value.slots.forEach((sl, i) => sl.default.name && cells.push({ ...dishCell(`slot${i}`, sl.default.name, sl.default.component_id, byId, ingredientsById), onClick: () => openCell(sl.default.name, sl.default.component_id, (id, n) => setSlot(i, { ...sl, default: { ...sl.default, component_id: id, name: sl.default.name || n } })) }));
  const commitAdd = (v: DishValue) => {
    if (!v.component_id) { setAdding(v); return; }
    if (isBento) onChange({ ...value, slots: [...value.slots.filter((sl) => sl.default.name), { category: "青菜類", default: { name: v.name, component_id: v.component_id }, candidates: [] }] });
    else onChange({ ...value, parts: [...value.parts, { component_id: v.component_id, name: v.name, portions: 1 }] });
    setAdding(null);
  };
  const canAdd = !isBento || value.slots.filter((sl) => sl.default.name).length < DEFAULT_PLATFORM_CONFIG.maxSides;
  const bentoGrid = (
    <div className="rounded-md border border-border bg-white p-2 space-y-2">
      <p className="text-xs font-semibold">{tr("便當格子：點格子改配菜和份量，按「加一格」新增配菜", "Bento cells: tap a cell to edit it, Add for a new dish")}</p>
      <BentoBox size="edit" cells={cells} onAdd={canAdd && !adding ? () => setAdding({ name: "", component_id: null }) : undefined} />
      {adding && (
        <div className="flex gap-2 items-start">
          <DishPicker value={adding} onChange={commitAdd} components={components} placeholder={tr("新的一格：打菜名找或建立", "New cell: type a dish")} onCreate={(name, withRecipe) => createComponent(name, withRecipe, (id, n) => commitAdd({ name: adding.name || n, component_id: id }))} />
          <Button variant="ghost" size="sm" onClick={() => setAdding(null)}>{tr("取消", "Cancel")}</Button>
        </div>
      )}
    </div>
  );

  const preview = <BentoPreview value={value} itemName={itemName} itemPrice={itemPrice} componentsById={byId} ingredientsById={ingredientsById} vendorId={vendorId} orderCount={orderCount} />;

  return (
    <div className="border rounded-lg p-3 space-y-3 bg-orange-50/40">
      <div className="flex flex-wrap gap-4 text-sm">
        <fieldset className="flex items-center gap-3">
          <legend className="sr-only">{tr("品項類型", "Item type")}</legend>
          <span className="text-xs font-semibold">{tr("品項類型", "Type")}</span>
          {(["bento", "single"] as const).map((type) => (
            <label key={type} className="flex items-center gap-1">
              <input
                type="radio"
                name="item-type"
                checked={value.itemType === type}
                onChange={() => onChange({
                  ...value,
                  itemType: type,
                  slots: type === "bento" && value.slots.length === 0 ? [{ category: "青菜類", default: { name: "" }, candidates: [] }] : value.slots,
                  mains: type === "bento" && value.mains.length === 0 ? [{ name: "", component_id: null, price: 0 }] : value.mains,
                })}
              />
              {type === "bento" ? tr("便當（可自組）", "Bento (build your own)") : tr("單品（直接點選）", "Single item")}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex items-center gap-3">
          <legend className="sr-only">{tr("供應餐期", "Meal periods")}</legend>
          <span className="text-xs font-semibold">{tr("供應餐期", "Served at")}</span>
          {MEAL_PERIODS.map((p) => (
            <label key={p} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={value.mealPeriods.includes(p)}
                onChange={(e) => onChange({ ...value, mealPeriods: e.target.checked ? MEAL_PERIODS.filter((x) => x === p || value.mealPeriods.includes(x)) : value.mealPeriods.filter((x) => x !== p) })}
              />
              {mealPeriodLabel(p)}
            </label>
          ))}
        </fieldset>
      </div>
      {value.mealPeriods.length === 0 && <p className="text-xs text-red-600">{tr("至少勾一個餐期；取餐時段到「店家設定」依餐期設定。", "Pick at least one meal period.")}</p>}

      {bentoGrid}

      {partsEditor}
      {!isBento ? preview : (
        <>
          <div className="rounded-md border border-border bg-white p-2 space-y-2">
            <p className="text-xs font-semibold">{tr(`主菜（消費者單選，各自定價，便當價以所選主菜為準；平台每份抽成 ${COMMISSION_PCT}%，定價請加上去）`, `Mains (customer picks one; each has its own price — add the ${COMMISSION_PCT}% platform commission when pricing)`)}</p>
            {value.mains.map((m, i) => (
              <div key={i} className="flex gap-2 items-start flex-wrap sm:flex-nowrap">
                <ImageThumbUpload vendorId={vendorId} value={m.image_url} onChange={(url) => setMain(i, { ...m, image_url: url || null })} label={tr("主菜照片", "Main photo")} />
                {picker({ name: m.name, component_id: m.component_id ?? null }, (v) => setMain(i, { ...m, ...v }), tr("主菜名（打字找配方）", "Main (type to find recipe)"))}
                <Input className="h-9 w-20" type="number" min={1} placeholder={tr("價格", "Price")} value={m.price || ""} onChange={(e) => setMain(i, { ...m, price: Number(e.target.value) })} />
                <span className="self-center">{costBadge(m.component_id, m.name, (id, n) => setMain(i, { ...m, component_id: id, name: m.name || n }))}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={tr("刪除", "Remove")} disabled={value.mains.length <= 1} onClick={() => onChange({ ...value, mains: value.mains.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => onChange({ ...value, mains: [...value.mains, { name: "", component_id: null, price: 0 }] })}><Plus /> {tr("主菜", "Main")}</Button>
          </div>

          <div>
            <Label className="text-xs">{tr("白飯半成品（半碗 −5／一碗／一碗半 +10 作用在這裡）", "Rice component (half −5 / one / 1.5 +10)")}</Label>
            <div className="flex gap-2 items-center">
              <select className={SELECT_CLASS} value={value.riceComponentId} onChange={(e) => onChange({ ...value, riceComponentId: e.target.value })}>
                <option value="">{tr("沒有白飯（不能選飯量）", "No rice")}</option>
                {components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {value.riceComponentId && costBadge(value.riceComponentId, tr("白飯", "Rice"), (id) => onChange({ ...value, riceComponentId: id }))}
            </div>
          </div>

          {value.slots.map((slot, i) => (
            <div key={i} className="rounded-md border border-border bg-white p-2 space-y-2">
              <div className="flex gap-2 items-center">
                <span className="text-xs font-semibold shrink-0">{tr(`配菜 ${i + 1}`, `Side ${i + 1}`)}</span>
                <select className="h-9 rounded-md border border-input px-2 text-sm" value={slot.category} onChange={(e) => setSlot(i, { ...slot, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" aria-label={tr("刪除配菜", "Remove side")} onClick={() => onChange({ ...value, slots: value.slots.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
              <div className="flex gap-2 items-start">
                <ImageThumbUpload vendorId={vendorId} value={slot.default.image_url} onChange={(url) => setSlot(i, { ...slot, default: { ...slot.default, image_url: url || null } })} label={tr("預設菜照片", "Default photo")} />
                {picker({ name: slot.default.name, component_id: slot.default.component_id ?? null }, (v) => setSlot(i, { ...slot, default: { ...slot.default, ...v } }), tr("預設菜（打字找配方）", "Default dish"))}
                <span className="self-center">{costBadge(slot.default.component_id, slot.default.name, (id, n) => setSlot(i, { ...slot, default: { ...slot.default, component_id: id, name: slot.default.name || n } }))}</span>
              </div>
              {slot.candidates.map((c, ci) => {
                const setCand = (patch: Partial<typeof c>) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, ...patch } : x)) });
                return (
                  <div key={ci} className="flex gap-2 items-start pl-3 flex-wrap">
                    <ImageThumbUpload vendorId={vendorId} value={c.image_url} onChange={(url) => setCand({ image_url: url || null })} label={tr("候選菜照片", "Candidate photo")} />
                    {picker({ name: c.name, component_id: c.component_id ?? null }, (v) => setCand(v), tr("候選菜（打字找配方）", "Candidate"))}
                    {candidateDetails && (
                      <>
                        <select
                          className="h-9 rounded-md border border-input px-1 text-xs"
                          value={c.portion_level < 1 ? 0.5 : 1}
                          title={tr("份量級距（系統依成本計算，可微調）", "Portion level")}
                          aria-label={tr("份量級距", "Portion level")}
                          onChange={(e) => setCand({ portion_level: Number(e.target.value) })}
                        >
                          {[1, 0.5].map((l) => <option key={l} value={l}>{portionLabel(l)}</option>)}
                        </select>
                        <Input className="h-9 w-16" type="number" placeholder={tr("週上限", "Cap")} title={tr("本週供應上限（依週進料庫存）", "Weekly cap")} aria-label={tr("週上限", "Weekly cap")} value={c.weekly_cap ?? ""} onChange={(e) => setCand({ weekly_cap: e.target.value ? Number(e.target.value) : null })} />
                        <Input className="h-9 w-16" type="number" placeholder={tr("最低", "Min")} title={tr(`成立最低量（空白＝店家設定，預設 ${DEFAULT_PLATFORM_CONFIG.candidateMinQty}）`, "Minimum to happen")} aria-label={tr("成立最低量", "Minimum quantity")} value={c.min_qty ?? ""} onChange={(e) => setCand({ min_qty: e.target.value ? Number(e.target.value) : null })} />
                      </>
                    )}
                    <span className="self-center">{costBadge(c.component_id, c.name, (id, n) => setCand({ component_id: id, name: c.name || n }))}</span>
                    {c.disabled && <span className="text-xs text-red-600 shrink-0 self-center">{tr("成本過高，不得列為候選", "too costly")}</span>}
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={tr("刪除候選菜", "Remove candidate")} onClick={() => setSlot(i, { ...slot, candidates: slot.candidates.filter((_, k) => k !== ci) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                );
              })}
              {slot.candidates.length < DEFAULT_PLATFORM_CONFIG.maxCandidatesPerSlot && (
                <Button size="sm" variant="outline" className="ml-3" onClick={() => setSlot(i, { ...slot, candidates: [...slot.candidates, { name: "", component_id: null, portion_level: 1, weekly_cap: null, min_qty: null }] })}>
                  <Plus /> {tr("候選菜（同類別，最多 3 道）", "Candidate (same category, max 3)")}
                </Button>
              )}
            </div>
          ))}
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" disabled={value.slots.length >= DEFAULT_PLATFORM_CONFIG.maxSides} onClick={() => onChange({ ...value, slots: [...value.slots, { category: "青菜類", default: { name: "" }, candidates: [] }] })}><Plus /> {tr("配菜", "Side")}</Button>
            <Button size="sm" variant="outline" onClick={recalc}><Calculator /> {tr("依成本計算份量級距", "Calculate portion levels")}</Button>
            {value.slots.some((sl) => sl.candidates.length > 0) && (
              <Button size="sm" variant="ghost" onClick={() => setCandidateDetails((v) => !v)} aria-expanded={candidateDetails}>
                {candidateDetails ? tr("收起候選菜細項", "Hide candidate details") : tr("候選菜細項（份量、週上限、最低量）", "Candidate details (portion, cap, minimum)")}
              </Button>
            )}
          </div>
          {preview}
        </>
      )}

      <div className="rounded-md border border-border bg-white">
        <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
          {isBento ? tr("進階（週菜單輪替、自訂欄位）", "Advanced (weekly rotation, custom fields)") : tr("進階（週菜單輪替）", "Advanced (weekly rotation)")}
          <span className="text-muted-foreground">{advanced ? "−" : "+"}</span>
        </button>
        {advanced && (
          <div className="space-y-3 px-3 pb-3">
            <div>
              <Label className="text-xs">{tr("週菜單輪替：只在這幾天供應（都不勾＝每天）", "Weekly rotation: served only on (none = every day)")}</Label>
              <div className="flex gap-2 text-sm flex-wrap">
                {WEEKDAYS.map((d) => (
                  <label key={d} className="flex items-center gap-1">
                    <input type="checkbox" checked={value.weekdays.includes(d)} onChange={(e) => onChange({ ...value, weekdays: e.target.checked ? [...value.weekdays, d].sort() : value.weekdays.filter((x) => x !== d) })} />
                    {tr(`週${WD[d]}`, ["", "Mon", "Tue", "Wed", "Thu", "Fri"][d])}
                  </label>
                ))}
              </div>
            </div>
            {isBento && (
              <>
              {value.customFields.map((field, i) => (
                <div key={i} className="rounded-md border border-border bg-white p-2 space-y-2">
                  <div className="flex gap-2 items-center">
                    <span className="text-xs font-semibold shrink-0">{tr("自訂欄位", "Custom field")}</span>
                    <Input className="h-9 w-40" placeholder={tr("欄位名稱（例：湯品）", "Name (e.g. Soup)")} value={field.label} onChange={(e) => setCustom(i, { ...field, label: e.target.value })} />
                    <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" aria-label={tr("刪除欄位", "Remove field")} onClick={() => onChange({ ...value, customFields: value.customFields.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                  {field.options.map((opt, oi) => (
                    <div key={oi} className="flex gap-2 items-center pl-3">
                      <Input className="h-9 w-40" placeholder={oi === 0 ? tr("選項（第一個是預設）", "Option (first = default)") : tr("選項", "Option")} value={opt.name} onChange={(e) => setCustom(i, { ...field, options: field.options.map((o, k) => (k === oi ? { ...o, name: e.target.value } : o)) })} />
                      <Input className="h-9 w-24" type="number" step={1} placeholder={tr("加減價", "± price")} title={tr("加減價（0＝不加價，可填負數）", "Price change (0 = free, negative allowed)")} value={opt.price || ""} onChange={(e) => setCustom(i, { ...field, options: field.options.map((o, k) => (k === oi ? { ...o, price: Math.round(Number(e.target.value) || 0) } : o)) })} />
                      {oi === 0 && <span className="text-xs text-muted-foreground shrink-0">{tr("預設", "default")}</span>}
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={tr("刪除選項", "Remove option")} disabled={field.options.length <= 1} onClick={() => setCustom(i, { ...field, options: field.options.filter((_, k) => k !== oi) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="ml-3" onClick={() => setCustom(i, { ...field, options: [...field.options, { name: "", price: 0 }] })}><Plus /> {tr("選項", "Option")}</Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => onChange({ ...value, customFields: [...value.customFields, { label: "", options: [{ name: "", price: 0 }, { name: "", price: 0 }] }] })}>
                <Plus /> {tr("自訂欄位（例：湯品、飲料、辣度）", "Custom field (e.g. soup, drink, spice)")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {tr(`標準配菜數＝上面的配菜數（建議 3 道）；消費者最多選 ${DEFAULT_PLATFORM_CONFIG.maxSides} 道，第四道可選「備案」（不加價，許願沒成立時遞補）或「加菜」+${DEFAULT_PLATFORM_CONFIG.addonSidePrice}。份量比例＝預設菜單份成本 ÷ 候選菜單份成本；截單後份量鎖定。`,
                  `Standard sides = the sides above (3 recommended). Customers can pick up to ${DEFAULT_PLATFORM_CONFIG.maxSides}; the 4th is a free backup or a +${DEFAULT_PLATFORM_CONFIG.addonSidePrice} add-on.`)}
              </p>
              </>
            )}
          </div>
        )}
      </div>

      <ComponentDialog vendorId={vendorId} value={compDraft?.draft ?? null} onClose={() => setCompDraft(null)} onSaved={(id, name) => compDraft?.assign?.(id, name)} />
      <IngredientDialog vendorId={vendorId} value={ingDraft} onClose={() => setIngDraft(null)} />
    </div>
  );
}

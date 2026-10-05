import { Plus, Trash2, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageThumbUpload } from "@/components/ImageUploadField";
import { componentCost, portionLabel, portionLevelFor } from "@/lib/bento";
import { DEFAULT_PLATFORM_CONFIG } from "@/lib/platformConfig";
import { MEAL_PERIODS, mealPeriodLabel } from "@/lib/pickupSlots";
import { tr } from "@/lib/i18n";
import type { BentoCustomField, BentoMain, BentoSlot, Component, Ingredient, MealPeriod } from "@/types";

export interface BentoForm {
  itemType: "bento" | "single";
  mealPeriods: MealPeriod[];
  mains: BentoMain[];
  riceComponentId: string;
  componentId: string; // 單品對應的半成品
  weekdays: number[];
  slots: BentoSlot[];
  customFields: BentoCustomField[]; // 配菜下方店家自訂的下拉欄位
}

export const EMPTY_BENTO: BentoForm = { itemType: "single", mealPeriods: ["lunch"], mains: [], riceComponentId: "", componentId: "", weekdays: [], slots: [], customFields: [] };

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

/**
 * 品項結構編輯（1002 規格 §3.2、§3.3）：
 * - 品項類型：便當（可自組：白飯＋主菜＋配菜）或單品（直接點選，例如鹹粥、蛋餅）
 * - 供應餐期（早／中／晚，可多選）；取餐時段在店家設定裡依餐期設定
 * - 主菜可列多道、各自定價，便當價格以所選主菜為準；每道菜都要有照片（消費者點圖片選菜）
 * - 配菜格：預設菜＋最多 3 道候選菜（同類別），候選菜不加價，改以份量平衡成本：
 *   比例 ≥ 0.75 全份、0.5–0.75 半份、低於 0.5 不得列為候選
 * - 自訂欄位：配菜下方再加店家自己的下拉選單（例：湯品、飲料、辣度），選項可加減價，第一個選項是預設
 */
export default function BentoEditor({ value, onChange, components, ingredientsById, vendorId }: {
  value: BentoForm;
  onChange: (v: BentoForm) => void;
  components: Component[];
  ingredientsById: Record<string, Ingredient>;
  vendorId: string | undefined;
}) {
  const byId = Object.fromEntries(components.map((c) => [c.id, c]));
  const cost = (id?: string | null) => (id ? componentCost(byId[id], ingredientsById) : 0);
  const setSlot = (i: number, slot: BentoSlot) => onChange({ ...value, slots: value.slots.map((s, j) => (j === i ? slot : s)) });
  const setCustom = (i: number, field: BentoCustomField) => onChange({ ...value, customFields: value.customFields.map((f, j) => (j === i ? field : f)) });
  const setMain = (i: number, main: BentoMain) => onChange({ ...value, mains: value.mains.map((m, j) => (j === i ? main : m)) });
  const isBento = value.itemType === "bento";

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

  const compSelect = (id: string | null | undefined, set: (id: string, name?: string) => void, placeholder = "—") => (
    <select className="h-9 rounded-md border border-input bg-background px-2 text-sm min-w-0 flex-1" value={id ?? ""} onChange={(e) => set(e.target.value, byId[e.target.value]?.name)}>
      <option value="">{placeholder}</option>
      {components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );

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

      <div>
        <Label className="text-xs">{tr("週菜單輪替：只在這幾天供應（都不勾＝每天）", "Weekly rotation: served only on (none = every day)")}</Label>
        <div className="flex gap-2 text-sm">
          {WEEKDAYS.map((d) => (
            <label key={d} className="flex items-center gap-1">
              <input type="checkbox" checked={value.weekdays.includes(d)} onChange={(e) => onChange({ ...value, weekdays: e.target.checked ? [...value.weekdays, d].sort() : value.weekdays.filter((x) => x !== d) })} />
              {tr(`週${WD[d]}`, ["", "Mon", "Tue", "Wed", "Thu", "Fri"][d])}
            </label>
          ))}
        </div>
      </div>

      {!isBento ? (
        <div className="flex items-center gap-2">
          <Label className="shrink-0 text-xs">{tr("對應半成品（備料用）", "Prep component")}</Label>
          {compSelect(value.componentId, (id) => onChange({ ...value, componentId: id }))}
        </div>
      ) : (
        <>
          <div className="rounded-md border border-border bg-white p-2 space-y-2">
            <p className="text-xs font-semibold">{tr("主菜（消費者單選，各自定價，便當價以所選主菜為準）", "Mains (customer picks one; each has its own price)")}</p>
            {value.mains.map((m, i) => (
              <div key={i} className="flex gap-2 items-center">
                <ImageThumbUpload vendorId={vendorId} value={m.image_url} onChange={(url) => setMain(i, { ...m, image_url: url || null })} label={tr("主菜照片", "Main photo")} />
                <Input className="h-9 w-28" placeholder={tr("主菜名", "Main")} value={m.name} onChange={(e) => setMain(i, { ...m, name: e.target.value })} />
                {compSelect(m.component_id, (id, name) => setMain(i, { ...m, component_id: id || null, name: m.name || name || "" }))}
                <Input className="h-9 w-20" type="number" min={1} placeholder={tr("價格", "Price")} value={m.price || ""} onChange={(e) => setMain(i, { ...m, price: Number(e.target.value) })} />
                <span className="text-xs text-muted-foreground w-14 shrink-0">{tr("成本", "cost")} {cost(m.component_id).toFixed(1)}</span>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={value.mains.length <= 1} onClick={() => onChange({ ...value, mains: value.mains.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => onChange({ ...value, mains: [...value.mains, { name: "", component_id: null, price: 0 }] })}><Plus /> {tr("主菜", "Main")}</Button>
          </div>

          <div><Label className="text-xs">{tr("白飯半成品（半碗 −5／一碗／一碗半 +10 作用在這裡）", "Rice component (half −5 / one / 1.5 +10)")}</Label>{compSelect(value.riceComponentId, (id) => onChange({ ...value, riceComponentId: id }), tr("沒有白飯（不能選飯量）", "No rice"))}</div>

          {value.slots.map((slot, i) => (
            <div key={i} className="rounded-md border border-border bg-white p-2 space-y-2">
              <div className="flex gap-2 items-center">
                <span className="text-xs font-semibold shrink-0">{tr(`配菜 ${i + 1}`, `Side ${i + 1}`)}</span>
                <select className="h-9 rounded-md border border-input px-2 text-sm" value={slot.category} onChange={(e) => setSlot(i, { ...slot, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={() => onChange({ ...value, slots: value.slots.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
              <div className="flex gap-2 items-center">
                <ImageThumbUpload vendorId={vendorId} value={slot.default.image_url} onChange={(url) => setSlot(i, { ...slot, default: { ...slot.default, image_url: url || null } })} label={tr("預設菜照片", "Default photo")} />
                <Input className="h-9 w-28" placeholder={tr("預設菜", "Default")} value={slot.default.name} onChange={(e) => setSlot(i, { ...slot, default: { ...slot.default, name: e.target.value } })} />
                {compSelect(slot.default.component_id, (id, name) => setSlot(i, { ...slot, default: { ...slot.default, name: slot.default.name || name || "", component_id: id || null } }))}
                <span className="text-xs self-center text-muted-foreground w-14">NT${cost(slot.default.component_id).toFixed(1)}</span>
              </div>
              {slot.candidates.map((c, ci) => (
                <div key={ci} className="flex gap-2 items-center pl-3 flex-wrap">
                  <ImageThumbUpload vendorId={vendorId} value={c.image_url} onChange={(url) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, image_url: url || null } : x)) })} label={tr("候選菜照片", "Candidate photo")} />
                  <Input className="h-9 w-24" placeholder={tr("候選菜", "Candidate")} value={c.name} onChange={(e) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, name: e.target.value } : x)) })} />
                  {compSelect(c.component_id, (id, name) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, component_id: id || null, name: x.name || name || "" } : x)) }))}
                  <select
                    className="h-9 rounded-md border border-input px-1 text-xs"
                    value={c.portion_level < 1 ? 0.5 : 1}
                    title={tr("份量級距（系統依成本計算，可微調）", "Portion level")}
                    onChange={(e) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, portion_level: Number(e.target.value) } : x)) })}
                  >
                    {[1, 0.5].map((l) => <option key={l} value={l}>{portionLabel(l)}</option>)}
                  </select>
                  <Input className="h-9 w-16" type="number" placeholder={tr("週上限", "Cap")} title={tr("本週供應上限（依週進料庫存）", "Weekly cap")} value={c.weekly_cap ?? ""} onChange={(e) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, weekly_cap: e.target.value ? Number(e.target.value) : null } : x)) })} />
                  <Input className="h-9 w-16" type="number" placeholder={tr("最低", "Min")} title={tr(`成立最低量（空白＝店家設定，預設 ${DEFAULT_PLATFORM_CONFIG.candidateMinQty}）`, "Minimum to happen")} value={c.min_qty ?? ""} onChange={(e) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, min_qty: e.target.value ? Number(e.target.value) : null } : x)) })} />
                  {c.disabled && <span className="text-xs text-red-600 shrink-0">{tr("成本過高，不得列為候選", "too costly")}</span>}
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => setSlot(i, { ...slot, candidates: slot.candidates.filter((_, k) => k !== ci) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              ))}
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
          </div>
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
  );
}

import { Plus, Trash2, Calculator } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { componentCost, portionLabel, portionLevelFor } from "@/lib/bento";
import { DEFAULT_PLATFORM_CONFIG } from "@/lib/platformConfig";
import { tr } from "@/lib/i18n";
import type { BentoSlot, Component, Ingredient } from "@/types";

export interface BentoForm {
  bento: boolean;
  mainName: string;
  mainComponentId: string;
  riceComponentId: string;
  componentId: string; // 單品對應的半成品
  weekdays: number[];
  slots: BentoSlot[];
}

export const EMPTY_BENTO: BentoForm = { bento: false, mainName: "", mainComponentId: "", riceComponentId: "", componentId: "", weekdays: [], slots: [] };

const CATEGORIES = ["青菜類", "肉類配菜", "蛋豆類", "根莖類", "其他"];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WD = ["日", "一", "二", "三", "四", "五", "六"];

/**
 * 便當結構編輯（規格 §3.2、§3.3）：主菜固定一道；每個配菜格有類別、預設菜與最多 3 道候選菜
 * （只能同類別）；候選菜不加價，改以份量平衡成本——比例 ≥1 全份、0.75–1 為 3/4、0.5–0.75 半份、
 * 低於 0.5 不得列為候選。系統依配方成本計算，店家可微調。
 */
export default function BentoEditor({ value, onChange, components, ingredientsById }: {
  value: BentoForm;
  onChange: (v: BentoForm) => void;
  components: Component[];
  ingredientsById: Record<string, Ingredient>;
}) {
  const byId = Object.fromEntries(components.map((c) => [c.id, c]));
  const cost = (id?: string | null) => (id ? componentCost(byId[id], ingredientsById) : 0);
  const setSlot = (i: number, slot: BentoSlot) => onChange({ ...value, slots: value.slots.map((s, j) => (j === i ? slot : s)) });

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
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={value.bento} onChange={(e) => onChange({ ...value, bento: e.target.checked, slots: e.target.checked && value.slots.length === 0 ? [{ category: "青菜類", default: { name: "" }, candidates: [] }] : value.slots })} />
        {tr("這是便當（主菜＋配菜格，可加減飯菜、許願）", "This is a bento (main + side slots, rice options, wishes)")}
      </label>

      {!value.bento ? (
        <div className="flex items-center gap-2">
          <Label className="shrink-0 text-xs">{tr("對應半成品（備料用）", "Prep component")}</Label>
          {compSelect(value.componentId, (id) => onChange({ ...value, componentId: id }))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div><Label className="text-xs">{tr("主菜名稱（固定、不可減）", "Main dish (fixed)")}</Label><Input className="h-9" value={value.mainName} onChange={(e) => onChange({ ...value, mainName: e.target.value })} /></div>
            <div><Label className="text-xs">{tr("主菜半成品", "Main component")}</Label>{compSelect(value.mainComponentId, (id, name) => onChange({ ...value, mainComponentId: id, mainName: value.mainName || name || "" }))}</div>
            <div className="col-span-2"><Label className="text-xs">{tr("主食半成品（加飯＋10／減飯−5 作用在這裡）", "Staple component (extra/less rice)")}</Label>{compSelect(value.riceComponentId, (id) => onChange({ ...value, riceComponentId: id }), tr("沒有主食（不能加減飯）", "No staple"))}</div>
          </div>

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

          {value.slots.map((slot, i) => (
            <div key={i} className="rounded-md border border-border bg-white p-2 space-y-2">
              <div className="flex gap-2 items-center">
                <span className="text-xs font-semibold shrink-0">{tr(`配菜格 ${i + 1}`, `Slot ${i + 1}`)}</span>
                <select className="h-9 rounded-md border border-input px-2 text-sm" value={slot.category} onChange={(e) => setSlot(i, { ...slot, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <Button variant="ghost" size="icon" className="ml-auto h-8 w-8" onClick={() => onChange({ ...value, slots: value.slots.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
              <div className="flex gap-2">
                <Input className="h-9 w-32" placeholder={tr("預設菜", "Default")} value={slot.default.name} onChange={(e) => setSlot(i, { ...slot, default: { ...slot.default, name: e.target.value } })} />
                {compSelect(slot.default.component_id, (id, name) => setSlot(i, { ...slot, default: { name: slot.default.name || name || "", component_id: id || null } }))}
                <span className="text-xs self-center text-muted-foreground w-14">NT${cost(slot.default.component_id).toFixed(1)}</span>
              </div>
              {slot.candidates.map((c, ci) => (
                <div key={ci} className="flex gap-2 items-center pl-3">
                  <Input className="h-9 w-28" placeholder={tr("候選菜", "Candidate")} value={c.name} onChange={(e) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, name: e.target.value } : x)) })} />
                  {compSelect(c.component_id, (id, name) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, component_id: id || null, name: x.name || name || "" } : x)) }))}
                  <select
                    className="h-9 rounded-md border border-input px-1 text-xs"
                    value={c.portion_level}
                    title={tr("份量級距（系統依成本計算，可微調）", "Portion level")}
                    onChange={(e) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, portion_level: Number(e.target.value) } : x)) })}
                  >
                    {[1, 0.75, 0.5].map((l) => <option key={l} value={l}>{portionLabel(l)}</option>)}
                  </select>
                  <Input className="h-9 w-16" type="number" placeholder={tr("週上限", "Cap")} title={tr("本週供應上限（依週進料庫存）", "Weekly cap")} value={c.weekly_cap ?? ""} onChange={(e) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, weekly_cap: e.target.value ? Number(e.target.value) : null } : x)) })} />
                  <Input className="h-9 w-16" type="number" placeholder={tr("最低", "Min")} title={tr(`成立最低量（空白＝店家設定，預設 ${DEFAULT_PLATFORM_CONFIG.candidateMinQty}）`, "Minimum to happen")} value={c.min_qty ?? ""} onChange={(e) => setSlot(i, { ...slot, candidates: slot.candidates.map((x, k) => (k === ci ? { ...x, min_qty: e.target.value ? Number(e.target.value) : null } : x)) })} />
                  {c.disabled && <span className="text-xs text-red-600 shrink-0">{tr("成本過高", "too costly")}</span>}
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
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => onChange({ ...value, slots: [...value.slots, { category: "青菜類", default: { name: "" }, candidates: [] }] })}><Plus /> {tr("配菜格", "Slot")}</Button>
            <Button size="sm" variant="outline" onClick={recalc}><Calculator /> {tr("依成本計算份量級距", "Calculate portion levels")}</Button>
          </div>
          <p className="text-xs text-muted-foreground">{tr("份量比例＝預設菜單份成本 ÷ 候選菜單份成本；截單後份量鎖定。", "Portion ratio = default cost ÷ candidate cost; locked at cutoff.")}</p>
        </>
      )}
    </div>
  );
}

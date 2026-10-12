import { useMemo, useState } from "react";
import { selectClass } from "@/lib/fieldStyles";
import { addDoc, collection, doc, setDoc } from "firebase/firestore";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { useVendorMenu } from "@/hooks/useVendorMenu";
import { componentPortionsForLock, portionsCost } from "@/lib/prep";
import { queryClient } from "@/lib/queryClient";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { componentCost, rawAmount } from "@/lib/bento";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Component, Ingredient } from "@/types";

// Edit dialogs for semi-finished items and ingredients: used on the recipe page and also stacked from the menu editor (create a missing semi-finished item, fill a missing unit price),
// return the new document id on save; the underlying dialog's contents are unaffected.

export const EMPTY_ING: Omit<Ingredient, "id"> = {
  name: "", category: "其他", unit: "g",
  // The purchase unit name is free text entered by the vendor; its default follows the UI language (getter: picks the language each time {...EMPTY_ING} is spread)
  get purchase_unit_label() { return tr("公斤", "kg"); },
  purchase_unit_size: 1000,
  yield_rate: 1, loss_rate: 0, shelf_days: 7, frequency: "weekly", supplier_id: null, unit_price: 0,
};
export const EMPTY_COMP: Omit<Component, "id"> = {
  name: "", portion_grams: 100, ingredients: [], prep_minutes: 20, equipment: "炒鍋", batch_capacity: 20, advance_hours: 0, method: "炒", flavors: [],
};
export const ING_CATEGORIES = ["雞", "豬", "牛", "海鮮", "素", "蛋", "豆", "葉菜", "根莖", "瓜類", "米", "麵", "調味", "乾貨", "包材", "其他"];
const EQUIPMENT = ["炒鍋", "電鍋", "炸鍋", "烤箱", "滷鍋", "蒸籠", "湯鍋", "工作台"];
const METHODS = ["炸", "滷", "烤", "炒", "蒸", "煮", "涼拌"];
const FLAVORS = ["辣", "清淡", "甜"];
// 1002 spec §5: purchasing is only weekly stock-up or daily prep; long-life items (monthly) such as rice, oil, seasonings, dry goods and packaging fold into weekly and are ordered only below safety stock
export const FREQ_LABEL: Record<string, { zh: string; en: string }> = {
  monthly: { zh: "久放品項（低於安全庫存才叫）", en: "Long-life (reorder below safety stock)" },
  weekly: { zh: "每週進料", en: "Weekly delivery" },
  daily: { zh: "每日補貨", en: "Daily restock" },
};
export const freqLabel = (k: string) => (FREQ_LABEL[k] ? tr(FREQ_LABEL[k].zh, FREQ_LABEL[k].en) : k);

// The category, equipment, method and flavor values above are stored in Chinese (compared elsewhere); only the display switches to English
const EN_LABEL: Record<string, string> = {
  雞: "Chicken", 豬: "Pork", 牛: "Beef", 海鮮: "Seafood", 素: "Vegetarian", 蛋: "Egg", 豆: "Beans & tofu", 葉菜: "Leafy greens",
  根莖: "Root vegetables", 瓜類: "Gourds", 米: "Rice", 麵: "Noodles", 調味: "Seasoning", 乾貨: "Dry goods", 包材: "Packaging", 其他: "Other",
  炒鍋: "Wok", 電鍋: "Rice cooker", 炸鍋: "Fryer", 烤箱: "Oven", 滷鍋: "Braising pot", 蒸籠: "Steamer", 湯鍋: "Stock pot", 工作台: "Prep table",
  炸: "Fried", 滷: "Braised", 烤: "Roasted", 炒: "Stir-fried", 蒸: "Steamed", 煮: "Boiled", 涼拌: "Cold-tossed",
  辣: "Spicy", 清淡: "Mild", 甜: "Sweet",
};
/** Display text for category / equipment / method / flavor; unknown values are shown as is */
export const catalogLabel = (v: string) => tr(v, EN_LABEL[v] ?? v);
// Units of measure are vendor-defined (§3.2); these are only suggestions
const UNIT_SUGGESTIONS = ["克", "片", "顆", "塊", "毫升", "支", "張", "g", "ml", "個"];
const NEW_ING = "__new__";

export type ComponentDraft = Omit<Component, "id"> & { id?: string };
export type IngredientDraft = Omit<Ingredient, "id"> & { id?: string };

/** Save a semi-finished item / ingredient / supplier; returns the document id */
/**
 * After an ingredient's unit price changes, ask the backend to recompute the portion tiers of candidate dishes for dates not yet past cut-off (functions/src/disaster.js recalcPortionLevels).
 * A failure doesn't undo the saved price; the portion tiers just stay as they were until the next price change or a platform dish-price event recomputes them.
 */
export async function recalcPortionLevelsAfterPrice(vendorId: string): Promise<number | null> {
  try {
    const res = await httpsCallable<{ vendor_id: string }, { changed: number }>(functions, "recalcPortionLevels")({ vendor_id: vendorId });
    return res.data?.changed ?? 0;
  } catch {
    return null;
  }
}

export async function saveCatalogDoc(vendorId: string, kind: "ingredients" | "components" | "suppliers", data: Record<string, unknown> & { id?: string }): Promise<string> {
  const { id, ...rest } = data;
  let docId = id;
  if (docId) await setDoc(doc(db, "vendors", vendorId, kind, docId), rest);
  else docId = (await addDoc(collection(db, "vendors", vendorId, kind), rest)).id;
  await queryClient.invalidateQueries({ queryKey: ["vendorCatalog", vendorId] });
  queryClient.invalidateQueries({ queryKey: ["vendorMenu", vendorId] });
  return docId;
}

const SELECT = selectClass("md", "w-full");

/**
 * Price-increase impact (3.3(c)): when a unit price changes, list the items that use this ingredient and the before/after cost and margin of their default combination (one rice, first main, default sides).
 */
function PriceImpact({ vendorId, draft }: { vendorId: string | undefined; draft: IngredientDraft }) {
  const { data: catalog } = useVendorCatalog(vendorId);
  const { data: items = [] } = useVendorMenu(vendorId);
  const rows = useMemo(() => {
    if (!catalog || !draft.id) return [];
    const before = catalog.ingredientsById;
    const after = { ...before, [draft.id]: { ...before[draft.id], ...draft, id: draft.id } };
    const uses = new Set(catalog.components.filter((c) => c.ingredients.some((l) => l.ingredient_id === draft.id)).map((c) => c.id));
    return items.flatMap((item) => {
      const portions = componentPortionsForLock({ rice: "normal", slots: [], extra_side: null }, item, catalog.componentsById);
      if (![...portions.keys()].some((id) => uses.has(id))) return [];
      const price = item.mains?.[0]?.price || item.price || 0;
      const c0 = portionsCost(portions, catalog.componentsById, before);
      const c1 = portionsCost(portions, catalog.componentsById, after);
      return [{ id: item.id, name: item.name, price, c0, c1 }];
    });
  }, [catalog, items, draft]);
  const original = draft.id ? catalog?.ingredientsById[draft.id] : undefined;
  if (!original || original.unit_price === draft.unit_price || rows.length === 0) return null;
  const margin = (price: number, cost: number) => (price > 0 ? `${Math.round(((price - cost) / price) * 100)}%` : "—");
  return (
    <div className="col-span-2 rounded-md border border-warning/50 bg-warning-soft p-2 text-xs space-y-1">
      <p className="font-semibold">{tr(`單價 ${original.unit_price} → ${draft.unit_price}，影響 ${rows.length} 道菜（預設組合）：`, `Price ${original.unit_price} → ${draft.unit_price} affects ${rows.length} item(s):`)}</p>
      {rows.map((r) => (
        <p key={r.id} className="flex flex-wrap gap-x-2">
          <span className="font-medium">{r.name}</span>
          <span>{tr("成本", "cost")} {r.c0.toFixed(1)} → <b>{r.c1.toFixed(1)}</b></span>
          <span className={r.price > 0 && (r.price - r.c1) / r.price < 0.4 ? "text-accent-foreground font-semibold" : ""}>{tr("毛利", "margin")} {margin(r.price, r.c0)} → {margin(r.price, r.c1)}</span>
        </p>
      ))}
      <p className="text-muted-foreground">{tr("存檔後，未截單日期的候選菜份量級距會自動重算。", "After saving, portion levels for open dates are recalculated.")}</p>
    </div>
  );
}

export function IngredientDialog({ vendorId, value, onClose, onSaved }: {
  vendorId: string | undefined;
  value: IngredientDraft | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { toast } = useToast();
  const { data: catalog } = useVendorCatalog(vendorId);
  const [ing, setIng] = useState<IngredientDraft | null>(value);
  const [opened, setOpened] = useState(value);
  if (value !== opened) {
    setOpened(value);
    setIng(value);
  }

  async function save() {
    if (!vendorId || !ing) return;
    try {
      const before = ing.id ? catalog?.ingredientsById[ing.id]?.unit_price : undefined;
      const id = await saveCatalogDoc(vendorId, "ingredients", ing);
      toast({ title: tr("已儲存", "Saved"), description: ing.name });
      // Unit price changed: recompute the portion tiers too (this is the "recalculated automatically after saving" step the dialog mentions)
      if (before !== undefined && before !== ing.unit_price) void recalcPortionLevelsAfterPrice(vendorId);
      onSaved?.(id);
      onClose();
    } catch (err) {
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
    }
  }

  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{ing?.id ? tr("編輯原物料", "Edit ingredient") : tr("新增原物料", "Add ingredient")}</DialogTitle></DialogHeader>
        {ing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>{tr("名稱", "Name")}</Label><Input value={ing.name} onChange={(e) => setIng({ ...ing, name: e.target.value })} /></div>
            <div><Label>{tr("類別", "Category")}</Label>
              <select className={SELECT} value={ing.category} onChange={(e) => setIng({ ...ing, category: e.target.value })}>
                {ING_CATEGORIES.map((c) => <option key={c} value={c}>{catalogLabel(c)}</option>)}
              </select></div>
            <div><Label>{tr("用量單位", "Unit")}</Label>
              <Input list="ing-unit-suggestions" value={ing.unit} maxLength={6} onChange={(e) => setIng({ ...ing, unit: e.target.value.trim() })} placeholder={tr("克、片、顆…", "g, slice, piece…")} />
              <datalist id="ing-unit-suggestions">{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
              <span className="text-micro text-muted-foreground">{tr("以片、顆計的熟成率填 1、損耗率填 0", "For pieces, set yield 1 and loss 0")}</span></div>
            <div><Label>{tr("採購單位名稱", "Purchase unit")}</Label><Input value={ing.purchase_unit_label} onChange={(e) => setIng({ ...ing, purchase_unit_label: e.target.value })} placeholder={tr("盒、公斤、袋", "box, kg, bag")} /></div>
            <div><Label>{tr(`每採購單位 = 幾 ${ing.unit}`, `Units per purchase unit (${ing.unit})`)}</Label><Input type="number" value={ing.purchase_unit_size} onChange={(e) => setIng({ ...ing, purchase_unit_size: Number(e.target.value) })} /></div>
            <div><Label>{tr("最新單價（每採購單位）", "Latest price (per purchase unit)")}</Label><Input type="number" value={ing.unit_price} onChange={(e) => setIng({ ...ing, unit_price: Number(e.target.value) })} className={!(ing.unit_price > 0) ? "border-primary" : undefined} /></div>
            <div><Label>{tr("熟成率（熟重÷生重）", "Yield (cooked ÷ raw)")}</Label><Input type="number" step="0.05" value={ing.yield_rate} onChange={(e) => setIng({ ...ing, yield_rate: Number(e.target.value) })} /></div>
            <div><Label>{tr("損耗率（0–1）", "Loss rate (0–1)")}</Label><Input type="number" step="0.05" value={ing.loss_rate} onChange={(e) => setIng({ ...ing, loss_rate: Number(e.target.value) })} /></div>
            <div><Label>{tr("保存天數", "Shelf life (days)")}</Label><Input type="number" value={ing.shelf_days} onChange={(e) => setIng({ ...ing, shelf_days: Number(e.target.value) })} /></div>
            <div><Label>{tr("採購頻率", "Purchase frequency")}</Label>
              <select className={SELECT} value={ing.frequency} onChange={(e) => setIng({ ...ing, frequency: e.target.value as Ingredient["frequency"] })}>
                {Object.keys(FREQ_LABEL).map((k) => <option key={k} value={k}>{freqLabel(k)}</option>)}
              </select></div>
            <div><Label>{tr("供應商", "Supplier")}</Label>
              <select className={SELECT} value={ing.supplier_id ?? ""} onChange={(e) => setIng({ ...ing, supplier_id: e.target.value || null })}>
                <option value="">—</option>
                {catalog?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <PriceImpact vendorId={vendorId} draft={ing} />
            <p className="col-span-2 text-xs text-muted-foreground">{tr("生料用量 = 熟重 × 份數 ÷（熟成率 ×（1 − 損耗率））。例：100 g 熟重、熟成率 0.8、損耗 10% → 生料 139 g。", "Raw = cooked × portions ÷ (yield × (1 − loss)).")}{" "}{ing.name && `${tr("試算", "e.g.")} 100${ing.unit} → ${rawAmount(100, ing).toFixed(0)}${ing.unit}`}</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tr("取消", "Cancel")}</Button>
          <Button disabled={!ing?.name} onClick={save}>{tr("儲存", "Save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Cooking method and equipment fill in defaults (simplification proposal §3-4): picking a method auto-fills equipment, servings per batch and process minutes, so the vendor doesn't have to work them out
const METHOD_PRESET: Record<string, { equipment: string; batch_capacity: number; prep_minutes: number }> = {
  炒: { equipment: "炒鍋", batch_capacity: 10, prep_minutes: 15 },
  煮: { equipment: "電鍋", batch_capacity: 20, prep_minutes: 50 },
  滷: { equipment: "滷鍋", batch_capacity: 40, prep_minutes: 90 },
  炸: { equipment: "炸鍋", batch_capacity: 15, prep_minutes: 20 },
  烤: { equipment: "烤箱", batch_capacity: 20, prep_minutes: 30 },
  蒸: { equipment: "蒸籠", batch_capacity: 30, prep_minutes: 40 },
  涼拌: { equipment: "工作台", batch_capacity: 20, prep_minutes: 15 },
};
const EQUIPMENT_PRESET: Record<string, { batch_capacity: number; prep_minutes: number }> = {
  炒鍋: { batch_capacity: 10, prep_minutes: 15 }, 電鍋: { batch_capacity: 20, prep_minutes: 50 }, 炸鍋: { batch_capacity: 15, prep_minutes: 20 },
  烤箱: { batch_capacity: 20, prep_minutes: 30 }, 滷鍋: { batch_capacity: 40, prep_minutes: 90 }, 蒸籠: { batch_capacity: 30, prep_minutes: 40 },
  湯鍋: { batch_capacity: 40, prep_minutes: 60 }, 工作台: { batch_capacity: 20, prep_minutes: 15 },
};

/** Cooked weight = raw weight × cooking yield × (1 − loss rate); inverse of rawAmount */
function cookedFromRaw(raw: number, ing: Pick<Ingredient, "yield_rate" | "loss_rate">): number {
  return raw / rawAmount(1, ing);
}
const round1 = (n: number) => Math.round(n * 10) / 10;
/** Only gram / milliliter units distinguish raw vs cooked; slices, pieces and sticks count by quantity */
const isWeight = (unit: string | undefined) => !unit || ["g", "ml", "克", "毫升"].includes(unit);

/**
 * Edit dialog for a semi-finished item (one side dish). By default only three fields: name, ingredients, portion; picking a method fills in equipment and batch size, everything else goes under "Advanced".
 * Portion can be entered as raw or cooked weight (data is always stored as cooked weight; prep and purchasing convert back to raw via cooking yield): 180 g of multigrain rice is raw weight and far more than 180 g once cooked, so the two must be labeled separately.
 */
export function ComponentDialog({ vendorId, value, onClose, onSaved }: {
  vendorId: string | undefined;
  value: ComponentDraft | null;
  onClose: () => void;
  onSaved?: (id: string, name: string) => void;
}) {
  const { toast } = useToast();
  const { data: catalog } = useVendorCatalog(vendorId);
  const ingById = catalog?.ingredientsById ?? {};
  const [comp, setComp] = useState<ComponentDraft | null>(value);
  const [opened, setOpened] = useState(value);
  const [basis, setBasis] = useState<"raw" | "cooked">("raw");
  const [advanced, setAdvanced] = useState(false);
  if (value !== opened) {
    setOpened(value);
    setComp(value);
    setAdvanced(false);
  }
  // Stacked ingredient dialog: once created, fill it back into row lineIdx
  const [newIng, setNewIng] = useState<{ draft: IngredientDraft; lineIdx: number } | null>(null);

  const setLine = (idx: number, patch: Partial<Component["ingredients"][number]>) =>
    comp && setComp({ ...comp, ingredients: comp.ingredients.map((l, j) => (j === idx ? { ...l, ...patch } : l)) });

  async function save() {
    if (!vendorId || !comp) return;
    try {
      // The vendor pressing Save counts as confirmation, so the AI draft flag is removed
      const id = await saveCatalogDoc(vendorId, "components", { ...comp, ingredients: comp.ingredients.filter((l) => l.ingredient_id), ai_draft: false });
      toast({ title: tr("已儲存", "Saved"), description: comp.name });
      onSaved?.(id, comp.name);
      onClose();
    } catch (err) {
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
    }
  }

  const cost = comp ? componentCost({ id: "", ...comp }, ingById) : 0;

  return (
    <>
      <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{comp?.id ? tr("編輯配菜", "Edit dish") : tr("新增配菜", "Add dish")}</DialogTitle>
            {comp?.ai_draft && <DialogDescription className="text-accent-foreground">{tr("這是 AI 估的草稿，份量照店裡實際做法改一改，按儲存就算確認。", "AI draft — adjust to how you actually cook it; saving confirms it.")}</DialogDescription>}
          </DialogHeader>
          {comp && (
            <div className="space-y-4">
              <div><Label>{tr("名稱", "Name")}</Label><Input value={comp.name} onChange={(e) => setComp({ ...comp, name: e.target.value })} placeholder={tr("例：炒小白菜", "e.g. stir-fried bok choy")} /></div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>{tr("一份用什麼", "What goes into one portion")}</Label>
                  <div className="inline-flex rounded-full border border-border p-0.5 text-xs" role="radiogroup" aria-label={tr("份量填生重還是熟重", "Amounts are raw or cooked")}>
                    {(["raw", "cooked"] as const).map((b) => (
                      <button key={b} type="button" role="radio" aria-checked={basis === b} onClick={() => setBasis(b)} className={cn("rounded-full px-3 py-1", basis === b ? "bg-foreground text-background font-semibold" : "text-muted-foreground")}>
                        {b === "raw" ? tr("填生重（買來秤的）", "Raw (as bought)") : tr("填熟重（煮好裝盒）", "Cooked (in the box)")}
                      </button>
                    ))}
                  </div>
                </div>
                {comp.ingredients.map((line, idx) => {
                  const ing = ingById[line.ingredient_id];
                  const weight = isWeight(ing?.unit);
                  const raw = ing ? rawAmount(line.grams || 0, ing) : line.grams || 0;
                  const shown = basis === "raw" && ing && weight ? round1(raw) : line.grams;
                  return (
                    <div key={idx} className="space-y-0.5">
                      <div className="flex gap-2">
                        <select
                          className={selectClass("md", "flex-1 min-w-0")}
                          value={line.ingredient_id}
                          onChange={(e) => {
                            if (e.target.value === NEW_ING) setNewIng({ draft: { ...EMPTY_ING }, lineIdx: idx });
                            else setLine(idx, { ingredient_id: e.target.value });
                          }}
                          aria-label={tr("原物料", "Ingredient")}
                        >
                          <option value="">{tr("選原物料…", "Pick an ingredient…")}</option>
                          {catalog?.ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                          <option value={NEW_ING}>{tr("＋ 新增原物料…", "+ New ingredient…")}</option>
                        </select>
                        <Input
                          className="w-24 h-10"
                          type="number"
                          min={0}
                          value={shown || ""}
                          aria-label={weight ? (basis === "raw" ? tr("每份生重", "Raw per portion") : tr("每份熟重", "Cooked per portion")) : tr("每份數量", "Count per portion")}
                          onChange={(e) => {
                            const n = Number(e.target.value) || 0;
                            setLine(idx, { grams: basis === "raw" && ing && weight ? round1(cookedFromRaw(n, ing)) : n });
                          }}
                        />
                        <span className="text-xs self-center w-8">{ing?.unit ?? "g"}</span>
                        <Button variant="ghost" size="icon" className="h-10 w-10" aria-label={tr("刪除", "Remove")} onClick={() => setComp({ ...comp, ingredients: comp.ingredients.filter((_, j) => j !== idx) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                      </div>
                      {ing && weight && Math.abs(raw - (line.grams || 0)) > 0.05 && (
                        <p className="text-[11px] text-muted-foreground pl-1">
                          {basis === "raw" ? tr(`生重 ${round1(raw)}${ing.unit} → 熟重約 ${round1(line.grams)}${ing.unit}`, `raw ${round1(raw)} → cooked ≈ ${round1(line.grams)}`) : tr(`熟重 ${round1(line.grams)}${ing.unit} ← 生重約 ${round1(raw)}${ing.unit}`, `cooked ${round1(line.grams)} ← raw ≈ ${round1(raw)}`)}
                          {tr(`（熟成率 ${ing.yield_rate}${ing.loss_rate ? `、損耗 ${Math.round(ing.loss_rate * 100)}%` : ""}）`, ` (yield ${ing.yield_rate})`)}
                        </p>
                      )}
                    </div>
                  );
                })}
                <div className="flex items-center justify-between gap-2">
                  <Button size="sm" variant="outline" onClick={() => setComp({ ...comp, ingredients: [...comp.ingredients, { ingredient_id: "", grams: 0 }] })}><Plus /> {tr("加原物料", "Add ingredient")}</Button>
                  <span className="text-sm">{tr("每份成本", "Cost/portion")} <b>NT${cost.toFixed(1)}</b></span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{tr("做法", "Method")}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setComp({ ...comp, method: m, ...METHOD_PRESET[m] })}
                      className={cn("rounded-full border px-3 py-1.5 text-sm", comp.method === m ? "border-foreground bg-foreground text-background font-semibold" : "border-border hover:bg-accent")}
                    >{catalogLabel(m)}</button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{tr(`${comp.equipment}・每批 ${comp.batch_capacity} 份・${comp.prep_minutes} 分鐘`, `${catalogLabel(comp.equipment)} · ${comp.batch_capacity}/batch · ${comp.prep_minutes} min`)}</p>
              </div>

              <div className="rounded-md border border-border">
                <button type="button" className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium" onClick={() => setAdvanced((v) => !v)} aria-expanded={advanced}>
                  {tr("進階（設備、批量、製程時間、口味）", "Advanced (equipment, batch, timing, flavor)")}
                  <span className="text-muted-foreground">{advanced ? "−" : "+"}</span>
                </button>
                {advanced && (
                  <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                    <div><Label>{tr("設備", "Equipment")}</Label>
                      <select className={SELECT} value={comp.equipment} onChange={(e) => setComp({ ...comp, equipment: e.target.value, ...EQUIPMENT_PRESET[e.target.value] })}>
                        {EQUIPMENT.map((m) => <option key={m} value={m}>{catalogLabel(m)}</option>)}
                      </select></div>
                    <div><Label>{tr("每份熟重 (g)", "Cooked portion (g)")}</Label><Input type="number" value={comp.portion_grams} onChange={(e) => setComp({ ...comp, portion_grams: Number(e.target.value) })} /></div>
                    <div><Label>{tr("每批份數", "Batch size")}</Label><Input type="number" value={comp.batch_capacity} onChange={(e) => setComp({ ...comp, batch_capacity: Number(e.target.value) })} /></div>
                    <div><Label>{tr("每批製程（分）", "Minutes per batch")}</Label><Input type="number" value={comp.prep_minutes} onChange={(e) => setComp({ ...comp, prep_minutes: Number(e.target.value) })} /></div>
                    <div><Label>{tr("可提前製作（小時）", "Can be made ahead (h)")}</Label><Input type="number" value={comp.advance_hours} onChange={(e) => setComp({ ...comp, advance_hours: Number(e.target.value) })} /></div>
                    <div className="flex items-end gap-3 text-sm pb-2">
                      {FLAVORS.map((f) => (
                        <label key={f} className="flex items-center gap-1">
                          <input type="checkbox" checked={comp.flavors?.includes(f) ?? false} onChange={(e) => setComp({ ...comp, flavors: e.target.checked ? [...(comp.flavors ?? []), f] : (comp.flavors ?? []).filter((x) => x !== f) })} /> {catalogLabel(f)}
                        </label>
                      ))}
                    </div>
                    <p className="col-span-2 text-xs text-muted-foreground">{tr("設備、批量、製程時間只用在今日備料的詳細排程；量不大的店不用填。", "Only used for the detailed prep schedule; small shops can skip.")}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>{tr("取消", "Cancel")}</Button>
            <Button disabled={!comp?.name} onClick={save}>{tr("儲存", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <IngredientDialog
        vendorId={vendorId}
        value={newIng?.draft ?? null}
        onClose={() => setNewIng(null)}
        onSaved={(id) => newIng && setLine(newIng.lineIdx, { ingredient_id: id })}
      />
    </>
  );
}

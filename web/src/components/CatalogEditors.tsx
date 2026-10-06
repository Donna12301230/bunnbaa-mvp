import { useMemo, useState } from "react";
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
import { db } from "@/lib/firebase";
import { componentCost, rawAmount } from "@/lib/bento";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Component, Ingredient } from "@/types";

// 半成品、原物料的編輯視窗：配方頁用，菜單編輯也會疊開（找不到半成品時直接建、成本缺單價時直接補），
// 存完回傳新文件 id，原本的視窗內容不受影響。

export const EMPTY_ING: Omit<Ingredient, "id"> = {
  name: "", category: "其他", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000,
  yield_rate: 1, loss_rate: 0, shelf_days: 7, frequency: "weekly", supplier_id: null, unit_price: 0,
};
export const EMPTY_COMP: Omit<Component, "id"> = {
  name: "", portion_grams: 100, ingredients: [], prep_minutes: 20, equipment: "炒鍋", batch_capacity: 20, advance_hours: 0, method: "炒", flavors: [],
};
export const ING_CATEGORIES = ["雞", "豬", "牛", "海鮮", "素", "蛋", "豆", "葉菜", "根莖", "瓜類", "米", "麵", "調味", "乾貨", "包材", "其他"];
const EQUIPMENT = ["炒鍋", "電鍋", "炸鍋", "烤箱", "滷鍋", "蒸籠", "湯鍋", "工作台"];
const METHODS = ["炸", "滷", "烤", "炒", "蒸", "煮", "涼拌"];
const FLAVORS = ["辣", "清淡", "甜"];
// 1002 規格 §5：採購只分每週進料與每日備料；米、油、調味料、乾貨、包材等久放品項（monthly）併入每週，低於安全庫存才叫
export const FREQ_LABEL: Record<string, string> = { monthly: "久放品項（低於安全庫存才叫）", weekly: "每週進料", daily: "每日補貨" };
// 計量單位由店家自訂（§3.2），這些只是建議
const UNIT_SUGGESTIONS = ["克", "片", "顆", "塊", "毫升", "支", "張", "g", "ml", "個"];
const NEW_ING = "__new__";

export type ComponentDraft = Omit<Component, "id"> & { id?: string };
export type IngredientDraft = Omit<Ingredient, "id"> & { id?: string };

/** 存半成品／原物料／小盤商；回傳文件 id */
export async function saveCatalogDoc(vendorId: string, kind: "ingredients" | "components" | "suppliers", data: Record<string, unknown> & { id?: string }): Promise<string> {
  const { id, ...rest } = data;
  let docId = id;
  if (docId) await setDoc(doc(db, "vendors", vendorId, kind, docId), rest);
  else docId = (await addDoc(collection(db, "vendors", vendorId, kind), rest)).id;
  await queryClient.invalidateQueries({ queryKey: ["vendorCatalog", vendorId] });
  queryClient.invalidateQueries({ queryKey: ["vendorMenu", vendorId] });
  return docId;
}

const SELECT = "w-full h-10 rounded-md border border-input bg-background px-2 text-sm";

/**
 * 漲價影響（3.3(c)）：改單價時，列出用到這個原物料的品項，預設組合（一碗飯、第一道主菜、預設配菜）的成本與毛利前後變化。
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
    <div className="col-span-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs space-y-1">
      <p className="font-semibold">{tr(`單價 ${original.unit_price} → ${draft.unit_price}，影響 ${rows.length} 道菜（預設組合）：`, `Price ${original.unit_price} → ${draft.unit_price} affects ${rows.length} item(s):`)}</p>
      {rows.map((r) => (
        <p key={r.id} className="flex flex-wrap gap-x-2">
          <span className="font-medium">{r.name}</span>
          <span>{tr("成本", "cost")} {r.c0.toFixed(1)} → <b>{r.c1.toFixed(1)}</b></span>
          <span className={r.price > 0 && (r.price - r.c1) / r.price < 0.4 ? "text-orange-700 font-semibold" : ""}>{tr("毛利", "margin")} {margin(r.price, r.c0)} → {margin(r.price, r.c1)}</span>
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
      const id = await saveCatalogDoc(vendorId, "ingredients", ing);
      toast({ title: tr("已儲存", "Saved"), description: ing.name });
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
                {ING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select></div>
            <div><Label>{tr("用量單位", "Unit")}</Label>
              <Input list="ing-unit-suggestions" value={ing.unit} maxLength={6} onChange={(e) => setIng({ ...ing, unit: e.target.value.trim() })} placeholder={tr("克、片、顆…", "g, slice, piece…")} />
              <datalist id="ing-unit-suggestions">{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
              <span className="text-micro text-muted-foreground">{tr("以片、顆計的熟成率填 1、損耗率填 0", "For pieces, set yield 1 and loss 0")}</span></div>
            <div><Label>{tr("採購單位名稱", "Purchase unit")}</Label><Input value={ing.purchase_unit_label} onChange={(e) => setIng({ ...ing, purchase_unit_label: e.target.value })} placeholder={tr("盒、公斤、袋", "box, kg, bag")} /></div>
            <div><Label>{tr(`每採購單位 = 幾 ${ing.unit}`, `Units per purchase unit (${ing.unit})`)}</Label><Input type="number" value={ing.purchase_unit_size} onChange={(e) => setIng({ ...ing, purchase_unit_size: Number(e.target.value) })} /></div>
            <div><Label>{tr("最新單價（每採購單位）", "Latest price (per purchase unit)")}</Label><Input type="number" value={ing.unit_price} onChange={(e) => setIng({ ...ing, unit_price: Number(e.target.value) })} className={!(ing.unit_price > 0) ? "border-amber-500" : undefined} /></div>
            <div><Label>{tr("熟成率（熟重÷生重）", "Yield (cooked ÷ raw)")}</Label><Input type="number" step="0.05" value={ing.yield_rate} onChange={(e) => setIng({ ...ing, yield_rate: Number(e.target.value) })} /></div>
            <div><Label>{tr("損耗率（0–1）", "Loss rate (0–1)")}</Label><Input type="number" step="0.05" value={ing.loss_rate} onChange={(e) => setIng({ ...ing, loss_rate: Number(e.target.value) })} /></div>
            <div><Label>{tr("保存天數", "Shelf life (days)")}</Label><Input type="number" value={ing.shelf_days} onChange={(e) => setIng({ ...ing, shelf_days: Number(e.target.value) })} /></div>
            <div><Label>{tr("採購頻率", "Purchase frequency")}</Label>
              <select className={SELECT} value={ing.frequency} onChange={(e) => setIng({ ...ing, frequency: e.target.value as Ingredient["frequency"] })}>
                {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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

// 烹調方式與設備帶出預設值（簡化提案 §3-4）：選了做法就自動填設備、每批份數、製程分鐘，店家不用自己想
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

/** 熟重 = 生重 × 熟成率 ×（1 − 損耗率）；rawAmount 的反函數 */
function cookedFromRaw(raw: number, ing: Pick<Ingredient, "yield_rate" | "loss_rate">): number {
  return raw / rawAmount(1, ing);
}
const round1 = (n: number) => Math.round(n * 10) / 10;
/** 以克、毫升計的才有生熟之分；片、顆、支照數量算 */
const isWeight = (unit: string | undefined) => !unit || ["g", "ml", "克", "毫升"].includes(unit);

/**
 * 半成品（一道配菜）的編輯視窗。預設只有三樣：名稱、原物料、份量；做法選了會帶出設備與批量，其餘收進「進階」。
 * 份量可以填生重或熟重（資料一律存熟重，備料、叫貨用熟成率換回生料）：五穀米 180 g 是生重，煮熟後遠大於 180 g，兩個要分開標。
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
  // 疊開的原物料視窗：建好後填回第 lineIdx 行
  const [newIng, setNewIng] = useState<{ draft: IngredientDraft; lineIdx: number } | null>(null);

  const setLine = (idx: number, patch: Partial<Component["ingredients"][number]>) =>
    comp && setComp({ ...comp, ingredients: comp.ingredients.map((l, j) => (j === idx ? { ...l, ...patch } : l)) });

  async function save() {
    if (!vendorId || !comp) return;
    try {
      // 店家按過儲存＝確認過，AI 草稿標記拿掉
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
            {comp?.ai_draft && <DialogDescription className="text-orange-700">{tr("這是 AI 估的草稿，份量照店裡實際做法改一改，按儲存就算確認。", "AI draft — adjust to how you actually cook it; saving confirms it.")}</DialogDescription>}
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
                          className="flex-1 h-10 rounded-md border border-input bg-background px-2 text-sm min-w-0"
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
                    >{m}</button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{tr(`${comp.equipment}・每批 ${comp.batch_capacity} 份・${comp.prep_minutes} 分鐘`, `${comp.equipment} · ${comp.batch_capacity}/batch · ${comp.prep_minutes} min`)}</p>
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
                        {EQUIPMENT.map((m) => <option key={m}>{m}</option>)}
                      </select></div>
                    <div><Label>{tr("每份熟重 (g)", "Cooked portion (g)")}</Label><Input type="number" value={comp.portion_grams} onChange={(e) => setComp({ ...comp, portion_grams: Number(e.target.value) })} /></div>
                    <div><Label>{tr("每批份數", "Batch size")}</Label><Input type="number" value={comp.batch_capacity} onChange={(e) => setComp({ ...comp, batch_capacity: Number(e.target.value) })} /></div>
                    <div><Label>{tr("每批製程（分）", "Minutes per batch")}</Label><Input type="number" value={comp.prep_minutes} onChange={(e) => setComp({ ...comp, prep_minutes: Number(e.target.value) })} /></div>
                    <div><Label>{tr("可提前製作（小時）", "Can be made ahead (h)")}</Label><Input type="number" value={comp.advance_hours} onChange={(e) => setComp({ ...comp, advance_hours: Number(e.target.value) })} /></div>
                    <div className="flex items-end gap-3 text-sm pb-2">
                      {FLAVORS.map((f) => (
                        <label key={f} className="flex items-center gap-1">
                          <input type="checkbox" checked={comp.flavors?.includes(f) ?? false} onChange={(e) => setComp({ ...comp, flavors: e.target.checked ? [...(comp.flavors ?? []), f] : (comp.flavors ?? []).filter((x) => x !== f) })} /> {f}
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

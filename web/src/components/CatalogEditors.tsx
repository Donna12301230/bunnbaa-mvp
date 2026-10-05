import { useState } from "react";
import { addDoc, collection, doc, setDoc } from "firebase/firestore";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { queryClient } from "@/lib/queryClient";
import { db } from "@/lib/firebase";
import { componentCost, rawAmount } from "@/lib/bento";
import { tr } from "@/lib/i18n";
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
  if (value !== opened) {
    setOpened(value);
    setComp(value);
  }
  // 疊開的原物料視窗：建好後填回第 lineIdx 行
  const [newIng, setNewIng] = useState<{ draft: IngredientDraft; lineIdx: number } | null>(null);

  const setLine = (idx: number, patch: Partial<Component["ingredients"][number]>) =>
    comp && setComp({ ...comp, ingredients: comp.ingredients.map((l, j) => (j === idx ? { ...l, ...patch } : l)) });

  async function save() {
    if (!vendorId || !comp) return;
    try {
      const id = await saveCatalogDoc(vendorId, "components", { ...comp, ingredients: comp.ingredients.filter((l) => l.ingredient_id) });
      toast({ title: tr("已儲存", "Saved"), description: comp.name });
      onSaved?.(id, comp.name);
      onClose();
    } catch (err) {
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
    }
  }

  return (
    <>
      <Dialog open={!!value} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{comp?.id ? tr("編輯半成品", "Edit component") : tr("新增半成品", "Add component")}</DialogTitle>
            <DialogDescription>{tr("每份熟重、製程時間、設備與容量、可提前時間，決定每日備料清單與流程時間軸。", "Portion weight, prep time, equipment, batch size and lead time drive the daily prep list and timeline.")}</DialogDescription>
          </DialogHeader>
          {comp && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>{tr("名稱", "Name")}</Label><Input value={comp.name} onChange={(e) => setComp({ ...comp, name: e.target.value })} /></div>
              <div className="col-span-2 space-y-1.5 rounded-md border border-border p-2">
                <Label>{tr("原物料（每份熟重）", "Ingredients (cooked per portion)")}</Label>
                {comp.ingredients.map((line, idx) => (
                  <div key={idx} className="flex gap-2">
                    <select
                      className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm min-w-0"
                      value={line.ingredient_id}
                      onChange={(e) => {
                        if (e.target.value === NEW_ING) setNewIng({ draft: { ...EMPTY_ING }, lineIdx: idx });
                        else setLine(idx, { ingredient_id: e.target.value });
                      }}
                    >
                      <option value="">—</option>
                      {catalog?.ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}{i.unit_price > 0 ? "" : tr("（未填單價）", " (no price)")}</option>)}
                      <option value={NEW_ING}>{tr("＋ 新增原物料…", "+ New ingredient…")}</option>
                    </select>
                    <Input className="w-24 h-9" type="number" value={line.grams} onChange={(e) => setLine(idx, { grams: Number(e.target.value) })} />
                    <span className="text-xs self-center w-8">{ingById[line.ingredient_id]?.unit ?? "g"}</span>
                    <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={tr("刪除", "Remove")} onClick={() => setComp({ ...comp, ingredients: comp.ingredients.filter((_, j) => j !== idx) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setComp({ ...comp, ingredients: [...comp.ingredients, { ingredient_id: "", grams: 0 }] })}><Plus /> {tr("加原物料", "Add ingredient")}</Button>
                <p className="text-xs text-muted-foreground">{tr("每份成本", "Cost per portion")} NT${componentCost({ id: "", ...comp }, ingById).toFixed(1)}</p>
              </div>
              <div><Label>{tr("每份熟重 (g)", "Portion (g)")}</Label><Input type="number" value={comp.portion_grams} onChange={(e) => setComp({ ...comp, portion_grams: Number(e.target.value) })} /></div>
              <div><Label>{tr("烹調方式", "Method")}</Label>
                <select className={SELECT} value={comp.method} onChange={(e) => setComp({ ...comp, method: e.target.value })}>
                  {METHODS.map((m) => <option key={m}>{m}</option>)}
                </select></div>
              <div><Label>{tr("設備", "Equipment")}</Label>
                <select className={SELECT} value={comp.equipment} onChange={(e) => setComp({ ...comp, equipment: e.target.value })}>
                  {EQUIPMENT.map((m) => <option key={m}>{m}</option>)}
                </select></div>
              <div><Label>{tr("每批份數（設備容量）", "Batch size")}</Label><Input type="number" value={comp.batch_capacity} onChange={(e) => setComp({ ...comp, batch_capacity: Number(e.target.value) })} /></div>
              <div><Label>{tr("每批製程（分）", "Minutes per batch")}</Label><Input type="number" value={comp.prep_minutes} onChange={(e) => setComp({ ...comp, prep_minutes: Number(e.target.value) })} /></div>
              <div><Label>{tr("可提前製作（小時）", "Can be made ahead (h)")}</Label><Input type="number" value={comp.advance_hours} onChange={(e) => setComp({ ...comp, advance_hours: Number(e.target.value) })} /></div>
              <div className="col-span-2 flex gap-3 text-sm">
                {FLAVORS.map((f) => (
                  <label key={f} className="flex items-center gap-1">
                    <input type="checkbox" checked={comp.flavors?.includes(f) ?? false} onChange={(e) => setComp({ ...comp, flavors: e.target.checked ? [...(comp.flavors ?? []), f] : (comp.flavors ?? []).filter((x) => x !== f) })} /> {f}
                  </label>
                ))}
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

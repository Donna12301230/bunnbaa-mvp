import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import { BookOpen, Plus, Sparkles, Trash2, Pencil, Wand2 } from "lucide-react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { queryClient } from "@/lib/queryClient";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { componentCost, rawAmount } from "@/lib/bento";
import { tr } from "@/lib/i18n";
import type { Component, Ingredient, Supplier } from "@/types";

// 配方三層（規格 §3）：品項（菜單管理）→ 半成品 → 原物料。
// 配方同時產生備料數量、成本、份量級距與口味標籤；數量一律由程式計算，Gemini 只給草稿。
const EMPTY_ING: Omit<Ingredient, "id"> = {
  name: "", category: "其他", unit: "g", purchase_unit_label: "公斤", purchase_unit_size: 1000,
  yield_rate: 1, loss_rate: 0, shelf_days: 7, frequency: "weekly", supplier_id: null, unit_price: 0,
};
const EMPTY_COMP: Omit<Component, "id"> = {
  name: "", portion_grams: 100, ingredients: [], prep_minutes: 20, equipment: "炒鍋", batch_capacity: 20, advance_hours: 0, method: "炒", flavors: [],
};
const ING_CATEGORIES = ["雞", "豬", "牛", "海鮮", "素", "蛋", "豆", "葉菜", "根莖", "瓜類", "米", "麵", "調味", "乾貨", "包材", "其他"];
const EQUIPMENT = ["炒鍋", "電鍋", "炸鍋", "烤箱", "滷鍋", "蒸籠", "湯鍋", "工作台"];
const METHODS = ["炸", "滷", "烤", "炒", "蒸", "煮", "涼拌"];
const FLAVORS = ["辣", "清淡", "甜"];
// 1002 規格 §5：採購只分每週進料與每日備料；米、油、調味料、乾貨、包材等久放品項（monthly）併入每週，低於安全庫存才叫
const FREQ_LABEL: Record<string, string> = { monthly: "久放品項（低於安全庫存才叫）", weekly: "每週進料", daily: "每日補貨" };
// 計量單位由店家自訂（§3.2），這些只是建議
const UNIT_SUGGESTIONS = ["克", "片", "顆", "塊", "毫升", "支", "張", "g", "ml", "個"];

interface TemplateDoc {
  id: string;
  name: string;
  structure: string;
  ingredients: (Omit<Ingredient, "id"> & { key: string })[];
  components: (Omit<Component, "id" | "ingredients"> & { key: string; ingredients: { ingredient: string; grams: number }[] })[];
  items: Record<string, unknown>[];
}

export default function VendorPortalRecipes() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data: vendor } = useMyVendor();
  const vendorId = vendor?.id;
  const { data: catalog, isLoading } = useVendorCatalog(vendorId);
  const [ing, setIng] = useState<(Omit<Ingredient, "id"> & { id?: string }) | null>(null);
  const [comp, setComp] = useState<(Omit<Component, "id"> & { id?: string }) | null>(null);
  const [sup, setSup] = useState<(Omit<Supplier, "id"> & { id?: string }) | null>(null);
  const [draftName, setDraftName] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await getDocs(collection(db, "templates"))).docs.map((d) => ({ id: d.id, ...d.data() }) as TemplateDoc),
    enabled: templateOpen,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["vendorCatalog", vendorId] });
    queryClient.invalidateQueries({ queryKey: ["vendorMenu", vendorId] });
  };

  async function save(kind: "ingredients" | "components" | "suppliers", data: Record<string, unknown> & { id?: string }) {
    if (!vendorId) return;
    const { id, ...rest } = data;
    try {
      if (id) await setDoc(doc(db, "vendors", vendorId, kind, id), rest);
      else await addDoc(collection(db, "vendors", vendorId, kind), rest);
      refresh();
      setIng(null);
      setComp(null);
      setSup(null);
      toast({ title: tr("已儲存", "Saved") });
    } catch (err) {
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
    }
  }

  async function remove(kind: "ingredients" | "components" | "suppliers", id: string, name: string) {
    if (!vendorId || !(await confirm({ title: tr(`刪除「${name}」？`, `Delete ${name}?`), confirmLabel: tr("刪除", "Delete"), destructive: true }))) return;
    await deleteDoc(doc(db, "vendors", vendorId, kind, id));
    refresh();
  }

  /** Gemini 配方草稿：產生半成品＋原物料，同名原物料沿用既有的；店家接著在編輯視窗改數字 */
  async function draftRecipe() {
    if (!vendorId || !draftName.trim()) return;
    setDrafting(true);
    try {
      const res = await httpsCallable(functions, "draftRecipe")({ name: draftName.trim() });
      const out = res.data as { component: Omit<Component, "id" | "ingredients">; ingredients: (Omit<Ingredient, "id"> & { grams: number })[]; note?: string; disclaimer: string };
      const lines: { ingredient_id: string; grams: number }[] = [];
      for (const d of out.ingredients || []) {
        const existing = catalog?.ingredients.find((x) => x.name === d.name);
        let id = existing?.id;
        if (!id) {
          const { grams: _g, ...rest } = d;
          const ref = await addDoc(collection(db, "vendors", vendorId, "ingredients"), { ...EMPTY_ING, ...rest, unit_price: 0 });
          id = ref.id;
        }
        lines.push({ ingredient_id: id, grams: Number(d.grams) || 0 });
      }
      refresh();
      setComp({ ...EMPTY_COMP, ...out.component, ingredients: lines });
      toast({ title: tr("已產生配方草稿", "Draft ready"), description: `${out.note ?? ""} ${out.disclaimer}` });
      setDraftName("");
    } catch (err) {
      toast({ variant: "destructive", title: tr("產生草稿失敗", "Couldn't draft"), description: (err as Error).message });
    } finally {
      setDrafting(false);
    }
  }

  /** 從定式模板開店（§3.1）：複製原物料、半成品與品項（含配菜格、候選菜建議） */
  async function applyTemplate(t: TemplateDoc) {
    if (!vendorId) return;
    try {
      const batch = writeBatch(db);
      const ingIds: Record<string, string> = {};
      for (const i of t.ingredients) {
        const existing = catalog?.ingredients.find((x) => x.name === i.name);
        if (existing) {
          ingIds[i.key] = existing.id;
          continue;
        }
        const ref = doc(collection(db, "vendors", vendorId, "ingredients"));
        const { key: _k, ...rest } = i;
        batch.set(ref, rest);
        ingIds[i.key] = ref.id;
      }
      const compIds: Record<string, string> = {};
      for (const c of t.components) {
        const existing = catalog?.components.find((x) => x.name === c.name);
        if (existing) {
          compIds[c.key] = existing.id;
          continue;
        }
        const ref = doc(collection(db, "vendors", vendorId, "components"));
        const { key: _k, ingredients, ...rest } = c;
        batch.set(ref, { ...rest, ingredients: ingredients.map((l) => ({ ingredient_id: ingIds[l.ingredient], grams: l.grams })) });
        compIds[c.key] = ref.id;
      }
      const mapComp = (key: unknown) => (typeof key === "string" && compIds[key]) || null;
      for (const item of t.items) {
        const it = item as { main?: { name: string; component: string }; rice_component?: string; component?: string; slots?: { category: string; default: { name: string; component: string }; candidates: { name: string; component: string; portion_level: number }[] }[] };
        const ref = doc(collection(db, "menu_items"));
        batch.set(ref, {
          ...item,
          vendor_id: vendorId,
          template: t.id,
          is_available: false, // 店家確認價格後自己上架
          image: null,
          allergens: (item as { allergens?: string[] }).allergens ?? [],
          dietary_tags: (item as { dietary_tags?: string[] }).dietary_tags ?? [],
          main: it.main ? { name: it.main.name, component_id: mapComp(it.main.component) } : null,
          rice_component_id: mapComp(it.rice_component),
          fixed: ((item as { fixed?: { name: string; component: string }[] }).fixed ?? []).map((f) => ({ name: f.name, component_id: mapComp(f.component) })),
          component_id: mapComp(it.component),
          slots: (it.slots ?? []).map((s) => ({
            category: s.category,
            default: { name: s.default.name, component_id: mapComp(s.default.component) },
            candidates: s.candidates.map((c) => ({ name: c.name, component_id: mapComp(c.component), portion_level: c.portion_level ?? 1, weekly_cap: null, min_qty: null })),
          })),
          created_at: new Date(),
        });
      }
      await batch.commit();
      refresh();
      setTemplateOpen(false);
      toast({ title: tr(`已套用「${t.name}」模板`, `Applied ${t.name}`), description: tr("品項先設為下架，到菜單管理確認價格後再上架。", "Items start unlisted — check prices in Menu, then list them.") });
    } catch (err) {
      toast({ variant: "destructive", title: tr("套用失敗", "Couldn't apply"), description: (err as Error).message });
    }
  }

  const ingById = catalog?.ingredientsById ?? {};

  return (
    <VendorPortalLayout>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h1 className="font-heading text-3xl md:text-4xl font-semibold flex items-center gap-2"><BookOpen className="w-5 h-5 text-orange-500" /> {tr("配方與原物料", "Recipes & ingredients")}</h1>
        <Button variant="outline" onClick={() => setTemplateOpen(true)}><Wand2 /> {tr("從定式模板開店", "Start from a template")}</Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{tr("品項 → 半成品 → 原物料。配方算出每日備料、叫貨量、成本與候選菜份量級距。", "Items → prepared components → raw ingredients. Recipes drive prep counts, purchasing, cost and portion levels.")}</p>

      <Card className="mb-4">
        <CardContent className="p-3 flex flex-wrap gap-2 items-center">
          <Sparkles className="w-4 h-4 text-orange-500" />
          <span className="text-sm">{tr("輸入菜名，AI 產生配方草稿：", "Type a dish and AI drafts a recipe:")}</span>
          <Input className="w-48" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder={tr("例：地瓜葉", "e.g. sweet potato leaves")} />
          <Button size="sm" onClick={draftRecipe} disabled={drafting || !draftName.trim()}>{drafting ? tr("產生中…", "Drafting…") : tr("產生草稿", "Draft")}</Button>
          <span className="text-xs text-muted-foreground">{tr("數字只是起點，請改成店內實際值再儲存。", "Numbers are a starting point — edit before saving.")}</span>
        </CardContent>
      </Card>

      {isLoading ? <SkeletonBlocks count={3} height={64} className="space-y-2" /> : (
        <Tabs defaultValue="components">
          <TabsList className="max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="components">{tr("半成品", "Components")}（{catalog?.components.length ?? 0}）</TabsTrigger>
            <TabsTrigger value="ingredients">{tr("原物料", "Ingredients")}（{catalog?.ingredients.length ?? 0}）</TabsTrigger>
            <TabsTrigger value="suppliers">{tr("小盤商", "Suppliers")}（{catalog?.suppliers.length ?? 0}）</TabsTrigger>
          </TabsList>

          <TabsContent value="components" className="space-y-2">
            <Button size="sm" onClick={() => setComp({ ...EMPTY_COMP })}><Plus /> {tr("新增半成品", "Add component")}</Button>
            {catalog?.components.length === 0 && <EmptyState size="compact" icon={<BookOpen size={32} />} title={tr("還沒有半成品", "No components yet")} description={tr("白飯、滷雞腿、炒高麗菜…可以直接裝盒的成品。", "Rice, braised chicken, stir-fried cabbage… things that go straight into the box.")} />}
            {catalog?.components.map((c) => (
              <Card key={c.id}>
                <CardContent className="p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{c.name} <span className="text-xs text-muted-foreground">{c.method}・{c.equipment}・{c.portion_grams} g／份</span></p>
                    <p className="text-xs text-muted-foreground">
                      {c.ingredients.map((l) => `${ingById[l.ingredient_id]?.name ?? "?"} ${l.grams}${ingById[l.ingredient_id]?.unit ?? "g"}`).join("、") || tr("尚未設定原物料", "No ingredients yet")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {tr(`每批 ${c.batch_capacity} 份、${c.prep_minutes} 分鐘`, `${c.batch_capacity}/batch, ${c.prep_minutes} min`)}{c.advance_hours ? tr(`、可提前 ${c.advance_hours} 小時`, `, ${c.advance_hours} h ahead`) : ""}
                      ・{tr("每份成本", "Cost")} NT${componentCost(c, ingById).toFixed(1)}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setComp(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8 text-red-500" onClick={() => remove("components", c.id, c.name)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="ingredients" className="space-y-2">
            <Button size="sm" onClick={() => setIng({ ...EMPTY_ING })}><Plus /> {tr("新增原物料", "Add ingredient")}</Button>
            {catalog?.ingredients.map((i) => (
              <Card key={i.id}>
                <CardContent className="p-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">{i.name} <span className="text-xs text-muted-foreground">{i.category}・{FREQ_LABEL[i.frequency] ?? i.frequency}</span></p>
                    <p className="text-xs text-muted-foreground">
                      {tr(`熟成率 ${i.yield_rate}、損耗 ${Math.round(i.loss_rate * 100)}%、保存 ${i.shelf_days} 天`, `Yield ${i.yield_rate}, loss ${Math.round(i.loss_rate * 100)}%, keeps ${i.shelf_days} d`)}
                      ・NT${i.unit_price}／{i.purchase_unit_label}（{i.purchase_unit_size}{i.unit}）
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setIng(i)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8 text-red-500" onClick={() => remove("ingredients", i.id, i.name)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </CardContent>
              </Card>
            ))}
            <p className="text-xs text-muted-foreground">{tr("單價請在每次進貨時更新；菜價暴漲時更新後，未截單日期的份量級距會自動重算。", "Update prices on each delivery; after a price spike, portion levels for future dates are recalculated.")}</p>
          </TabsContent>

          <TabsContent value="suppliers" className="space-y-2">
            <Button size="sm" onClick={() => setSup({ name: "", phone: "", line_id: "", note: "" })}><Plus /> {tr("新增小盤商", "Add supplier")}</Button>
            {catalog?.suppliers.map((s) => (
              <Card key={s.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1"><p className="font-medium">{s.name}</p><p className="text-xs text-muted-foreground">{s.phone} {s.line_id && `LINE: ${s.line_id}`} {s.note}</p></div>
                  <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => setSup(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8 text-red-500" onClick={() => remove("suppliers", s.id, s.name)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </CardContent>
              </Card>
            ))}
          </TabsContent>
        </Tabs>
      )}

      {/* 原物料 */}
      <Dialog open={!!ing} onOpenChange={(o) => !o && setIng(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{ing?.id ? tr("編輯原物料", "Edit ingredient") : tr("新增原物料", "Add ingredient")}</DialogTitle></DialogHeader>
          {ing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>{tr("名稱", "Name")}</Label><Input value={ing.name} onChange={(e) => setIng({ ...ing, name: e.target.value })} /></div>
              <div><Label>{tr("類別", "Category")}</Label>
                <select className="w-full h-10 rounded-md border border-input px-2 text-sm" value={ing.category} onChange={(e) => setIng({ ...ing, category: e.target.value })}>
                  {ING_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select></div>
              <div><Label>{tr("用量單位", "Unit")}</Label>
                <Input list="ing-unit-suggestions" value={ing.unit} maxLength={6} onChange={(e) => setIng({ ...ing, unit: e.target.value.trim() })} placeholder={tr("克、片、顆…", "g, slice, piece…")} />
                <datalist id="ing-unit-suggestions">{UNIT_SUGGESTIONS.map((u) => <option key={u} value={u} />)}</datalist>
                <span className="text-micro text-muted-foreground">{tr("以片、顆計的熟成率填 1、損耗率填 0", "For pieces, set yield 1 and loss 0")}</span></div>
              <div><Label>{tr("採購單位名稱", "Purchase unit")}</Label><Input value={ing.purchase_unit_label} onChange={(e) => setIng({ ...ing, purchase_unit_label: e.target.value })} placeholder={tr("盒、公斤、袋", "box, kg, bag")} /></div>
              <div><Label>{tr(`每採購單位 = 幾 ${ing.unit}`, `Units per purchase unit (${ing.unit})`)}</Label><Input type="number" value={ing.purchase_unit_size} onChange={(e) => setIng({ ...ing, purchase_unit_size: Number(e.target.value) })} /></div>
              <div><Label>{tr("最新單價（每採購單位）", "Latest price (per purchase unit)")}</Label><Input type="number" value={ing.unit_price} onChange={(e) => setIng({ ...ing, unit_price: Number(e.target.value) })} /></div>
              <div><Label>{tr("熟成率（熟重÷生重）", "Yield (cooked ÷ raw)")}</Label><Input type="number" step="0.05" value={ing.yield_rate} onChange={(e) => setIng({ ...ing, yield_rate: Number(e.target.value) })} /></div>
              <div><Label>{tr("損耗率（0–1）", "Loss rate (0–1)")}</Label><Input type="number" step="0.05" value={ing.loss_rate} onChange={(e) => setIng({ ...ing, loss_rate: Number(e.target.value) })} /></div>
              <div><Label>{tr("保存天數", "Shelf life (days)")}</Label><Input type="number" value={ing.shelf_days} onChange={(e) => setIng({ ...ing, shelf_days: Number(e.target.value) })} /></div>
              <div><Label>{tr("採購頻率", "Purchase frequency")}</Label>
                <select className="w-full h-10 rounded-md border border-input px-2 text-sm" value={ing.frequency} onChange={(e) => setIng({ ...ing, frequency: e.target.value as Ingredient["frequency"] })}>
                  {Object.entries(FREQ_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select></div>
              <div><Label>{tr("供應商", "Supplier")}</Label>
                <select className="w-full h-10 rounded-md border border-input px-2 text-sm" value={ing.supplier_id ?? ""} onChange={(e) => setIng({ ...ing, supplier_id: e.target.value || null })}>
                  <option value="">—</option>
                  {catalog?.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></div>
              <p className="col-span-2 text-xs text-muted-foreground">{tr("生料用量 = 熟重 × 份數 ÷（熟成率 ×（1 − 損耗率））。例：100 g 熟重、熟成率 0.8、損耗 10% → 生料 139 g。", "Raw = cooked × portions ÷ (yield × (1 − loss)).")}{" "}{ing.name && `${tr("試算", "e.g.")} 100${ing.unit} → ${rawAmount(100, ing).toFixed(0)}${ing.unit}`}</p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIng(null)}>{tr("取消", "Cancel")}</Button>
            <Button disabled={!ing?.name} onClick={() => ing && save("ingredients", ing)}>{tr("儲存", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 半成品 */}
      <Dialog open={!!comp} onOpenChange={(o) => !o && setComp(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{comp?.id ? tr("編輯半成品", "Edit component") : tr("新增半成品", "Add component")}</DialogTitle>
            <DialogDescription>{tr("每份熟重、製程時間、設備與容量、可提前時間，決定每日備料清單與流程時間軸。", "Portion weight, prep time, equipment, batch size and lead time drive the daily prep list and timeline.")}</DialogDescription>
          </DialogHeader>
          {comp && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>{tr("名稱", "Name")}</Label><Input value={comp.name} onChange={(e) => setComp({ ...comp, name: e.target.value })} /></div>
              <div><Label>{tr("每份熟重 (g)", "Portion (g)")}</Label><Input type="number" value={comp.portion_grams} onChange={(e) => setComp({ ...comp, portion_grams: Number(e.target.value) })} /></div>
              <div><Label>{tr("烹調方式", "Method")}</Label>
                <select className="w-full h-10 rounded-md border border-input px-2 text-sm" value={comp.method} onChange={(e) => setComp({ ...comp, method: e.target.value })}>
                  {METHODS.map((m) => <option key={m}>{m}</option>)}
                </select></div>
              <div><Label>{tr("設備", "Equipment")}</Label>
                <select className="w-full h-10 rounded-md border border-input px-2 text-sm" value={comp.equipment} onChange={(e) => setComp({ ...comp, equipment: e.target.value })}>
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
              <div className="col-span-2 space-y-1.5">
                <Label>{tr("原物料（每份熟重）", "Ingredients (cooked per portion)")}</Label>
                {comp.ingredients.map((line, idx) => (
                  <div key={idx} className="flex gap-2">
                    <select className="flex-1 h-9 rounded-md border border-input px-2 text-sm" value={line.ingredient_id} onChange={(e) => setComp({ ...comp, ingredients: comp.ingredients.map((l, j) => (j === idx ? { ...l, ingredient_id: e.target.value } : l)) })}>
                      <option value="">—</option>
                      {catalog?.ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                    </select>
                    <Input className="w-24 h-9" type="number" value={line.grams} onChange={(e) => setComp({ ...comp, ingredients: comp.ingredients.map((l, j) => (j === idx ? { ...l, grams: Number(e.target.value) } : l)) })} />
                    <span className="text-xs self-center w-6">{ingById[line.ingredient_id]?.unit ?? "g"}</span>
                    <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setComp({ ...comp, ingredients: comp.ingredients.filter((_, j) => j !== idx) })}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => setComp({ ...comp, ingredients: [...comp.ingredients, { ingredient_id: "", grams: 0 }] })}><Plus /> {tr("加原物料", "Add ingredient")}</Button>
                <p className="text-xs text-muted-foreground">{tr("每份成本", "Cost per portion")} NT${componentCost({ id: "", ...comp }, ingById).toFixed(1)}</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setComp(null)}>{tr("取消", "Cancel")}</Button>
            <Button disabled={!comp?.name} onClick={() => comp && save("components", { ...comp, ingredients: comp.ingredients.filter((l) => l.ingredient_id) })}>{tr("儲存", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 小盤商 */}
      <Dialog open={!!sup} onOpenChange={(o) => !o && setSup(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{tr("小盤商", "Supplier")}</DialogTitle></DialogHeader>
          {sup && (
            <div className="space-y-2">
              <div><Label>{tr("名稱", "Name")}</Label><Input value={sup.name} onChange={(e) => setSup({ ...sup, name: e.target.value })} /></div>
              <div><Label>{tr("電話", "Phone")}</Label><Input value={sup.phone ?? ""} onChange={(e) => setSup({ ...sup, phone: e.target.value })} /></div>
              <div><Label>LINE ID</Label><Input value={sup.line_id ?? ""} onChange={(e) => setSup({ ...sup, line_id: e.target.value })} /></div>
              <div><Label>{tr("備註", "Note")}</Label><Input value={sup.note ?? ""} onChange={(e) => setSup({ ...sup, note: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSup(null)}>{tr("取消", "Cancel")}</Button>
            <Button disabled={!sup?.name} onClick={() => sup && save("suppliers", sup)}>{tr("儲存", "Save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 定式模板 */}
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("定式菜單模板", "Menu templates")}</DialogTitle>
            <DialogDescription>{tr("每個模板內含配菜格結構、預設配方、製程資料、每格 3 道候選菜建議。套用後品項先下架，確認價格再上架。", "Each template has slot structure, default recipes, prep data and 3 candidate suggestions per slot. Items start unlisted.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {templates.length === 0 && <p className="text-sm text-muted-foreground">{tr("平台還沒建立模板。", "No templates yet.")}</p>}
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="flex-1"><p className="font-medium">{t.name}</p><p className="text-xs text-muted-foreground">{t.structure}</p></div>
                <Button size="sm" onClick={() => applyTemplate(t)}>{tr("套用", "Apply")}</Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </VendorPortalLayout>
  );
}

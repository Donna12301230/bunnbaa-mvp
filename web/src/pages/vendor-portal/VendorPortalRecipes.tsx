import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDoc, collection, deleteDoc, doc, getDocs, writeBatch } from "firebase/firestore";
import { AlertTriangle, BookOpen, Plus, Sparkles, Trash2, Pencil, Wand2 } from "lucide-react";
import { useLocation } from "wouter";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import MenuPrepProgress from "@/components/MenuPrepProgress";
import { ComponentDialog, EMPTY_COMP, EMPTY_ING, FREQ_LABEL, IngredientDialog, saveCatalogDoc, type ComponentDraft, type IngredientDraft } from "@/components/CatalogEditors";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, Tag } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { useVendorMenu } from "@/hooks/useVendorMenu";
import { queryClient } from "@/lib/queryClient";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { componentCost } from "@/lib/bento";
import { componentUsage, costIssue, costIssueText, ingredientIssues } from "@/lib/prep";
import { setPendingEdit, takePendingEdit } from "@/lib/pendingEdit";
import { tr } from "@/lib/i18n";
import type { Component, Ingredient, Supplier } from "@/types";

// 配方三層（規格 §3）：品項（菜單管理）→ 半成品 → 原物料。
// 配方同時產生備料數量、成本、份量級距與口味標籤；數量一律由程式計算，Gemini 只給草稿。
// 每個半成品顯示「用在哪些菜」，原物料標出會讓成本／叫貨算錯的缺漏（未填單價、未選供應商、沒有配方用到）。

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
  const [, navigate] = useLocation();
  const { data: vendor } = useMyVendor();
  const vendorId = vendor?.id;
  const { data: catalog, isLoading } = useVendorCatalog(vendorId);
  const { data: menuItems = [] } = useVendorMenu(vendorId);
  const [ing, setIng] = useState<IngredientDraft | null>(null);
  const [comp, setComp] = useState<ComponentDraft | null>(null);
  const [sup, setSup] = useState<(Omit<Supplier, "id"> & { id?: string }) | null>(null);
  const [draftName, setDraftName] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [tab, setTab] = useState("components");
  const [onlyIssues, setOnlyIssues] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await getDocs(collection(db, "templates"))).docs.map((d) => ({ id: d.id, ...d.data() }) as TemplateDoc),
    enabled: templateOpen,
  });

  const ingById = catalog?.ingredientsById ?? {};
  const compById = catalog?.componentsById ?? {};
  const usage = useMemo(() => componentUsage(menuItems), [menuItems]);
  const usedIngredientIds = useMemo(() => new Set((catalog?.components ?? []).flatMap((c) => c.ingredients.map((l) => l.ingredient_id))), [catalog]);
  const compIssues = (c: Component) => {
    const out: string[] = [];
    const issue = costIssue(c.id, compById, ingById);
    if (issue) out.push(costIssueText(issue));
    if (!usage.get(c.id)?.length) out.push(tr("沒有菜用到", "Not on the menu"));
    return out;
  };
  const compIssueCount = (catalog?.components ?? []).filter((c) => costIssue(c.id, compById, ingById)).length;
  const ingIssueCount = (catalog?.ingredients ?? []).filter((i) => ingredientIssues(i, usedIngredientIds).length > 0).length;

  // 從菜單或進度條跳過來：直接打開那一筆
  useEffect(() => {
    if (!catalog) return;
    const compId = takePendingEdit("component");
    if (compId && compById[compId]) {
      setTab("components");
      setComp(compById[compId]);
    }
    const ingId = takePendingEdit("ingredient");
    if (ingId && ingById[ingId]) {
      setTab("ingredients");
      setIng(ingById[ingId]);
    }
  }, [catalog]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["vendorCatalog", vendorId] });
    queryClient.invalidateQueries({ queryKey: ["vendorMenu", vendorId] });
  };

  async function remove(kind: "ingredients" | "components" | "suppliers", id: string, name: string) {
    let description: string | undefined;
    if (kind === "components") {
      const users = usage.get(id) ?? [];
      if (users.length) description = tr(`有 ${users.length} 道菜用到（${users.map((u) => u.name).join("、")}），刪除後這些菜的備料、叫貨會少算這一項。`, `${users.length} item(s) use this; their prep and purchasing will miss it.`);
    }
    if (kind === "ingredients") {
      const users = (catalog?.components ?? []).filter((c) => c.ingredients.some((l) => l.ingredient_id === id));
      if (users.length) description = tr(`有 ${users.length} 個半成品用到（${users.map((u) => u.name).join("、")}），刪除後這些配方的成本、叫貨會少算。`, `${users.length} component(s) use this.`);
    }
    if (!vendorId || !(await confirm({ title: tr(`刪除「${name}」？`, `Delete ${name}?`), description, confirmLabel: tr("刪除", "Delete"), destructive: true }))) return;
    await deleteDoc(doc(db, "vendors", vendorId, kind, id));
    refresh();
  }

  function openMenuItem(itemId: string) {
    setPendingEdit("menu_item", itemId);
    navigate("/vendor-portal/menu");
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

  const issueTags = (tags: string[]) => tags.map((t) => (
    <span key={t} className="inline-flex items-center gap-0.5 rounded bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[11px] font-medium"><AlertTriangle className="w-3 h-3" />{t}</span>
  ));
  const components = (catalog?.components ?? []).filter((c) => !onlyIssues || compIssues(c).length > 0);
  const ingredients = (catalog?.ingredients ?? []).filter((i) => !onlyIssues || ingredientIssues(i, usedIngredientIds).length > 0);

  return (
    <VendorPortalLayout>
      <MenuPrepProgress />
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h1 className="font-heading text-3xl md:text-4xl font-semibold flex items-center gap-2"><BookOpen className="w-5 h-5 text-orange-500" /> {tr("配方與原物料", "Recipes & ingredients")}</h1>
        <Button variant="outline" onClick={() => setTemplateOpen(true)}><Wand2 /> {tr("從定式模板開店", "Start from a template")}</Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{tr("原物料 → 半成品 → 菜單品項。配方算出每日備料、叫貨量、成本與候選菜份量級距；標 ⚠ 的會讓成本或叫貨算錯，請補齊。", "Ingredients → components → menu items. Recipes drive prep counts, purchasing, cost and portion levels; fix anything marked ⚠.")}</p>

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
        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <TabsList className="max-w-full justify-start overflow-x-auto">
              <TabsTrigger value="components">{tr("半成品", "Components")}（{catalog?.components.length ?? 0}{compIssueCount ? `・⚠${compIssueCount}` : ""}）</TabsTrigger>
              <TabsTrigger value="ingredients">{tr("原物料", "Ingredients")}（{catalog?.ingredients.length ?? 0}{ingIssueCount ? `・⚠${ingIssueCount}` : ""}）</TabsTrigger>
              <TabsTrigger value="suppliers">{tr("小盤商", "Suppliers")}（{catalog?.suppliers.length ?? 0}）</TabsTrigger>
            </TabsList>
            {tab !== "suppliers" && (
              <div className="flex gap-1.5">
                <Tag selected={!onlyIssues} onClick={() => setOnlyIssues(false)}>{tr("全部", "All")}</Tag>
                <Tag selected={onlyIssues} onClick={() => setOnlyIssues(true)}>{tr("只看待補", "Needs attention")}</Tag>
              </div>
            )}
          </div>

          <TabsContent value="components" className="space-y-2">
            <Button size="sm" onClick={() => setComp({ ...EMPTY_COMP })}><Plus /> {tr("新增半成品", "Add component")}</Button>
            {catalog?.components.length === 0 && <EmptyState size="compact" icon={<BookOpen size={32} />} title={tr("還沒有半成品", "No components yet")} description={tr("白飯、滷雞腿、炒高麗菜…可以直接裝盒的成品。也可以在菜單管理編輯品項時直接建立。", "Rice, braised chicken, stir-fried cabbage… You can also create them while editing a menu item.")} />}
            {components.map((c) => {
              const users = usage.get(c.id) ?? [];
              return (
                <Card key={c.id}>
                  <CardContent className="p-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <p className="font-medium flex flex-wrap items-center gap-1.5">{c.name} <span className="text-xs text-muted-foreground font-normal">{c.method}・{c.equipment}・{c.portion_grams} g／份</span>{issueTags(compIssues(c))}</p>
                      <p className="text-xs text-muted-foreground">
                        {c.ingredients.map((l) => `${ingById[l.ingredient_id]?.name ?? "?"} ${l.grams}${ingById[l.ingredient_id]?.unit ?? "g"}`).join("、") || tr("尚未設定原物料", "No ingredients yet")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {tr(`每批 ${c.batch_capacity} 份、${c.prep_minutes} 分鐘`, `${c.batch_capacity}/batch, ${c.prep_minutes} min`)}{c.advance_hours ? tr(`、可提前 ${c.advance_hours} 小時`, `, ${c.advance_hours} h ahead`) : ""}
                        ・{tr("每份成本", "Cost")} NT${componentCost(c, ingById).toFixed(1)}
                      </p>
                      {users.length > 0 && (
                        <p className="text-xs flex flex-wrap items-center gap-1">
                          <span className="text-muted-foreground">{tr("用在：", "Used in: ")}</span>
                          {users.map((u) => <button key={u.id} type="button" className="rounded border border-border bg-orange-50 px-1.5 hover:bg-orange-100" onClick={() => openMenuItem(u.id)}>{u.name}</button>)}
                        </p>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="w-8 h-8" aria-label={tr("編輯", "Edit")} onClick={() => setComp(c)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="w-8 h-8 text-red-500" aria-label={tr("刪除", "Delete")} onClick={() => remove("components", c.id, c.name)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="ingredients" className="space-y-2">
            <Button size="sm" onClick={() => setIng({ ...EMPTY_ING })}><Plus /> {tr("新增原物料", "Add ingredient")}</Button>
            {ingredients.map((i) => {
              const users = (catalog?.components ?? []).filter((c) => c.ingredients.some((l) => l.ingredient_id === i.id));
              return (
                <Card key={i.id}>
                  <CardContent className="p-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <p className="font-medium flex flex-wrap items-center gap-1.5">{i.name} <span className="text-xs text-muted-foreground font-normal">{i.category}・{FREQ_LABEL[i.frequency] ?? i.frequency}</span>{issueTags(ingredientIssues(i, usedIngredientIds).map((x) => x.text))}</p>
                      <p className="text-xs text-muted-foreground">
                        {tr(`熟成率 ${i.yield_rate}、損耗 ${Math.round(i.loss_rate * 100)}%、保存 ${i.shelf_days} 天`, `Yield ${i.yield_rate}, loss ${Math.round(i.loss_rate * 100)}%, keeps ${i.shelf_days} d`)}
                        ・NT${i.unit_price}／{i.purchase_unit_label}（{i.purchase_unit_size}{i.unit}）
                        {i.supplier_id && `・${catalog?.suppliers.find((s) => s.id === i.supplier_id)?.name ?? ""}`}
                      </p>
                      {users.length > 0 && (
                        <p className="text-xs flex flex-wrap items-center gap-1">
                          <span className="text-muted-foreground">{tr("用在：", "Used in: ")}</span>
                          {users.map((u) => <button key={u.id} type="button" className="rounded border border-border bg-orange-50 px-1.5 hover:bg-orange-100" onClick={() => { setTab("components"); setComp(u); }}>{u.name}</button>)}
                        </p>
                      )}
                    </div>
                    <Button variant="ghost" size="icon" className="w-8 h-8" aria-label={tr("編輯", "Edit")} onClick={() => setIng(i)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="w-8 h-8 text-red-500" aria-label={tr("刪除", "Delete")} onClick={() => remove("ingredients", i.id, i.name)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </CardContent>
                </Card>
              );
            })}
            <p className="text-xs text-muted-foreground">{tr("單價請在每次進貨時更新；菜價暴漲時更新後，未截單日期的份量級距會自動重算。", "Update prices on each delivery; after a price spike, portion levels for future dates are recalculated.")}</p>
          </TabsContent>

          <TabsContent value="suppliers" className="space-y-2">
            <Button size="sm" onClick={() => setSup({ name: "", phone: "", line_id: "", note: "" })}><Plus /> {tr("新增小盤商", "Add supplier")}</Button>
            {catalog?.suppliers.map((s) => {
              const count = (catalog?.ingredients ?? []).filter((i) => i.supplier_id === s.id).length;
              return (
                <Card key={s.id}>
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="flex-1"><p className="font-medium">{s.name} <span className="text-xs text-muted-foreground font-normal">{tr(`供應 ${count} 項原物料`, `${count} ingredients`)}</span></p><p className="text-xs text-muted-foreground">{s.phone} {s.line_id && `LINE: ${s.line_id}`} {s.note}</p></div>
                    <Button variant="ghost" size="icon" className="w-8 h-8" aria-label={tr("編輯", "Edit")} onClick={() => setSup(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="w-8 h-8 text-red-500" aria-label={tr("刪除", "Delete")} onClick={() => remove("suppliers", s.id, s.name)}><Trash2 className="w-3.5 h-3.5" /></Button>
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>
        </Tabs>
      )}

      <IngredientDialog vendorId={vendorId} value={ing} onClose={() => setIng(null)} />
      <ComponentDialog vendorId={vendorId} value={comp} onClose={() => setComp(null)} />

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
            <Button
              disabled={!sup?.name}
              onClick={async () => {
                if (!vendorId || !sup) return;
                try {
                  await saveCatalogDoc(vendorId, "suppliers", sup);
                  setSup(null);
                  toast({ title: tr("已儲存", "Saved") });
                } catch (err) {
                  toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
                }
              }}
            >{tr("儲存", "Save")}</Button>
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

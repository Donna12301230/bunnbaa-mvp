import { useEffect, useMemo, useState } from "react";
import { selectClass } from "@/lib/fieldStyles";
import { useQuery } from "@tanstack/react-query";
import { addDoc, collection, deleteDoc, doc, getDocs, writeBatch } from "firebase/firestore";
import { AlertTriangle, BookOpen, Carrot, Clock, Flame, MessageCircle, Pencil, Phone, Plus, Soup, Sparkles, Store, Trash2, UtensilsCrossed, Wand2 } from "lucide-react";
import { useLocation } from "wouter";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import InfoTip from "@/components/InfoTip";
import { ComponentDialog, EMPTY_COMP, EMPTY_ING, IngredientDialog, catalogLabel, recalcPortionLevelsAfterPrice, saveCatalogDoc, type ComponentDraft, type IngredientDraft } from "@/components/CatalogEditors";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, Tag } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import PortalPageHeader from "@/components/PortalPageHeader";
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
import { loc, tr } from "@/lib/i18n";
import { paren } from "@/lib/format";
import { cn } from "@/lib/utils";
import { componentGroup, GROUP_CELL, GROUP_DOT, groupLabel, ingredientGroup, type FoodGroup } from "@/lib/foodColors";
import type { Component, Ingredient, Supplier } from "@/types";

// Three recipe tiers: item (menu management) → semi-finished component → ingredient.
// Recipes drive prep quantities, cost, portion tiers and flavor tags; quantities are always computed by code, Gemini only drafts.
// Each component shows "used in which dishes"; ingredients flag gaps that would skew cost / purchasing (no unit price, no supplier, not used by any recipe).

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
  const [tab, setTab] = useState("ingredients");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [priceEdit, setPriceEdit] = useState<{ id: string; value: string } | null>(null);

  const { data: templates = [], isLoading: loadingTemplates } = useQuery({
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

  // Arrived from the menu or the progress bar: open that entry directly
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

  /** Gemini recipe draft: creates components + ingredients, reusing existing ingredients with the same name; the vendor then edits numbers in the dialog */
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

  /** Set up the shop from a preset template: copies ingredients, components and items (including side-dish cells and candidate dish suggestions) */
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
          is_available: false, // The vendor lists items after confirming prices
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

  const components = (catalog?.components ?? []).filter((c) => !onlyIssues || compIssues(c).length > 0);
  const ingredients = (catalog?.ingredients ?? []).filter((i) => !onlyIssues || ingredientIssues(i, usedIngredientIds).some((x) => x.code !== "unused"));
  const suppliers = catalog?.suppliers ?? [];
  const supplierName = (id: string | null | undefined) => suppliers.find((s) => s.id === id)?.name;
  const noPrice = (catalog?.ingredients ?? []).filter((i) => !(i.unit_price > 0));
  const noSupplier = (catalog?.ingredients ?? []).filter((i) => !i.supplier_id);
  const groups = (["rice", "protein", "veg", "pack", "other"] as FoodGroup[])
    .map((g) => ({ g, items: ingredients.filter((i) => ingredientGroup(i.category) === g) }))
    .filter((x) => x.items.length > 0);

  /** Unit price and supplier are edited right on the card (the two most-edited fields), no dialog needed */
  async function quickSave(i: Ingredient, patch: Partial<Ingredient>) {
    if (!vendorId) return;
    try {
      await saveCatalogDoc(vendorId, "ingredients", { ...i, ...patch });
      toast({ title: tr(`已更新 ${i.name}`, `Updated ${loc(i, "name")}`) });
      // Editing the unit price by clicking the price also recomputes candidate-dish portion tiers, same as the edit dialog
      if (patch.unit_price !== undefined && patch.unit_price !== i.unit_price) void recalcPortionLevelsAfterPrice(vendorId);
    } catch (err) {
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
    }
  }
  function commitPrice() {
    if (!priceEdit) return;
    const i = ingById[priceEdit.id];
    const n = Number(priceEdit.value);
    setPriceEdit(null);
    if (i && Number.isFinite(n) && n >= 0 && n !== i.unit_price) void quickSave(i, { unit_price: n });
  }

  const tabs = [
    { key: "ingredients", icon: Carrot, label: tr("食材", "Ingredients"), n: catalog?.ingredients.length ?? 0, warn: ingIssueCount },
    { key: "suppliers", icon: Store, label: tr("供應商", "Suppliers"), n: suppliers.length, warn: noSupplier.length },
    { key: "components", icon: Soup, label: tr("配菜", "Dishes"), n: catalog?.components.length ?? 0, warn: compIssueCount },
  ];

  return (
    <VendorPortalLayout>
      <PortalPageHeader
        icon={BookOpen}
        title={<>
          {tr("食材與供應商", "Ingredients & suppliers")}
          <InfoTip>{tr("這裡管單價、供應商與熟成率；每道菜用什麼，直接在菜單管理點便當格子改。點價格就能直接改，進貨時順手更新。", "Prices, suppliers and yields live here; dish contents are edited from bento cells in Menu. Tap a price to change it.")}</InfoTip>
        </>}
        actions={<Button variant="outline" onClick={() => setTemplateOpen(true)}><Wand2 /> {tr("從定式模板開店", "Start from a template")}</Button>}
      />

      {isLoading ? <SkeletonBlocks count={3} height={64} className="space-y-2" /> : (
        <div className="space-y-4">
          {/* Main tabs: icon + count + warning count */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn("relative rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === t.key ? "border-foreground bg-card shadow-sm" : "border-border bg-card/60 hover:bg-card")}
              >
                <t.icon className="w-5 h-5 text-accent-foreground" />
                <p className="mt-1 text-sm text-muted-foreground">{t.label}</p>
                <p className="text-2xl font-bold leading-none">{t.n}</p>
                {t.warn > 0 && <span className="absolute top-2 right-2 inline-flex items-center gap-0.5 rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning-text"><AlertTriangle className="w-3 h-3" />{t.warn}</span>}
              </button>
            ))}
          </div>

          {/* To fix: one icon, one word; tap to fix directly */}
          {tab === "ingredients" && (noPrice.length > 0 || noSupplier.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {noPrice.map((i) => (
                <button key={`p${i.id}`} type="button" className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-3 py-1 text-sm font-medium text-danger-text hover:bg-danger/25" onClick={() => setPriceEdit({ id: i.id, value: "" })}>
                  <AlertTriangle className="w-3.5 h-3.5" />{tr(`${i.name}：缺單價`, `${loc(i, "name")}: no price`)}
                </button>
              ))}
              {noSupplier.filter((i) => i.unit_price > 0).map((i) => (
                <button key={`s${i.id}`} type="button" className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-3 py-1 text-sm font-medium text-warning-text hover:bg-warning/30" onClick={() => setTab("suppliers")}>
                  <Store className="w-3.5 h-3.5" />{tr(`${i.name}：沒供應商`, `${loc(i, "name")}: no supplier`)}
                </button>
              ))}
            </div>
          )}

          {tab !== "suppliers" && (
            <div className="flex flex-wrap items-center gap-2">
              <Tag selected={!onlyIssues} onClick={() => setOnlyIssues(false)}>{tr("全部", "All")}</Tag>
              <Tag selected={onlyIssues} onClick={() => setOnlyIssues(true)}>{tr("只看待補", "Needs attention")}</Tag>
              <Button size="sm" className="ml-auto" onClick={() => (tab === "ingredients" ? setIng({ ...EMPTY_ING }) : setComp({ ...EMPTY_COMP }))}><Plus /> {tab === "ingredients" ? tr("新增食材", "Add ingredient") : tr("新增配菜", "Add dish")}</Button>
            </div>
          )}

          {/* Ingredients: grouped by category color block, one card each; tap the price to edit */}
          {tab === "ingredients" && (
            <div className="space-y-5">
              {catalog?.ingredients.length === 0 && <EmptyState size="compact" icon={<Carrot size={32} />} title={tr("還沒有食材", "No ingredients yet")} description={tr("在菜單管理按「AI 幫我填」，會自動建好用到的食材。", "Use “Let AI fill it” in Menu and ingredients are created for you.")} />}
              {groups.map(({ g, items }) => (
                <section key={g} className="space-y-2">
                  <h2 className="flex items-center gap-2 font-semibold"><span className={cn("w-3 h-3 rounded-sm", GROUP_DOT[g])} />{groupLabel(g)}<span className="text-sm font-normal text-muted-foreground">{items.length}</span></h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {items.map((i) => {
                      const issues = ingredientIssues(i, usedIngredientIds);
                      const priced = i.unit_price > 0;
                      const editing = priceEdit?.id === i.id;
                      const users = (catalog?.components ?? []).filter((c) => c.ingredients.some((l) => l.ingredient_id === i.id));
                      const weight = ["g", "ml", "克", "毫升"].includes(i.unit);
                      return (
                        <Card key={i.id} className={cn("overflow-hidden border-2", !priced && "border-danger/40")}>
                          <div className={cn("h-1.5", GROUP_DOT[g])} />
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-start gap-2">
                              <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setIng(i)}>
                                <p className="text-lg font-semibold leading-tight hover:underline">{loc(i, "name")}</p>
                                <p className="text-xs text-muted-foreground">{catalogLabel(i.category)}{i.frequency === "monthly" ? tr("・久放", " · long-life") : ""}</p>
                              </button>
                              <Button variant="ghost" size="icon" className="w-8 h-8 -mr-1 text-muted-foreground" aria-label={tr(`刪除 ${i.name}`, `Delete ${loc(i, "name")}`)} onClick={() => remove("ingredients", i.id, loc(i, "name"))}><Trash2 className="w-3.5 h-3.5" /></Button>
                            </div>

                            {/* Price: edited most often, large text, tap to edit */}
                            {editing ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm">NT$</span>
                                <Input autoFocus type="number" min={0} className="h-10 w-24 text-lg font-bold" value={priceEdit!.value} onChange={(e) => setPriceEdit({ id: i.id, value: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") commitPrice(); if (e.key === "Escape") setPriceEdit(null); }} onBlur={commitPrice} aria-label={tr(`${i.name} 每${i.purchase_unit_label}單價`, "Price")} />
                                <span className="text-sm text-muted-foreground">/ {i.purchase_unit_label}</span>
                              </div>
                            ) : (
                              <button type="button" onClick={() => setPriceEdit({ id: i.id, value: priced ? String(i.unit_price) : "" })} className={cn("w-full flex items-baseline gap-1 rounded-lg px-2 py-1 -mx-2 text-left hover:bg-accent", !priced && "text-danger-text")} aria-label={tr(`改 ${i.name} 的單價`, `Edit price of ${loc(i, "name")}`)}>
                                {priced ? (
                                  <>
                                    <span className="text-2xl font-bold">NT${i.unit_price}</span>
                                    <span className="text-sm text-muted-foreground">/ {i.purchase_unit_label}{i.purchase_unit_size !== 1 ? paren(`${i.purchase_unit_size}${i.unit}`) : ""}</span>
                                    <Pencil className="ml-auto w-3.5 h-3.5 text-muted-foreground self-center" />
                                  </>
                                ) : <span className="text-base font-semibold flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{tr("點我填單價", "Tap to add price")}</span>}
                              </button>
                            )}

                            {/* Small icons: supplier, raw-to-cooked ratio, shelf life */}
                            <div className="flex flex-wrap gap-1.5 text-xs">
                              <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5", i.supplier_id ? "bg-muted" : "bg-warning-soft text-warning-text")}>
                                <Store className="w-3 h-3" />{supplierName(i.supplier_id) ?? tr("沒供應商", "No supplier")}
                              </span>
                              {weight && i.yield_rate !== 1 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5" title={tr("熟重 ÷ 生重", "cooked ÷ raw")}>
                                  <Flame className="w-3 h-3" />{tr(`生→熟 ×${i.yield_rate}`, `raw→cooked ×${i.yield_rate}`)}
                                </span>
                              )}
                              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5"><Clock className="w-3 h-3" />{tr(`放 ${i.shelf_days} 天`, `${i.shelf_days} d`)}</span>
                            </div>

                            {users.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {users.map((u) => <button key={u.id} type="button" className={cn("rounded-md border px-1.5 py-0.5 text-xs", GROUP_CELL[componentGroup(u, ingById)])} onClick={() => { setTab("components"); setComp(u); }}>{loc(u, "name")}</button>)}
                              </div>
                            ) : issues.some((x) => x.code === "unused") && <p className="text-xs text-muted-foreground">{tr("還沒有配菜用到", "Not used yet")}</p>}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* Suppliers: one card each, tap to call or LINE; below are the ingredients bought from them */}
          {tab === "suppliers" && (
            <div className="space-y-3">
              {noSupplier.length > 0 && suppliers.length > 0 && (
                <Card className="border-2 border-warning/50 bg-warning-soft/60">
                  <CardContent className="p-3 space-y-2">
                    <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="w-4 h-4 text-accent-foreground" />{tr(`${noSupplier.length} 樣食材還沒指定跟誰買`, `${noSupplier.length} ingredient(s) have no supplier`)}</p>
                    <div className="flex flex-wrap gap-2">
                      {noSupplier.map((i) => (
                        <label key={i.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card pl-3 pr-1 py-1 text-sm">
                          <span className={cn("w-2.5 h-2.5 rounded-sm", GROUP_DOT[ingredientGroup(i.category)])} />{loc(i, "name")}
                          <select className={selectClass("sm", "rounded-full px-2")} value="" onChange={(e) => e.target.value && quickSave(i, { supplier_id: e.target.value })} aria-label={tr(`${i.name} 的供應商`, `Supplier for ${loc(i, "name")}`)}>
                            <option value="">{tr("選供應商…", "Pick…")}</option>
                            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {suppliers.map((s) => {
                  const mine = (catalog?.ingredients ?? []).filter((i) => i.supplier_id === s.id);
                  return (
                    <Card key={s.id} className="border-2">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <span className="w-12 h-12 shrink-0 rounded-full bg-secondary text-accent-foreground flex items-center justify-center text-xl font-bold" aria-hidden="true">{s.name.slice(0, 1)}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-lg font-semibold leading-tight truncate">{s.name}</p>
                            <p className="text-xs text-muted-foreground">{tr(`${mine.length} 樣食材`, `${mine.length} ingredients`)}{s.note ? `・${s.note}` : ""}</p>
                          </div>
                          <Button variant="ghost" size="icon" className="w-8 h-8" aria-label={tr(`編輯 ${s.name}`, `Edit ${s.name}`)} onClick={() => setSup(s)}><Pencil className="w-3.5 h-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground" aria-label={tr(`刪除 ${s.name}`, `Delete ${s.name}`)} onClick={() => remove("suppliers", s.id, s.name)}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {s.phone ? <Button size="sm" variant="outline" asChild><a href={`tel:${s.phone}`}><Phone /> {s.phone}</a></Button> : null}
                          {s.line_id ? <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-3 py-1 text-sm text-success-text"><MessageCircle className="w-3.5 h-3.5" />LINE {s.line_id}</span> : null}
                          {!s.phone && !s.line_id && <button type="button" className="text-xs text-primary underline" onClick={() => setSup(s)}>{tr("＋ 加電話或 LINE", "+ Add phone or LINE")}</button>}
                        </div>
                        {mine.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-2 border-t">
                            {mine.map((i) => (
                              <button key={i.id} type="button" onClick={() => { setTab("ingredients"); setIng(i); }} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-sm hover:bg-border">
                                <span className={cn("w-2.5 h-2.5 rounded-sm", GROUP_DOT[ingredientGroup(i.category)])} />{loc(i, "name")}
                                <span className={cn("text-xs", i.unit_price > 0 ? "text-muted-foreground" : "text-danger-text font-semibold")}>{i.unit_price > 0 ? `$${i.unit_price}` : tr("缺價", "no price")}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
                <button type="button" onClick={() => setSup({ name: "", phone: "", line_id: "", note: "" })} className="min-h-[9rem] rounded-xl border-2 border-dashed border-input flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-card hover:text-foreground">
                  <Plus className="w-6 h-6" />{tr("新增供應商", "Add supplier")}
                </button>
              </div>
            </div>
          )}

          {/* Dishes: same colors as the bento cells; cost in large text, ingredients listed as color dots */}
          {tab === "components" && (
            <div className="space-y-3">
              <Card>
                <CardContent className="p-3 flex flex-wrap gap-2 items-center">
                  <Sparkles className="w-4 h-4 text-accent-foreground" />
                  <Input className="w-48" value={draftName} onChange={(e) => setDraftName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") draftRecipe(); }} placeholder={tr("打菜名，例：地瓜葉", "Dish name, e.g. greens")} />
                  <Button size="sm" onClick={draftRecipe} disabled={drafting || !draftName.trim()}>{drafting ? tr("產生中…", "Drafting…") : tr("AI 產生配方", "AI draft")}</Button>
                </CardContent>
              </Card>
              {catalog?.components.length === 0 && <EmptyState size="compact" icon={<Soup size={32} />} title={tr("還沒有配菜", "No dishes yet")} description={tr("在菜單管理點便當格子就會建立。", "Created from bento cells in Menu.")} />}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {components.map((c) => {
                  const users = usage.get(c.id) ?? [];
                  const issue = costIssue(c.id, compById, ingById);
                  const cost = componentCost(c, ingById);
                  return (
                    <Card key={c.id} className={cn("overflow-hidden border-2", issue && issue.kind !== "no_price" && "border-dashed")}>
                      <button type="button" onClick={() => setComp(c)} className={cn("w-full border-b-2 px-3 py-3 text-left", issue && issue.kind !== "no_price" ? "bg-card border-dashed border-input" : GROUP_CELL[componentGroup(c, ingById)])}>
                        <span className="flex items-start gap-2">
                          <span className="flex-1 text-lg font-semibold leading-tight">{loc(c, "name")}</span>
                          {c.ai_draft && <span className="inline-flex items-center gap-0.5 rounded-full bg-card/80 px-2 py-0.5 text-[11px] font-semibold text-accent-foreground"><Sparkles className="w-3 h-3" />{tr("AI 草稿", "AI draft")}</span>}
                        </span>
                        <span className="block text-sm opacity-80">{c.portion_grams}g・{c.method && catalogLabel(c.method)}</span>
                      </button>
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-baseline gap-2">
                          {issue ? (
                            <span className="inline-flex items-center gap-1 text-sm font-semibold text-warning-text"><AlertTriangle className="w-4 h-4" />{costIssueText(issue)}</span>
                          ) : (
                            <><span className="text-2xl font-bold">NT${cost.toFixed(1)}</span><span className="text-sm text-muted-foreground">{tr("/ 份", "/ portion")}</span></>
                          )}
                          <Button variant="ghost" size="icon" className="ml-auto w-8 h-8 text-muted-foreground" aria-label={tr(`刪除 ${c.name}`, `Delete ${loc(c, "name")}`)} onClick={() => remove("components", c.id, loc(c, "name"))}><Trash2 className="w-3.5 h-3.5" /></Button>
                        </div>
                        {c.ingredients.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {c.ingredients.map((l, k) => {
                              const ing = ingById[l.ingredient_id];
                              return (
                                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                                  <span className={cn("w-2 h-2 rounded-sm", GROUP_DOT[ingredientGroup(ing?.category)])} />{ing ? loc(ing, "name") : "?"} {Math.round(l.grams * 10) / 10}{ing?.unit ?? "g"}
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {users.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-1 text-xs pt-1 border-t">
                            <UtensilsCrossed className="w-3.5 h-3.5 text-muted-foreground" aria-label={tr("用在", "Used in")} />
                            {users.map((u) => <button key={u.id} type="button" className="rounded-md bg-accent px-1.5 py-0.5 hover:bg-secondary" onClick={() => openMenuItem(u.id)}>{loc(u, "name")}</button>)}
                          </div>
                        ) : <p className="text-xs text-muted-foreground pt-1 border-t">{tr("還沒放進菜單", "Not on the menu")}</p>}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <IngredientDialog vendorId={vendorId} value={ing} onClose={() => setIng(null)} />
      <ComponentDialog vendorId={vendorId} value={comp} onClose={() => setComp(null)} />

      {/* Small suppliers */}
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

      {/* Preset templates */}
      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("定式菜單模板", "Menu templates")}</DialogTitle>
            <DialogDescription>{tr("每個模板內含配菜格結構、預設配方、製程資料、每格 3 道候選菜建議。套用後品項先下架，確認價格再上架。", "Each template has slot structure, default recipes, prep data and 3 candidate suggestions per slot. Items start unlisted.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {loadingTemplates && <SkeletonBlocks count={2} height={56} className="space-y-2" />}
            {!loadingTemplates && templates.length === 0 && <p className="text-sm text-muted-foreground">{tr("平台還沒建立模板。", "No templates yet.")}</p>}
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

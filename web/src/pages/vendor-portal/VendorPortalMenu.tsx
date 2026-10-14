import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDocs, query, updateDoc, where,
} from "firebase/firestore";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Camera, FolderTree, Plus, Pencil, Sparkles, Trash2, UtensilsCrossed, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { queryClient } from "@/lib/queryClient";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { imageToBase64 } from "@/lib/imageData";
import { myVendorDocKey, useMyVendor } from "@/hooks/useMyVendor";
import MenuCatalogManager from "@/components/MenuCatalogManager";
import { catalogOrder, groupByCatalog } from "@/lib/menuCatalog";
import { usePlatformConfig } from "@/lib/platformConfig";
import { netOfCommission, withCommission } from "@/lib/pricing";
import type { MenuItem } from "@/types";
import { ALLERGEN_LIST, DIETARY_TAGS, tagEn } from "@/types";
import { loc, tr } from "@/lib/i18n";
import { ImageUploadField } from "@/components/ImageUploadField";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState, Switch, Tag } from "@/components/ds";
import BentoEditor, { EMPTY_BENTO, portionTextFor, type BentoForm } from "@/components/BentoEditor";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { useVendorMenu } from "@/hooks/useVendorMenu";
import BentoBox, { itemCells, MarginBar } from "@/components/BentoBox";
import InfoTip from "@/components/InfoTip";
import PortalPageHeader from "@/components/PortalPageHeader";
import { fillingText, useRecipeGaps } from "@/components/RecipeGapCard";
import { recipeTargets } from "@/lib/aiFill";
import { GROUP_DOT, groupLabel, type FoodGroup } from "@/lib/foodColors";
import { addDaysStr, bookableDateRange, mondayOf, todayStr } from "@/lib/pickupSlots";
import { componentPortionsForLock, costIssueText, itemIssues, portionsCost } from "@/lib/prep";
import { takePendingEdit } from "@/lib/pendingEdit";
import { PENDING_STATUSES } from "@/lib/lockOutcome";
import type { Lock } from "@/types";
import { Link } from "wouter";

// Draft returned by photo listing (functions/src/menuVision.js); only written to menu_items after the vendor owner presses "Fill in form" to confirm
interface MenuDraft {
  name: string;
  name_en: string;
  price: number | null;
  category: string;
  dietary_tags: string[];
  allergens: string[];
  description: string;
}

const EMPTY_FORM = { name: "", description: "", price: "", category: "一般", catalog: "", isAvailable: true, image: "", allergens: [] as string[], dietaryTags: [] as string[], nameEn: "", descriptionEn: "" };

// English name / description: Functions translate them automatically (translateMenuItem), and vendors can also edit them by hand.
// A manually edited field sets i18n_src to the current Chinese, so the trigger treats it as "already translated" and won't overwrite it;
// clearing it = hand it back to auto translation (deletes the English and i18n_src, and the trigger re-translates);
// leaving the English alone and changing only the Chinese = the trigger re-translates automatically as usual.
function englishOverrides(
  form: { name: string; description: string; nameEn: string; descriptionEn: string },
  original: MenuItem | null
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, en] of [["name", form.nameEn], ["description", form.descriptionEn]] as const) {
    const before = (original?.[`${field}_en`] as string | undefined) ?? "";
    const value = en.trim();
    if (value === before.trim()) continue;
    if (value) {
      out[`${field}_en`] = value;
      out[`i18n_src.${field}`] = form[field];
    } else if (original) {
      out[`${field}_en`] = deleteField();
      out[`i18n_src.${field}`] = deleteField();
    }
  }
  return out;
}

export default function VendorPortalMenu() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [bento, setBento] = useState<BentoForm>(EMPTY_BENTO);
  const photoInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [drafts, setDrafts] = useState<MenuDraft[]>([]);
  const [draftNote, setDraftNote] = useState("");
  const [activeDraft, setActiveDraft] = useState<number | null>(null);
  const [catalogsOpen, setCatalogsOpen] = useState(false);
  // "More settings" in the item form: expanded by default for an AI draft (which carries dietary tags) or when description / English / catalog / dietary tags are already filled
  const [moreOpen, setMoreOpen] = useState(false);
  const { data: platformConfig } = usePlatformConfig();
  const commissionRate = platformConfig?.commissionRate ?? 0.05;
  const commissionPct = Math.round(commissionRate * 1000) / 10;

  // The vendor bound to the signed-in vendor owner (vendors/{id}.owner_uid); write access is enforced by
  // isVendorOwner in firestore.rules, so it isn't checked again here.
  const { data: myVendor } = useMyVendor();
  const VENDOR_ID = myVendor?.id;
  const { data: catalog } = useVendorCatalog(VENDOR_ID);
  // After next week's supplier order is generated on Saturday 12:00, next week's mains are locked and only like-for-like side swaps are allowed (provisional)
  const nextWeekLocked = !!myVendor?.menu_locked_week && myVendor.menu_locked_week >= mondayOf(addDaysStr(todayStr(), 7));

  const { data: items = [], isLoading } = useVendorMenu(VENDOR_ID);
  const gaps = useRecipeGaps();
  const catalogNames = useMemo(() => catalogOrder(myVendor?.menu_catalogs, items), [myVendor?.menu_catalogs, items]);
  /** Items with an AI-generated recipe the vendor hasn't confirmed yet */
  const hasAiDraft = (item: MenuItem) => !!catalog && [item.rice_component_id, item.main?.component_id, ...(item.mains ?? []).map((m) => m.component_id), ...(item.fixed ?? []).map((f) => f.component_id), ...(item.slots ?? []).map((sl) => sl.default?.component_id)]
    .some((id) => !!id && !!catalog.componentsById[id]?.ai_draft);

  // Recipe gaps per item (no recipe linked, recipe has no ingredients, ingredient has no unit price)
  const issuesById = useMemo(() => {
    if (!catalog) return {} as Record<string, ReturnType<typeof itemIssues>>;
    return Object.fromEntries(items.map((i) => [i.id, itemIssues(i, catalog.componentsById, catalog.ingredientsById)]));
  }, [items, catalog]);

  // Shortcut for preview servings: servings already ordered for the next business day (per item)
  const nextDay = bookableDateRange().find((d) => d > todayStr());
  const { data: nextDayCounts } = useQuery({
    queryKey: ["menuNextDayCounts", VENDOR_ID, nextDay],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "locks"), where("vendor_id", "==", VENDOR_ID), where("pickup_date", "==", nextDay)));
      const out: Record<string, number> = {};
      snap.docs.map((d) => d.data() as Lock).filter((l) => PENDING_STATUSES.has(l.status) && l.menu_item_id).forEach((l) => { out[l.menu_item_id!] = (out[l.menu_item_id!] || 0) + 1; });
      return out;
    },
    enabled: !!VENDOR_ID && !!nextDay && dialogOpen,
  });

  // Coming from the recipe page's "Used in:" or the progress bar: open that item directly
  useEffect(() => {
    if (!catalog || items.length === 0) return;
    const id = takePendingEdit("menu_item");
    const item = id ? items.find((i) => i.id === id) : undefined;
    if (item) openEdit(item);
  }, [catalog, items]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!myVendor) throw new Error(tr("這個帳號還沒綁定店家，請聯絡平台", "This account isn't linked to a vendor yet. Please contact the platform"));
      if (bento.mealPeriods.length === 0) throw new Error(tr("請至少勾選一個供應餐期", "Pick at least one meal period"));
      const comps = Object.fromEntries((catalog?.components ?? []).map((c) => [c.id, c]));
      const withPortion = (componentId: string | null | undefined, name: string) =>
        portionTextFor(componentId ? comps[componentId] : undefined, catalog?.ingredientsById ?? {}, name);
      const mains = bento.mains.filter((m) => m.name && m.price > 0).map((m) => ({
        name: m.name, component_id: m.component_id || null, price: m.price, image_url: m.image_url || null, portion_text: withPortion(m.component_id, m.name),
      }));
      if (bento.itemType === "bento" && mains.length === 0) throw new Error(tr("便當至少要有一道有價格的主菜", "A bento needs at least one main with a price"));
      const data = {
        vendor_id: myVendor.id,
        name: form.name,
        description: form.description,
        // When a bento has several mains, price stores the lowest main price (card shows "From $50", legacy code compatibility)
        price: bento.itemType === "bento" && mains.length > 0 ? Math.min(...mains.map((m) => m.price)) : Number(form.price),
        category: form.category,
        catalog: form.catalog.trim() || null,
        is_available: form.isAvailable,
        image: form.image || null, // Firestore SDK throws on `undefined` field values
        allergens: form.allergens,
        dietary_tags: form.dietaryTags,
        // Item structure: type, meal periods served, mains (each priced separately), sides; each dish has a photo and portion text
        item_type: bento.itemType,
        meal_periods: bento.mealPeriods,
        mains: bento.itemType === "bento" ? mains : [],
        main: bento.itemType === "bento" && mains[0] ? { name: mains[0].name, component_id: mains[0].component_id || null, portion_text: mains[0].portion_text } : null,
        rice_component_id: bento.itemType === "bento" ? bento.riceComponentId || null : null,
        slots: bento.itemType === "bento"
          ? bento.slots.filter((sl) => sl.default.name).map((sl) => ({
            ...sl,
            default: { ...sl.default, image_url: sl.default.image_url || null, portion_text: withPortion(sl.default.component_id, sl.default.name) },
            candidates: sl.candidates.filter((c) => c.name).map((c) => ({ ...c, image_url: c.image_url || null, portion_text: withPortion(c.component_id, c.name) })),
          }))
          : [],
        // Custom dropdown fields below the sides: fields without a name and options without a name aren't saved
        custom_fields: bento.itemType === "bento"
          ? bento.customFields
            .map((f) => ({ label: f.label.trim(), options: f.options.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), price: Math.round(Number(o.price) || 0) })) }))
            .filter((f) => f.label && f.options.length > 0)
          : [],
        weekdays: bento.weekdays,
        // Prep components are always stored in fixed (single items too); the old single component_id is cleared so prep isn't double-counted
        fixed: bento.parts.filter((p) => p.component_id).map((p) => {
          const name = p.name || comps[p.component_id!]?.name || "";
          return { name, component_id: p.component_id, portions: p.portions > 0 ? p.portions : 1, portion_text: withPortion(p.component_id, name) };
        }),
        component_id: null,
      };
      const original = editId ? items.find((i) => i.id === editId) ?? null : null;
      const english = englishOverrides(form, original);
      if (editId) {
        await updateDoc(doc(db, "menu_items", editId), { ...data, ...english });
      } else {
        // New item: the dotted-path "i18n_src.name" syntax of updateDoc doesn't work with addDoc, so use a nested object
        const src: Record<string, string> = {};
        const extra: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(english)) {
          if (key.startsWith("i18n_src.")) src[key.slice("i18n_src.".length)] = value as string;
          else extra[key] = value;
        }
        await addDoc(collection(db, "menu_items"), { ...data, ...extra, ...(Object.keys(src).length ? { i18n_src: src } : {}), created_at: new Date() });
      }
      // A new catalog name typed in the form: appended to the end of the vendor's catalog list (order can be changed later under "Catalogs")
      if (data.catalog && !catalogNames.includes(data.catalog)) {
        await updateDoc(doc(db, "vendors", myVendor.id), { menu_catalogs: [...catalogNames, data.catalog] });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendorMenu", VENDOR_ID] });
      queryClient.invalidateQueries({ queryKey: myVendorDocKey(VENDOR_ID) });
      setDialogOpen(false);
      setEditId(null);
      setForm(EMPTY_FORM);
      setBento(EMPTY_BENTO);
      if (activeDraft !== null) {
        setDrafts((list) => list.filter((_, i) => i !== activeDraft));
        setActiveDraft(null);
      }
      toast({ title: editId ? tr("已更新", "Updated") : tr("已新增", "Added"), description: form.name });
    },
    onError: (err: any) => {
      const description = err?.code === "permission-denied"
        ? tr("帳號尚未綁定店家權限，請聯絡管理員", "This account doesn't have vendor access yet. Please contact an admin")
        : err.message;
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, "menu_items", id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendorMenu", VENDOR_ID] });
      toast({ title: tr("已刪除", "Deleted") });
    },
    onError: (err: any) => {
      const description = err?.code === "permission-denied"
        ? tr("帳號尚未綁定店家權限，請聯絡管理員", "This account doesn't have vendor access yet. Please contact an admin")
        : err.message;
      toast({ variant: "destructive", title: tr("刪除失敗", "Couldn't delete"), description });
    },
  });

  async function readMenuPhoto(file: File) {
    if (!VENDOR_ID) return;
    setReading(true);
    try {
      const { base64, mimeType } = await imageToBase64(file);
      const res = await httpsCallable(functions, "extractMenuFromImage")({ vendor_id: VENDOR_ID, image_base64: base64, mime_type: mimeType });
      const data = res.data as { items: MenuDraft[]; note: string };
      setDrafts(data.items);
      setDraftNote(data.note);
      if (data.items.length === 0) {
        toast({ title: tr("照片裡沒有讀到品項", "No items found in the photo"), description: data.note || undefined });
      }
    } catch (err) {
      toast({ variant: "destructive", title: tr("辨識失敗", "Couldn't read the photo"), description: (err as Error).message });
    } finally {
      setReading(false);
      if (photoInput.current) photoInput.current.value = "";
    }
  }

  function openDraft(index: number) {
    const d = drafts[index];
    setEditId(null);
    setActiveDraft(index);
    setForm({
      ...EMPTY_FORM,
      name: d.name,
      description: d.description,
      price: d.price ? String(d.price) : "",
      category: d.category || EMPTY_FORM.category,
      allergens: d.allergens,
      dietaryTags: d.dietary_tags,
      nameEn: d.name_en,
    });
    setBento(EMPTY_BENTO);
    setMoreOpen(true); // An AI draft needs the vendor to confirm dietary tags
    setDialogOpen(true);
  }

  function openAdd() {
    setActiveDraft(null);
    setEditId(null);
    setForm(EMPTY_FORM);
    setBento(EMPTY_BENTO);
    setMoreOpen(false);
    setDialogOpen(true);
  }

  function openEdit(item: MenuItem) {
    setActiveDraft(null);
    setMoreOpen(false);
    setEditId(item.id);
    setForm({ name: item.name, description: item.description, price: String(item.price), category: item.category, catalog: item.catalog ?? "", isAvailable: item.is_available, image: item.image ?? "", allergens: item.allergens ?? [], dietaryTags: item.dietary_tags ?? [], nameEn: item.name_en ?? "", descriptionEn: item.description_en ?? "" });
    const isBentoItem = item.item_type ? item.item_type === "bento" : (item.slots?.length ?? 0) > 0;
    setBento({
      itemType: isBentoItem ? "bento" : "single",
      mealPeriods: item.meal_periods?.length ? item.meal_periods : ["lunch"],
      mains: item.mains?.length ? item.mains : isBentoItem && item.main?.name ? [{ name: item.main.name, component_id: item.main.component_id ?? null, price: item.price, image_url: item.image }] : [],
      riceComponentId: item.rice_component_id ?? "",
      parts: [
        ...(item.component_id ? [{ component_id: item.component_id, name: catalog?.components.find((c) => c.id === item.component_id)?.name ?? "", portions: 1 }] : []),
        ...(item.fixed ?? []).map((f) => ({ component_id: f.component_id ?? null, name: f.name, portions: f.portions ?? 1 })),
      ],
      weekdays: item.weekdays ?? [],
      slots: item.slots ?? [],
      customFields: item.custom_fields ?? [],
    });
    setDialogOpen(true);
  }

  function toggleTag(field: "allergens" | "dietaryTags", tag: string) {
    setForm(f => {
      const arr = f[field];
      return { ...f, [field]: arr.includes(tag) ? arr.filter(t => t !== tag) : [...arr, tag] };
    });
  }

  return (
    <VendorPortalLayout>
      <PortalPageHeader
        icon={UtensilsCrossed}
        title={<>
          {tr("菜單管理", "Menu")}
          <InfoTip>{tr("每道菜長得像一個便當：每格是一道配菜，顏色是食材類別。格子都填好，系統就能算每份成本、毛利，並自動產生叫貨單和備料。單價、供應商在「食材與供應商」。", "Each item looks like a bento box: each cell is a dish, colored by food group. Fill the cells and cost, margin, purchasing and prep are calculated for you. Prices and suppliers live in Ingredients.")}</InfoTip>
        </>}
        actions={<>
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) readMenuPhoto(file);
            }}
          />
          <Button variant="outline" onClick={() => setCatalogsOpen(true)} disabled={!VENDOR_ID}>
            <FolderTree className="w-4 h-4 mr-1" /> {tr("管理目錄", "Catalogs")}
          </Button>
          <Button variant="outline" onClick={() => photoInput.current?.click()} disabled={reading || !VENDOR_ID}>
            <Camera className="w-4 h-4 mr-1" /> {reading ? tr("AI 辨識中…", "Reading…") : tr("拍照上架", "From a photo")}
          </Button>
          <Button  onClick={openAdd}>
            <Plus className="w-4 h-4 mr-1" /> {tr("新增品項", "Add item")}
          </Button>
        </>}
      />

      {/* Menu completeness: only answers "which dishes can be costed" */}
      {gaps.stats && gaps.listed.length > 0 && (
        <Card className="mb-5">
          <CardContent className="p-4 flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[12rem] space-y-1.5">
              <p className="text-sm text-muted-foreground">{tr("可以算成本的菜", "Items with full cost")}</p>
              <p className="font-heading text-3xl font-semibold leading-none">
                {gaps.stats.ready.length}<span className="text-lg text-muted-foreground"> / {gaps.listed.length} {tr("道", "")}</span>
              </p>
              <div className="h-2.5 w-full max-w-xs overflow-hidden rounded-full bg-border">
                <div className="h-full bg-success-strong transition-all" style={{ width: `${Math.round((gaps.stats.ready.length / gaps.listed.length) * 100)}%` }} />
              </div>
            </div>
            {gaps.stats.gapItems.length > 0 ? (
              <Button size="lg" onClick={() => gaps.fill()} disabled={!!gaps.progress}>
                <Sparkles /> {gaps.progress ? fillingText(gaps.progress) : tr(`一次補完全部（${gaps.stats.gapItems.length} 道）`, `Fill them all (${gaps.stats.gapItems.length})`)}
              </Button>
            ) : gaps.stats.unpriced.length > 0 ? (
              <Link href="/vendor-portal/recipes" className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1.5 text-sm font-medium text-warning-text hover:bg-warning/30">
                <AlertTriangle className="w-4 h-4" />{tr(`缺單價：${gaps.stats.unpriced.slice(0, 2).map(([, n]) => n).join("、")}`, `No price: ${gaps.stats.unpriced.slice(0, 2).map(([, n]) => n).join(", ")}`)}{gaps.stats.unpriced.length > 2 ? tr(` 等 ${gaps.stats.unpriced.length} 項`, "…") : ""}
              </Link>
            ) : null}
            <div className="w-full flex flex-wrap gap-3 text-xs text-muted-foreground">
              {(["rice", "protein", "veg", "pack"] as FoodGroup[]).map((g) => (
                <span key={g} className="inline-flex items-center gap-1"><span className={cn("w-2.5 h-2.5 rounded-sm", GROUP_DOT[g])} />{groupLabel(g)}</span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {drafts.length > 0 && (
        <Card className="mb-5 border-brand/40 bg-accent/40">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-accent-foreground" /> {tr(`AI 讀到 ${drafts.length} 個品項草稿`, `AI found ${drafts.length} draft item(s)`)}</p>
                <p className="text-xs text-muted-foreground">{tr("草稿還沒上架。按「填入表單」確認價格、飲食標記與過敏原後再儲存。", "Nothing is listed yet. Use Fill in form to check price, dietary tags and allergens, then save.")}</p>
                {draftNote && <p className="text-xs text-warning-text mt-1">{draftNote}</p>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setDrafts([]); setDraftNote(""); }}>{tr("全部清除", "Clear all")}</Button>
            </div>
            <div className="space-y-2">
              {drafts.map((d, i) => (
                <div key={`${d.name}-${i}`} className="flex items-center gap-3 bg-card rounded-lg border px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{tr(d.name, d.name_en || d.name)}</span>
                      <span className="text-xs text-muted-foreground">{d.category}</span>
                      {d.dietary_tags.map((tag) => <Badge key={tag} variant="outline" className="text-xs text-success-text border-success/40">{tr(tag, tagEn(tag))}</Badge>)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.price ? `NT$${d.price}` : tr("價格未讀到", "No price found")}
                      {d.allergens.length > 0 && <span className="text-danger-text">{tr("・可能含：", " · May contain: ")}{d.allergens.map((a) => tr(a, tagEn(a))).join(tr("、", ", "))}</span>}
                    </div>
                  </div>
                  <Button size="sm" onClick={() => openDraft(i)}>{tr("填入表單", "Fill in form")}</Button>
                  <Button variant="ghost" size="icon" className="w-8 h-8" aria-label={tr(`略過「${d.name}」`, `Skip ${d.name}`)} onClick={() => setDrafts((list) => list.filter((_, j) => j !== i))}>
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <SkeletonBlocks count={3} height={64} className="space-y-2" />
      ) : items.length === 0 ? (
        <EmptyState icon={<UtensilsCrossed size={32} />} title={tr("尚無菜單品項", "No menu items yet")} description={tr("拍一張菜單照片，AI 幫你一次上架。", "Snap your menu and AI lists it for you.")} action={<Button onClick={() => photoInput.current?.click()} disabled={reading || !VENDOR_ID}><Camera /> {tr("拍照上架", "From a photo")}</Button>} />
      ) : (() => {
        // Catalog > category, two levels; when the vendor doesn't use catalogs there's only the category level
        const groups = groupByCatalog(items, myVendor?.menu_catalogs, (i) => i.category);
        const hasCatalogs = groups.some((g) => g.catalog);
        const sections = groups.flatMap((g) => g.categories.map((c, idx) => ({ key: `${g.catalog}/${c.category}`, catalog: g.catalog, first: idx === 0, cat: c.category, items: c.items })));
        return (
          <div className="space-y-10">
            {sections.map(({ key, catalog: catalogName, first, cat, items: sectionItems }) => (
              <div key={key}>
                {hasCatalogs && first && (
                  <p className="mb-4 flex items-center gap-2 border-b border-ink pb-2 font-heading text-xl font-semibold">
                    <FolderTree className="w-5 h-5 text-primary" aria-hidden="true" />{catalogName ? loc(sectionItems[0], "catalog") || catalogName : tr("未分目錄", "No catalog")}
                  </p>
                )}
                <h2 className="font-heading text-2xl font-semibold mb-3">{loc(sectionItems[0], "category") || cat}</h2>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {sectionItems.map(item => (
                    <Card key={item.id}>
                      <CardContent className="p-4 md:p-5 flex items-start gap-4">
                        {(() => {
                          const cells = catalog ? itemCells(item, catalog.componentsById, catalog.ingredientsById) : [];
                          return <BentoBox cells={cells} empty={cells.length === 0} />;
                        })()}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button type="button" className="font-heading text-lg font-semibold text-left hover:underline" onClick={() => openEdit(item)}>{loc(item, "name")}</button>
                            {!item.is_available && <Badge variant="secondary" className="text-xs">{tr("已下架", "Unavailable")}</Badge>}
                            {hasAiDraft(item) && (
                              <Badge variant="outline" className="text-xs text-accent-foreground border-brand/40"><Sparkles className="w-3 h-3 mr-0.5" />{tr("AI 草稿", "AI draft")}</Badge>
                            )}
                          </div>
                          <div className="text-accent-foreground font-semibold text-sm">NT${item.price}{(item.mains?.length ?? 0) > 1 ? tr(" 起", "+") : ""}</div>
                          {(() => {
                            if (!catalog) return null;
                            const targets = recipeTargets(item, catalog);
                            if (targets.length > 0) {
                              return (
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs text-muted-foreground">{tr(`${targets.length} 格還沒有組成`, `${targets.length} cell(s) missing`)}</span>
                                  <Button size="sm" variant="outline" onClick={() => gaps.fill([item])} disabled={!!gaps.progress}>
                                    <Sparkles /> {gaps.progress ? fillingText(gaps.progress) : tr("AI 幫我填", "Let AI fill it")}
                                  </Button>
                                </div>
                              );
                            }
                            const issue = issuesById[item.id]?.[0];
                            if (issue) {
                              return (
                                <button type="button" className="inline-flex items-center gap-1 rounded-full bg-warning-soft text-warning-text px-2 py-0.5 text-xs font-medium hover:bg-warning/30" onClick={() => openEdit(item)}>
                                  <AlertTriangle className="w-3 h-3 shrink-0" />{costIssueText(issue.issue)}
                                </button>
                              );
                            }
                            const portions = componentPortionsForLock({ rice: "normal", slots: [], extra_side: null }, item, catalog.componentsById);
                            const price = item.mains?.[0]?.price || item.price || 0;
                            return <div className="max-w-xs"><MarginBar cost={portionsCost(portions, catalog.componentsById, catalog.ingredientsById)} price={price} /></div>;
                          })()}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="w-8 h-8" aria-label={tr(`編輯「${item.name}」`, `Edit ${loc(item, "name")}`)} onClick={() => openEdit(item)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-8 h-8 text-danger-text"
                            aria-label={tr(`刪除「${item.name}」`, `Delete ${loc(item, "name")}`)}
                            onClick={async () => {
                              if (await confirm({ title: tr(`要刪除「${item.name}」嗎？`, `Delete ${loc(item, "name")}?`), description: tr("刪除後無法復原。", "This can't be undone."), confirmLabel: tr("確定刪除", "Delete"), destructive: true })) {
                                deleteMutation.mutate(item.id);
                              }
                            }}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? tr("編輯品項", "Edit item") : tr("新增品項", "Add item")}</DialogTitle>
          </DialogHeader>
          {activeDraft !== null && (
            <p className="text-xs text-warning-text bg-warning-soft rounded p-2">{tr("這是 AI 從照片讀出的草稿，請確認價格、飲食標記與過敏原（食安法規定）正確再儲存。", "This is an AI draft from your photo. Check price, dietary tags and allergens (required by law) before saving.")}</p>
          )}
          {/* 2026-10-09 simplification: ① required basics ② bento contents and price ③ allergens (legal requirement); description, English, catalog and dietary tags moved into "More settings" */}
          <div className="space-y-4 py-2">
            <section className="space-y-3" aria-labelledby="menu-step-basic">
              <h3 id="menu-step-basic" className="text-sm font-semibold">{tr("① 基本資料", "① Basics")}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="menu-item-name">{tr("名稱 *", "Name *")}</Label>
                    <Input id="menu-item-name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={tr("例：招牌雞腿便當", "e.g. Signature chicken bento")} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor="menu-item-category">{tr("分類", "Category")}</Label>
                      <Input id="menu-item-category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder={tr("例：便當、湯品", "e.g. Bento, Soup")} />
                    </div>
                    {bento.itemType !== "bento" && (
                      <div>
                        <Label htmlFor="menu-item-price">{tr("價格 (NT$) *", "Price (NT$) *")}</Label>
                        <Input id="menu-item-price" type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
                      </div>
                    )}
                  </div>
                  {/* Partnership plan: per-serving commission, added on top when pricing */}
                  {bento.itemType !== "bento" && Number(form.price) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {tr(`平台抽成 ${commissionPct}%，原價賣出實收約 NT$${netOfCommission(Number(form.price), commissionRate)}。`, `After the ${commissionPct}% commission you net about NT$${netOfCommission(Number(form.price), commissionRate)} at full price.`)}{" "}
                      <button type="button" className="font-semibold text-primary underline underline-offset-2" onClick={() => setForm(f => ({ ...f, price: String(withCommission(Number(f.price), commissionRate)) }))}>
                        {tr(`加 ${commissionPct}% → NT$${withCommission(Number(form.price), commissionRate)}`, `Add ${commissionPct}% → NT$${withCommission(Number(form.price), commissionRate)}`)}
                      </button>
                    </p>
                  )}
                  {/* Listing on/off is a toggle that takes effect immediately → the design system uses Switch */}
                  <Switch
                    checked={form.isAvailable}
                    onCheckedChange={(checked) => setForm(f => ({ ...f, isAvailable: checked }))}
                    label={tr("上架販售", "Available")}
                    description={tr("關閉後顧客暫時看不到這個品項", "When off, customers won't see this item")}
                  />
                </div>
                <ImageUploadField label={tr("品項圖片", "Item photo")} vendorId={VENDOR_ID} value={form.image} onChange={v => setForm(f => ({ ...f, image: v }))} />
              </div>
            </section>

            <section className="space-y-2" aria-labelledby="menu-step-content">
              <h3 id="menu-step-content" className="text-sm font-semibold">
                {bento.itemType === "bento" ? tr("② 便當內容與價格（價格依主菜設定）", "② Contents & price (priced per main)") : tr("② 內容", "② Contents")}
              </h3>
              {nextWeekLocked && bento.itemType === "bento" && (
                <p className="text-xs text-warning-text bg-warning-soft rounded p-2">{tr("下週叫貨單已產生，下週主菜已鎖定；請只做等值的配菜替換。", "Next week's purchase list is out, so mains are locked — only swap sides for equivalents.")}</p>
              )}
              <BentoEditor itemName={form.name} itemPrice={Number(form.price) || 0} value={bento} onChange={setBento} components={catalog?.components ?? []} ingredientsById={catalog?.ingredientsById ?? {}} vendorId={VENDOR_ID} orderCount={editId && nextDay && nextDayCounts?.[editId] ? { label: tr(`${nextDay.slice(5)} 已訂`, `${nextDay.slice(5)} booked`), n: nextDayCounts[editId] } : undefined} />
            </section>

            {/* Allergen labeling (required by food safety law): the only label that must be seen, so it stays outside */}
            <section aria-labelledby="menu-step-allergens">
              <h3 id="menu-step-allergens" className="text-sm font-semibold mb-1.5">{tr("③ 過敏原標示", "③ Allergens")} <span className="text-xs text-danger-text font-normal">{tr("（食安法規定）", "(required by food safety law)")}</span></h3>
              <div className="flex flex-wrap gap-2">
                {ALLERGEN_LIST.map(tag => (
                  <Tag key={tag} selected={form.allergens.includes(tag)} onClick={() => toggleTag("allergens", tag)}>
                    {tr(tag, tagEn(tag))}
                  </Tag>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{tr("點選含有的過敏原成分，將顯示於消費者菜單頁面。", "Select the allergens this item contains; they're shown on the customer menu.")}</p>
            </section>

            <details className="rounded-lg border border-border" open={moreOpen} onToggle={(e) => setMoreOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
                {tr("更多設定（說明、飲食標記、英文版、目錄）", "More (description, dietary tags, English, catalog)")}
              </summary>
              <div className="space-y-3 px-3 pb-3">
                <div>
                  <Label htmlFor="menu-item-desc">{tr("說明", "Description")}</Label>
                  <Textarea id="menu-item-desc" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
                </div>
                <div>
                  <Label className="block mb-1.5">{tr("飲食標記", "Dietary tags")}</Label>
                  <div className="flex flex-wrap gap-2">
                    {DIETARY_TAGS.map(tag => (
                      <Tag key={tag} selected={form.dietaryTags.includes(tag)} onClick={() => toggleTag("dietaryTags", tag)}>
                        {tr(tag, tagEn(tag))}
                      </Tag>
                    ))}
                  </div>
                </div>
                {/* English version (for customers using the English UI) */}
                <div className="border rounded-lg p-3 space-y-2 bg-background">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {tr("英文版（自動翻譯，可修改）", "English (auto-translated, editable)")}
                  </p>
                  <Input
                    value={form.nameEn}
                    onChange={e => setForm(f => ({ ...f, nameEn: e.target.value }))}
                    placeholder={tr("英文名稱，留空＝自動翻譯", "English name — leave blank to auto-translate")}
                    aria-label={tr("英文名稱", "English name")}
                  />
                  <Textarea
                    value={form.descriptionEn}
                    onChange={e => setForm(f => ({ ...f, descriptionEn: e.target.value }))}
                    placeholder={tr("英文說明，留空＝自動翻譯", "English description — leave blank to auto-translate")}
                    aria-label={tr("英文說明", "English description")}
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    {tr("儲存後約幾秒會自動翻好。只改中文、沒改英文時，英文會重新自動翻譯。", "Translations appear a few seconds after saving. If you change the Chinese but not the English, the English is re-translated automatically.")}
                  </p>
                </div>
                <div>
                  <Label htmlFor="menu-item-catalog">{tr("目錄（分類的上一層，選填）", "Catalog (above category, optional)")}</Label>
                  <Input id="menu-item-catalog" list="menu-catalog-options" maxLength={30} value={form.catalog} onChange={e => setForm(f => ({ ...f, catalog: e.target.value }))} placeholder={tr("例：午餐便當；可選現有的或直接打新的", "e.g. Lunch bentos — pick one or type a new one")} />
                  <datalist id="menu-catalog-options">{catalogNames.map((n) => <option key={n} value={n} />)}</datalist>
                </div>
              </div>
            </details>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button
              
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.name || (bento.itemType !== "bento" && !form.price)}
            >
              {saveMutation.isPending ? tr("儲存中…", "Saving…") : tr("儲存", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    {VENDOR_ID && (
        <MenuCatalogManager open={catalogsOpen} onClose={() => setCatalogsOpen(false)} vendorId={VENDOR_ID} listed={myVendor?.menu_catalogs} items={items}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["vendorMenu", VENDOR_ID] });
            queryClient.invalidateQueries({ queryKey: myVendorDocKey(VENDOR_ID) });
          }} />
      )}
    </VendorPortalLayout>
  );
}

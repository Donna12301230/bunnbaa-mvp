import { useRef, useState } from "react";
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
import { Camera, Plus, Pencil, Sparkles, Trash2, UtensilsCrossed, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { queryClient } from "@/lib/queryClient";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { imageToBase64 } from "@/lib/imageData";
import { useMyVendor } from "@/hooks/useMyVendor";
import type { MenuItem } from "@/types";
import { ALLERGEN_LIST, DIETARY_TAGS, tagEn } from "@/types";
import { tr } from "@/lib/i18n";
import { ImageUploadField } from "@/components/ImageUploadField";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState, Switch, Tag } from "@/components/ds";
import BentoEditor, { EMPTY_BENTO, portionTextFor, type BentoForm } from "@/components/BentoEditor";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { addDaysStr, mondayOf, todayStr } from "@/lib/pickupSlots";
import { Link } from "wouter";

// 拍照上架（functions/src/menuVision.js）回傳的草稿，店主按「填入表單」確認後才寫進 menu_items
interface MenuDraft {
  name: string;
  name_en: string;
  price: number | null;
  category: string;
  dietary_tags: string[];
  allergens: string[];
  description: string;
}

const EMPTY_FORM = { name: "", description: "", price: "", category: "一般", isAvailable: true, image: "", allergens: [] as string[], dietaryTags: [] as string[], nameEn: "", descriptionEn: "" };

// 英文名稱／說明：Functions 會自動翻（translateMenuItem），商家也可以手動改。
// 手動改過的欄位把 i18n_src 設成目前的中文，觸發器就認定「已翻過」不會蓋掉；
// 清空＝交回自動翻譯（刪掉英文與 i18n_src，觸發器會重翻）；
// 英文沒動、只改中文＝照常由觸發器重新自動翻譯。
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

  // 登入店主綁定（vendors/{id}.owner_uid）的商家；寫入權限由 firestore.rules 的
  // isVendorOwner 把關，這裡不另外檢查。
  const { data: myVendor } = useMyVendor();
  const VENDOR_ID = myVendor?.id;
  const { data: catalog } = useVendorCatalog(VENDOR_ID);
  // 週六 12:00 產生下週叫貨單後，下週主菜鎖定，只能等值替換配菜（§16 暫定）
  const nextWeekLocked = !!myVendor?.menu_locked_week && myVendor.menu_locked_week >= mondayOf(addDaysStr(todayStr(), 7));

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["vendorMenu", VENDOR_ID],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "menu_items"), where("vendor_id", "==", VENDOR_ID)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as MenuItem)
        .sort((a, b) => a.category.localeCompare(b.category));
    },
    enabled: !!VENDOR_ID,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!myVendor) throw new Error(tr("這個帳號還沒綁定商家，請聯絡平台", "This account isn't linked to a vendor yet. Please contact the platform"));
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
        // 便當有多道主菜時，price 存最低主菜價（卡片「$50 起」、舊程式相容）
        price: bento.itemType === "bento" && mains.length > 0 ? Math.min(...mains.map((m) => m.price)) : Number(form.price),
        category: form.category,
        is_available: form.isAvailable,
        image: form.image || null, // Firestore SDK throws on `undefined` field values
        allergens: form.allergens,
        dietary_tags: form.dietaryTags,
        // 品項結構（1002 規格 §3.2）：類型、供應餐期、主菜（各自定價）、配菜，每道菜有照片與份量文字
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
        // 配菜下方的自訂下拉欄位：沒填名稱的欄位、沒填名稱的選項都不存
        custom_fields: bento.itemType === "bento"
          ? bento.customFields
            .map((f) => ({ label: f.label.trim(), options: f.options.filter((o) => o.name.trim()).map((o) => ({ name: o.name.trim(), price: Math.round(Number(o.price) || 0) })) }))
            .filter((f) => f.label && f.options.length > 0)
          : [],
        weekdays: bento.weekdays,
        component_id: bento.itemType === "single" ? bento.componentId || null : null,
      };
      const original = editId ? items.find((i) => i.id === editId) ?? null : null;
      const english = englishOverrides(form, original);
      if (editId) {
        await updateDoc(doc(db, "menu_items", editId), { ...data, ...english });
      } else {
        // 新品項：updateDoc 的「i18n_src.name」點路徑寫法在 addDoc 不適用，改成巢狀物件
        const src: Record<string, string> = {};
        const extra: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(english)) {
          if (key.startsWith("i18n_src.")) src[key.slice("i18n_src.".length)] = value as string;
          else extra[key] = value;
        }
        await addDoc(collection(db, "menu_items"), { ...data, ...extra, ...(Object.keys(src).length ? { i18n_src: src } : {}), created_at: new Date() });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendorMenu", VENDOR_ID] });
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
        ? tr("帳號尚未綁定商家權限，請聯絡管理員", "This account doesn't have vendor access yet. Please contact an admin")
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
        ? tr("帳號尚未綁定商家權限，請聯絡管理員", "This account doesn't have vendor access yet. Please contact an admin")
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
    setDialogOpen(true);
  }

  function openAdd() {
    setActiveDraft(null);
    setEditId(null);
    setForm(EMPTY_FORM);
    setBento(EMPTY_BENTO);
    setDialogOpen(true);
  }

  function openEdit(item: MenuItem) {
    setActiveDraft(null);
    setEditId(item.id);
    setForm({ name: item.name, description: item.description, price: String(item.price), category: item.category, isAvailable: item.is_available, image: item.image ?? "", allergens: item.allergens ?? [], dietaryTags: item.dietary_tags ?? [], nameEn: item.name_en ?? "", descriptionEn: item.description_en ?? "" });
    const isBentoItem = item.item_type ? item.item_type === "bento" : (item.slots?.length ?? 0) > 0;
    setBento({
      itemType: isBentoItem ? "bento" : "single",
      mealPeriods: item.meal_periods?.length ? item.meal_periods : ["lunch"],
      mains: item.mains?.length ? item.mains : isBentoItem && item.main?.name ? [{ name: item.main.name, component_id: item.main.component_id ?? null, price: item.price, image_url: item.image }] : [],
      riceComponentId: item.rice_component_id ?? "",
      componentId: item.component_id ?? "",
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
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="font-heading text-3xl md:text-4xl font-semibold">{tr("菜單管理", "Menu")}</h1>
          <p className="text-xs text-muted-foreground">{tr("主菜、配菜格與候選菜；配方在", "Mains, side slots and candidates; recipes live in")} <Link href="/vendor-portal/recipes" className="text-primary underline">{tr("配方與原物料", "Recipes")}</Link></p>
        </div>
        <div className="flex gap-2">
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
          <Button variant="outline" onClick={() => photoInput.current?.click()} disabled={reading || !VENDOR_ID}>
            <Camera className="w-4 h-4 mr-1" /> {reading ? tr("AI 辨識中…", "Reading…") : tr("拍照上架", "From a photo")}
          </Button>
          <Button  onClick={openAdd}>
            <Plus className="w-4 h-4 mr-1" /> {tr("新增品項", "Add item")}
          </Button>
        </div>
      </div>

      {drafts.length > 0 && (
        <Card className="mb-5 border-orange-200 bg-orange-50/40">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-orange-500" /> {tr(`AI 讀到 ${drafts.length} 個品項草稿`, `AI found ${drafts.length} draft item(s)`)}</p>
                <p className="text-xs text-muted-foreground">{tr("草稿還沒上架。按「填入表單」確認價格、飲食標記與過敏原後再儲存。", "Nothing is listed yet. Use Fill in form to check price, dietary tags and allergens, then save.")}</p>
                {draftNote && <p className="text-xs text-amber-700 mt-1">{draftNote}</p>}
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setDrafts([]); setDraftNote(""); }}>{tr("全部清除", "Clear all")}</Button>
            </div>
            <div className="space-y-2">
              {drafts.map((d, i) => (
                <div key={`${d.name}-${i}`} className="flex items-center gap-3 bg-white rounded-lg border px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{d.name}</span>
                      <span className="text-xs text-muted-foreground">{d.category}</span>
                      {d.dietary_tags.map((tag) => <Badge key={tag} variant="outline" className="text-xs text-green-700 border-green-200">{tr(tag, tagEn(tag))}</Badge>)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {d.price ? `NT$ ${d.price}` : tr("價格未讀到", "No price found")}
                      {d.allergens.length > 0 && <span className="text-red-500">{tr("・可能含：", " · May contain: ")}{d.allergens.map((a) => tr(a, tagEn(a))).join(tr("、", ", "))}</span>}
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
        <EmptyState icon={<UtensilsCrossed size={32} />} title={tr("尚無菜單品項", "No menu items yet")} description={tr("點擊上方「新增品項」，上架第一道餐點。", "Click Add item above to list your first dish.")} />
      ) : (() => {
        const categories = Array.from(new Set(items.map(i => i.category)));
        return (
          <div className="space-y-10">
            {categories.map(cat => (
              <div key={cat}>
                <h2 className="font-heading text-2xl font-semibold mb-3">{cat}</h2>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  {items.filter(i => i.category === cat).map(item => (
                    <Card key={item.id}>
                      <CardContent className="p-4 md:p-5 flex items-center gap-4">
                        <div className="w-20 h-20 rounded-2xl overflow-hidden border border-ink bg-secondary shrink-0 flex items-center justify-center">
                          {item.image
                            ? <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                            : <UtensilsCrossed className="w-6 h-6 text-secondary-foreground/50" aria-hidden="true" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-heading text-lg font-semibold">{item.name}</span>
                            {!item.is_available && <Badge variant="secondary" className="text-xs">{tr("已下架", "Unavailable")}</Badge>}
                            {item.dietary_tags?.map(t => (
                              <Badge key={t} variant="outline" className="text-xs text-green-700 border-green-200">{tr(t, tagEn(t))}</Badge>
                            ))}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                          {(item.slots?.length ?? 0) > 0 && (
                            <div className="text-xs text-muted-foreground truncate">
                              {item.main?.name && <>{tr("主菜", "Main")} {item.main.name}・</>}
                              {item.slots!.map((sl) => `${sl.default.name}${sl.candidates.length ? `（+${sl.candidates.map((c) => c.name).join("/")}）` : ""}`).join("、")}
                              {item.weekdays?.length ? `・${tr("週", "")}${item.weekdays.join(",")}` : ""}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-orange-600 font-semibold text-sm">NT$ {item.price}{(item.mains?.length ?? 0) > 1 ? tr(" 起", "+") : ""}</span>
                            {item.allergens?.length > 0 && (
                              <span className="text-xs text-red-500">{tr("含：", "Contains: ")}{item.allergens.map((a) => tr(a, tagEn(a))).join(tr("、", ", "))}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => openEdit(item)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-8 h-8 text-red-500"
                            aria-label={tr(`刪除「${item.name}」`, `Delete ${item.name}`)}
                            onClick={async () => {
                              if (await confirm({ title: tr(`要刪除「${item.name}」嗎？`, `Delete ${item.name}?`), description: tr("刪除後無法復原。", "This can't be undone."), confirmLabel: tr("確定刪除", "Delete"), destructive: true })) {
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
            <p className="text-xs text-amber-800 bg-amber-50 rounded p-2">{tr("這是 AI 從照片讀出的草稿，請確認價格、飲食標記與過敏原（食安法規定）正確再儲存。", "This is an AI draft from your photo. Check price, dietary tags and allergens (required by law) before saving.")}</p>
          )}
          <div className="space-y-3 py-2">
            <div>
              <Label>{tr("名稱 *", "Name *")}</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>{tr("說明", "Description")}</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            {/* 英文版（給英文介面的顧客看） */}
            <div className="border rounded-lg p-3 space-y-2 bg-gray-50">
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{bento.itemType === "bento" ? tr("價格（便當依主菜定價，下方設定）", "Price (set per main below)") : tr("價格 (NT$) *", "Price (NT$) *")}</Label>
                <Input type="number" value={form.price} disabled={bento.itemType === "bento"} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
              </div>
              <div>
                <Label>{tr("分類", "Category")}</Label>
                <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder={tr("例：便當、湯品", "e.g. Bento, Soup")} />
              </div>
            </div>
            {/* 上架與否是即時生效的開關設定 → 設計系統用 Switch */}
            <Switch
              checked={form.isAvailable}
              onCheckedChange={(checked) => setForm(f => ({ ...f, isAvailable: checked }))}
              label={tr("上架販售", "Available")}
              description={tr("關閉後顧客暫時看不到這個品項", "When off, customers won't see this item")}
            />
            {/* 飲食標記 */}
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
            {/* 過敏原標示（食安法要求） */}
            <div>
              <Label className="block mb-1.5">{tr("過敏原標示", "Allergens")} <span className="text-xs text-red-500 font-normal">{tr("（食安法規定）", "(required by food safety law)")}</span></Label>
              <div className="flex flex-wrap gap-2">
                {ALLERGEN_LIST.map(tag => (
                  <Tag key={tag} selected={form.allergens.includes(tag)} onClick={() => toggleTag("allergens", tag)}>
                    {tr(tag, tagEn(tag))}
                  </Tag>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">{tr("點選含有的過敏原成分，將顯示於消費者菜單頁面。", "Select the allergens this item contains; they're shown on the customer menu.")}</p>
            </div>
            {nextWeekLocked && bento.itemType === "bento" && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">{tr("下週叫貨單已產生，下週主菜已鎖定；請只做等值的配菜替換。", "Next week's purchase list is out, so mains are locked — only swap sides for equivalents.")}</p>
            )}
            <BentoEditor itemName={form.name} value={bento} onChange={setBento} components={catalog?.components ?? []} ingredientsById={catalog?.ingredientsById ?? {}} vendorId={VENDOR_ID} />
            <ImageUploadField label={tr("品項圖片", "Item photo")} vendorId={VENDOR_ID} value={form.image} onChange={v => setForm(f => ({ ...f, image: v }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button
              
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.name || (bento.itemType !== "bento" && !form.price)}
            >
              {saveMutation.isPending ? tr("儲存中...", "Saving...") : tr("儲存", "Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </VendorPortalLayout>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where,
} from "firebase/firestore";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, UtensilsCrossed } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { queryClient } from "@/lib/queryClient";
import { db } from "@/lib/firebase";
import { useMyVendor } from "@/hooks/useMyVendor";
import type { MenuItem } from "@/types";
import { ALLERGEN_LIST, DIETARY_TAGS } from "@/types";
import { ImageUploadField } from "@/components/ImageUploadField";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState, Switch, Tag } from "@/components/ds";

const EMPTY_FORM = { name: "", description: "", price: "", category: "一般", isAvailable: true, image: "", allergens: [] as string[], dietaryTags: [] as string[] };

export default function VendorPortalMenu() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  // 登入店主綁定（vendors/{id}.owner_uid）的商家；寫入權限由 firestore.rules 的
  // isVendorOwner 把關，這裡不另外檢查。
  const { data: myVendor } = useMyVendor();
  const VENDOR_ID = myVendor?.id;

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
      if (!myVendor) throw new Error("這個帳號還沒綁定商家，請聯絡平台");
      const data = {
        vendor_id: myVendor.id,
        name: form.name,
        description: form.description,
        price: Number(form.price),
        category: form.category,
        is_available: form.isAvailable,
        image: form.image || null, // Firestore SDK throws on `undefined` field values
        allergens: form.allergens,
        dietary_tags: form.dietaryTags,
      };
      if (editId) {
        await updateDoc(doc(db, "menu_items", editId), data);
      } else {
        await addDoc(collection(db, "menu_items"), { ...data, created_at: new Date() });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendorMenu", VENDOR_ID] });
      setDialogOpen(false);
      setEditId(null);
      setForm(EMPTY_FORM);
      toast({ title: editId ? "已更新" : "已新增", description: form.name });
    },
    onError: (err: any) => {
      const description = err?.code === "permission-denied"
        ? "帳號尚未綁定商家權限，請聯絡管理員"
        : err.message;
      toast({ variant: "destructive", title: "儲存失敗", description });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, "menu_items", id));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendorMenu", VENDOR_ID] });
      toast({ title: "已刪除" });
    },
    onError: (err: any) => {
      const description = err?.code === "permission-denied"
        ? "帳號尚未綁定商家權限，請聯絡管理員"
        : err.message;
      toast({ variant: "destructive", title: "刪除失敗", description });
    },
  });

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(item: MenuItem) {
    setEditId(item.id);
    setForm({ name: item.name, description: item.description, price: String(item.price), category: item.category, isAvailable: item.is_available, image: item.image ?? "", allergens: item.allergens ?? [], dietaryTags: item.dietary_tags ?? [] });
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
        <h2 className="text-xl font-bold">菜單管理</h2>
        <Button  onClick={openAdd}>
          <Plus className="w-4 h-4 mr-1" /> 新增品項
        </Button>
      </div>

      {isLoading ? (
        <SkeletonBlocks count={3} height={64} className="space-y-2" />
      ) : items.length === 0 ? (
        <EmptyState icon={<UtensilsCrossed size={32} />} title="尚無菜單品項" description="點擊上方「新增品項」，上架第一道餐點。" />
      ) : (() => {
        const categories = Array.from(new Set(items.map(i => i.category)));
        return (
          <div className="space-y-5">
            {categories.map(cat => (
              <div key={cat}>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{cat}</p>
                <div className="space-y-2">
                  {items.filter(i => i.category === cat).map(item => (
                    <Card key={item.id}>
                      <CardContent className="p-3 flex items-center gap-3">
                        <div className="w-16 h-16 rounded-lg overflow-hidden bg-orange-50 shrink-0 flex items-center justify-center">
                          {item.image
                            ? <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                            : <UtensilsCrossed className="w-6 h-6 text-orange-200" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium">{item.name}</span>
                            {!item.is_available && <Badge variant="secondary" className="text-xs">已下架</Badge>}
                            {item.dietary_tags?.map(t => (
                              <Badge key={t} variant="outline" className="text-xs text-green-700 border-green-200">{t}</Badge>
                            ))}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{item.description}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-orange-600 font-semibold text-sm">NT$ {item.price}</span>
                            {item.allergens?.length > 0 && (
                              <span className="text-xs text-red-500">含：{item.allergens.join("、")}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="w-8 h-8" onClick={() => openEdit(item)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="w-8 h-8 text-red-500"
                            aria-label={`刪除「${item.name}」`}
                            onClick={async () => {
                              if (await confirm({ title: `要刪除「${item.name}」嗎？`, description: "刪除後無法復原。", confirmLabel: "確定刪除", destructive: true })) {
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "編輯品項" : "新增品項"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>名稱 *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>說明</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>價格 (NT$) *</Label>
                <Input type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
              </div>
              <div>
                <Label>分類</Label>
                <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} placeholder="例：便當、湯品" />
              </div>
            </div>
            {/* 上架與否是即時生效的開關設定 → 設計系統用 Switch */}
            <Switch
              checked={form.isAvailable}
              onCheckedChange={(checked) => setForm(f => ({ ...f, isAvailable: checked }))}
              label="上架販售"
              description="關閉後顧客暫時看不到這個品項"
            />
            {/* 飲食標記 */}
            <div>
              <Label className="block mb-1.5">飲食標記</Label>
              <div className="flex flex-wrap gap-2">
                {DIETARY_TAGS.map(tag => (
                  <Tag key={tag} selected={form.dietaryTags.includes(tag)} onClick={() => toggleTag("dietaryTags", tag)}>
                    {tag}
                  </Tag>
                ))}
              </div>
            </div>
            {/* 過敏原標示（食安法要求） */}
            <div>
              <Label className="block mb-1.5">過敏原標示 <span className="text-xs text-red-500 font-normal">（食安法規定）</span></Label>
              <div className="flex flex-wrap gap-2">
                {ALLERGEN_LIST.map(tag => (
                  <Tag key={tag} selected={form.allergens.includes(tag)} onClick={() => toggleTag("allergens", tag)}>
                    {tag}
                  </Tag>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">點選含有的過敏原成分，將顯示於消費者菜單頁面。</p>
            </div>
            <ImageUploadField label="品項圖片" vendorId={VENDOR_ID} value={form.image} onChange={v => setForm(f => ({ ...f, image: v }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button
              
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.name || !form.price}
            >
              {saveMutation.isPending ? "儲存中..." : "儲存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </VendorPortalLayout>
  );
}

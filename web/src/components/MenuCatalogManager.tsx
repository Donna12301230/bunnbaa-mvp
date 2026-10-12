import { useEffect, useState } from "react";
import { deleteField, doc, writeBatch } from "firebase/firestore";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { tr } from "@/lib/i18n";
import { catalogOf, catalogOrder } from "@/lib/menuCatalog";
import type { MenuItem } from "@/types";

const MAX_CATALOGS = 30; // Matches the menu_catalogs limit in firestore.rules

/**
 * Manage menu catalogs (the level above categories): add, rename, reorder, delete.
 * Order is stored in vendors.menu_catalogs; renaming also updates the catalog of items underneath, and deleting moves items back to "Uncatalogued" (items are not deleted).
 */
export default function MenuCatalogManager({ open, onClose, vendorId, listed, items, onSaved }: {
  open: boolean;
  onClose: () => void;
  vendorId: string;
  listed: string[] | undefined;
  items: MenuItem[];
  onSaved: () => void;
}) {
  const { toast } = useToast();
  // original: this row's original catalog name (null for new rows); used on save to detect renames
  const [rows, setRows] = useState<{ name: string; original: string | null }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setRows(catalogOrder(listed, items).map((name) => ({ name, original: name })));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const names = rows.map((r) => r.name.trim());
  const problem = names.some((n) => !n)
    ? tr("目錄名稱不能空白", "Catalog names can't be blank")
    : new Set(names).size !== names.length
      ? tr("目錄名稱不能重複", "Catalog names must be unique")
      : names.some((n) => n.length > 30)
        ? tr("目錄名稱最多 30 個字", "Catalog names are limited to 30 characters")
        : null;

  function move(i: number, delta: number) {
    setRows((prev) => {
      const next = [...prev];
      const j = i + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function save() {
    if (problem) return;
    setBusy(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "vendors", vendorId), { menu_catalogs: names });
      const renamed = new Map(rows.filter((r) => r.original && r.original !== r.name.trim()).map((r) => [r.original!, r.name.trim()]));
      const kept = new Set(rows.map((r) => r.original).filter(Boolean));
      for (const item of items) {
        const current = catalogOf(item);
        if (!current) continue;
        if (renamed.has(current)) batch.update(doc(db, "menu_items", item.id), { catalog: renamed.get(current) });
        else if (!kept.has(current)) batch.update(doc(db, "menu_items", item.id), { catalog: deleteField(), catalog_en: deleteField() });
      }
      await batch.commit();
      toast({ title: tr("目錄已儲存", "Catalogs saved") });
      onSaved();
      onClose();
    } catch (err) {
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("管理目錄", "Manage catalogs")}</DialogTitle>
          <DialogDescription>{tr("目錄是分類的上一層，例如「午餐便當」底下有「雞肉」「豬肉」。消費者會先看到目錄，順序照這裡排。", "A catalog sits above categories — e.g. “Lunch bentos” containing “Chicken” and “Pork”. Customers see catalogs first, in this order.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">{tr("還沒有目錄。品項不分目錄也可以照常販售。", "No catalogs yet. Items sell fine without one.")}</p>}
          {rows.map((row, i) => {
            const count = row.original ? items.filter((it) => catalogOf(it) === row.original).length : 0;
            return (
              <div key={i} className="flex items-center gap-1.5">
                <Input value={row.name} maxLength={30} aria-label={tr(`第 ${i + 1} 個目錄名稱`, `Catalog ${i + 1} name`)} placeholder={tr("例：午餐便當", "e.g. Lunch bentos")}
                  onChange={(e) => setRows((prev) => prev.map((r, k) => (k === i ? { ...r, name: e.target.value } : r)))} />
                <span className="w-12 shrink-0 text-xs text-muted-foreground text-right">{tr(`${count} 道`, `${count}`)}</span>
                <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0" disabled={i === 0} aria-label={tr("往上移", "Move up")} onClick={() => move(i, -1)}><ArrowUp /></Button>
                <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0" disabled={i === rows.length - 1} aria-label={tr("往下移", "Move down")} onClick={() => move(i, 1)}><ArrowDown /></Button>
                <Button variant="ghost" size="icon" className="w-8 h-8 shrink-0 text-danger-text" aria-label={tr("刪除目錄", "Delete catalog")} onClick={() => setRows((prev) => prev.filter((_, k) => k !== i))}><Trash2 /></Button>
              </div>
            );
          })}
          <Button size="sm" variant="outline" disabled={rows.length >= MAX_CATALOGS} onClick={() => setRows((prev) => [...prev, { name: "", original: null }])}><Plus /> {tr("新增目錄", "Add catalog")}</Button>
          {problem && rows.length > 0 && <p className="text-xs text-danger-text">{problem}</p>}
          <p className="text-xs text-muted-foreground">{tr("刪除目錄不會刪品項，底下的品項會移到「未分目錄」。", "Deleting a catalog keeps its items; they move to “No catalog”.")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{tr("取消", "Cancel")}</Button>
          <Button disabled={busy || !!problem} onClick={save}>{busy ? tr("儲存中…", "Saving…") : tr("儲存", "Save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

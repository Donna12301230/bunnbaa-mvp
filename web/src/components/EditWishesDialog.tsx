import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { useToast } from "@/hooks/use-toast";
import { portionLabel } from "@/lib/bento";
import { tr } from "@/lib/i18n";
import type { Lock, MenuItem, SlotChoice } from "@/types";

/**
 * 截單前修改配菜許願（規格 §4.1「截單前可自由修改」）。只能在預設菜與候選菜之間換（金額不變）；
 * 選了「不要」的格子、加減飯會改變金額，要取消後重訂。
 */
export default function EditWishesDialog({ lock, onClose }: { lock: Lock | null; onClose: () => void }) {
  const { toast } = useToast();
  const [choices, setChoices] = useState<SlotChoice[]>([]);
  const [busy, setBusy] = useState(false);

  const { data: item } = useQuery({
    queryKey: ["menuItem", lock?.menu_item_id],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "menu_items", lock!.menu_item_id!));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as MenuItem) : null;
    },
    enabled: !!lock?.menu_item_id,
  });

  useEffect(() => {
    if (!lock) return;
    setChoices((lock.slots ?? []).map((s) => (s.removed ? "none" : s.wished != null && s.candidate_index != null ? s.candidate_index : "default")));
  }, [lock?.id]);

  async function save() {
    if (!lock) return;
    setBusy(true);
    try {
      await httpsCallable(functions, "updateLockChoices")({ lock_id: lock.id, slots: choices.map((choice) => ({ choice })) });
      toast({ title: tr("已更新許願", "Wishes updated") });
      onClose();
    } catch (err) {
      toast({ title: tr("更新失敗", "Couldn't update"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!lock} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("修改配菜許願", "Edit side-dish wishes")}</DialogTitle>
          <DialogDescription>{tr("截單前可以改；「不要」的格子與加減飯會改變金額，要取消後重訂。", "You can change these until cutoff. Removing sides or changing rice changes the price — cancel and re-order for that.")}</DialogDescription>
        </DialogHeader>
        {item?.slots?.map((slot, i) => (
          <div key={i} className="space-y-1">
            <label className="text-xs text-muted-foreground" htmlFor={`edit-slot-${i}`}>{slot.category}</label>
            {choices[i] === "none" ? (
              <p className="text-sm">{tr("不要", "None")}</p>
            ) : (
              <select
                id={`edit-slot-${i}`}
                className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm"
                value={String(choices[i] ?? "default")}
                onChange={(e) => setChoices((prev) => prev.map((c, j) => (j === i ? (e.target.value === "default" ? "default" : Number(e.target.value)) : c)))}
              >
                <option value="default">{slot.default.name}{tr("（預設）", " (default)")}</option>
                {slot.candidates.map((c, ci) => !c.disabled && (
                  <option key={ci} value={ci}>{c.name}（{portionLabel(c.portion_level)}）</option>
                ))}
              </select>
            )}
          </div>
        ))}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{tr("取消", "Cancel")}</Button>
          <Button onClick={save} disabled={busy || !item}>{busy ? tr("儲存中…", "Saving…") : tr("儲存", "Save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

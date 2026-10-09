import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { useToast } from "@/hooks/use-toast";
import { RICE_OPTIONS, adjustAmount, itemListPrice, itemMains, portionLabel, sideOptions } from "@/lib/bento";
import { mealPeriodLabel, mealPeriodOf, slotLabel } from "@/lib/pickupSlots";
import { useSlotAvailability } from "@/hooks/useSlotAvailability";
import { usePlatformConfig } from "@/lib/platformConfig";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ExtraSideChoice, Lock, MenuItem, RiceOption, SlotChoice, Vendor } from "@/types";

/**
 * 截單前修改（規格 §4.1）：取餐時段（同一天，計畫的每一天也在這裡個別改）、主菜、配菜、飯量、第四道。
 * 金額以下單時的早鳥折數重算：變便宜差額退成平台點數；變貴目前不能線上補差額（伺服器 updateLockChoices 擋）。
 */
export default function EditWishesDialog({ lock, onClose }: { lock: Lock | null; onClose: () => void }) {
  const { toast } = useToast();
  const { data: config } = usePlatformConfig();
  const [choices, setChoices] = useState<SlotChoice[]>([]);
  const [rice, setRice] = useState<RiceOption>("normal");
  const [mainIndex, setMainIndex] = useState<number | null>(null);
  const [extra, setExtra] = useState<ExtraSideChoice | null>(null);
  const [window, setWindow] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: item } = useQuery({
    queryKey: ["menuItem", lock?.menu_item_id],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "menu_items", lock!.menu_item_id!));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as MenuItem) : null;
    },
    enabled: !!lock?.menu_item_id,
  });
  const { data: vendor } = useQuery({
    queryKey: ["vendor", lock?.vendor_id],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "vendors", lock!.vendor_id));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Vendor) : null;
    },
    enabled: !!lock?.vendor_id,
  });
  const { slots: windowSlots } = useSlotAvailability(vendor, lock?.pickup_date ?? "", item);

  useEffect(() => {
    if (!lock) return;
    setChoices((lock.slots ?? []).map((s) => (s.removed ? "none" : s.wished != null && s.candidate_index != null ? s.candidate_index : "default")));
    setRice(lock.rice ?? "normal");
    setMainIndex(lock.main_index ?? null);
    setExtra(lock.extra_side ? { slot: lock.extra_side.slot, candidate: lock.extra_side.candidate_index, mode: lock.extra_side.mode } : null);
    setWindow(lock.pickup_window);
  }, [lock?.id]);

  const isPlanDay = !!lock?.plan_id;
  const bento = !isPlanDay && !!item?.slots?.length;
  const mains = item ? itemMains(item) : [];
  const options = useMemo(() => (item ? sideOptions(item) : []), [item]);

  // 預覽新金額（伺服器會再算一次）
  const preview = useMemo(() => {
    if (!lock || !item || !bento) return null;
    const list = itemListPrice(item, mainIndex);
    const early = Math.round(list * (1 - (lock.discount_percent || 0) / 100));
    const subtotal = Math.max(0, early + adjustAmount(rice, choices, config, extra));
    return subtotal - Math.min(lock.coupon_discount || 0, subtotal);
  }, [lock, item, bento, mainIndex, rice, choices, extra, config]);

  async function save() {
    if (!lock) return;
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { lock_id: lock.id, pickup_window: window };
      if (bento) Object.assign(payload, { slots: choices.map((choice) => ({ choice })), rice, main_index: mainIndex, extra_side: extra });
      const res = await httpsCallable(functions, "updateLockChoices")(payload);
      const refunded = (res.data as { refunded?: number }).refunded || 0;
      toast({ title: tr("已更新", "Updated"), description: refunded > 0 ? tr(`差額 ${refunded} 點已退到你的平台點數`, `${refunded} points were added to your balance`) : undefined });
      onClose();
    } catch (err) {
      toast({ title: tr("更新失敗", "Couldn't update"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const removed = choices.filter((c) => c === "none").length;
  const chosen = new Set((item?.slots || []).map((slot, i) => (choices[i] === "none" ? null : choices[i] === "default" ? slot.default.name : slot.candidates[choices[i] as number]?.name)));

  return (
    <Dialog open={!!lock} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isPlanDay ? tr("修改這一天的取餐時段", "Change this day's pickup time") : tr("修改訂單", "Change order")}</DialogTitle>
          <DialogDescription>
            {tr("截單前都可以改。變便宜的差額會退成平台點數；變貴目前還不能線上補差額。", "You can change this until cutoff. If it gets cheaper the difference comes back as points; changes that cost more aren't supported yet.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <p className="text-xs font-semibold text-muted-foreground">{tr(`${lock?.pickup_date ?? ""} 取餐時段`, `Pickup time on ${lock?.pickup_date ?? ""}`)}</p>
          <div className="flex flex-wrap gap-2">
            {windowSlots.map((s) => (
              <button
                key={s.window}
                type="button"
                disabled={!s.open && s.window !== lock?.pickup_window}
                onClick={() => setWindow(s.window)}
                className={cn("h-9 px-3 rounded-full border text-sm", window === s.window ? "border-ink bg-secondary" : "border-border bg-card", !s.open && s.window !== lock?.pickup_window && "opacity-40 cursor-not-allowed")}
              >
                <span className="text-xs text-muted-foreground mr-1">{mealPeriodLabel(mealPeriodOf(s.window))}</span>{slotLabel(s.window)}
              </button>
            ))}
          </div>
        </div>

        {bento && mains.length > 1 && (
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">{tr("主菜", "Main")}</span>
            <select className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm" value={mainIndex ?? 0} onChange={(e) => setMainIndex(Number(e.target.value))}>
              {mains.map((m, i) => <option key={i} value={i}>{m.name}（NT${m.price}）</option>)}
            </select>
          </label>
        )}

        {bento && item?.rice_component_id && (
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">{tr("白飯", "Rice")}</span>
            <div className="flex gap-2">
              {RICE_OPTIONS.map((o) => (
                <button key={o.value} type="button" onClick={() => setRice(o.value)} className={cn("flex-1 h-9 rounded-full border text-sm", rice === o.value ? "border-ink bg-secondary" : "border-border bg-card")}>
                  {tr(o.label, o.labelEn)}
                </button>
              ))}
            </div>
          </div>
        )}

        {bento && item?.slots?.map((slot, i) => (
          <label key={i} className="block space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">{slot.category}</span>
            <select
              className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm"
              value={String(choices[i] ?? "default")}
              onChange={(e) => {
                const v = e.target.value;
                setChoices((prev) => prev.map((c, j) => (j === i ? (v === "default" || v === "none" ? v : Number(v)) : c)));
                if (v === "none") setExtra(null);
              }}
            >
              <option value="default">{slot.default.name}{tr("（預設）", " (default)")}</option>
              {slot.candidates.map((c, ci) => !c.disabled && <option key={ci} value={ci}>{c.name}（{portionLabel(c.portion_level)}）</option>)}
              <option value="none">{tr(`少一道（−${Math.abs(config?.slotRemovePrice ?? 5)}）`, `None (−${Math.abs(config?.slotRemovePrice ?? 5)})`)}</option>
            </select>
          </label>
        ))}

        {bento && (item?.slots?.length ?? 0) < (config?.maxSides ?? 4) && removed === 0 && (
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted-foreground">{tr("第四道", "4th side")}</span>
            <div className="flex gap-2">
              <select
                className="flex-1 h-10 rounded-md border border-input bg-background px-2 text-sm"
                value={extra ? `${extra.slot}:${extra.candidate ?? "d"}` : ""}
                onChange={(e) => {
                  if (!e.target.value) return setExtra(null);
                  const [slot, cand] = e.target.value.split(":");
                  setExtra({ slot: Number(slot), candidate: cand === "d" ? null : Number(cand), mode: extra?.mode ?? "backup" });
                }}
              >
                <option value="">{tr("不加", "None")}</option>
                {options.filter((o) => !chosen.has(o.name)).map((o) => <option key={`${o.slot}:${o.candidate ?? "d"}`} value={`${o.slot}:${o.candidate ?? "d"}`}>{o.name}</option>)}
              </select>
              {extra && (
                <select className="h-10 rounded-md border border-input bg-background px-2 text-sm" value={extra.mode} onChange={(e) => setExtra({ ...extra, mode: e.target.value as ExtraSideChoice["mode"] })}>
                  <option value="backup">{tr("備案（不加價）", "Backup (free)")}</option>
                  <option value="addon">{tr("加菜 +10", "Add-on +10")}</option>
                </select>
              )}
            </div>
          </div>
        )}

        {preview != null && lock && preview !== lock.locked_price && (
          <p className={cn("text-sm", preview > lock.locked_price ? "text-red-600" : "text-green-700")}>
            {preview > lock.locked_price
              ? tr(`這樣要多 NT$${preview - lock.locked_price}，目前還不能線上補差額，請保留原本的選項`, `This costs NT$${preview - lock.locked_price} more, and topping up isn't supported yet — please keep your current choices`)
              : tr(`新金額 NT$${preview}，差額 ${lock.locked_price - preview} 點會退到你的平台點數`, `New price NT$${preview}; ${lock.locked_price - preview} points come back to your balance`)}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{tr("取消", "Cancel")}</Button>
          <Button onClick={save} disabled={busy || (!!lock?.menu_item_id && !item) || (preview != null && !!lock && preview > lock.locked_price)}>
            {busy ? tr("儲存中…", "Saving…") : tr("儲存", "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

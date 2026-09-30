import { tr, loc } from "@/lib/i18n";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { completePickup, LOCK_STATUS_STYLE, pickupCode, REDEEMABLE_STATUSES } from "@/lib/lockOutcome";
import { riceLabel, slotText } from "@/lib/bento";
import { todayStr } from "@/lib/pickupSlots";
import type { Lock } from "@/types";

/**
 * 商家後台訂單列（訂單管理、時段明細、取餐頁共用）：取餐號、品項、實際配菜、加減飯、備註。
 * 今天的單可以當面核對後「確認取餐」（completePickup）。未取餐不用手動登記：
 * 取餐時段結束 30 分鐘後系統自動轉愛心餐（規格 §7）。不顯示消費者姓名（§14.2）。
 */
export default function LockOrderRow({ lock, showDate = true }: { lock: Lock; showDate?: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const status = LOCK_STATUS_STYLE[lock.status] ?? { label: lock.status, className: "bg-gray-100 text-gray-700" };
  const canRedeem = REDEEMABLE_STATUSES.has(lock.status) && lock.pickup_date === todayStr();

  async function confirm() {
    setBusy(true);
    try {
      await completePickup({ lock_id: lock.id });
      toast({ title: tr("已確認取餐", "Pickup confirmed") });
    } catch (err) {
      toast({ variant: "destructive", title: tr("操作失敗", "Action failed"), description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-border rounded-lg p-3 bg-white space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-sm truncate">{loc(lock, "item_name")}</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-mono font-semibold text-foreground">{pickupCode(lock)}</span>
            {showDate && <> · {lock.pickup_date}</>} · {lock.pickup_window} · NT${lock.locked_price}
          </p>
          {(lock.slots?.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">{lock.slots!.map(slotText).join("／")}{riceLabel(lock.rice) ? `／${riceLabel(lock.rice)}` : ""}</p>
          )}
          {lock.note && <p className="text-xs text-amber-700 mt-0.5">{tr("備註：", "Note: ")}{lock.note}</p>}
        </div>
        <Badge variant="muted" className={`shrink-0 ${status.className}`}>{status.label}</Badge>
      </div>
      {canRedeem && (
        <Button size="sm" className="w-full" disabled={busy} onClick={confirm}>{tr("當面核對，確認取餐", "Checked in person — confirm pickup")}</Button>
      )}
    </div>
  );
}

import { tr, loc } from "@/lib/i18n";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { LOCK_STATUS_STYLE, markLockOutcome, pickupCode, REDEEMABLE_STATUSES } from "@/lib/lockOutcome";
import type { Lock } from "@/types";

/**
 * 商家後台訂單列（訂單管理、時段明細共用）：顯示取餐編號／品項／時段／備註，
 * 還沒取餐的可以直接「確認取餐」或「登記未取餐」（走 markLockOutcome，跟核對取餐頁同一支）。
 * 狀態更新靠呼叫端的 onSnapshot 即時反映，這裡不自己改 state。
 */
export default function LockOrderRow({ lock, showDate = true }: { lock: Lock; showDate?: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [note, setNote] = useState("");
  const status = LOCK_STATUS_STYLE[lock.status] ?? { label: lock.status, className: "bg-gray-100 text-gray-700" };
  const canRedeem = REDEEMABLE_STATUSES.has(lock.status);

  async function submit(outcome: "fulfilled" | "no_show") {
    if (outcome === "no_show" && note.trim().length < 2) {
      toast({ variant: "destructive", title: tr("請簡短描述狀況（至少 2 個字）", "Please briefly describe what happened (at least 2 characters)") });
      return;
    }
    setBusy(true);
    try {
      await markLockOutcome(lock.id, outcome, outcome === "no_show" ? note.trim() : undefined);
      toast({ title: outcome === "fulfilled" ? tr("已確認取餐", "Pickup confirmed") : tr("已登記未取餐", "Marked as no-show") });
      setNoShowOpen(false);
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
            <span className="font-mono">{pickupCode(lock)}</span>
            {showDate && <> · {lock.pickup_date}</>} · {lock.pickup_window} · NT${lock.locked_price}
          </p>
          {lock.note && <p className="text-xs text-amber-700 mt-0.5">{tr("備註：", "Note: ")}{lock.note}</p>}
          {lock.no_show_note && <p className="text-xs text-red-600 mt-0.5">{tr("未取餐說明：", "No-show note: ")}{lock.no_show_note}</p>}
        </div>
        <Badge variant="muted" className={`shrink-0 ${status.className}`}>{status.label}</Badge>
      </div>

      {canRedeem && !noShowOpen && (
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" disabled={busy} onClick={() => submit("fulfilled")}>{tr("確認取餐", "Confirm pickup")}</Button>
          <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={() => setNoShowOpen(true)}>{tr("登記未取餐", "Mark no-show")}</Button>
        </div>
      )}
      {canRedeem && noShowOpen && (
        <div className="flex flex-col gap-1.5">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tr("狀況說明（會餵給校準報告的落差分析）", "What happened (used in the calibration report)")}
            aria-label={tr("未取餐說明", "No-show note")}
            maxLength={200}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" className="flex-1" disabled={busy} onClick={() => submit("no_show")}>{tr("送出", "Submit")}</Button>
            <Button size="sm" variant="ghost" className="flex-1" disabled={busy} onClick={() => setNoShowOpen(false)}>{tr("取消", "Cancel")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

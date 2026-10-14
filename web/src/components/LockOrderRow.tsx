import { tr, loc } from "@/lib/i18n";
import { formatNT, formatPickupDate } from "@/lib/format";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { completePickup, LOCK_STATUS_STYLE, pickupCode, REDEEMABLE_STATUSES } from "@/lib/lockOutcome";
import { customOptionTexts, riceLabel, slotText } from "@/lib/bento";
import { todayStr } from "@/lib/pickupSlots";
import type { Lock } from "@/types";

/**
 * Vendor portal order row (shared by order management, slot details and the pickup page): the first column is the redemption code (4-digit pickup number + last three phone digits),
 * followed by item, actual sides, rice adjustment and notes.
 * Today's orders can be checked in person and marked "Confirm pickup" (completePickup). No-shows need no manual entry:
 * 30 minutes after the pickup slot ends the system converts them to charity meals. Diner names are not shown.
 */
export default function LockOrderRow({ lock, showDate = true }: { lock: Lock; showDate?: boolean }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const status = LOCK_STATUS_STYLE[lock.status] ?? { label: lock.status, className: "bg-muted text-foreground" };
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
    <div className="border border-border rounded-lg p-3 bg-card space-y-2">
      <div className="flex items-start gap-3">
        {/* First column: redemption code, so the vendor can match it at a glance */}
        <div className="shrink-0 min-w-[4.5rem] rounded-md bg-muted px-1.5 py-1 text-center" title={tr("取餐碼：取餐號＋手機末三碼", "Pickup code + last 3 phone digits")}>
          <p className="font-mono text-lg font-bold leading-tight tracking-wider">{pickupCode(lock)}</p>
          <p className="font-mono text-[11px] leading-tight text-muted-foreground">{lock.phone_last3 ? `${tr("手機末三碼", "Phone last 3")} ${lock.phone_last3}` : tr("取餐號", "Pickup no.")}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{loc(lock, "item_name")}</p>
          <p className="text-xs text-muted-foreground">
            {showDate && <>{formatPickupDate(lock.pickup_date)} · </>}{lock.pickup_window} · {formatNT(lock.locked_price)}
          </p>
          {(lock.slots?.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">{[...lock.slots!.map((s) => slotText(s, lock)), ...customOptionTexts(lock.custom_options, lock)].join(tr("／", " / "))}{riceLabel(lock.rice) ? `${tr("／", " / ")}${riceLabel(lock.rice)}` : ""}</p>
          )}
          {lock.note && <p className="text-xs text-warning-text mt-0.5">{tr("備註：", "Note: ")}{lock.note}</p>}
        </div>
        <Badge variant="muted" className={`shrink-0 ${status.className}`}>{status.label}</Badge>
      </div>
      {canRedeem && (
        <Button size="sm" className="w-full" disabled={busy} onClick={confirm}>{tr("當面核對，確認取餐", "Checked in person — confirm pickup")}</Button>
      )}
    </div>
  );
}

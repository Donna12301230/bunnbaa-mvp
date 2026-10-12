import { useState } from "react";
import { Coins, Undo2 } from "lucide-react";
import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import { useWallet, type WalletEntry } from "@/hooks/useWallet";
import { useConfirm } from "@/components/ConfirmDialog";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ds";
import { formatDateTime } from "@/lib/format";
import { tr } from "@/lib/i18n";

const REASON: Record<string, () => string> = {
  disaster: () => tr("停班停課退款", "Work-suspension refund"),
  transfer: () => tr("轉讓被接手退款", "Transfer refund"),
  price_change: () => tr("改便宜退差額", "Price-change refund"),
  vendor_failed: () => tr("店家未出餐退款", "Vendor no-service refund"),
};

function entryLabel(e: WalletEntry): string {
  if (e.type === "credit") return `${REASON[e.reason ?? ""]?.() ?? tr("退款", "Refund")}${e.text ? `・${e.text}` : ""}`;
  if (e.type === "spend") return tr("結帳折抵", "Used at checkout");
  if (e.type === "release") return tr("付款未完成，點數已退還", "Payment not completed — points returned");
  return tr("退回 LINE Pay", "Sent back to LINE Pay");
}

/**
 * Member center "Platform points" (2026-10-09): every refund becomes points first (1 point = NT$1) and can be used at checkout;
 * points that remember their original payment can be sent back to that transaction via "Send back to LINE Pay" (functions/src/wallet.js withdrawPoints).
 */
export default function WalletPanel() {
  const { balance, withdrawable, entries, loading } = useWallet();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function withdraw() {
    const ok = await confirm({
      title: tr(`把 ${withdrawable} 點退回 LINE Pay？`, `Send ${withdrawable} points back to LINE Pay?`),
      description: tr("每一筆點數會退回當初付款的那筆 LINE Pay 交易，實際入帳時間依 LINE Pay 與銀行而定。退回後就不能再用來折抵。", "Each batch goes back to the LINE Pay payment it came from; timing depends on LINE Pay and your bank. Returned points can't be used at checkout."),
      confirmLabel: tr("退回 LINE Pay", "Send back"),
      cancelLabel: tr("先留著", "Keep them"),
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await httpsCallable<object, { withdrawn: number; failed: number }>(functions, "withdrawPoints")({});
      const { withdrawn, failed } = res.data;
      toast({
        title: withdrawn > 0 ? tr(`已退回 ${withdrawn} 點到 LINE Pay`, `${withdrawn} points sent back to LINE Pay`) : tr("沒有退回任何點數", "Nothing was sent back"),
        ...(failed > 0 ? { description: tr(`有 ${failed} 點退回失敗（可能超過 LINE Pay 可退款期限），已留在你的點數裡，可以結帳折抵或聯絡客服。`, `${failed} points couldn't be returned (the LINE Pay refund window may have passed) and stay in your balance.`), variant: "destructive" as const } : {}),
      });
    } catch (err) {
      toast({ title: tr("退回失敗", "Couldn't send them back"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-card rounded-card border border-ink p-6 md:p-8 space-y-5" aria-labelledby="wallet-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="wallet-title" className="flex items-center gap-2 font-semibold"><Coins className="w-5 h-5 text-primary" aria-hidden="true" />{tr("平台點數", "BunnBaa points")}</h2>
          <p className="mt-1 font-heading text-4xl font-semibold tabular-nums">{loading ? "—" : balance}<span className="ml-1 text-base font-normal text-muted-foreground">{tr("點", "pts")}</span></p>
          <p className="text-sm text-muted-foreground">{tr("1 點＝NT$1，結帳時可以折抵，不會過期。", "1 point = NT$1. Use them at checkout; they don't expire.")}</p>
        </div>
        <div className="text-right space-y-1">
          <Button variant="outline" onClick={withdraw} disabled={busy || withdrawable <= 0}><Undo2 /> {busy ? tr("處理中…", "Working…") : tr("退回 LINE Pay", "Send back to LINE Pay")}</Button>
          <p className="text-xs text-muted-foreground">{tr(`可退回 ${withdrawable} 點`, `${withdrawable} points can be sent back`)}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{tr("停班停課、轉讓被接手、截單前改便宜、店家未出餐等退款，都會先存成點數；想拿回現金可以按「退回 LINE Pay」，會退到當初付款的那筆交易。", "Refunds (work suspensions, transfers taken over, cheaper changes before cutoff, vendor no-service) are stored as points first. To get cash back, send them back to the LINE Pay payment they came from.")}</p>
      {entries.length === 0 ? (
        <EmptyState size="compact" icon={<Coins size={32} />} title={tr("還沒有點數紀錄", "No point activity yet")} />
      ) : (
        <ul className="divide-y divide-border text-sm">
          {entries.map((e) => {
            const plus = e.type === "credit" || e.type === "release";
            return (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate">{entryLabel(e)}</span>
                  <span className="text-xs text-muted-foreground">{formatDateTime(e.created_at?.toDate?.())}</span>
                </span>
                <span className={`shrink-0 font-semibold tabular-nums ${plus ? "text-success-text" : "text-foreground"}`}>{plus ? "+" : "−"}{e.amount}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

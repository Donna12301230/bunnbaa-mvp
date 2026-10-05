import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { CheckCircle2, HeartHandshake, ScanLine, Search } from "lucide-react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import QrScannerDialog from "@/components/QrScannerDialog";
import LockOrderRow from "@/components/LockOrderRow";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import { completePickup, PENDING_STATUSES, type PickupSummary } from "@/lib/lockOutcome";
import { todayStr } from "@/lib/pickupSlots";
import { db } from "@/lib/firebase";
import { tr } from "@/lib/i18n";
import { customOptionTexts } from "@/lib/bento";
import type { Lock } from "@/types";

/**
 * 取餐核銷（規格 §6）：店家以手機網頁相機掃消費者的 QR（伺服器簽章的一次性憑證），
 * 畫面顯示取餐號、主菜、實際配菜（許願結果）、加減飯、折價券折抵、實付金額，按「完成取餐」
 * 觸發 onOrderCompleted（計入營業額、發抽獎券）。只有該店帳號可核銷。
 * 備援：4 碼取餐號＋手機末三碼。代領：支援連續掃描多筆。愛心餐預約的 QR 也在這裡掃。
 * 路徑沿用 /lock/vendor/redeem，舊書籤不會壞。
 */
export default function VendorRedeemPage() {
  const vendorId = useAuth().user?.vendorId;
  const [scannerOpen, setScannerOpen] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [pending, setPending] = useState<{ summary: PickupSummary; args: { token?: string; pickup_code?: string; phone_last3?: string } } | null>(null);
  const [code, setCode] = useState("");
  const [last3, setLast3] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<PickupSummary[]>([]);
  const [todayLocks, setTodayLocks] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);
  const today = todayStr();

  useEffect(() => {
    if (!vendorId) return;
    return onSnapshot(query(collection(db, "locks"), where("vendor_id", "==", vendorId), where("pickup_date", "==", today)), (snap) => {
      setTodayLocks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Lock).sort((a, b) => (a.pickup_code ?? "").localeCompare(b.pickup_code ?? "")));
      setLoading(false);
    }, () => setLoading(false));
  }, [vendorId, today]);

  const stats = useMemo(() => ({
    total: todayLocks.filter((l) => l.status !== "cancelled").length,
    waiting: todayLocks.filter((l) => PENDING_STATUSES.has(l.status)).length,
    done: todayLocks.filter((l) => l.status === "fulfilled" || l.status === "resold_and_fulfilled").length,
    charity: todayLocks.filter((l) => l.status === "charity").length,
  }), [todayLocks]);

  async function lookup(args: { token?: string; pickup_code?: string; phone_last3?: string }) {
    setBusy(true);
    try {
      const summary = await completePickup({ ...args, preview: true });
      setPending({ summary, args });
    } catch (err) {
      toast({ variant: "destructive", title: tr("查不到可取餐的訂單", "No order to pick up"), description: (err as Error).message });
      if (continuous) setScannerOpen(true);
    } finally {
      setBusy(false);
    }
  }

  const onScan = useCallback((text: string) => {
    setScannerOpen(false);
    lookup({ token: text });
  }, [continuous]);

  async function finish() {
    if (!pending) return;
    setBusy(true);
    try {
      const summary = await completePickup(pending.args);
      setDone((prev) => [summary, ...prev].slice(0, 20));
      setPending(null);
      setCode("");
      setLast3("");
      toast({ title: tr(`已完成取餐 ${summary.pickup_code ?? ""}`, `Picked up ${summary.pickup_code ?? ""}`) });
      if (continuous) setScannerOpen(true);
    } catch (err) {
      toast({ variant: "destructive", title: tr("核銷失敗", "Couldn't complete"), description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const s = pending?.summary;

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-1 flex items-center gap-2"><ScanLine className="w-5 h-5 text-orange-500" /> {tr("取餐掃碼", "Pickup scan")}</h2>
      <p className="text-sm text-muted-foreground mb-4">{tr("掃顧客的取餐 QR Code；掃不到時輸入 4 碼取餐號＋手機末三碼。標籤與畫面都不顯示顧客姓名。", "Scan the customer's QR code, or enter the 4-digit code plus the last 3 phone digits. Names are never shown.")}</p>

      <div className="grid grid-cols-4 gap-2 mb-4 text-center">
        {[
          [tr("今日訂單", "Today"), stats.total],
          [tr("待取餐", "Waiting"), stats.waiting],
          [tr("已取餐", "Done"), stats.done],
          [tr("轉愛心餐", "Charity"), stats.charity],
        ].map(([label, n]) => (
          <Card key={label as string}><CardContent className="p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-bold">{n}</p></CardContent></Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{tr("掃描 QR Code", "Scan QR code")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" onClick={() => setScannerOpen(true)} disabled={busy}><ScanLine /> {tr("用相機掃描", "Scan with camera")}</Button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} />
              {tr("連續掃描（代領多筆）", "Continuous scanning (proxy pickups)")}
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{tr("備援：取餐號＋手機末三碼", "Backup: code + phone digits")}</CardTitle></CardHeader>
          <CardContent>
            <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); lookup({ pickup_code: code.trim(), phone_last3: last3.trim() }); }}>
              <div className="flex-1"><Label htmlFor="pc">{tr("取餐號", "Code")}</Label><Input id="pc" inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></div>
              <div className="w-24"><Label htmlFor="p3">{tr("末三碼", "Last 3")}</Label><Input id="p3" inputMode="numeric" maxLength={3} value={last3} onChange={(e) => setLast3(e.target.value.replace(/\D/g, ""))} /></div>
              <Button type="submit" disabled={busy || code.length !== 4 || last3.length !== 3}><Search /></Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {s && (
        <Card className="mb-6 border-2 border-orange-300">
          <CardContent className="p-4 space-y-2">
            {s.kind === "charity" ? (
              <p className="font-semibold flex items-center gap-1.5 text-pink-700"><HeartHandshake className="w-4 h-4" /> {tr("愛心餐預約", "Charity reservation")}</p>
            ) : null}
            <div className="flex items-baseline justify-between">
              <span className="text-3xl font-extrabold tracking-widest">{s.pickup_code}</span>
              {s.kind === "lock" && <span className="text-sm text-muted-foreground">{s.pickup_window}</span>}
            </div>
            <p className="font-semibold">{s.item_name}</p>
            {s.slots && s.slots.length > 0 && (
              <ul className="text-sm space-y-0.5">
                {s.slots.map((slot, i) => (
                  <li key={i}>
                    {slot.category}：{slot.removed ? <Badge variant="muted">{tr("不要", "none")}</Badge> : slot.dish}
                    {slot.wished && slot.dish === slot.wished && <Badge variant="muted" className="ml-1 bg-orange-100 text-orange-700">{tr("許願成立", "wish")}</Badge>}
                  </li>
                ))}
              </ul>
            )}
            {s.sides && s.sides.length > 0 && <p className="text-sm">{s.sides.join("、")}</p>}
            {s.main_dish && <p className="text-sm">{tr("主菜：", "Main: ")}<strong>{s.main_dish}</strong></p>}
            {s.extra_side && <p className="text-sm">{s.extra_side.mode === "addon" ? tr(`加菜：${s.extra_side.dish}`, `Add-on: ${s.extra_side.dish}`) : s.extra_side.used ? tr(`備案已遞補：${s.extra_side.dish}`, `Backup used: ${s.extra_side.dish}`) : tr(`備案（未用到）：${s.extra_side.dish}`, `Backup (unused): ${s.extra_side.dish}`)}</p>}
            {customOptionTexts(s.custom_options).map((text, k) => <p key={k} className="text-sm">{text}</p>)}
            {s.rice && s.rice !== "normal" && <p className="text-sm font-semibold">{s.rice === "add" ? tr("白飯一碗半", "1.5 bowls of rice") : tr("白飯半碗", "Half bowl of rice")}</p>}
            {s.note && <p className="text-sm text-amber-700">{tr("備註：", "Note: ")}{s.note}</p>}
            {s.kind === "lock" && (
              <p className="text-sm text-muted-foreground">
                {(s.coupon_discount ?? 0) > 0 && tr(`折價券折抵 ${s.coupon_discount} 元・`, `Coupon −${s.coupon_discount} · `)}{tr(`實付 ${s.paid} 元（已線上付款）`, `Paid NT$${s.paid} online`)}
              </p>
            )}
            <div className="flex gap-2 pt-1">
              <Button className="flex-1" onClick={finish} disabled={busy}><CheckCircle2 /> {tr("完成取餐", "Complete pickup")}</Button>
              <Button variant="outline" onClick={() => setPending(null)} disabled={busy}>{tr("取消", "Cancel")}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {done.length > 0 && (
        <p className="text-xs text-muted-foreground mb-4">{tr("剛完成：", "Just done: ")}{done.map((d) => d.pickup_code).join("、")}</p>
      )}

      <h3 className="font-semibold mb-2">{tr("今日訂單", "Today's orders")}</h3>
      {loading ? (
        <SkeletonBlocks count={3} height={72} className="space-y-2" />
      ) : todayLocks.length === 0 ? (
        <EmptyState size="compact" icon={<ScanLine size={32} />} title={tr("今天沒有訂單", "No orders today")} />
      ) : (
        <div className="grid md:grid-cols-2 gap-2">
          {todayLocks.map((l) => <LockOrderRow key={l.id} lock={l} showDate={false} />)}
        </div>
      )}

      <QrScannerDialog open={scannerOpen} onOpenChange={setScannerOpen} onScan={onScan} />
    </VendorPortalLayout>
  );
}

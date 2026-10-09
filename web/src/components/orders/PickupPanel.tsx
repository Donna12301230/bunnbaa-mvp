import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, HeartHandshake, Keyboard, ScanLine, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import QrScannerDialog from "@/components/QrScannerDialog";
import LockOrderRow from "@/components/LockOrderRow";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import { completePickup, DONE_STATUSES, PENDING_STATUSES, type PickupSummary } from "@/lib/lockOutcome";
import { tr } from "@/lib/i18n";
import { customOptionTexts } from "@/lib/bento";
import { cn } from "@/lib/utils";
import type { Lock } from "@/types";

/**
 * 取餐核銷（規格 §6）：店家以手機網頁相機掃消費者的 QR（伺服器簽章的一次性憑證），
 * 畫面顯示取餐號、主菜、實際配菜（許願結果）、加減飯、折價券折抵、實付金額，按「完成取餐」
 * 觸發 onOrderCompleted（計入營業額、發抽獎券）。只有該店帳號可核銷。
 * 備援：4 碼取餐號＋手機末三碼。代領：支援連續掃描多筆。愛心餐預約的 QR 也在這裡掃。
 * 今天的訂單依取餐時段分組，每組一條已取／待取進度條。
 */
export default function PickupPanel({ todayLocks, loading }: { todayLocks: Lock[]; loading: boolean }) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [manual, setManual] = useState(false);
  const [pending, setPending] = useState<{ summary: PickupSummary; args: { token?: string; pickup_code?: string; phone_last3?: string } } | null>(null);
  const [code, setCode] = useState("");
  const [last3, setLast3] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<PickupSummary[]>([]);
  const [onlyWaiting, setOnlyWaiting] = useState(true);

  const stats = useMemo(() => ({
    total: todayLocks.filter((l) => l.status !== "cancelled").length,
    waiting: todayLocks.filter((l) => PENDING_STATUSES.has(l.status)).length,
    done: todayLocks.filter((l) => DONE_STATUSES.has(l.status)).length,
    charity: todayLocks.filter((l) => l.status === "charity").length,
  }), [todayLocks]);

  // 依取餐時段分組
  const windows = useMemo(() => {
    const map = new Map<string, Lock[]>();
    for (const l of todayLocks) {
      if (l.status === "cancelled") continue;
      map.set(l.pickup_window, [...(map.get(l.pickup_window) ?? []), l]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [todayLocks]);

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
    <div className="space-y-4">
      {/* 大按鈕：掃描；備援輸入收起來 */}
      <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <Card className="border-2 border-foreground">
          <CardContent className="p-4 space-y-3">
            <Button className="w-full h-16 text-lg" onClick={() => setScannerOpen(true)} disabled={busy}><ScanLine className="!w-6 !h-6" /> {tr("掃顧客的取餐 QR", "Scan pickup QR")}</Button>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="w-4 h-4" checked={continuous} onChange={(e) => setContinuous(e.target.checked)} />
                {tr("連續掃（代領多筆）", "Keep scanning (proxy pickups)")}
              </label>
              <button type="button" className="inline-flex items-center gap-1 text-primary underline" onClick={() => setManual((v) => !v)} aria-expanded={manual}><Keyboard className="w-4 h-4" />{tr("掃不到？輸入號碼", "Can't scan? Type it")}</button>
            </div>
            {manual && (
              <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); lookup({ pickup_code: code.trim(), phone_last3: last3.trim() }); }}>
                <div className="flex-1"><Label htmlFor="pc">{tr("取餐號（4 碼）", "Code (4 digits)")}</Label><Input id="pc" className="h-11 text-lg font-mono tracking-widest" inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></div>
                <div className="w-28"><Label htmlFor="p3">{tr("手機末三碼", "Phone last 3")}</Label><Input id="p3" className="h-11 text-lg font-mono tracking-widest" inputMode="numeric" maxLength={3} value={last3} onChange={(e) => setLast3(e.target.value.replace(/\D/g, ""))} /></div>
                <Button type="submit" className="h-11" disabled={busy || code.length !== 4 || last3.length !== 3} aria-label={tr("查詢", "Look up")}><Search /></Button>
              </form>
            )}
          </CardContent>
        </Card>
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: tr("待取", "Waiting"), n: stats.waiting, cls: "bg-warning-soft border-warning/50 text-warning-text" },
            { label: tr("已取", "Picked up"), n: stats.done, cls: "bg-success-soft border-success/40 text-success-text" },
            { label: tr("轉愛心餐", "Charity"), n: stats.charity, cls: "bg-charity-soft border-charity/40 text-charity" },
          ].map((x) => (
            <div key={x.label} className={cn("rounded-xl border-2 p-3 flex flex-col justify-center text-center", x.cls)}>
              <p className="text-3xl font-bold leading-none">{x.n}</p>
              <p className="text-xs mt-1">{x.label}</p>
            </div>
          ))}
        </div>
      </div>

      {s && (
        <Card className="border-4 border-brand">
          <CardContent className="p-5 space-y-2">
            {s.kind === "charity" ? (
              <p className="font-semibold flex items-center gap-1.5 text-charity"><HeartHandshake className="w-4 h-4" /> {tr("愛心餐預約", "Charity reservation")}</p>
            ) : null}
            <div className="flex items-baseline justify-between">
              <span className="text-5xl font-extrabold tracking-widest">{s.pickup_code}</span>
              {s.kind === "lock" && <span className="text-sm text-muted-foreground">{s.pickup_window}</span>}
            </div>
            <p className="text-lg font-semibold">{s.item_name}</p>
            {s.main_dish && <p className="text-sm">{tr("主菜：", "Main: ")}<strong>{s.main_dish}</strong></p>}
            {s.slots && s.slots.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {s.slots.map((slot, i) => (
                  <span key={i} className={cn("rounded-md border px-2 py-0.5 text-sm", slot.removed ? "border-dashed text-muted-foreground line-through" : "bg-success-soft border-success/40")}>
                    {slot.removed ? slot.category : slot.dish}
                    {slot.wished && slot.dish === slot.wished && <Badge variant="muted" className="ml-1 bg-secondary text-accent-foreground">{tr("許願", "wish")}</Badge>}
                  </span>
                ))}
              </div>
            )}
            {s.sides && s.sides.length > 0 && <p className="text-sm">{s.sides.join("、")}</p>}
            {s.extra_side && <p className="text-sm">{s.extra_side.mode === "addon" ? tr(`加菜：${s.extra_side.dish}`, `Add-on: ${s.extra_side.dish}`) : s.extra_side.used ? tr(`備案已遞補：${s.extra_side.dish}`, `Backup used: ${s.extra_side.dish}`) : tr(`備案（未用到）：${s.extra_side.dish}`, `Backup (unused): ${s.extra_side.dish}`)}</p>}
            {customOptionTexts(s.custom_options).map((text, k) => <p key={k} className="text-sm">{text}</p>)}
            {s.rice && s.rice !== "normal" && <p className="text-base font-bold text-warning-text">{s.rice === "add" ? tr("白飯一碗半", "1.5 bowls of rice") : tr("白飯半碗", "Half bowl of rice")}</p>}
            {s.note && <p className="text-sm text-warning-text">{tr("備註：", "Note: ")}{s.note}</p>}
            {s.kind === "lock" && (
              <p className="text-sm text-muted-foreground">
                {(s.coupon_discount ?? 0) > 0 && tr(`折價券折抵 ${s.coupon_discount} 元・`, `Coupon −${s.coupon_discount} · `)}{tr(`實付 ${s.paid} 元（已線上付款）`, `Paid NT$${s.paid} online`)}
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <Button className="flex-1 h-14 text-lg" onClick={finish} disabled={busy}><CheckCircle2 className="!w-6 !h-6" /> {tr("完成取餐", "Complete pickup")}</Button>
              <Button variant="outline" className="h-14" onClick={() => setPending(null)} disabled={busy}>{tr("取消", "Cancel")}</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {done.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">{tr("剛完成：", "Just done: ")}</span>
          {done.map((d, i) => <span key={i} className="rounded-full bg-success-soft px-2 py-0.5 font-mono font-semibold text-success-text">✓ {d.pickup_code}</span>)}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{tr("今天的單", "Today's orders")}</h3>
        <div className="inline-flex rounded-full border border-border p-0.5 text-xs">
          {[true, false].map((v) => (
            <button key={String(v)} type="button" onClick={() => setOnlyWaiting(v)} aria-pressed={onlyWaiting === v} className={cn("rounded-full px-3 py-1", onlyWaiting === v ? "bg-foreground text-background font-semibold" : "text-muted-foreground")}>
              {v ? tr("只看待取", "Waiting only") : tr("全部", "All")}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <SkeletonBlocks count={3} height={72} className="space-y-2" />
      ) : windows.length === 0 ? (
        <EmptyState size="compact" icon={<ScanLine size={32} />} title={tr("今天沒有訂單", "No orders today")} />
      ) : (
        <div className="space-y-5">
          {windows.map(([w, rows]) => {
            const got = rows.filter((l) => DONE_STATUSES.has(l.status)).length;
            const shown = onlyWaiting ? rows.filter((l) => PENDING_STATUSES.has(l.status)) : rows;
            return (
              <section key={w} className="space-y-2">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-semibold text-sm w-28 shrink-0">{w}</span>
                  <div className="flex-1 flex h-3 overflow-hidden rounded-full bg-warning" role="img" aria-label={tr(`已取 ${got} / ${rows.length}`, `${got} of ${rows.length}`)}>
                    <div className="h-full bg-success-strong" style={{ width: `${(got / rows.length) * 100}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground w-12 text-right">{got} / {rows.length}</span>
                </div>
                {shown.length === 0 ? <p className="text-xs text-success-text pl-1">{tr("這個時段都取完了 ✓", "All picked up ✓")}</p> : (
                  <div className="grid md:grid-cols-2 gap-2">
                    {shown.map((l) => <LockOrderRow key={l.id} lock={l} showDate={false} />)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <QrScannerDialog open={scannerOpen} onOpenChange={setScannerOpen} onScan={onScan} />
    </div>
  );
}

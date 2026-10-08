import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { collection, onSnapshot } from "firebase/firestore";
import { Gift, PartyPopper, Ticket, Trophy } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import PageHero from "@/components/PageHero";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ds";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useMyCoupons, useMyTickets, millis } from "@/hooks/useMyRewards";
import { couponTitle, openProgress, tierLabel } from "@/lib/rewards";
import { tr } from "@/lib/i18n";
import type { RewardStatus } from "@/types";

/**
 * 成長獎勵（規格 §8、§9）：店家累積淨營業額滿 1 萬元時，以其中 5% 生成回饋池，拆成折價券供消費者抽獎，人人有獎。
 * 每累計實付 100 元一張抽獎券（只能抽該店家的回饋池）；營業額未達 1 萬元不開池，持續累積。
 * 抽中後 30 天有效，結帳時自動可選用，每筆限用一張。
 */
export default function RewardsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const tickets = useMyTickets(user?.id);
  const { coupons } = useMyCoupons(user?.id);
  const [statuses, setStatuses] = useState<RewardStatus[]>([]);
  const [drawing, setDrawing] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; discount: number; expires_at: number; vendor: string } | null>(null);

  useEffect(() => onSnapshot(collection(db, "rewardStatus"), (snap) => {
    setStatuses(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RewardStatus));
  }, () => setStatuses([])), []);

  const byVendor = useMemo(() => {
    const map = new Map<string, { vendorId: string; name: string; pending: number; drawable: number }>();
    for (const t of tickets) {
      const g = map.get(t.vendor_id) ?? { vendorId: t.vendor_id, name: t.vendor_name || "", pending: 0, drawable: 0 };
      if (t.status === "pending") g.pending++;
      if (t.status === "drawable" && millis(t.draw_deadline) > Date.now()) g.drawable++;
      map.set(t.vendor_id, g);
    }
    return [...map.values()];
  }, [tickets]);

  async function draw(vendorId: string, name: string) {
    setDrawing(vendorId);
    try {
      const res = await httpsCallable(functions, "drawTicket")({ vendor_id: vendorId });
      const data = res.data as { label: string; discount: number; expires_at: number };
      setResult({ ...data, vendor: name });
    } catch (err) {
      toast({ title: tr("抽獎失敗", "Draw failed"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setDrawing(null);
    }
  }

  const statusOf = (vendorId: string) => statuses.find((s) => s.id === vendorId);
  const ownedCoupons = coupons.filter((c) => c.status === "owned" && millis(c.expires_at) > Date.now());
  const pastCoupons = coupons.filter((c) => !ownedCoupons.includes(c));

  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader active="rewards" />
      <PageHero eyebrow={tr("人人有獎", "Everyone wins")} title={tr("成長獎勵", "Rewards")} description={tr("每累計實付 100 元一張抽獎券；店家累積營業額滿 1 萬元就開獎，拿出其中 5% 當回饋池，人人有獎。", "Every NT$100 you pay earns a ticket. Once a vendor's sales reach NT$10,000 the draw opens, with 5% of those sales as the reward pool — everyone wins.")} />
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-12 space-y-14">
        {!user ? (
          <EmptyState icon={<Trophy size={32} />} title={tr("請先登入", "Please sign in")} description={tr("登入後就能看到你的抽獎券、抽獎進度與折價券。", "Sign in to see your tickets, draw progress and coupons.")} action={<Button asChild><Link href="/login">{tr("前往登入", "Sign in")}</Link></Button>} />
        ) : (
          <>
            <section className="space-y-3">
              <h2 className="font-heading text-3xl font-semibold flex items-center gap-3"><Ticket className="w-7 h-7 text-primary" aria-hidden="true" /> {tr("我的抽獎券", "My tickets")}</h2>
              {byVendor.length === 0 ? (
                <EmptyState size="compact" icon={<Ticket size={32} />} title={tr("還沒有抽獎券", "No tickets yet")} description={tr("取餐完成（或便當轉為愛心餐）後，每累計實付 100 元就會拿到一張。", "You get one for every NT$100 paid once meals are picked up (or become charity meals).")} />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {byVendor.map((g) => {
                    const st = statusOf(g.vendorId);
                    return (
                      <div key={g.vendorId} className="bg-card rounded-[1.75rem] border border-ink p-6 space-y-3">
                        <p className="font-heading text-xl font-semibold">{g.name || st?.vendor_name}</p>
                        <p className="text-sm">
                          {g.drawable > 0
                            ? tr(`${g.drawable} 張可以抽`, `${g.drawable} ready to draw`)
                            : tr(`${g.pending} 張等待開池`, `${g.pending} waiting for the pool`)}
                        </p>
                        {st && !st.pool_open && (
                          <>
                            <div className="h-2.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(openProgress(st))} aria-label={tr("開獎進度", "Draw progress")}>
                              <div className="h-full rounded-full bg-[#f29e0c] transition-[width] duration-700" style={{ width: `${openProgress(st)}%` }} />
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {st.paused ? tr("店家暫停參加本期", "Vendor paused this period") : st.amount_to_open <= 0 ? tr("全店已達標，下週一開獎", "Target reached — the draw opens next Monday") : tr(`全店再賣 ${st.amount_to_open} 元開獎`, `NT$${st.amount_to_open} more in sales to open`)}
                            </p>
                          </>
                        )}
                        {st?.pool_open && (
                          <p className="text-xs text-muted-foreground">{tr(`抽獎期限 ${new Date(millis(st.draw_deadline)).toLocaleDateString()}，逾期未抽的獎項回歸店家`, `Draw by ${new Date(millis(st.draw_deadline)).toLocaleDateString()}`)}</p>
                        )}
                        <Button size="sm" disabled={g.drawable === 0 || drawing !== null} onClick={() => draw(g.vendorId, g.name || st?.vendor_name || "")}>
                          <Gift /> {drawing === g.vendorId ? tr("抽獎中…", "Drawing…") : tr("抽一張", "Draw")}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h2 className="font-heading text-3xl font-semibold">{tr("我的折價券", "My coupons")}</h2>
              {ownedCoupons.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tr("目前沒有可用的折價券。", "No usable coupons right now.")}</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {ownedCoupons.map((c) => (
                    <div key={c.id} className="rounded-[1.5rem] border-2 border-dashed border-ink bg-accent p-6">
                      <p className="font-heading text-4xl font-semibold">{couponTitle(c.discount)}</p>
                      <p className="text-xs text-muted-foreground">{tierLabel(c.tier)}</p>
                      <p className="text-sm mt-1">{c.vendor_name}</p>
                      <p className="text-xs text-muted-foreground">{tr("到期", "Expires")} {new Date(millis(c.expires_at)).toLocaleDateString()}</p>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">{tr("折價券只能在發券店家使用、綁定帳號不可轉讓；每筆訂單限用一張，折抵不超過訂單小計、不找零。訂單取消（取餐 48 小時前）時，用掉的券會退回並保留原到期日。", "Coupons are for the issuing vendor only and can't be transferred. One per order, no change given. If you cancel the order (up to 48 hours before pickup), the coupon you used comes back with its original expiry.")}</p>
              {pastCoupons.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">{tr("已使用／過期", "Used / expired")}（{pastCoupons.length}）</summary>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {pastCoupons.map((c) => <li key={c.id}>{c.vendor_name} {couponTitle(c.discount)}・{c.status === "redeemed" ? tr("已使用", "used") : tr("已過期", "expired")}</li>)}
                  </ul>
                </details>
              )}
            </section>
          </>
        )}
      </div>

      <Dialog open={!!result} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent className="max-w-xs text-center">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-center gap-2"><PartyPopper className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("恭喜！", "Congrats!")}</DialogTitle>
            <DialogDescription>{result?.vendor}</DialogDescription>
          </DialogHeader>
          {result && (
            <>
              <p className="font-heading text-6xl font-semibold">{couponTitle(result.discount)}</p>
              <p className="text-sm text-muted-foreground">{result.label}</p>
              <p className="text-xs text-muted-foreground">{tr(`${new Date(result.expires_at).toLocaleDateString()} 前有效，結帳時選用`, `Valid until ${new Date(result.expires_at).toLocaleDateString()} — apply it at checkout`)}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

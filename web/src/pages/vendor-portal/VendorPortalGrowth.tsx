import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { Download, PauseCircle, PlayCircle, Search, Trophy, RefreshCw } from "lucide-react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { ALL_TIERS, allocatePool, tierLabel } from "@/lib/rewards";
import { usePlatformConfig } from "@/lib/platformConfig";
import { tr } from "@/lib/i18n";
import type { Coupon, RewardStatus } from "@/types";

interface Period {
  id: string;
  status?: string;
  net_revenue?: number;
  refunds?: number;
  tickets?: number;
  carried_revenue?: number;
  carried_tickets?: number;
  total_revenue?: number;
  total_tickets?: number;
  pool?: number;
  allocation?: Record<string, number>;
  remaining?: Record<string, number>;
  leftover?: number;
  unclaimed_amount?: number;
  draw_deadline?: unknown;
}
const millis = (ts: unknown) => (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
const STATUS_LABEL: Record<string, [string, string]> = {
  pooled: ["開獎中", "Draw open"], carried: ["未達門檻，結轉", "Carried over"], closed: ["已結束", "Closed"], paused: ["暫停", "Paused"],
};

/**
 * 成長獎勵與券負債看板（規格 §8、§9.3、§9.4）：每週以淨營業額 10% 生成回饋池，拆成折價券抽獎，
 * 人人有獎；券發出後規則不可變更。店家以「流通中負債」掌握潛在成本。
 */
export default function VendorPortalGrowth() {
  const vendorId = useAuth().user?.vendorId;
  const { data: vendor } = useMyVendor();
  const { data: config } = usePlatformConfig();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [periods, setPeriods] = useState<Period[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [status, setStatus] = useState<RewardStatus | null>(null);
  const [lookup, setLookup] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    if (!vendorId) return;
    const u1 = onSnapshot(collection(db, "vendors", vendorId, "rewardPeriods"), (s) => setPeriods(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Period).sort((a, b) => b.id.localeCompare(a.id))));
    const u2 = onSnapshot(query(collection(db, "coupons"), where("vendor_id", "==", vendorId)), (s) => setCoupons(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Coupon)));
    const u3 = onSnapshot(doc(db, "rewardStatus", vendorId), (s) => setStatus(s.exists() ? ({ id: s.id, ...s.data() } as RewardStatus) : null));
    return () => {
      u1();
      u2();
      u3();
    };
  }, [vendorId]);

  const current = periods.find((p) => p.status === "pooled") ?? periods.find((p) => p.status === "closed");
  const m = useMemo(() => {
    const sum = (list: Coupon[]) => list.reduce((s, c) => s + (c.discount || 0), 0);
    const owned = coupons.filter((c) => c.status === "owned");
    const redeemed = coupons.filter((c) => c.status === "redeemed");
    const soon = owned.filter((c) => millis(c.expires_at) < Date.now() + 7 * 86400000);
    return {
      liability: sum(owned), ownedCount: owned.length,
      redeemedAll: sum(redeemed), redeemedCount: redeemed.length,
      redeemedPeriod: sum(redeemed.filter((c) => c.pool_period === current?.id)),
      returned: sum(coupons.filter((c) => c.status === "expired" || c.status === "unclaimed")) + periods.reduce((s, p) => s + (p.leftover || 0), 0),
      expiringSoon: sum(soon), expiringCount: soon.length,
    };
  }, [coupons, periods, current?.id]);

  const found = lookup.trim() ? coupons.filter((c) => c.id === lookup.trim() || c.lock_id === lookup.trim()) : [];

  function exportCsv() {
    const rows = coupons.filter((c) => (!from || c.pool_period >= from) && (!to || c.pool_period <= to));
    const header = ["coupon_id", "pool_period", "tier", "discount", "status", "expires_at", "lock_id"];
    const csv = [header, ...rows.map((c) => [c.id, c.pool_period, c.tier, c.discount, c.status, c.expires_at ? new Date(millis(c.expires_at)).toISOString() : "", c.lock_id ?? ""])]
      .map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `coupons_${vendorId}_${from || "all"}_${to || "all"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function togglePause() {
    const paused = !vendor?.rewards_paused_from;
    if (paused && !(await confirm({ title: tr("暫停參加下一期？", "Pause the next period?"), description: tr("需提前 7 天：從 7 天後的那一週起不再發抽獎券、不開池。已發出的券照常兌現。", "Takes effect from the week at least 7 days out. Issued coupons stay valid."), confirmLabel: tr("暫停", "Pause") }))) return;
    setBusy(true);
    try {
      const res = await httpsCallable(functions, "setRewardPause")({ paused });
      const r = res.data as { paused_from: string | null };
      toast({ title: r.paused_from ? tr(`將從 ${r.paused_from} 那週起暫停`, `Paused from ${r.paused_from}`) : tr("已恢復參加", "Resumed") });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function closeNow() {
    setBusy(true);
    try {
      const res = await httpsCallable(functions, "triggerRewardPeriodNow")({});
      toast({ title: tr("已結算上一期", "Last period settled"), description: JSON.stringify(res.data) });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const preview = allocatePool(Math.floor(10000), 1000);

  return (
    <VendorPortalLayout>
      <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-1 flex items-center gap-2"><Trophy className="w-5 h-5 text-orange-500" /> {tr("成長獎勵・券負債", "Rewards & coupon liability")}</h1>
      <p className="text-sm text-muted-foreground mb-4">
        {tr(`每週一結算上一週：淨營業額 × ${Math.round((config?.rewardRate ?? 0.1) * 100)}% 生成回饋池，抽獎券滿 ${config?.minTicketsToOpen ?? 100} 張才開池（未達標結轉，不強制開池）。折價券於線上結帳時自動套用，店家不需人工收券；券發出後規則不可變更。`,
          `Settled every Monday: net revenue × ${Math.round((config?.rewardRate ?? 0.1) * 100)}% becomes the pool; it opens once ${config?.minTicketsToOpen ?? 100} tickets are in.`)}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">{tr("本期回饋池", "Current pool")}</p><p className="text-xl font-bold">NT${current?.pool ?? 0}</p><p className="text-xs text-muted-foreground">{current ? current.id : "—"}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">{tr("流通中負債", "Outstanding liability")}</p><p className="text-xl font-bold text-orange-600">NT${m.liability}</p><p className="text-xs text-muted-foreground">{m.ownedCount} {tr("張持有中", "held")}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">{tr("已兌現（本期／累計）", "Redeemed (period / total)")}</p><p className="text-xl font-bold">NT${m.redeemedPeriod} / {m.redeemedAll}</p><p className="text-xs text-muted-foreground">{m.redeemedCount} {tr("張", "coupons")}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">{tr("回歸金額（過期、未抽、未分配）", "Returned (expired, unclaimed, unallocated)")}</p><p className="text-xl font-bold">NT${m.returned}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">{tr("未來 7 天到期", "Expiring in 7 days")}</p><p className="text-xl font-bold">NT${m.expiringSoon}</p><p className="text-xs text-muted-foreground">{m.expiringCount} {tr("張", "coupons")}</p></CardContent></Card>
        <Card><CardContent className="p-3"><p className="text-xs text-muted-foreground">{tr("距離開池", "To next pool")}</p><p className="text-xl font-bold">{status?.pool_open ? tr("開獎中", "Open") : `${status?.tickets_so_far ?? 0}/${status?.min_tickets ?? 100}`}</p><p className="text-xs text-muted-foreground">{status?.pool_open ? "" : tr(`再 ${status?.amount_to_open ?? "—"} 元`, `NT$${status?.amount_to_open ?? "—"} to go`)}</p></CardContent></Card>
      </div>

      {current?.allocation && (
        <Card className="mb-4">
          <CardHeader className="pb-2"><CardTitle className="text-base">{tr("本期券種分配（剩餘／總數）", "This pool's coupons (left / total)")}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-3 md:grid-cols-6 gap-2 text-center text-sm">
            {ALL_TIERS.map((t) => (
              <div key={t.code} className="rounded border p-2"><p className="text-xs">{tierLabel(t.code)}</p><p className="font-bold">{current.remaining?.[t.code] ?? 0}/{current.allocation?.[t.code] ?? 0}</p><p className="text-xs text-muted-foreground">{tr(`折 ${t.discount}`, `−${t.discount}`)}</p></div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mb-4">
        <CardHeader className="pb-2"><CardTitle className="text-base">{tr("結算紀錄", "Periods")}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">{tr("期別（週一）", "Week")}</th><th>{tr("淨營業額", "Net revenue")}</th><th>{tr("結轉", "Carried")}</th><th>{tr("抽獎券", "Tickets")}</th><th>{tr("回饋池", "Pool")}</th><th>{tr("狀態", "Status")}</th></tr></thead>
            <tbody>{periods.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="py-1">{p.id}</td>
                <td>NT${p.net_revenue ?? 0}{p.refunds ? <span className="text-xs text-red-600"> (−{p.refunds})</span> : null}</td>
                <td className="text-xs">{p.carried_revenue ? `NT$${p.carried_revenue}／${p.carried_tickets}${tr("張", "")}` : "—"}</td>
                <td>{p.total_tickets ?? p.tickets ?? 0}</td>
                <td>{p.pool ? `NT$${p.pool}` : "—"}</td>
                <td>{p.status ? <Badge variant="muted">{tr(...(STATUS_LABEL[p.status] ?? [p.status, p.status]))}</Badge> : tr("累積中", "Accumulating")}</td>
              </tr>
            ))}</tbody>
          </table>
          {periods.length === 0 && <p className="text-sm text-muted-foreground">{tr("還沒有結算紀錄。", "No periods yet.")}</p>}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{tr("查詢單張券", "Look up a coupon")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2"><Input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder={tr("券 ID 或訂單 ID", "Coupon ID or order ID")} /><Button variant="outline" size="icon"><Search /></Button></div>
            {found.map((c) => <p key={c.id} className="text-sm">{c.id}：{tierLabel(c.tier)} {tr(`折 ${c.discount}`, `−${c.discount}`)}・{c.status}・{c.pool_period}{c.lock_id ? `・${tr("訂單", "order")} ${c.lock_id}` : ""}</p>)}
            {lookup && found.length === 0 && <p className="text-xs text-muted-foreground">{tr("查無資料", "Not found")}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{tr("匯出 CSV 與設定", "Export & settings")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="flex gap-2 items-center text-sm">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /> ～ <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" />
              <Button size="sm" variant="outline" onClick={exportCsv}><Download /> CSV</Button>
            </div>
            <Button size="sm" variant="outline" onClick={togglePause} disabled={busy}>
              {vendor?.rewards_paused_from ? <><PlayCircle /> {tr(`恢復參加（目前從 ${vendor.rewards_paused_from} 起暫停）`, `Resume (paused from ${vendor.rewards_paused_from})`)}</> : <><PauseCircle /> {tr("暫停參加下一期", "Pause next period")}</>}
            </Button>
            <Button size="sm" variant="ghost" onClick={closeNow} disabled={busy}><RefreshCw /> {tr("立即結算上一期（Demo）", "Settle last period now (demo)")}</Button>
            <p className="text-xs text-muted-foreground">{tr("不可修改已發出券的折抵、效期或適用範圍。", "Issued coupons' value, validity and scope can't be changed.")}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{tr("分配演算法範例（淨營業額 100,000、1,000 張抽獎券）", "Allocation example (NT$100,000, 1,000 tickets)")}</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {ALL_TIERS.map((t) => `${tierLabel(t.code)} ${preview.counts[t.code]}`).join("、")}；{tr(`合計 ${preview.spent} 元，餘 ${preview.leftover} 元回歸店家。保底九五折人人有獎。`, `Total NT$${preview.spent}, NT$${preview.leftover} returned. Everyone gets at least 5% off.`)}
        </CardContent>
      </Card>
    </VendorPortalLayout>
  );
}

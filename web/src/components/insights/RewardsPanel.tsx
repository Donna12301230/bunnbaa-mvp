import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { ChevronDown, ChevronRight, Download, PauseCircle, PlayCircle, RefreshCw, Search, Ticket } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import InfoTip from "@/components/InfoTip";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { ALL_TIERS, allocatePool, tierLabel } from "@/lib/rewards";
import { usePlatformConfig } from "@/lib/platformConfig";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
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
}
const millis = (ts: unknown) => (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
const STATUS: Record<string, { zh: string; en: string; cls: string }> = {
  pooled: { zh: "開獎中", en: "Draw open", cls: "bg-orange-500" },
  carried: { zh: "未達門檻，結轉", en: "Carried over", cls: "bg-stone-300" },
  closed: { zh: "已結束", en: "Closed", cls: "bg-green-500" },
  paused: { zh: "暫停", en: "Paused", cls: "bg-stone-200" },
};
const nt = (n: number) => `NT$${Math.round(n).toLocaleString()}`;

/**
 * 回饋券（規格 §8、§9.3、§9.4）：每週以淨營業額 10% 生成回饋池，拆成折價券抽獎，人人有獎；券發出後規則不可變更。
 * 一眼看：流通中負債（大字）、距離開池進度、券的去向色條、本期各券種剩餘、每週回饋池長條；查詢、匯出、暫停收在「工具」。
 */
export default function RewardsPanel({ vendorId, onHeadline }: { vendorId: string | undefined; onHeadline?: (n: number) => void }) {
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
  const [tools, setTools] = useState(false);

  useEffect(() => {
    if (!vendorId) return;
    const u1 = onSnapshot(collection(db, "vendors", vendorId, "rewardPeriods"), (s) => setPeriods(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Period).sort((a, b) => b.id.localeCompare(a.id))), () => setPeriods([]));
    const u2 = onSnapshot(query(collection(db, "coupons"), where("vendor_id", "==", vendorId)), (s) => setCoupons(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Coupon)), () => setCoupons([]));
    const u3 = onSnapshot(doc(db, "rewardStatus", vendorId), (s) => setStatus(s.exists() ? ({ id: s.id, ...s.data() } as RewardStatus) : null), () => setStatus(null));
    return () => { u1(); u2(); u3(); };
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
  useEffect(() => { onHeadline?.(m.liability); }, [m.liability]);

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

  const preview = allocatePool(10000, 1000);
  const flow = [
    { key: "redeemed", label: tr("已兌現", "Redeemed"), v: m.redeemedAll, cls: "bg-green-500" },
    { key: "owned", label: tr("還在客人手上", "Outstanding"), v: m.liability, cls: "bg-orange-400" },
    { key: "returned", label: tr("回到店家", "Returned"), v: m.returned, cls: "bg-stone-300" },
  ];
  const flowTotal = Math.max(1, flow.reduce((s, x) => s + x.v, 0));
  const tickets = status?.tickets_so_far ?? 0;
  const minTickets = status?.min_tickets ?? config?.minTicketsToOpen ?? 100;
  const chart = [...periods].reverse().slice(-12);
  const chartMax = Math.max(1, ...chart.map((p) => p.pool || 0));

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground flex items-center gap-1">
        {tr(`每週一把上週淨營業額的 ${Math.round((config?.rewardRate ?? 0.1) * 100)}% 變成折價券抽給客人`, `Every Monday, ${Math.round((config?.rewardRate ?? 0.1) * 100)}% of last week's net revenue becomes coupons`)}
        <InfoTip>{tr(`抽獎券滿 ${config?.minTicketsToOpen ?? 100} 張才開池，未達標就結轉。折價券於線上結帳時自動套用，店家不用收券；券發出後規則不可變更。範例：淨營業額 100,000、1,000 張抽獎券 → ${ALL_TIERS.map((t) => `${tierLabel(t.code)} ${preview.counts[t.code]}`).join("、")}，餘 ${preview.leftover} 元回歸店家。`, `The pool opens once ${config?.minTicketsToOpen ?? 100} tickets are in; otherwise it carries over. Coupons apply automatically at checkout.`)}</InfoTip>
      </p>

      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-2 border-orange-300 bg-orange-50/60">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">{tr("還在客人手上的券（潛在成本）", "Outstanding coupons (liability)")}</p>
            <p className="text-3xl font-bold text-orange-700 tabular-nums">{nt(m.liability)}</p>
            <p className="text-xs text-muted-foreground">{tr(`${m.ownedCount} 張`, `${m.ownedCount} coupons`)}{m.expiringCount > 0 ? tr(`・7 天內到期 ${nt(m.expiringSoon)}`, ` · ${nt(m.expiringSoon)} expiring in 7 d`) : ""}</p>
          </CardContent>
        </Card>
        <Card className="border-2">
          <CardContent className="p-4 space-y-2">
            <p className="text-xs text-muted-foreground">{tr("本期回饋池", "Current pool")}{current ? `・${current.id.slice(5)}` : ""}</p>
            <p className="text-3xl font-bold tabular-nums">{nt(current?.pool ?? 0)}</p>
            <p className="text-xs text-muted-foreground">{tr(`本期已兌現 ${nt(m.redeemedPeriod)}`, `${nt(m.redeemedPeriod)} redeemed this period`)}</p>
          </CardContent>
        </Card>
        <Card className="border-2">
          <CardContent className="p-4 space-y-2">
            <p className="text-xs text-muted-foreground">{tr("下一池", "Next pool")}</p>
            {status?.pool_open ? <p className="text-3xl font-bold text-orange-600">🎉 {tr("開獎中", "Open")}</p> : (
              <>
                <p className="text-3xl font-bold tabular-nums">{tickets}<span className="text-base font-normal text-muted-foreground"> / {minTickets} {tr("張", "")}</span></p>
                <div className="h-3 rounded-full bg-stone-200 overflow-hidden"><div className="h-full rounded-full bg-orange-400" style={{ width: `${Math.min(100, (tickets / Math.max(1, minTickets)) * 100)}%` }} /></div>
                <p className="text-xs text-muted-foreground">{tr(`再賣 ${status?.amount_to_open ?? "—"} 元開池`, `NT$${status?.amount_to_open ?? "—"} to open`)}</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 券的去向 */}
      <Card className="border-2">
        <CardContent className="p-4 space-y-2">
          <p className="font-semibold">{tr("發出去的券後來怎麼了", "Where issued coupons went")}</p>
          <div className="flex h-6 overflow-hidden rounded-lg bg-stone-100" role="img" aria-label={flow.map((x) => `${x.label} ${nt(x.v)}`).join("，")}>
            {flow.filter((x) => x.v > 0).map((x) => <div key={x.key} className={cn("h-full", x.cls)} style={{ width: `${(x.v / flowTotal) * 100}%` }} title={`${x.label} ${nt(x.v)}`} />)}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {flow.map((x) => <span key={x.key} className="inline-flex items-center gap-1.5"><span className={cn("w-3 h-3 rounded-sm", x.cls)} />{x.label} <b className="tabular-nums">{nt(x.v)}</b></span>)}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        {current?.allocation && (
          <Card className="border-2">
            <CardContent className="p-4 space-y-2">
              <p className="font-semibold">{tr("本期還剩哪些券", "Coupons left this pool")}</p>
              {ALL_TIERS.filter((t) => (current.allocation?.[t.code] ?? 0) > 0).map((t) => {
                const total = current.allocation?.[t.code] ?? 0;
                const left = current.remaining?.[t.code] ?? 0;
                return (
                  <div key={t.code} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-2 text-sm">
                    <span className="truncate"><Ticket className="inline w-3.5 h-3.5 mr-1 text-orange-500" />{tierLabel(t.code)}</span>
                    <div className="h-3 rounded-full bg-stone-100 overflow-hidden"><div className="h-full rounded-full bg-orange-400" style={{ width: `${(left / Math.max(1, total)) * 100}%` }} /></div>
                    <span className="w-16 text-right tabular-nums text-muted-foreground">{left}/{total}</span>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
        <Card className={cn("border-2", !current?.allocation && "md:col-span-2")}>
          <CardContent className="p-4 space-y-2">
            <p className="font-semibold">{tr("每週回饋池", "Weekly pools")}</p>
            {chart.length === 0 ? <p className="text-sm text-muted-foreground">{tr("還沒有結算紀錄。", "No periods yet.")}</p> : (
              <>
                <div className="flex items-end gap-1.5 h-32" role="img" aria-label={chart.map((p) => `${p.id} ${nt(p.pool || 0)}`).join("，")}>
                  {chart.map((p) => (
                    <div key={p.id} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${p.id}：${nt(p.pool || 0)}・${p.status ? tr(STATUS[p.status]?.zh ?? p.status, STATUS[p.status]?.en ?? p.status) : tr("累積中", "Accumulating")}`}>
                      <div className="w-full flex flex-col justify-end h-24 rounded-sm bg-stone-100 overflow-hidden">
                        <div className={cn("w-full", STATUS[p.status ?? ""]?.cls ?? "bg-orange-200")} style={{ height: `${((p.pool || 0) / chartMax) * 100}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground leading-none">{p.id.slice(5).replace("-", "/")}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {Object.entries(STATUS).map(([k, s]) => <span key={k} className="inline-flex items-center gap-1"><span className={cn("w-2.5 h-2.5 rounded-sm", s.cls)} />{tr(s.zh, s.en)}</span>)}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 工具：查詢、匯出、暫停 */}
      <Card className="border-2">
        <CardContent className="p-0">
          <button type="button" className="w-full flex items-center gap-1.5 px-4 py-3 text-left text-sm font-semibold" onClick={() => setTools((v) => !v)} aria-expanded={tools}>
            {tools ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{tr("查詢單張券・匯出 CSV・暫停參加", "Look up · Export CSV · Pause")}
            {vendor?.rewards_paused_from && <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-xs">{tr(`${vendor.rewards_paused_from} 起暫停`, `Paused from ${vendor.rewards_paused_from}`)}</span>}
          </button>
          {tools && (
            <div className="grid gap-4 px-4 pb-4 md:grid-cols-2">
              <div className="space-y-2">
                <div className="flex gap-2"><Input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder={tr("券 ID 或訂單 ID", "Coupon ID or order ID")} /><Button variant="outline" size="icon" aria-label={tr("查詢", "Search")}><Search /></Button></div>
                {found.map((c) => <p key={c.id} className="text-sm">{c.id}：{tierLabel(c.tier)} {tr(`折 ${c.discount}`, `−${c.discount}`)}・{c.status}・{c.pool_period}{c.lock_id ? `・${tr("訂單", "order")} ${c.lock_id}` : ""}</p>)}
                {lookup && found.length === 0 && <p className="text-xs text-muted-foreground">{tr("查無資料", "Not found")}</p>}
              </div>
              <div className="space-y-2">
                <div className="flex gap-2 items-center text-sm">
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 min-w-0" /> ～ <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 min-w-0" />
                  <Button size="sm" variant="outline" onClick={exportCsv}><Download /> CSV</Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={togglePause} disabled={busy}>
                    {vendor?.rewards_paused_from ? <><PlayCircle /> {tr("恢復參加", "Resume")}</> : <><PauseCircle /> {tr("暫停參加下一期", "Pause next period")}</>}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={closeNow} disabled={busy}><RefreshCw /> {tr("立即結算上一期（Demo）", "Settle now (demo)")}</Button>
                </div>
                <p className="text-xs text-muted-foreground">{tr("不可修改已發出券的折抵、效期或適用範圍。", "Issued coupons' value, validity and scope can't be changed.")}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

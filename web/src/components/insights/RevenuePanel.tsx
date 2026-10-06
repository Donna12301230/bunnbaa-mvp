import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { Banknote, CheckCircle2, MessageCircleQuestion, ShoppingBag, Sparkles, TrendingUp } from "lucide-react";
import { httpsCallable } from "@/lib/callable";
import { db, functions } from "@/lib/firebase";
import type { AccuracyReport, Lock } from "@/types";
import { addDaysStr, todayStr } from "@/lib/pickupSlots";
import { DONE_STATUSES, REVENUE_STATUSES } from "@/lib/lockOutcome";
import { tr, loc, planBaseName } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import InfoTip from "@/components/InfoTip";
import RevenueCostChart from "@/components/RevenueCostChart";

export const REPORT_DAYS = 15;

function reportRange() {
  const end = todayStr();
  return { start: addDaysStr(end, -(REPORT_DAYS - 1)), end };
}

interface ReportStats {
  totalRevenue: number;
  totalOrders: number;
  avgOrder: number;
  completedOrders: number;
  topItems: { name: string; qty: number; revenue: number }[];
}

// 以取餐日落在最近 REPORT_DAYS 天（含今天）的鎖定計算；鎖定是全額預付，未取餐也算收入，
// 取消退款的不算（狀態口徑跟每日收入圖 getDailyRevenueSeries 相同）。
function computeStats(locks: Lock[]): ReportStats | null {
  const { start, end } = reportRange();
  const rows = locks.filter((l) => l.pickup_date >= start && l.pickup_date <= end && REVENUE_STATUSES.has(l.status));
  if (rows.length === 0) return null;
  const totalRevenue = rows.reduce((sum, l) => sum + (l.locked_price || 0), 0);
  const byItem = new Map<string, { qty: number; revenue: number }>();
  for (const l of rows) {
    const name = planBaseName(loc(l, "item_name")); // 計畫型「A方案・第1/5天」併成同一項
    const item = byItem.get(name) ?? { qty: 0, revenue: 0 };
    item.qty += 1;
    item.revenue += l.locked_price || 0;
    byItem.set(name, item);
  }
  return {
    totalRevenue,
    totalOrders: rows.length,
    avgOrder: Math.round(totalRevenue / rows.length),
    completedOrders: rows.filter((l) => DONE_STATUSES.has(l.status)).length,
    topItems: [...byItem].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty).slice(0, 10),
  };
}

/** 營收：15 天四個大數字、每日收入與材料成本圖、熱銷排行（獎牌＋長條）、預測準確率量表＋問 AI */
export default function RevenuePanel({ vendorId, onHeadline }: { vendorId: string | undefined; onHeadline?: (n: number) => void }) {
  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!vendorId) return;
    // 單一等值不加 orderBy，避免另外要求複合索引，最新一份在前端挑
    const q = query(collection(db, "accuracy_reports"), where("vendor_id", "==", vendorId), limit(50));
    return onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as AccuracyReport & { generated_at?: { toMillis?: () => number } });
      docs.sort((a, b) => (b.generated_at?.toMillis?.() ?? 0) - (a.generated_at?.toMillis?.() ?? 0));
      setReport(docs[0] ?? null);
    }, () => setReport(null));
  }, [vendorId]);

  // 直接查取餐日區間（vendor_id + pickup_date 索引），不用「最近 500 筆」——訂單一多會被截掉（BUG-13）
  useEffect(() => {
    if (!vendorId) return;
    const { start, end } = reportRange();
    const q = query(collection(db, "locks"), where("vendor_id", "==", vendorId), where("pickup_date", ">=", start), where("pickup_date", "<=", end));
    return onSnapshot(q, (snap) => {
      setLocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock));
      setLoading(false);
    }, () => setLoading(false));
  }, [vendorId]);
  const stats = computeStats(locks);
  useEffect(() => { onHeadline?.(stats?.totalRevenue ?? 0); }, [stats?.totalRevenue]);

  async function ask() {
    const q = draft.trim();
    if (!q || !vendorId) return;
    setAsking(true);
    setAnswer("");
    try {
      const res = await httpsCallable(functions, "askCalibrationScenario")({ vendor_id: vendorId, question: q });
      setAnswer((res.data as { scenario_answer: string }).scenario_answer);
    } catch (err) {
      setAnswer(tr(`追問失敗：${(err as Error).message}`, `Couldn't get an answer: ${(err as Error).message}`));
    } finally {
      setAsking(false);
    }
  }

  if (loading) return <SkeletonBlocks count={3} height={128} className="space-y-3" />;

  const medals = ["bg-amber-400 text-amber-950", "bg-stone-300 text-stone-900", "bg-orange-300 text-orange-950"];
  const acc = report ? Math.round(report.accuracy_rate * 100) : 0;

  return (
    <div className="space-y-4">
      {!stats ? (
        <EmptyState icon={<TrendingUp size={32} />} title={tr(`最近 ${REPORT_DAYS} 天沒有訂單`, `No orders in the last ${REPORT_DAYS} days`)} />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { icon: Banknote, label: tr(`${REPORT_DAYS} 天收入`, `${REPORT_DAYS}-day revenue`), v: `NT$${stats.totalRevenue.toLocaleString()}`, cls: "text-orange-600" },
              { icon: ShoppingBag, label: tr("訂單", "Orders"), v: String(stats.totalOrders), cls: "" },
              { icon: TrendingUp, label: tr("每單平均", "Avg. order"), v: `NT$${stats.avgOrder}`, cls: "" },
              { icon: CheckCircle2, label: tr("已取餐", "Picked up"), v: `${Math.round((stats.completedOrders / stats.totalOrders) * 100)}%`, cls: "text-green-700" },
            ].map((x) => (
              <Card key={x.label} className="border-2">
                <CardContent className="p-4">
                  <x.icon className="w-5 h-5 text-orange-500" />
                  <p className={cn("mt-1 text-2xl md:text-3xl font-bold leading-tight tabular-nums", x.cls)}>{x.v}</p>
                  <p className="text-xs text-muted-foreground">{x.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-2">
            <CardContent className="p-4 space-y-2">
              <p className="font-semibold flex items-center gap-1">{tr("每天收入 vs 材料成本", "Daily revenue vs materials")}<InfoTip>{tr(`最近 ${REPORT_DAYS} 天，依取餐日。預付制未取餐也算收入，取消退款的不算。`, `Last ${REPORT_DAYS} days by pickup date.`)}</InfoTip></p>
              <RevenueCostChart vendorId={vendorId} />
            </CardContent>
          </Card>

          <Card className="border-2">
            <CardContent className="p-4 space-y-3">
              <p className="font-semibold">{tr("賣最好的", "Best sellers")}</p>
              {stats.topItems.map((item, idx) => (
                <div key={item.name} className="flex items-center gap-3">
                  <span className={cn("w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold", medals[idx] ?? "bg-stone-100 text-muted-foreground")}>{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="font-medium truncate">{item.name}</span>
                      <span className="shrink-0"><b>{item.qty}</b> {tr("份", "")}<span className="text-muted-foreground"> · NT${item.revenue.toLocaleString()}</span></span>
                    </div>
                    <div className="mt-1 h-3 rounded-full bg-stone-100 overflow-hidden">
                      <div className={cn("h-full rounded-full", idx === 0 ? "bg-orange-500" : "bg-orange-300")} style={{ width: `${(item.qty / stats.topItems[0].qty) * 100}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {/* 預測準確率：量表；說明與追問收起來 */}
      <Card className="border-2">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="w-4 h-4 text-orange-500" />
            <p className="font-semibold">{tr("預測準不準", "Forecast accuracy")}</p>
            <InfoTip>{tr("每天由系統比對預測份數和實際取餐產生。僅供參考，不是備貨建議。", "Generated daily by comparing forecast vs actual pickups. For reference only.")}</InfoTip>
            {report && <button type="button" className="ml-auto inline-flex items-center gap-1 text-sm text-primary underline" onClick={() => setAskOpen((v) => !v)}><MessageCircleQuestion className="w-4 h-4" />{tr("問 AI", "Ask AI")}</button>}
          </div>
          {report ? (
            <>
              <div className="flex flex-wrap items-center gap-4">
                <p className="text-4xl font-bold tabular-nums">{acc}%</p>
                <div className="flex-1 min-w-[12rem] space-y-1">
                  <div className="relative h-4 rounded-full bg-gradient-to-r from-red-300 via-amber-300 to-green-400">
                    <span className="absolute -top-1 h-6 w-1.5 rounded-full bg-foreground" style={{ left: `calc(${acc}% - 3px)` }} aria-hidden="true" />
                  </div>
                  <div className="flex justify-between text-[11px] text-muted-foreground"><span>0%</span><span>{tr("誤差", "error")} {report.error_range}</span><span>100%</span></div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{loc(report, "pattern_note")}</p>
              {askOpen && (
                <div className="flex gap-2">
                  <Input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }} placeholder={tr("例如：鎖定量目標調高 10%，缺口會怎麼變？", "e.g. If I raise my target by 10%…")} className="text-sm" />
                  <Button size="sm" onClick={ask} disabled={!draft.trim() || asking}>{asking ? tr("分析中…", "Analysing…") : tr("送出", "Ask")}</Button>
                </div>
              )}
              {answer && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{answer}</p>}
            </>
          ) : <p className="text-sm text-muted-foreground">{tr("累積幾天的取餐紀錄後就會出現。", "Appears after a few days of pickups.")}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

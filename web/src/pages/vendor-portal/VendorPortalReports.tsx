import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "@/lib/callable";
import { db, functions } from "@/lib/firebase";
import type { AccuracyReport } from "@/types";
import { useVendorLocks } from "@/hooks/useVendorLocks";
import { addDaysStr, todayStr } from "@/lib/pickupSlots";
import { DONE_STATUSES } from "@/lib/lockOutcome";
import { tr, loc, planBaseName } from "@/lib/i18n";
import type { Lock } from "@/types";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Banknote, ShoppingBag, TrendingUp, Users, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import RevenueCostChart from "@/components/RevenueCostChart";

// 設計系統圖表色（index.css --chart-*），由深到淺；走 CSS 變數才會跟著深色模式切換
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "color-mix(in srgb, var(--chart-2) 60%, var(--card))",
  "color-mix(in srgb, var(--chart-2) 35%, var(--card))",
  "color-mix(in srgb, var(--chart-2) 20%, var(--card))",
];

function ItemRankList({ items }: { items: { name: string; qty: number; revenue: number }[] }) {
  if (items.length === 0) return <EmptyState size="compact" icon={<ShoppingBag size={32} />} title={tr("這段期間沒有銷售紀錄", "No sales in this period")} />;
  const maxQty = items[0].qty;
  return (
    <div className="space-y-2">
      {items.map((item, idx) => {
        const pct = Math.round((item.qty / maxQty) * 100);
        return (
          <div key={item.name} className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-4 shrink-0 text-right">{idx + 1}</span>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-center mb-0.5">
                <span className="text-sm font-medium truncate">{item.name}</span>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">
                  {item.qty} {tr("份", "meals")} · NT$ {item.revenue.toLocaleString()}
                </span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: COLORS[Math.min(idx, COLORS.length - 1)] }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface ReportStats {
  totalRevenue: number;
  totalOrders: number;
  avgOrder: number;
  completedOrders: number;
  revenueByDate: { date: string; revenue: number }[];
  topItems: { name: string; qty: number; revenue: number }[];
}

const REPORT_DAYS = 15;

// 以取餐日落在最近 REPORT_DAYS 天（含今天）的鎖定計算；鎖定是全額預付，未取餐也算收入。
function computeStats(locks: Lock[]): ReportStats | null {
  const end = todayStr();
  const start = addDaysStr(end, -(REPORT_DAYS - 1));
  const rows = locks.filter((l) => l.pickup_date >= start && l.pickup_date <= end);
  if (rows.length === 0) return null;
  const totalRevenue = rows.reduce((sum, l) => sum + (l.locked_price || 0), 0);
  const byDate = new Map<string, number>();
  for (let d = start; d <= end; d = addDaysStr(d, 1)) byDate.set(d, 0);
  const byItem = new Map<string, { qty: number; revenue: number }>();
  for (const l of rows) {
    byDate.set(l.pickup_date, (byDate.get(l.pickup_date) ?? 0) + (l.locked_price || 0));
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
    revenueByDate: [...byDate].map(([date, revenue]) => ({ date: `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`, revenue })),
    topItems: [...byItem].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.qty - a.qty).slice(0, 10),
  };
}

// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/reports.tsx.
// 2026-09-28 改用真實 locks（原本分「預約／現場」兩組 mock，TODO §7 決定不做現場點餐）。
export default function VendorPortalReports() {
  const { user } = useAuth();
  const [whatifDraft, setWhatifDraft] = useState("");
  const [whatifAnswer, setWhatifAnswer] = useState("");

  // 對應 UI草圖 VendorDashboard.dc.html「收益及未來備料趨勢」分頁的「校準洞察」。
  // 2026-09-28 改接真實資料：最新一份 accuracy_reports（dailyCalibration 產生）＋
  // askCalibrationScenario 追問，跟 /lock/vendor（pages/VendorDashboard.tsx）同一套。
  const VENDOR_ID = user?.vendorId;
  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!VENDOR_ID) return;
    // 單一等值不加 orderBy，避免另外要求複合索引，最新一份在前端挑
    const q = query(collection(db, "accuracy_reports"), where("vendor_id", "==", VENDOR_ID), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as AccuracyReport & { generated_at?: { toMillis?: () => number } });
      docs.sort((a, b) => (b.generated_at?.toMillis?.() ?? 0) - (a.generated_at?.toMillis?.() ?? 0));
      setReport(docs[0] ?? null);
    });
    return () => unsub();
  }, [VENDOR_ID]);

  async function handleAskWhatif() {
    const q = whatifDraft.trim();
    if (!q || !VENDOR_ID) return;
    setAsking(true);
    setWhatifAnswer("");
    try {
      const fn = httpsCallable(functions, "askCalibrationScenario");
      const res = await fn({ vendor_id: VENDOR_ID, question: q });
      setWhatifAnswer((res.data as { scenario_answer: string }).scenario_answer);
    } catch (err) {
      setWhatifAnswer(tr(`追問失敗：${(err as Error).message}`, `Couldn't get an answer: ${(err as Error).message}`));
    } finally {
      setAsking(false);
    }
  }

  const { locks, loading: loadingStats } = useVendorLocks(500);
  const stats = computeStats(locks);

  function StatCards({ stats, colorClass = "text-orange-600" }: {
    stats: ReportStats;
    colorClass?: string;
  }) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Banknote className="w-4 h-4 mx-auto mb-1 text-orange-500" />
            <div className={`text-2xl font-bold ${colorClass}`}>{stats.totalRevenue.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">{tr("累計收入 (NT$)", "Revenue (NT$)")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <ShoppingBag className="w-4 h-4 mx-auto mb-1 text-orange-500" />
            <div className="text-2xl font-bold">{stats.totalOrders}</div>
            <div className="text-xs text-muted-foreground">{tr("總訂單數", "Orders")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <TrendingUp className="w-4 h-4 mx-auto mb-1 text-orange-500" />
            <div className="text-2xl font-bold">{stats.avgOrder}</div>
            <div className="text-xs text-muted-foreground">{tr("平均訂單 (NT$)", "Avg. order (NT$)")}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Users className="w-4 h-4 mx-auto mb-1 text-orange-500" />
            <div className="text-2xl font-bold text-green-600">{stats.completedOrders}</div>
            <div className="text-xs text-muted-foreground">{tr("已完成", "Picked up")}</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <VendorPortalLayout>
      <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-5 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-orange-500" /> {tr("訂單統計報表", "Order reports")}
      </h1>

      {/* 校準洞察（對應 UI草圖「收益及未來備料趨勢」分頁；同一份 Gemini 校準報告
          真正串接在 /lock/vendor，見 pages/VendorDashboard.tsx） */}
      <Card className="mb-5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <CardTitle className="text-base flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-orange-500" /> {tr("校準洞察", "Calibration insights")}
            </CardTitle>
            <span className="text-xs text-muted-foreground">{tr("僅供參考・非備貨建議", "For reference only — not prep advice")}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {report ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-orange-600">{Math.round(report.accuracy_rate * 100)}%</p>
                  <p className="text-xs text-muted-foreground">{tr("目前預測準確率", "Current forecast accuracy")}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold">{report.error_range}</p>
                  <p className="text-xs text-muted-foreground">{tr("近期誤差區間", "Recent error range")}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{loc(report, "pattern_note")}</p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{tr("尚無校準報告——每天由系統自動產生，累積幾天的取餐紀錄後就會出現。", "No calibration report yet — one is generated daily once there are a few days of pickups.")}</p>
          )}
          <div className="flex gap-2">
            <Input
              value={whatifDraft}
              onChange={e => setWhatifDraft(e.target.value)}
              placeholder={tr("例如：如果把鎖定量目標調高 10%，缺口大概會怎麼變化？", "e.g. If I raise my locking target by 10%, how would the gap change?")}
              className="text-sm"
            />
            <Button size="sm" onClick={handleAskWhatif} disabled={!whatifDraft.trim() || !report || asking}>{asking ? tr("分析中…", "Analysing…") : tr("送出", "Ask")}</Button>
          </div>
          {whatifAnswer && (
            <div className="bg-amber-50 rounded-lg p-3 text-sm text-amber-900 space-y-1">
              <p>{whatifAnswer}</p>
              <p className="text-xs text-amber-700">{tr("此為情境式參考答案，非備貨建議，最終決定權在商家", "A scenario-based answer for reference only — not prep advice; the decision is yours")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {loadingStats ? (
        <SkeletonBlocks count={3} height={128} className="space-y-3" />
      ) : !stats ? (
        <EmptyState icon={<TrendingUp size={32} />} title={tr(`最近 ${REPORT_DAYS} 天沒有訂單`, `No orders in the last ${REPORT_DAYS} days`)} />
      ) : (
        <div className="space-y-5">
          <StatCards stats={stats} />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{tr(`每日收入與材料成本（最近 ${REPORT_DAYS} 天，依取餐日）`, `Daily revenue vs material cost (last ${REPORT_DAYS} days, by pickup date)`)}</CardTitle>
            </CardHeader>
            <CardContent>
              <RevenueCostChart vendorId={VENDOR_ID} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{tr("熱銷品項 Top 10", "Top 10 items")}</CardTitle>
            </CardHeader>
            <CardContent>
              <ItemRankList items={stats.topItems} />
            </CardContent>
          </Card>
        </div>
      )}
    </VendorPortalLayout>
  );
}

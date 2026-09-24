import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { mockGetMyVendor, mockGetVendorReportStats, mockAccuracyReport, type MockReportStats } from "@/lib/mockData";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Banknote, ShoppingBag, TrendingUp, Users, TableProperties, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";

// 設計系統圖表色（index.css --chart-*），由深到淺；走 CSS 變數才會跟著深色模式切換
const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "color-mix(in srgb, var(--chart-2) 60%, var(--card))",
  "color-mix(in srgb, var(--chart-2) 35%, var(--card))",
  "color-mix(in srgb, var(--chart-2) 20%, var(--card))",
];
const AXIS_TICK = { fontSize: 12, fill: "var(--muted-foreground)" };

function ItemRankList({ items }: { items: { name: string; qty: number; revenue: number }[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground text-center py-6">無資料</p>;
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
                  {item.qty} 份 · NT$ {item.revenue.toLocaleString()}
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

// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/reports.tsx.
// TODO(firebase): mockGetVendorReportStats aggregates mockData.ts's
// mockPreOrders/mockTableOrders instead of Parse.Query("PreOrder"/"TableOrder"
// /"PreOrderItem"/"TableOrderItem") — swap for a real Firestore aggregation
// once the backend is wired up.
export default function VendorPortalReports() {
  const { user } = useAuth();
  const [whatifDraft, setWhatifDraft] = useState("");
  const [whatifAnswer, setWhatifAnswer] = useState("");

  // TODO(firebase): 對應 UI草圖 VendorDashboard.dc.html「收益及未來備料趨勢」分頁
  // 的「校準洞察」追問。/lock/vendor（legacy pages/VendorDashboard.tsx）已經有
  // 真的串 Gemini（askCalibrationScenario Cloud Function），這裡先用 local
  // state 示意，之後要接的話直接沿用那支 Function 即可。
  function handleAskWhatif() {
    const q = whatifDraft.trim();
    if (!q) return;
    setWhatifAnswer(
      "根據過去的落差模式，調整後預估履約缺口會落在現行誤差區間的上緣附近，仍以雨天午餐時段風險最高，建議觀察下週雨天數再評估。（示意畫面：實際回覆需串接 askCalibrationScenario）"
    );
  }

  const { data: myVendor } = useQuery({
    queryKey: ["myVendor", user?.id],
    queryFn: async () => mockGetMyVendor(),
    enabled: !!user,
  });

  const { data: preStats, isLoading: loadingPre } = useQuery({
    queryKey: ["vendorReports-pre", myVendor?.id],
    queryFn: async () => myVendor ? mockGetVendorReportStats(myVendor.id, "pre") : null,
    enabled: !!myVendor,
  });

  const { data: tableStats, isLoading: loadingTable } = useQuery({
    queryKey: ["vendorReports-table", myVendor?.id],
    queryFn: async () => myVendor ? mockGetVendorReportStats(myVendor.id, "table") : null,
    enabled: !!myVendor,
  });

  function StatCards({ stats, colorClass = "text-orange-600" }: {
    stats: MockReportStats;
    colorClass?: string;
  }) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Banknote className="w-4 h-4 mx-auto mb-1 text-orange-500" />
            <div className={`text-2xl font-bold ${colorClass}`}>{stats.totalRevenue.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground">累計收入 (NT$)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <ShoppingBag className="w-4 h-4 mx-auto mb-1 text-orange-500" />
            <div className="text-2xl font-bold">{stats.totalOrders}</div>
            <div className="text-xs text-muted-foreground">總訂單數</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <TrendingUp className="w-4 h-4 mx-auto mb-1 text-orange-500" />
            <div className="text-2xl font-bold">{stats.avgOrder}</div>
            <div className="text-xs text-muted-foreground">平均訂單 (NT$)</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <Users className="w-4 h-4 mx-auto mb-1 text-orange-500" />
            <div className="text-2xl font-bold text-green-600">{stats.completedOrders}</div>
            <div className="text-xs text-muted-foreground">已完成</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  function RevenueChart({ data }: { data: { date: string; revenue: number }[] }) {
    if (data.length === 0) return <p className="text-sm text-muted-foreground text-center py-6">無資料</p>;
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="date" tick={AXIS_TICK} />
          <YAxis tick={AXIS_TICK} />
          <Tooltip formatter={(v: number) => [`NT$ ${v}`, "收入"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Bar dataKey="revenue" radius={[4, 4, 0, 0]} fill="var(--chart-1)" />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-5 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-orange-500" /> 訂單統計報表
      </h2>

      {/* 校準洞察（對應 UI草圖「收益及未來備料趨勢」分頁；同一份 Gemini 校準報告
          真正串接在 /lock/vendor，見 pages/VendorDashboard.tsx） */}
      <Card className="mb-5">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-1">
            <CardTitle className="text-base flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-orange-500" /> 校準洞察
            </CardTitle>
            <span className="text-xs text-muted-foreground">僅供參考・非備貨建議</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-orange-600">{Math.round(mockAccuracyReport.accuracy_rate * 100)}%</p>
              <p className="text-xs text-muted-foreground">目前預測準確率</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-xl font-bold">{mockAccuracyReport.error_range}</p>
              <p className="text-xs text-muted-foreground">近期誤差區間</p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">{mockAccuracyReport.pattern_note}</p>
          <div className="flex gap-2">
            <Input
              value={whatifDraft}
              onChange={e => setWhatifDraft(e.target.value)}
              placeholder="例如：如果把鎖定量目標調高 10%，缺口大概會怎麼變化？"
              className="text-sm"
            />
            <Button size="sm" onClick={handleAskWhatif} disabled={!whatifDraft.trim()}>送出</Button>
          </div>
          {whatifAnswer && (
            <div className="bg-amber-50 rounded-lg p-3 text-sm text-amber-900 space-y-1">
              <p>{whatifAnswer}</p>
              <p className="text-xs text-amber-700">此為情境式參考答案，非備貨建議，最終決定權在商家</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Tabs defaultValue="pre">
        <TabsList className="mb-5">
          <TabsTrigger value="pre" className="flex items-center gap-1.5">
            <ShoppingBag className="w-3.5 h-3.5" /> 預約訂單
          </TabsTrigger>
          <TabsTrigger value="table" className="flex items-center gap-1.5">
            <TableProperties className="w-3.5 h-3.5" /> 現場訂單
          </TabsTrigger>
        </TabsList>

        {/* 預約訂單報表 */}
        <TabsContent value="pre">
          {loadingPre ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : !preStats ? (
            <div className="text-center py-20 text-muted-foreground">
              <TrendingUp className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>尚無預約訂單資料</p>
            </div>
          ) : (
            <div className="space-y-5">
              <StatCards stats={preStats} />
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">每日收入（最近 15 天）</CardTitle>
                </CardHeader>
                <CardContent>
                  <RevenueChart data={preStats.revenueByDate} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">熱銷品項 Top 10</CardTitle>
                </CardHeader>
                <CardContent>
                  <ItemRankList items={preStats.topItems} />
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* 現場訂單報表 */}
        <TabsContent value="table">
          {loadingTable ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : !tableStats ? (
            <div className="text-center py-20 text-muted-foreground">
              <TableProperties className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>尚無現場訂單資料</p>
            </div>
          ) : (
            <div className="space-y-5">
              <StatCards stats={tableStats} colorClass="text-blue-600" />
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">每日收入（最近 15 天）</CardTitle>
                </CardHeader>
                <CardContent>
                  <RevenueChart data={tableStats.revenueByDate} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">熱銷品項 Top 10</CardTitle>
                </CardHeader>
                <CardContent>
                  <ItemRankList items={tableStats.topItems} />
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </VendorPortalLayout>
  );
}

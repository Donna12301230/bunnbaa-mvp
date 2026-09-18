import { useQuery } from "@tanstack/react-query";
import { mockGetMyVendor, mockGetVendorReportStats, type MockReportStats } from "@/lib/mockData";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Banknote, ShoppingBag, TrendingUp, Users, TableProperties } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";

const COLORS = ["#f97316", "#fb923c", "#fdba74", "#fed7aa", "#ffedd5"];

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
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v: number) => [`NT$ ${v}`, "收入"]} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
          <Bar dataKey="revenue" radius={[4, 4, 0, 0]} fill="#f97316" />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-5 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-orange-500" /> 訂單統計報表
      </h2>

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

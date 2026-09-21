import { useQuery } from "@tanstack/react-query";
import { mockGetVendorDashboard } from "@/lib/mockData";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardList, UtensilsCrossed, TrendingUp, TableProperties, CalendarDays, ChevronRight, Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "wouter";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";

// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/dashboard.tsx.
// TODO(firebase): mockGetVendorDashboard() stands in for
// Parse.Cloud.run("getVendorDashboard") — swap for a real Firestore-backed
// aggregation (or Cloud Function) once the backend is wired up.
export default function VendorPortalDashboard() {
  const { user } = useAuth();

  const { data: dashboard, isLoading } = useQuery({
    queryKey: ["vendorDashboard", user?.id],
    queryFn: () => mockGetVendorDashboard(),
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  });

  const todaySessions = dashboard?.todaySessions ?? [];

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-4">
        {dashboard?.vendorName ? `${dashboard.vendorName} — 總覽` : "廠商總覽"}
      </h2>

      {/* 統計卡片 */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <ClipboardList className="w-3.5 h-3.5" /> 預約待確認
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{dashboard?.pendingOrders ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <TableProperties className="w-3.5 h-3.5" /> 現場待確認
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{dashboard?.tablePending ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" /> 總訂單數
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboard?.totalOrders ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <UtensilsCrossed className="w-3.5 h-3.5" /> 菜單項目
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{dashboard?.menuCount ?? 0}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 今日開放時段 */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-orange-500" />
            今日開放時段（{format(new Date(), "M/d (EEE)", { locale: zhTW })}）
          </CardTitle>
          <Link href="/vendor-portal/sessions">
            <Button variant="ghost" size="sm" className="text-xs h-7">
              管理時段 <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {todaySessions.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-30" />
              今日無開放時段
              <div className="mt-2">
                <Link href="/vendor-portal/sessions">
                  <Button size="sm" variant="outline" className="text-xs">前往新增時段</Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {todaySessions.map(s => (
                <Link key={s.id} href={`/vendor-portal/sessions/${s.id}/summary`}>
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 text-sm font-semibold">
                        <Clock className="w-3.5 h-3.5 text-orange-500" />
                        {s.pickupTime}
                      </div>
                      <div className="text-sm text-muted-foreground">{s.pickupLocation}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-orange-600">{s.orderCount} 單</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        s.status === "open"
                          ? "bg-green-100 text-green-700"
                          : s.status === "closed"
                          ? "bg-gray-100 text-gray-600"
                          : "bg-blue-100 text-blue-700"
                      }`}>
                        {s.status === "open" ? "開放中" : s.status === "closed" ? "已截止" : "已完成"}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </VendorPortalLayout>
  );
}

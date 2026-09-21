import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChefHat } from "lucide-react";
import { mockPrepSlots } from "@/lib/mockData";

// 對應 UI草圖 VendorDashboard.dc.html「備料」分頁——之前的雛型沒有這個視角：
// 依取餐時段聚合「今天要備多少份」，方便商家一次看完整天備料量，不用一筆筆訂單
// 自己加總。
//
// TODO(firebase): 目前是寫死的假資料（見 lib/mockData.ts 的 mockPrepSlots）。
// 接後端時要依 locks collection 的 pickup_date + pickup_window 分組聚合今日
// 已鎖定、未履約的份數（排除 no_show / resold_and_fulfilled 之外的取消狀態），
// 跟消費者端 Main 草圖的取餐時段（11:30–12:00 等）對齊。
export default function VendorPortalPrep() {
  const totalCount = mockPrepSlots.reduce(
    (sum, slot) => sum + slot.items.reduce((a, it) => a + it.qty, 0),
    0
  );

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
        <ChefHat className="w-5 h-5 text-orange-500" /> 今日備料
      </h2>
      <p className="text-sm text-muted-foreground mb-5">依取餐時段聚合的今日備料份數，出餐前對一次就好。</p>

      <Card className="mb-4">
        <CardContent className="pt-5 pb-4 flex items-baseline gap-2">
          <span className="text-sm text-muted-foreground">今日總備料份數</span>
          <span className="text-2xl font-bold text-orange-600">{totalCount} 份</span>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {mockPrepSlots.map(slot => (
          <Card key={slot.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{slot.label}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {slot.items.map(it => (
                <div key={it.name} className="flex items-center justify-between text-sm">
                  <span className="truncate">{it.name}</span>
                  <span className="font-semibold text-muted-foreground shrink-0 ml-2">× {it.qty}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </VendorPortalLayout>
  );
}

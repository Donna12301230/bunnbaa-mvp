import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Ticket, Sparkles } from "lucide-react";
import { mockGrowthRewards } from "@/lib/mockData";

// 對應 UI草圖 VendorDashboard.dc.html「成長獎勵」分頁——全新機制，之前的雛型
// 完全沒有：商家累積合作營收達門檻後，解鎖消費者端抽獎（單抽／十連抽），獎項是
// 折扣券（8/6/5/3/1折或整份 0 元）。對應 Main 草圖新增的跑馬燈「剛抽中...0 元
// 大獎」（見 HomePage.tsx 的 GrowthRewardTicker）。
//
// TODO(firebase): 這頁完全是版面骨架，資料是 lib/mockData.ts 的
// mockGrowthRewards 假資料。要接後端得先決定：
//   - growth_rewards（商家累積營收、門檻解鎖狀態）collection 怎麼設計
//   - draws（開獎紀錄）collection，抽獎機率計算必須在 Cloud Function 做，
//     不能信任 client 端
//   - 0 元券／折扣券庫存要不要跟 locks 的 discount_percent 打通
const TIER_STYLE: Record<number, { bg: string; color: string }> = {
  80: { bg: "bg-amber-50", color: "text-amber-700" },
  60: { bg: "bg-amber-50", color: "text-amber-700" },
  50: { bg: "bg-blue-50", color: "text-blue-700" },
  30: { bg: "bg-purple-50", color: "text-purple-700" },
  10: { bg: "bg-orange-50", color: "text-orange-700" },
  0: { bg: "bg-yellow-100", color: "text-yellow-800" },
};

export default function VendorPortalGrowth() {
  const { cumulativeRevenue, milestones, voucherRemaining, voucherTotal, drawHistory } = mockGrowthRewards;

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
        <Trophy className="w-5 h-5 text-orange-500" /> 成長獎勵
      </h2>
      <p className="text-sm text-muted-foreground mb-5">
        累積合作營收達門檻，解鎖消費者端抽獎機制；獎項是折扣券或整份免費，鼓勵消費者持續回購。
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 門檻進度 */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">門檻進度</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {milestones.map(m => {
              const pct = Math.min(100, Math.round((cumulativeRevenue / m.threshold) * 100));
              return (
                <div key={m.id}>
                  <div className="flex items-center justify-between mb-1.5 text-sm">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" /> {m.label}
                    </span>
                    {m.achieved ? (
                      <span className="text-xs font-bold text-green-700">已達成</span>
                    ) : (
                      <span className="text-xs font-semibold text-muted-foreground">
                        ${cumulativeRevenue.toLocaleString()} / ${m.threshold.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${m.achieved ? "bg-green-600" : "bg-orange-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {!m.achieved && (
                    <p className="text-xs text-muted-foreground mt-1">
                      還差 ${(m.threshold - cumulativeRevenue).toLocaleString()} 解鎖
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* 0 元券庫存 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-1.5">
              <Ticket className="w-4 h-4 text-orange-500" /> 0 元券庫存
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">剩餘 {voucherRemaining} / {voucherTotal}</p>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
              <div className="h-full rounded-full bg-yellow-500" style={{ width: `${(voucherRemaining / voucherTotal) * 100}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">見底後將自動降級為 1 折券，仍保留六級保底機制</p>
          </CardContent>
        </Card>
      </div>

      {/* 歷史開獎名單 */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">歷史開獎名單</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-4 gap-2 px-6 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
            <span>日期</span>
            <span>消費者</span>
            <span>抽中等級</span>
            <span>品項</span>
          </div>
          {drawHistory.map(d => {
            const style = TIER_STYLE[d.tierPercentOff] ?? { bg: "bg-gray-100", color: "text-gray-600" };
            return (
              <div key={d.id} className="grid grid-cols-4 gap-2 px-6 py-3 text-sm border-b border-border last:border-0 items-center">
                <span className="text-muted-foreground">{d.date}</span>
                <span>{d.consumer}</span>
                <span>
                  <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${style.bg} ${style.color}`}>
                    {d.tierLabel}
                  </span>
                </span>
                <span className="text-muted-foreground truncate">{d.item}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </VendorPortalLayout>
  );
}

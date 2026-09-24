import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Ticket, Sparkles } from "lucide-react";
import { db } from "@/lib/firebase";
import { EmptyState } from "@/components/ds";

// 對應 UI草圖 VendorDashboard.dc.html「成長獎勵」分頁——全新機制，之前的雛型
// 完全沒有：商家累積合作營收達門檻後，解鎖消費者端抽獎（單抽／十連抽），獎項是
// 折扣券（8/6/5/3/1折或整份 0 元）。對應 Main 草圖新增的跑馬燈「剛抽中...0 元
// 大獎」（見 HomePage.tsx 的 GrowthRewardTicker）。
//
// 2026-09-22 接上真實資料：
//   - 累積營收：即時加總這個商家的 payouts.amount（跟 payouts 共用 vendor_id
//     索引），不用另外存一個累計欄位怕跟實際撥款對不上
//   - 門檻：平台固定政策（20萬/100萬），不是每個商家可調整的資料，寫死常數
//   - 0 元券庫存／開獎紀錄：真的讀 growth_rewards/{vendorId}、draws
//     collection——這兩個都只由 Cloud Function `drawGrowthReward` 寫（機率
//     計算不能信任 client），程式碼在 functions/src/index.js，但因為 Blaze
//     還沒升級，還沒有機會在正式站被呼叫過，這頁目前大概率會一直看到
//     「尚無資料」直到有人在 emulator 或正式站抽過獎
const VENDOR_ID = "cafe-renheya-demo";

const MILESTONES = [
  { id: "tier1", label: "20 萬門檻・單抽", threshold: 200000 },
  { id: "tier2", label: "100 萬門檻・十連抽", threshold: 1000000 },
];

const DEFAULT_VOUCHER_TOTAL = 10;

const TIER_STYLE: Record<number, { bg: string; color: string; label: string }> = {
  80: { bg: "bg-amber-50", color: "text-amber-700", label: "8折" },
  60: { bg: "bg-amber-50", color: "text-amber-700", label: "6折" },
  50: { bg: "bg-blue-50", color: "text-blue-700", label: "5折" },
  30: { bg: "bg-purple-50", color: "text-purple-700", label: "3折" },
  10: { bg: "bg-orange-50", color: "text-orange-700", label: "1折" },
  0: { bg: "bg-yellow-100", color: "text-yellow-800", label: "0元整份" },
};

interface DrawRecord {
  id: string;
  price_percent: number;
  item_name?: string | null;
  created_at?: { toDate?: () => Date };
}

export default function VendorPortalGrowth() {
  const [cumulativeRevenue, setCumulativeRevenue] = useState(0);
  const [voucherRemaining, setVoucherRemaining] = useState(DEFAULT_VOUCHER_TOTAL);
  const [voucherTotal, setVoucherTotal] = useState(DEFAULT_VOUCHER_TOTAL);
  const [drawHistory, setDrawHistory] = useState<DrawRecord[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "payouts"), where("vendor_id", "==", VENDOR_ID)), (snap) => {
      setCumulativeRevenue(snap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "growth_rewards", VENDOR_ID), (snap) => {
      if (snap.exists()) {
        setVoucherRemaining(snap.data().voucher_remaining ?? DEFAULT_VOUCHER_TOTAL);
        setVoucherTotal(snap.data().voucher_total ?? DEFAULT_VOUCHER_TOTAL);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    // 單一 equality（vendor_id），不加 orderBy，避免另外要求新複合索引，排序
    // 交給前端做——同 VendorPortalPrep/TransferMarketPage 的慣例。
    const unsub = onSnapshot(query(collection(db, "draws"), where("vendor_id", "==", VENDOR_ID)), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as DrawRecord);
      rows.sort((a, b) => (b.created_at?.toDate?.().getTime() ?? 0) - (a.created_at?.toDate?.().getTime() ?? 0));
      setDrawHistory(rows.slice(0, 20));
    });
    return () => unsub();
  }, []);

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
            {MILESTONES.map(m => {
              const achieved = cumulativeRevenue >= m.threshold;
              const pct = Math.min(100, Math.round((cumulativeRevenue / m.threshold) * 100));
              return (
                <div key={m.id}>
                  <div className="flex items-center justify-between mb-1.5 text-sm">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" /> {m.label}
                    </span>
                    {achieved ? (
                      <span className="text-xs font-bold text-green-700">已達成</span>
                    ) : (
                      <span className="text-xs font-semibold text-muted-foreground">
                        ${cumulativeRevenue.toLocaleString()} / ${m.threshold.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${achieved ? "bg-green-600" : "bg-orange-500"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {!achieved && (
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
          {drawHistory.length === 0 ? (
            <EmptyState size="compact" icon={<Trophy size={32} />} title="尚無開獎紀錄" />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 px-6 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
                <span>日期</span>
                <span>抽中等級</span>
                <span>品項</span>
              </div>
              {drawHistory.map(d => {
                const style = TIER_STYLE[d.price_percent] ?? { bg: "bg-gray-100", color: "text-gray-600", label: `${d.price_percent}%` };
                const date = d.created_at?.toDate?.();
                return (
                  <div key={d.id} className="grid grid-cols-3 gap-2 px-6 py-3 text-sm border-b border-border last:border-0 items-center">
                    <span className="text-muted-foreground">{date ? date.toLocaleDateString("zh-TW") : "—"}</span>
                    <span>
                      <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${style.bg} ${style.color}`}>
                        {style.label}
                      </span>
                    </span>
                    <span className="text-muted-foreground truncate">{d.item_name ?? "—"}</span>
                  </div>
                );
              })}
            </>
          )}
        </CardContent>
      </Card>
    </VendorPortalLayout>
  );
}

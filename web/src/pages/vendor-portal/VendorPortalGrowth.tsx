import { discountText } from "@/lib/pricing";
import { tr } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trophy, Ticket, Sparkles } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState } from "@/components/ds";

// 對應 UI草圖 VendorDashboard.dc.html「成長獎勵」分頁——全新機制，之前的雛型
// 完全沒有：商家累積合作營收達門檻後，解鎖消費者端抽獎（單抽／十連抽），獎項是
// 折扣券（8/6/5/3/1折或整份 0 元）。對應 Main 草圖新增的跑馬燈「剛抽中...0 元
// 大獎」（見 HomePage.tsx 的 GrowthRewardTicker）。
//
// 2026-09-22 接上真實資料：
//   - 累積營收：即時加總這個商家的 payouts.amount（跟 payouts 共用 vendor_id
//     索引），不用另外存一個累計欄位怕跟實際撥款對不上
//   - 門檻：平台層級設定，讀 platform_config/growth（跟 Functions drawGrowthReward／
//     syncGrowthUnlock 同一份），只有管理員能改
//   - 0 元券庫存／開獎紀錄：真的讀 growth_rewards/{vendorId}、draws
//     collection——這兩個都只由 Cloud Function `drawGrowthReward` 寫（機率
//     計算不能信任 client），程式碼在 functions/src/index.js，但因為 Blaze
//     還沒升級，還沒有機會在正式站被呼叫過，這頁目前大概率會一直看到
//     「尚無資料」直到有人在 emulator 或正式站抽過獎

interface Milestone {
  id: string;
  label: string;
  label_en?: string;
  threshold: number;
}

// price_percent＝要付原價的幾 %；標籤依語言組（8 折＝20% off）
const TIER_STYLE: Record<number, { bg: string; color: string }> = {
  80: { bg: "bg-amber-50", color: "text-amber-700" },
  60: { bg: "bg-amber-50", color: "text-amber-700" },
  50: { bg: "bg-blue-50", color: "text-blue-700" },
  30: { bg: "bg-purple-50", color: "text-purple-700" },
  10: { bg: "bg-orange-50", color: "text-orange-700" },
  0: { bg: "bg-yellow-100", color: "text-yellow-800" },
};
const tierLabel = (pricePercent: number) =>
  pricePercent === 0 ? tr("0元整份", "Free meal") : discountText(100 - pricePercent);

interface DrawRecord {
  id: string;
  price_percent: number;
  item_name?: string | null;
  item_name_en?: string;
  created_at?: { toDate?: () => Date };
}

export default function VendorPortalGrowth() {
  // 商家後台只讓 role=vendor 進來，vendorId 是登入店主綁定的商家
  const VENDOR_ID = useAuth().user?.vendorId;
  const [cumulativeRevenue, setCumulativeRevenue] = useState(0);
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [defaultVoucherTotal, setDefaultVoucherTotal] = useState(0);
  const [reward, setReward] = useState<{ voucher_remaining?: number; voucher_total?: number }>({});
  const voucherTotal = reward.voucher_total ?? defaultVoucherTotal;
  const voucherRemaining = reward.voucher_remaining ?? voucherTotal;

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "platform_config", "growth"), (snap) => {
      const data = snap.data() ?? {};
      setMilestones([...((data.milestones as Milestone[] | undefined) ?? [])].sort((a, b) => a.threshold - b.threshold));
      setDefaultVoucherTotal(typeof data.voucher_total === "number" ? data.voucher_total : 0);
    });
    return () => unsub();
  }, []);
  const [drawHistory, setDrawHistory] = useState<DrawRecord[]>([]);

  useEffect(() => {
    if (!VENDOR_ID) return;
    const unsub = onSnapshot(query(collection(db, "payouts"), where("vendor_id", "==", VENDOR_ID)), (snap) => {
      setCumulativeRevenue(snap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0));
    });
    return () => unsub();
  }, [VENDOR_ID]);

  useEffect(() => {
    if (!VENDOR_ID) return;
    const unsub = onSnapshot(doc(db, "growth_rewards", VENDOR_ID), (snap) => {
      setReward(snap.data() ?? {});
    });
    return () => unsub();
  }, [VENDOR_ID]);

  useEffect(() => {
    if (!VENDOR_ID) return;
    // 單一 equality（vendor_id），不加 orderBy，避免另外要求新複合索引，排序
    // 交給前端做——同 VendorPortalPrep/TransferMarketPage 的慣例。
    const unsub = onSnapshot(query(collection(db, "draws"), where("vendor_id", "==", VENDOR_ID)), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as DrawRecord);
      rows.sort((a, b) => (b.created_at?.toDate?.().getTime() ?? 0) - (a.created_at?.toDate?.().getTime() ?? 0));
      setDrawHistory(rows.slice(0, 20));
    });
    return () => unsub();
  }, [VENDOR_ID]);

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
        <Trophy className="w-5 h-5 text-orange-500" /> {tr("成長獎勵", "Growth rewards")}
      </h2>
      <p className="text-sm text-muted-foreground mb-5">
        {tr("累積合作營收達門檻，解鎖消費者端抽獎機制；獎項是折扣券或整份免費，鼓勵消費者持續回購。", "Reach a revenue threshold to unlock a prize draw for customers — prizes are discount vouchers or free meals that keep them coming back.")}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 門檻進度 */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tr("門檻進度", "Progress")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {milestones.length === 0 && (
              <p className="text-sm text-muted-foreground">{tr("平台尚未設定成長獎勵門檻。", "The platform hasn't set growth thresholds yet.")}</p>
            )}
            {milestones.map(m => {
              const achieved = cumulativeRevenue >= m.threshold;
              const pct = Math.min(100, Math.round((cumulativeRevenue / m.threshold) * 100));
              return (
                <div key={m.id}>
                  <div className="flex items-center justify-between mb-1.5 text-sm">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" /> {tr(m.label, m.label_en ?? m.label)}
                    </span>
                    {achieved ? (
                      <span className="text-xs font-bold text-green-700">{tr("已達成", "Reached")}</span>
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
                      {tr(`還差 $${(m.threshold - cumulativeRevenue).toLocaleString()} 解鎖`, `$${(m.threshold - cumulativeRevenue).toLocaleString()} to unlock`)}
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
              <Ticket className="w-4 h-4 text-orange-500" /> {tr("0 元券庫存", "Free-meal vouchers")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">{tr("剩餘", "Remaining")} {voucherRemaining} / {voucherTotal}</p>
            <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-2">
              <div className="h-full rounded-full bg-yellow-500" style={{ width: `${(voucherRemaining / voucherTotal) * 100}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{tr("見底後將自動降級為 1 折券，仍保留六級保底機制", "When they run out, winners get a 90%-off voucher instead; all six tiers still apply")}</p>
          </CardContent>
        </Card>
      </div>

      {/* 歷史開獎名單 */}
      <Card className="mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{tr("歷史開獎名單", "Draw history")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {drawHistory.length === 0 ? (
            <EmptyState size="compact" icon={<Trophy size={32} />} title={tr("尚無開獎紀錄", "No draws yet")} />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 px-6 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
                <span>{tr("日期", "Date")}</span>
                <span>{tr("抽中等級", "Prize")}</span>
                <span>{tr("品項", "Item")}</span>
              </div>
              {drawHistory.map(d => {
                const style = { ...(TIER_STYLE[d.price_percent] ?? { bg: "bg-gray-100", color: "text-gray-600" }), label: tierLabel(d.price_percent) };
                const date = d.created_at?.toDate?.();
                return (
                  <div key={d.id} className="grid grid-cols-3 gap-2 px-6 py-3 text-sm border-b border-border last:border-0 items-center">
                    <span className="text-muted-foreground">{date ? date.toLocaleDateString("zh-TW") : "—"}</span>
                    <span>
                      <span className={`inline-block text-xs font-bold px-2 py-0.5 rounded-full ${style.bg} ${style.color}`}>
                        {style.label}
                      </span>
                    </span>
                    <span className="text-muted-foreground truncate">{tr(d.item_name ?? "—", d.item_name_en || d.item_name || "—")}</span>
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

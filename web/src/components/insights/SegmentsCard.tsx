import { UsersRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import InfoTip from "@/components/InfoTip";
import { useCustomerSegments } from "@/lib/analytics";
import { formatNT } from "@/lib/format";
import { loc, tr } from "@/lib/i18n";

// 每一群一個顏色，依人數多寡輪流用
const SEGMENT_COLORS = ["bg-orange-400", "bg-emerald-500", "bg-sky-500", "bg-violet-400", "bg-rose-400", "bg-stone-400"];

/**
 * 客群（BigQuery ML.KMEANS 分群＋Gemini 產生的一句話描述，後端寫進 vendors/{id}/segments）：
 * 一條色帶看各群占比，下面每群一張小卡。只有彙總數字，沒有任何個人資料。
 * 還沒有資料時整塊不顯示（區域分頁本來就有自己的空狀態）。
 */
export default function SegmentsCard({ vendorId }: { vendorId: string | undefined }) {
  const { data: segments = [] } = useCustomerSegments(vendorId);
  if (segments.length === 0) return null;
  const total = segments.reduce((sum, s) => sum + s.customers, 0);

  return (
    <Card className="border-2">
      <CardContent className="p-4 space-y-3">
        <p className="font-semibold flex items-center gap-1.5">
          <UsersRound className="w-4 h-4 text-accent-foreground" aria-hidden="true" />
          {tr("你的客人大概分這幾種", "Your customers, by type")}
          <InfoTip>{tr("依每位客人多久來一次、多常訂、花多少、轉讓與未取餐的比例自動分群，再由 AI 寫一句描述。只有彙總，看不到任何個人資料。", "Grouped automatically by recency, frequency, spend, transfer and no-show rates, with an AI-written summary. Aggregates only — no personal data.")}</InfoTip>
          <span className="ml-auto text-xs font-normal text-muted-foreground">{tr(`共 ${total} 位`, `${total} customers`)}</span>
        </p>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={tr("各客群占比", "Share of each segment")}>
          {segments.map((s, i) => <span key={s.id} className={SEGMENT_COLORS[i % SEGMENT_COLORS.length]} style={{ width: `${(s.share ?? 0) * 100}%` }} />)}
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {segments.map((s, i) => (
            <li key={s.id} className="rounded-xl border border-border p-3 space-y-1">
              <p className="flex items-center gap-2 font-semibold">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]}`} aria-hidden="true" />
                <span className="truncate">{loc(s, "name")}</span>
                <span className="ml-auto shrink-0 tabular-nums">{Math.round((s.share ?? 0) * 100)}%</span>
              </p>
              <p className="text-sm text-muted-foreground">{loc(s, "description")}</p>
              <p className="text-xs text-muted-foreground">
                {[
                  tr(`${s.customers} 位`, `${s.customers} customers`),
                  s.orders_per_month != null ? tr(`每月約 ${Math.round(s.orders_per_month * 10) / 10} 次`, `≈${Math.round(s.orders_per_month * 10) / 10} orders/mo`) : null,
                  s.avg_spend != null ? tr(`平均每筆 ${formatNT(s.avg_spend)}`, `avg ${formatNT(s.avg_spend)}`) : null,
                ].filter(Boolean).join("・")}
              </p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

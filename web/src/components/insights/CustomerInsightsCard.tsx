import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { Link2, Users } from "lucide-react";
import { db } from "@/lib/firebase";
import { tr, loc } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import InfoTip from "@/components/InfoTip";

interface BasketPair { item_a: string; item_b: string; buyers: number; confidence: number }
interface Segment {
  segment_id: number;
  label: string | null;
  description: string | null;
  label_en?: string | null;
  description_en?: string | null;
  customers: number;
}

/**
 * 常一起買＋客群分布（functions/src/customerInsights.js 每週一用 BigQuery ML.KMEANS／AI.GENERATE 寫入
 * vendors/{id}/analytics/basket、segments）。只有彙總，沒有會員名單；兩份都還沒有就整張不顯示。
 */
export default function CustomerInsightsCard({ vendorId }: { vendorId: string | undefined }) {
  const [pairs, setPairs] = useState<BasketPair[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);

  useEffect(() => {
    if (!vendorId) return;
    const unsubs = [
      onSnapshot(doc(db, "vendors", vendorId, "analytics", "basket"), (s) => setPairs((s.data()?.pairs as BasketPair[]) ?? []), () => setPairs([])),
      onSnapshot(doc(db, "vendors", vendorId, "analytics", "segments"), (s) => setSegments((s.data()?.segments as Segment[]) ?? []), () => setSegments([])),
    ];
    return () => unsubs.forEach((u) => u());
  }, [vendorId]);

  if (pairs.length === 0 && segments.length === 0) return null;
  const totalCustomers = segments.reduce((s, x) => s + x.customers, 0) || 1;

  return (
    <Card className="border-2">
      <CardContent className="p-4 space-y-5">
        {segments.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-accent-foreground" />
              <p className="font-semibold">{tr("你的熟客是哪些人", "Who your regulars are")}</p>
              <InfoTip>{tr("平台用 BigQuery 把買過 2 份以上的會員依購買頻率、金額、早鳥折扣、轉讓與未取餐比例分成幾群，群名和說明由 Gemini 依各群的平均數字撰寫，每週一更新。只顯示人數，看不到是哪些會員。", "Members with 2+ orders are grouped in BigQuery by frequency, spend, early-bird use, transfers and no-shows; Gemini writes each group's name from its averages. Updated every Monday. Counts only — no member list.")}</InfoTip>
            </div>
            {segments.map((s) => (
              <div key={s.segment_id}>
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-medium truncate">{loc(s, "label") || tr(`客群 ${s.segment_id}`, `Group ${s.segment_id}`)}</span>
                  <span className="shrink-0"><b>{s.customers}</b> {tr("人", "")}</span>
                </div>
                <div className="mt-1 h-3 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-brand/60" style={{ width: `${(s.customers / totalCustomers) * 100}%` }} />
                </div>
                {loc(s, "description") && <p className="mt-1 text-xs text-muted-foreground">{loc(s, "description")}</p>}
              </div>
            ))}
          </div>
        )}
        {pairs.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-accent-foreground" />
              <p className="font-semibold">{tr("常一起買", "Often bought together")}</p>
              <InfoTip>{tr("同一位客人在你這裡兩樣都買過（不一定同一天）。可以參考來排套餐或配菜。", "The same customer has bought both from you (not necessarily the same day).")}</InfoTip>
            </div>
            {pairs.map((p) => (
              <div key={`${p.item_a}|${p.item_b}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{p.item_a} <span className="text-muted-foreground">＋</span> {p.item_b}</span>
                <span className="shrink-0 text-muted-foreground"><b className="text-foreground">{p.buyers}</b> {tr("位客人", "customers")}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

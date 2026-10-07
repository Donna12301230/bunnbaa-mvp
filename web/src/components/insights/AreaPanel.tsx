import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Bell, Lightbulb, MapPinned, RefreshCw, Sparkles, ThumbsDown, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ds";
import InfoTip from "@/components/InfoTip";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useToast } from "@/hooks/use-toast";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { usePlatformConfig } from "@/lib/platformConfig";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Insight {
  id: string;
  week: string;
  insufficient?: boolean;
  users?: number;
  orders?: number;
  nearby_vendors?: number;
  tag_shares?: { tag: string; share: number }[];
  removal_rates?: { dish: string; rate: number; total: number }[];
  open_wishes?: { dish: string; dish_key: string; people: number }[];
  gaps?: { tag: string; share: number; suppliers: number }[];
}
interface Tally { id: string; name: string; count: number; notified?: boolean; listed?: boolean }

/** 一列長條：名稱、色條、數值 */
function Bar({ label, value, max, text, cls = "bg-orange-400" }: { label: string; value: number; max: number; text: string; cls?: string }) {
  return (
    <div className="grid grid-cols-[6rem_1fr_auto] items-center gap-2 text-sm">
      <span className="truncate">{label}</span>
      <div className="h-3 rounded-full bg-stone-100 overflow-hidden"><div className={cn("h-full rounded-full", cls)} style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} /></div>
      <span className="w-14 text-right tabular-nums text-muted-foreground">{text}</span>
    </div>
  );
}

/**
 * 區域洞察（規格 §10.2）：取餐點方圓 1 公里、近 30 天，統計人數少於 20 人不顯示。
 * 只有匿名彙總：你的店的許願（進度條到「參考名單」門檻）、附近口味占比、供需缺口、許願排行、「不要」率。
 */
export default function AreaPanel({ vendorId, onHeadline }: { vendorId: string | undefined; onHeadline?: (n: number) => void }) {
  const { data: vendor } = useMyVendor();
  const { data: config } = usePlatformConfig();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [insight, setInsight] = useState<Insight | null>(null);
  const [tally, setTally] = useState<Tally[]>([]);
  const [busy, setBusy] = useState(false);
  const threshold = config?.openWishThreshold ?? 20;

  useEffect(() => {
    if (!vendorId) return;
    const u1 = onSnapshot(query(collection(db, "areaInsights"), where("vendor_id", "==", vendorId)), (s) => {
      const list = s.docs.map((d) => ({ id: d.id, ...d.data() }) as Insight).sort((a, b) => b.week.localeCompare(a.week));
      setInsight(list[0] ?? null);
    }, () => setInsight(null));
    const u2 = onSnapshot(collection(db, "vendors", vendorId, "wishTally"), (s) => setTally(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Tally).filter((t) => t.count > 0).sort((a, b) => b.count - a.count)), () => setTally([]));
    return () => { u1(); u2(); };
  }, [vendorId]);
  useEffect(() => { onHeadline?.(tally.reduce((s, t) => s + t.count, 0)); }, [tally]);

  async function rebuild() {
    setBusy(true);
    try {
      await httpsCallable(functions, "triggerTallyOpenWishesNow")({});
      const res = await httpsCallable(functions, "triggerAreaInsightsNow")({});
      const r = res.data as { skipped?: string };
      if (r.skipped === "no_location") toast({ title: tr("請先到店家設定填取餐點座標", "Set your pickup location in Store settings first") });
      else toast({ title: tr("已更新", "Updated") });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function notifyListed(t: Tally) {
    try {
      const res = await httpsCallable(functions, "notifyWishersListed")({ dish_key: t.id });
      toast({ title: tr(`已通知 ${(res.data as { notified: number }).notified} 位許願的人`, `Notified ${(res.data as { notified: number }).notified} people`) });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    }
  }

  const tallyMax = Math.max(threshold, ...tally.map((t) => t.count));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <MapPinned className="w-4 h-4 text-orange-500" />
        {tr(`取餐點方圓 ${config?.insightRadiusMeters ?? 1000} 公尺・近 30 天`, `Within ${config?.insightRadiusMeters ?? 1000} m · 30 days`)}
        <InfoTip>{tr(`少於 ${config?.insightMinUsers ?? 20} 人不顯示。只有匿名彙總，看不到任何個人資料。每週一自動更新。`, `Hidden under ${config?.insightMinUsers ?? 20} people. Anonymous totals only. Updated every Monday.`)}</InfoTip>
        {!vendor?.lat && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">{tr("還沒設定取餐點座標", "No pickup location")}</span>}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={rebuild} disabled={busy}><RefreshCw className={cn(busy && "animate-spin")} /> {tr("重新統計", "Refresh")}</Button>
      </div>

      {/* 你的店的許願：進度條到參考名單門檻 */}
      <Card className="border-2">
        <CardContent className="p-4 space-y-3">
          <p className="font-semibold flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-orange-500" />{tr("客人想吃什麼（向你的店許願）", "What customers wish you'd make")}</p>
          {tally.length === 0 ? <p className="text-sm text-muted-foreground">{tr("還沒有人許願。", "No wishes yet.")}</p> : tally.map((t) => {
            const hot = t.count >= threshold;
            return (
              <div key={t.id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{t.name}</span>
                  <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Users className="w-3.5 h-3.5" />{t.count}</span>
                  {hot && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">🔥 {tr("夠多人了", "Popular")}</span>}
                  <span className="ml-auto">
                    {t.listed ? <span className="text-xs text-green-700">✓ {tr("已通知", "Notified")}</span> : (
                      <Button size="sm" variant="outline" onClick={() => notifyListed(t)} title={tr("上架後按這裡通知當初許願的人", "After listing it, notify wishers")}><Bell /> {tr("上架了，通知他們", "Listed — notify")}</Button>
                    )}
                  </span>
                </div>
                <div className="relative h-3 rounded-full bg-stone-100 overflow-hidden" role="img" aria-label={tr(`${t.count} 人，門檻 ${threshold}`, `${t.count} people, threshold ${threshold}`)}>
                  <div className={cn("h-full rounded-full", hot ? "bg-orange-500" : "bg-orange-300")} style={{ width: `${(t.count / tallyMax) * 100}%` }} />
                  <span className="absolute top-0 bottom-0 w-0.5 bg-foreground/60" style={{ left: `${(threshold / tallyMax) * 100}%` }} />
                </div>
              </div>
            );
          })}
          {tally.length > 0 && <p className="text-xs text-muted-foreground">{tr(`直線＝${threshold} 人門檻。要上架：到菜單管理按「加一格」打菜名，AI 會幫你填配方。`, `Line = ${threshold}-person threshold. To list: add a cell in Menu and let AI fill it.`)}</p>}
        </CardContent>
      </Card>

      {!insight ? (
        <EmptyState icon={<Lightbulb size={32} />} title={tr("還沒有區域統計", "No area stats yet")} description={tr("每週一自動產生，也可以按「重新統計」。", "Generated every Monday, or press Refresh.")} />
      ) : insight.insufficient ? (
        <EmptyState icon={<Lightbulb size={32} />} title={tr("附近資料不足", "Not enough data nearby")} description={tr(`統計人數少於 ${config?.insightMinUsers ?? 20} 人，為保護隱私暫不顯示。`, "Fewer people than the privacy minimum — hidden for now.")} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[[tr("附近的人", "People"), insight.users], [tr("份訂單", "Orders"), insight.orders], [tr("家店", "Shops"), insight.nearby_vendors]].map(([label, n]) => (
              <Card key={String(label)} className="border-2"><CardContent className="p-3 text-center"><p className="text-2xl font-bold">{n ?? 0}</p><p className="text-xs text-muted-foreground">{label}</p></CardContent></Card>
            ))}
          </div>

          {insight.gaps && insight.gaps.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-3">
              {insight.gaps.map((g) => (
                <Card key={g.tag} className="border-2 border-green-300 bg-green-50/60">
                  <CardContent className="p-4 space-y-2">
                    <p className="text-xs font-semibold text-green-800">💡 {tr("機會：想吃的人多、賣的店少", "Opportunity: high demand, few shops")}</p>
                    <p className="text-xl font-bold">{g.tag}</p>
                    <div className="flex gap-4 text-sm">
                      <span>{tr("需求", "Demand")} <b className="text-lg">{g.share}%</b></span>
                      <span>{tr("附近供應", "Nearby")} <b className="text-lg">{g.suppliers}</b> {tr("家", "")}</span>
                    </div>
                    <Button size="sm" onClick={() => navigate("/vendor-portal/menu")}>{tr("加一道試試", "Try a dish")}</Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-3">
            <Card className="border-2">
              <CardContent className="p-4 space-y-2">
                <p className="font-semibold">{tr("附近的人喜歡的口味", "Tastes nearby")}</p>
                {insight.tag_shares?.map((t) => <Bar key={t.tag} label={t.tag} value={t.share} max={100} text={`${t.share}%`} />)}
              </CardContent>
            </Card>
            <Card className="border-2">
              <CardContent className="p-4 space-y-2">
                <p className="font-semibold">{tr("附近大家許願的菜", "Nearby wishes")}</p>
                {insight.open_wishes?.length ? insight.open_wishes.map((w) => <Bar key={w.dish_key} label={w.dish} value={w.people} max={insight.open_wishes![0].people} text={tr(`${w.people} 人`, `${w.people}`)} cls="bg-violet-400" />) : <p className="text-sm text-muted-foreground">—</p>}
              </CardContent>
            </Card>
            <Card className="border-2 md:col-span-2">
              <CardContent className="p-4 space-y-2">
                <p className="font-semibold flex items-center gap-1.5"><ThumbsDown className="w-4 h-4 text-red-500" />{tr("常被點「不要」的配菜", "Most-removed sides")}</p>
                {insight.removal_rates?.length ? insight.removal_rates.map((r) => <Bar key={r.dish} label={r.dish} value={r.rate} max={100} text={`${r.rate}%`} cls="bg-red-400" />) : <p className="text-sm text-muted-foreground">—</p>}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

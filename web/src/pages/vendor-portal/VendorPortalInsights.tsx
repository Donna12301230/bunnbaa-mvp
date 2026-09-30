import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Lightbulb, MapPinned, RefreshCw, Sparkles, Bell } from "lucide-react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ds";
import { useAuth } from "@/hooks/useAuth";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useToast } from "@/hooks/use-toast";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { usePlatformConfig } from "@/lib/platformConfig";
import { tr } from "@/lib/i18n";

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

/**
 * 區域洞察（規格 §10.2）：取餐點方圓 1 公里、近 30 天，統計人數少於 20 人不顯示。
 * 只有匿名彙總：標籤占比、開放許願排行、「不要」率高的菜、供需缺口；看不到任何個人資料。
 * 缺口可一鍵去建立候選菜試水溫。
 */
export default function VendorPortalInsights() {
  const vendorId = useAuth().user?.vendorId;
  const { data: vendor } = useMyVendor();
  const { data: config } = usePlatformConfig();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [insight, setInsight] = useState<Insight | null>(null);
  const [tally, setTally] = useState<Tally[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!vendorId) return;
    const u1 = onSnapshot(query(collection(db, "areaInsights"), where("vendor_id", "==", vendorId)), (s) => {
      const list = s.docs.map((d) => ({ id: d.id, ...d.data() }) as Insight).sort((a, b) => b.week.localeCompare(a.week));
      setInsight(list[0] ?? null);
    }, () => setInsight(null));
    const u2 = onSnapshot(collection(db, "vendors", vendorId, "wishTally"), (s) => setTally(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Tally).filter((t) => t.count > 0).sort((a, b) => b.count - a.count)));
    return () => {
      u1();
      u2();
    };
  }, [vendorId]);

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

  return (
    <VendorPortalLayout>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <h2 className="text-xl font-bold flex items-center gap-2"><MapPinned className="w-5 h-5 text-orange-500" /> {tr("區域洞察與許願", "Area insights & wishes")}</h2>
        <Button variant="outline" size="sm" onClick={rebuild} disabled={busy}><RefreshCw /> {tr("重新統計", "Refresh")}</Button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        {tr(`取餐點方圓 ${config?.insightRadiusMeters ?? 1000} 公尺、近 30 天；少於 ${config?.insightMinUsers ?? 20} 人不顯示。只有匿名彙總，看不到個人資料。`, `Within ${config?.insightRadiusMeters ?? 1000} m, last 30 days; hidden under ${config?.insightMinUsers ?? 20} people. Anonymous totals only.`)}
        {!vendor?.lat && tr("（尚未設定取餐點座標）", " (pickup location not set)")}
      </p>

      <Card className="mb-4">
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-orange-500" /> {tr("開放許願（你的店，近 30 天人數）", "Open wishes for your store (people, 30 days)")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {tally.length === 0 ? <p className="text-sm text-muted-foreground">{tr("還沒有人許願。", "No wishes yet.")}</p> : tally.map((t) => (
            <div key={t.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{t.name}</span>
              <span className="font-semibold">{t.count} {tr("人", "")}</span>
              {t.count >= (config?.openWishThreshold ?? 20) && <Badge variant="muted" className="bg-orange-100 text-orange-700">{tr("參考名單", "Shortlist")}</Badge>}
              {t.listed ? <Badge variant="muted">{tr("已通知", "Notified")}</Badge> : (
                <Button size="sm" variant="outline" onClick={() => notifyListed(t)} title={tr("上架後按這裡通知當初許願的人", "After listing it, notify wishers")}><Bell /> {tr("已上架，通知", "Listed — notify")}</Button>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">{tr("要上架時到「配方與原物料」用 AI 產生配方草稿，再到菜單管理加進候選菜或新品項。", "To list it, draft a recipe with AI in Recipes, then add it as a candidate or item in Menu.")}</p>
        </CardContent>
      </Card>

      {!insight ? (
        <EmptyState icon={<Lightbulb size={32} />} title={tr("還沒有區域統計", "No area stats yet")} description={tr("每週一自動產生，也可以按「重新統計」。", "Generated every Monday, or press Refresh.")} />
      ) : insight.insufficient ? (
        <EmptyState icon={<Lightbulb size={32} />} title={tr("附近資料不足", "Not enough data nearby")} description={tr(`統計人數少於 ${config?.insightMinUsers ?? 20} 人，為保護隱私暫不顯示。`, "Fewer people than the privacy minimum — hidden for now.")} />
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{tr(`口味標籤占比（${insight.users} 人、${insight.orders} 份、${insight.nearby_vendors} 家店）`, `Tag shares (${insight.users} people)`)}</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              {insight.tag_shares?.map((t) => (
                <div key={t.tag} className="flex items-center gap-2 text-sm">
                  <span className="w-12">{t.tag}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded"><div className="h-2 bg-orange-400 rounded" style={{ width: `${Math.min(100, t.share)}%` }} /></div>
                  <span className="w-12 text-right">{t.share}%</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{tr("供需缺口（需求高、附近供應少）", "Supply gaps")}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {insight.gaps?.length ? insight.gaps.map((g) => (
                <div key={g.tag} className="flex items-center gap-2 text-sm">
                  <span className="flex-1">{g.tag}：{tr(`需求 ${g.share}%，附近 ${g.suppliers} 家供應`, `${g.share}% demand, ${g.suppliers} suppliers`)}</span>
                  <Button size="sm" variant="outline" onClick={() => navigate("/vendor-portal/menu")}>{tr("建立候選菜試水溫", "Try as a candidate")}</Button>
                </div>
              )) : <p className="text-sm text-muted-foreground">{tr("目前沒有明顯缺口。", "No clear gaps right now.")}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{tr("附近開放許願排行", "Nearby open-wish ranking")}</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {insight.open_wishes?.length ? insight.open_wishes.map((w) => <div key={w.dish_key} className="flex justify-between"><span>{w.dish}</span><span>{w.people} {tr("人", "")}</span></div>) : <p className="text-muted-foreground">—</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{tr("「不要」率高的菜", "Most-removed sides")}</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              {insight.removal_rates?.length ? insight.removal_rates.map((r) => <div key={r.dish} className="flex justify-between"><span>{r.dish}</span><span>{r.rate}%（{r.total}）</span></div>) : <p className="text-muted-foreground">—</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </VendorPortalLayout>
  );
}

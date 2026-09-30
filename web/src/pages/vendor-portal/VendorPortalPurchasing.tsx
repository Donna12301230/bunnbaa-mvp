import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { ClipboardCheck, MessageCircle, Printer, RefreshCw, ShoppingBasket } from "lucide-react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, Tag } from "@/components/ds";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { useToast } from "@/hooks/use-toast";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { addDaysStr, mondayOf, todayStr } from "@/lib/pickupSlots";
import { tr } from "@/lib/i18n";

interface Line {
  ingredient_id: string;
  name: string;
  unit: string;
  purchase_unit_label: string;
  purchase_unit_size: number;
  supplier_id: string | null;
  by_day?: { date: string; confirmed: number; forecast: number }[];
  need: number;
  stock: number;
  order_units: number;
  deliveries?: { date: string; units: number }[];
  est_cost: number;
}
interface PurchaseList {
  type: "weekly" | "monthly";
  week_start?: string;
  month?: string;
  lines: Line[];
  board?: { date: string; closed: boolean; confirmed: number; forecast: number }[];
  uncounted: boolean;
  safety_rate: number;
  est_total: number;
  business_days?: number;
}

function nextMonth(): string {
  const [y, m] = todayStr().split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * 採購（規格 §5）：店家一週採購一次。每月備料（小盤商，每月 25 日）、本週進料（週六 12:00 鎖定、
 * 可分日到貨）、每日備料（截單後，見「每日備料」）。原物料依採購頻率自動歸區。
 * 進料量 = 已確定用量 + 預測用量 × (1 + 安全庫存) − 目前庫存，依採購單位進位。
 */
export default function VendorPortalPurchasing() {
  const { data: vendor } = useMyVendor();
  const vendorId = vendor?.id;
  const { data: catalog } = useVendorCatalog(vendorId);
  const { toast } = useToast();
  const thisMonday = mondayOf(todayStr());
  const [week, setWeek] = useState(addDaysStr(thisMonday, 7));
  const [weekly, setWeekly] = useState<PurchaseList | null>(null);
  const [monthly, setMonthly] = useState<PurchaseList | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [counted, setCounted] = useState<{ counted?: boolean; counts?: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const month = nextMonth();

  useEffect(() => {
    if (!vendorId) return;
    return onSnapshot(doc(db, "vendors", vendorId, "purchaseLists", `weekly_${week}`), (s) => setWeekly(s.exists() ? (s.data() as PurchaseList) : null), () => setWeekly(null));
  }, [vendorId, week]);
  useEffect(() => {
    if (!vendorId) return;
    return onSnapshot(doc(db, "vendors", vendorId, "purchaseLists", `monthly_${month}`), (s) => setMonthly(s.exists() ? (s.data() as PurchaseList) : null), () => setMonthly(null));
  }, [vendorId, month]);
  useEffect(() => {
    if (!vendorId) return;
    return onSnapshot(doc(db, "vendors", vendorId, "inventory", thisMonday), (s) => setCounted(s.exists() ? s.data() : null), () => setCounted(null));
  }, [vendorId, thisMonday]);

  const supplierName = (id: string | null) => catalog?.suppliers.find((s) => s.id === id)?.name ?? tr("未指定", "Unassigned");

  async function regenerate(type: "weekly" | "monthly") {
    setBusy(true);
    try {
      await httpsCallable(functions, "triggerPurchaseListNow")(type === "weekly" ? { type, week_start: week } : { type, month });
      toast({ title: tr("已重新產生", "Regenerated") });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  /** 一鍵透過 LINE 傳給小盤商（依供應商分組的文字） */
  function shareLine(list: PurchaseList) {
    const groups = new Map<string, Line[]>();
    list.lines.filter((l) => l.order_units > 0).forEach((l) => groups.set(supplierName(l.supplier_id), [...(groups.get(supplierName(l.supplier_id)) ?? []), l]));
    const title = list.type === "weekly" ? `${vendor?.name} 叫貨單（${list.week_start} 當週）` : `${vendor?.name} ${list.month} 月叫貨單`;
    const text = [title, ...[...groups.entries()].map(([sup, lines]) => `【${sup}】\n${lines.map((l) => `${l.name} ${l.order_units} ${l.purchase_unit_label}${l.deliveries && l.deliveries.length > 1 ? `（${l.deliveries.map((d) => `${d.date.slice(5)} ${d.units}`).join("／")}）` : ""}`).join("\n")}`)].join("\n\n");
    window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  async function saveCount() {
    if (!vendorId || !catalog) return;
    const out: Record<string, number> = {};
    for (const ing of catalog.ingredients) {
      const v = counts[ing.id];
      const theoretical = weekly?.lines.find((l) => l.ingredient_id === ing.id)?.stock ?? counted?.counts?.[ing.id] ?? 0;
      out[ing.id] = v === undefined || v === "" ? theoretical : Number(v);
    }
    await setDoc(doc(db, "vendors", vendorId, "inventory", thisMonday), { counts: out, counted: true, counted_at: new Date() });
    toast({ title: tr("盤點已儲存", "Stock count saved"), description: tr("按「重新產生」讓叫貨單改用盤點值。", "Regenerate the list to use the counted stock.") });
  }

  const listTable = (list: PurchaseList) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted-foreground border-b">
          <th className="py-1.5 pr-2">{tr("原物料", "Item")}</th><th className="pr-2">{tr("需要", "Need")}</th><th className="pr-2">{tr("庫存", "Stock")}</th>
          <th className="pr-2">{tr("叫貨", "Order")}</th>{list.type === "weekly" && <th className="pr-2">{tr("到貨", "Delivery")}</th>}<th className="pr-2">{tr("供應商", "Supplier")}</th><th className="text-right">{tr("估價", "Est.")}</th>
        </tr></thead>
        <tbody>
          {list.lines.map((l) => (
            <tr key={l.ingredient_id} className="border-b last:border-0 align-top">
              <td className="py-1.5 pr-2">{l.name}</td>
              <td className="pr-2">{l.need}{l.unit}</td>
              <td className="pr-2">{l.stock}{l.unit}</td>
              <td className="pr-2 font-semibold">{l.order_units} {l.purchase_unit_label}</td>
              {list.type === "weekly" && <td className="pr-2 text-xs">{(l.deliveries ?? []).map((d) => `${d.date.slice(5)}×${d.units}`).join("、") || "—"}</td>}
              <td className="pr-2 text-xs">{supplierName(l.supplier_id)}</td>
              <td className="text-right">NT${l.est_cost}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm font-semibold text-right mt-2">{tr("估計總額", "Estimated total")} NT${list.est_total}</p>
    </div>
  );

  return (
    <VendorPortalLayout>
      <div className="print:hidden">
        <h2 className="text-xl font-bold mb-1 flex items-center gap-2"><ShoppingBasket className="w-5 h-5 text-orange-500" /> {tr("採購與叫貨", "Purchasing")}</h2>
        <p className="text-sm text-muted-foreground mb-4">{tr("週叫貨單每週六 12:00 鎖定產生、月叫貨單每月 25 日產生。先在週六 12:00 前盤點，只改有差異的項目。", "Weekly lists are generated Saturdays at 12:00, monthly on the 25th. Count stock before Saturday noon — only change what differs.")}</p>
      </div>
      <Tabs defaultValue="weekly">
        <TabsList className="print:hidden">
          <TabsTrigger value="weekly">{tr("本週進料", "Weekly")}</TabsTrigger>
          <TabsTrigger value="monthly">{tr("每月備料", "Monthly")}</TabsTrigger>
          <TabsTrigger value="count">{tr("盤點", "Stock count")}{counted?.counted ? " ✓" : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center print:hidden">
            <Tag selected={week === thisMonday} onClick={() => setWeek(thisMonday)}>{tr("本週", "This week")} {thisMonday.slice(5)}</Tag>
            <Tag selected={week !== thisMonday} onClick={() => setWeek(addDaysStr(thisMonday, 7))}>{tr("下週", "Next week")} {addDaysStr(thisMonday, 7).slice(5)}</Tag>
            <Button size="sm" variant="outline" onClick={() => regenerate("weekly")} disabled={busy}><RefreshCw /> {weekly ? tr("重新產生", "Regenerate") : tr("試算", "Preview")}</Button>
            {weekly && <Button size="sm" variant="outline" onClick={() => shareLine(weekly)}><MessageCircle /> LINE</Button>}
            {weekly && <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> PDF</Button>}
          </div>
          {!weekly ? (
            <EmptyState size="compact" icon={<ShoppingBasket size={32} />} title={tr("還沒有這週的叫貨單", "No list for this week yet")} description={tr("週六 12:00 自動產生；也可以先按「試算」。", "Generated Saturday 12:00, or preview now.")} />
          ) : (
            <>
              {weekly.uncounted && <Badge variant="muted" className="bg-amber-100 text-amber-800 print:hidden">{tr("未盤點：以理論庫存計算", "Not counted: using theoretical stock")}</Badge>}
              {weekly.board && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">{tr("未來訂單看板（份）", "Upcoming orders board")}</CardTitle></CardHeader>
                  <CardContent className="grid grid-cols-5 gap-2 text-center text-sm">
                    {weekly.board.map((b) => (
                      <div key={b.date} className="rounded-md border p-2">
                        <p className="text-xs text-muted-foreground">{b.date.slice(5)}</p>
                        {b.closed ? <p className="text-xs">{tr("休", "Closed")}</p> : (
                          <>
                            <p className="font-bold text-orange-600">{b.confirmed}</p>
                            <p className="text-xs text-muted-foreground">+{tr("預測", "fcst")} {b.forecast}</p>
                          </>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">{tr(`週叫貨單（${weekly.week_start} 當週，安全庫存 ${Math.round(weekly.safety_rate * 100)}%）`, `Weekly list (${weekly.week_start})`)}</CardTitle></CardHeader>
                <CardContent>{listTable(weekly)}
                  <p className="text-xs text-muted-foreground mt-2 print:hidden">{tr("保存 ≤ 3 天的原物料（葉菜）自動建議分批到貨；冷凍與乾貨一次進。「已確定」越接近當天比例越高。", "Items keeping ≤3 days (greens) are split into deliveries; frozen and dry goods come at once.")}</p>
                </CardContent>
              </Card>
              {weekly.lines.some((l) => l.by_day) && (
                <Card className="print:hidden">
                  <CardHeader className="pb-2"><CardTitle className="text-base">{tr("原物料 × 週一至週五（已確定＋預測）", "Ingredients × weekday (confirmed + forecast)")}</CardTitle></CardHeader>
                  <CardContent className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr><th className="text-left py-1">{tr("原物料", "Item")}</th>{weekly.lines[0]?.by_day?.map((d) => <th key={d.date}>{d.date.slice(5)}</th>)}</tr></thead>
                      <tbody>{weekly.lines.map((l) => (
                        <tr key={l.ingredient_id} className="border-t"><td className="py-1">{l.name}</td>{l.by_day?.map((d) => <td key={d.date} className="text-center"><span className="font-semibold">{Math.round(d.confirmed)}</span><span className="text-muted-foreground">+{Math.round(d.forecast)}</span></td>)}</tr>
                      ))}</tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="monthly" className="space-y-4">
          <div className="flex gap-2 print:hidden">
            <Button size="sm" variant="outline" onClick={() => regenerate("monthly")} disabled={busy}><RefreshCw /> {monthly ? tr("重新產生", "Regenerate") : tr("試算", "Preview")}</Button>
            {monthly && <Button size="sm" variant="outline" onClick={() => shareLine(monthly)}><MessageCircle /> LINE</Button>}
            {monthly && <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> PDF</Button>}
          </div>
          {!monthly ? (
            <EmptyState size="compact" icon={<ShoppingBasket size={32} />} title={tr(`${month} 月叫貨單尚未產生`, `No list for ${month}`)} description={tr("米、油、調味料、乾貨、便當盒與包材，每月 25 日自動產生。", "Rice, oil, seasonings, dry goods and packaging — generated on the 25th.")} />
          ) : (
            <Card><CardHeader className="pb-2"><CardTitle className="text-base">{tr(`${month} 月小盤商叫貨單（${monthly.business_days} 個營業日）`, `${month} supplier list`)}</CardTitle></CardHeader><CardContent>{listTable(monthly)}</CardContent></Card>
          )}
        </TabsContent>

        <TabsContent value="count" className="space-y-3">
          <p className="text-sm text-muted-foreground">{tr(`盤點記在本週（${thisMonday}）。欄位預設是理論剩餘量，只改有差異的項目。`, `Counts are recorded for this week (${thisMonday}). Defaults are theoretical; change only what differs.`)}</p>
          {counted?.counted && <Badge variant="muted" className="bg-green-100 text-green-700"><ClipboardCheck className="w-3 h-3 mr-1" />{tr("本週已盤點", "Counted this week")}</Badge>}
          <Card>
            <CardContent className="p-3 space-y-2">
              {catalog?.ingredients.map((ing) => {
                const theoretical = counted?.counts?.[ing.id] ?? weekly?.lines.find((l) => l.ingredient_id === ing.id)?.stock ?? 0;
                return (
                  <div key={ing.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{ing.name}</span>
                    <Input className="w-28 h-8" type="number" placeholder={String(theoretical)} value={counts[ing.id] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [ing.id]: e.target.value }))} />
                    <span className="w-6 text-xs text-muted-foreground">{ing.unit}</span>
                  </div>
                );
              })}
              <Button onClick={saveCount} disabled={!catalog?.ingredients.length}><ClipboardCheck /> {tr("儲存盤點", "Save count")}</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </VendorPortalLayout>
  );
}

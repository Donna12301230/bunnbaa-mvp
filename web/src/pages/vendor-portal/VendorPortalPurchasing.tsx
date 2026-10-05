import { Fragment, useEffect, useMemo, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { AlertTriangle, ChevronDown, ChevronRight, ClipboardCheck, MessageCircle, Printer, RefreshCw, ShoppingBasket } from "lucide-react";
import { useLocation } from "wouter";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import MenuPrepProgress from "@/components/MenuPrepProgress";
import RecipeCraft from "@/components/RecipeCraft";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Tag } from "@/components/ds";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { addDaysStr, bookableDateRange, mondayOf, todayStr } from "@/lib/pickupSlots";
import { amountText } from "@/lib/prep";
import { purchaseText, shareToLine, toPurchaseUnits } from "@/lib/purchaseShare";
import { setPendingEdit } from "@/lib/pendingEdit";
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
  /** 需求來源：哪些品項用到、各幾份（舊叫貨單沒有） */
  sources?: { menu_item_id: string; name: string; confirmed: number; forecast: number; amount: number }[];
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
interface Shortage { ingredient_id: string; name: string; unit: string; need: number; have: number; short: number }

/**
 * 採購（規格 §5）：店家一週採購一次。週叫貨單週六 12:00 鎖定（可分日到貨），每日備料截單後算缺料。
 * 進料量 = 已確定用量 + 預測用量 × (1 + 安全庫存) − 目前庫存，依採購單位進位。
 * 盤點直接在叫貨單的「庫存」欄改，存了就自動重算；每一列可以展開看是哪幾道菜需要。
 * 每日備料算出的缺料會出現在最上面的「臨時補貨」，跟週叫貨單用同一套 LINE 文字。
 */
export default function VendorPortalPurchasing() {
  const { data: vendor } = useMyVendor();
  const vendorId = vendor?.id;
  const { data: catalog } = useVendorCatalog(vendorId);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const thisMonday = mondayOf(todayStr());
  const nextMonday = addDaysStr(thisMonday, 7);
  const [week, setWeek] = useState(nextMonday);
  const [weekly, setWeekly] = useState<PurchaseList | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [counted, setCounted] = useState<{ counted?: boolean; counts?: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [restock, setRestock] = useState<Record<string, Shortage[]>>({});
  // 盤點值只影響「下週」叫貨單（週六盤點記在本週，產生下週的單時使用）
  const editable = week === nextMonday;
  const prepDates = useMemo(() => {
    const today = todayStr();
    return [today, ...bookableDateRange().filter((d) => d > today).slice(0, 1)];
  }, []);

  useEffect(() => {
    if (!vendorId) return;
    return onSnapshot(doc(db, "vendors", vendorId, "purchaseLists", `weekly_${week}`), (s) => setWeekly(s.exists() ? (s.data() as PurchaseList) : null), () => setWeekly(null));
  }, [vendorId, week]);
  useEffect(() => {
    if (!vendorId) return;
    return onSnapshot(doc(db, "vendors", vendorId, "inventory", thisMonday), (s) => setCounted(s.exists() ? s.data() : null), () => setCounted(null));
  }, [vendorId, thisMonday]);
  // 臨時補貨：今天、下一個營業日的備料缺料
  useEffect(() => {
    if (!vendorId) return;
    const unsubs = prepDates.map((d) => onSnapshot(doc(db, "vendors", vendorId, "prepPlans", d), (s) => {
      setRestock((r) => ({ ...r, [d]: s.exists() && s.data().locked_at ? (s.data().shortages ?? []) : [] }));
    }, () => undefined));
    return () => unsubs.forEach((u) => u());
  }, [vendorId, prepDates]);

  const suppliers = catalog?.suppliers ?? [];
  const supplierName = (id: string | null) => suppliers.find((s) => s.id === id)?.name ?? tr("未指定", "Unassigned");
  const ingById = catalog?.ingredientsById ?? {};
  const theoretical = (id: string) => counted?.counts?.[id] ?? weekly?.lines.find((l) => l.ingredient_id === id)?.stock ?? 0;
  const changed = Object.entries(counts).filter(([, v]) => v !== "").length;

  async function regenerate() {
    setBusy(true);
    try {
      await httpsCallable(functions, "triggerPurchaseListNow")({ type: "weekly", week_start: week });
      queryClient.invalidateQueries({ queryKey: ["menuPrepProgress", vendorId] });
      toast({ title: tr("已重新產生", "Regenerated") });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function shareWeekly(list: PurchaseList) {
    const title = `${vendor?.name} 叫貨單（${list.week_start} 當週）`;
    shareToLine(purchaseText(title, list.lines.map((l) => ({ name: l.name, supplier_id: l.supplier_id, units: l.order_units, unit_label: l.purchase_unit_label, deliveries: l.deliveries })), suppliers));
  }

  function shareRestock(date: string, shortages: Shortage[]) {
    shareToLine(purchaseText(tr(`${vendor?.name ?? ""} 臨時補貨（${date} 用）`, `${vendor?.name ?? ""} restock for ${date}`), shortages.map((s) => {
      const ing = ingById[s.ingredient_id];
      return { name: s.name, supplier_id: ing?.supplier_id ?? null, units: toPurchaseUnits(s.short, ing?.purchase_unit_size ?? 1), unit_label: ing?.purchase_unit_label || s.unit };
    }), suppliers));
  }

  /** 存盤點（沒改的用理論值）→ 自動重算下週叫貨單 */
  async function saveCount() {
    if (!vendorId || !catalog) return;
    const out: Record<string, number> = {};
    for (const ing of catalog.ingredients) {
      const v = counts[ing.id];
      out[ing.id] = v === undefined || v === "" ? theoretical(ing.id) : Number(v);
    }
    setBusy(true);
    try {
      await setDoc(doc(db, "vendors", vendorId, "inventory", thisMonday), { counts: out, counted: true, counted_at: new Date() });
      setCounts({});
      toast({ title: tr("盤點已儲存，正在重算叫貨單…", "Count saved — recalculating…") });
    } catch (err) {
      toast({ variant: "destructive", title: tr("盤點儲存失敗", "Couldn't save count"), description: (err as Error).message });
      setBusy(false);
      return;
    }
    await regenerate();
  }

  const stockCell = (id: string, unit: string) => editable ? (
    <span className="inline-flex items-center gap-1">
      <Input className="w-20 h-7 text-xs" type="number" placeholder={String(Math.round(theoretical(id)))} value={counts[id] ?? ""} onChange={(e) => setCounts((c) => ({ ...c, [id]: e.target.value }))} aria-label={tr("盤點數量", "Counted stock")} />
      <span className="text-xs text-muted-foreground">{unit}</span>
    </span>
  ) : <>{Math.round(theoretical(id))}{unit}</>;

  const listTable = (list: PurchaseList) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted-foreground border-b">
          <th className="py-1.5 pr-2">{tr("原物料", "Item")}</th><th className="pr-2">{tr("需要", "Need")}</th><th className="pr-2">{editable ? tr("庫存（盤點）", "Stock (count)") : tr("庫存", "Stock")}</th>
          <th className="pr-2">{tr("叫貨", "Order")}</th><th className="pr-2">{tr("到貨", "Delivery")}</th><th className="pr-2">{tr("供應商", "Supplier")}</th><th className="text-right">{tr("估價", "Est.")}</th>
        </tr></thead>
        <tbody>
          {list.lines.map((l) => {
            const open = openLine === l.ingredient_id;
            return (
              <Fragment key={l.ingredient_id}>
                <tr className="border-b last:border-0 align-top">
                  <td className="py-1.5 pr-2">
                    <button type="button" className="inline-flex items-center gap-0.5 text-left hover:underline print:no-underline" onClick={() => setOpenLine(open ? null : l.ingredient_id)} aria-expanded={open}>
                      <span className="print:hidden">{open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</span>{l.name}
                    </button>
                  </td>
                  <td className="pr-2">{amountText(l.need, l.unit)}</td>
                  <td className="pr-2">{stockCell(l.ingredient_id, l.unit)}</td>
                  <td className="pr-2 font-semibold">{l.order_units} {l.purchase_unit_label}</td>
                  <td className="pr-2 text-xs">{(l.deliveries ?? []).map((d) => `${d.date.slice(5)}×${d.units}`).join("、") || "—"}</td>
                  <td className={`pr-2 text-xs ${l.supplier_id ? "" : "text-amber-700"}`}>{supplierName(l.supplier_id)}</td>
                  <td className="text-right">NT${l.est_cost}</td>
                </tr>
                {open && (
                  <tr className="bg-orange-50/50 print:hidden">
                    <td colSpan={7} className="px-3 py-2 text-xs space-y-1">
                      <p className="font-semibold">{tr(`為什麼要 ${amountText(l.need, l.unit)}：`, `Why ${amountText(l.need, l.unit)}:`)}</p>
                      {l.sources?.length ? (
                        <ul className="space-y-0.5">
                          {l.sources.map((s) => (
                            <li key={s.menu_item_id} className="flex flex-wrap gap-x-2">
                              <button type="button" className="text-primary underline" onClick={() => { setPendingEdit("menu_item", s.menu_item_id); navigate("/vendor-portal/menu"); }}>{s.name}</button>
                              <span>{tr(`${s.confirmed + s.forecast} 份（已確定 ${s.confirmed} ＋ 預測 ${s.forecast}）`, `${s.confirmed + s.forecast} meals (${s.confirmed} confirmed + ${s.forecast} forecast)`)}</span>
                              <span className="text-muted-foreground">→ {amountText(s.amount, l.unit)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="text-muted-foreground">{tr("這張叫貨單是舊版產生的，按「重新產生」就會列出來源。", "Regenerate to see which dishes need this.")}</p>}
                      <p className="text-muted-foreground">{tr(`含安全庫存 ${Math.round(list.safety_rate * 100)}%；叫貨＝需要 − 庫存，進位到 ${l.purchase_unit_label}（每${l.purchase_unit_label} ${l.purchase_unit_size}${l.unit}）。`, `Includes ${Math.round(list.safety_rate * 100)}% safety stock; order = need − stock, rounded up.`)}</p>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="text-sm font-semibold text-right mt-2">{tr("估計總額", "Estimated total")} NT${list.est_total}</p>
    </div>
  );

  const others = (catalog?.ingredients ?? []).filter((i) => !weekly?.lines.some((l) => l.ingredient_id === i.id));
  const restockDays = prepDates.filter((d) => (restock[d] ?? []).length > 0);

  return (
    <VendorPortalLayout>
      <div className="print:hidden">
        <MenuPrepProgress />
        <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-1 flex items-center gap-2"><ShoppingBasket className="w-5 h-5 text-orange-500" /> {tr("採購與叫貨", "Purchasing")}</h1>
        <p className="text-sm text-muted-foreground mb-4">{tr("週叫貨單每週六 12:00 鎖定產生；米、油、調味料、乾貨、包材等久放品項低於安全庫存才列入。週六 12:00 前直接在「庫存」欄盤點，只改有差異的項目，存了會自動重算。", "Weekly lists lock Saturdays at 12:00. Before then, count stock right in the Stock column — only change what differs; saving recalculates the list.")}</p>
      </div>

      {/* 臨時補貨：每日備料截單後算出的缺料 */}
      {restockDays.map((d) => (
        <Card key={d} className="mb-4 border-red-300 print:hidden">
          <CardHeader className="pb-2 flex-row flex-wrap items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base text-red-700 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {tr(`臨時補貨：${d === todayStr() ? "今天" : d.slice(5)} 備料缺料`, `Restock for ${d}`)}</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate("/vendor-portal/prep")}>{tr("看備料", "View prep")}</Button>
              <Button size="sm" onClick={() => shareRestock(d, restock[d])} disabled={!catalog}><MessageCircle /> {tr("LINE 叫貨", "Order via LINE")}</Button>
            </div>
          </CardHeader>
          <CardContent>
            <RecipeCraft items={restock[d].map((s) => ({ id: s.ingredient_id, name: s.name, need: s.need, unit: s.unit, have: s.have }))} compact />
          </CardContent>
        </Card>
      ))}

      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 items-center print:hidden">
          <Tag selected={week === thisMonday} onClick={() => setWeek(thisMonday)}>{tr("本週", "This week")} {thisMonday.slice(5)}</Tag>
          <Tag selected={week === nextMonday} onClick={() => setWeek(nextMonday)}>{tr("下週", "Next week")} {nextMonday.slice(5)}</Tag>
          <Button size="sm" variant="outline" onClick={regenerate} disabled={busy}><RefreshCw /> {weekly ? tr("重新產生", "Regenerate") : tr("試算", "Preview")}</Button>
          {weekly && <Button size="sm" variant="outline" onClick={() => shareWeekly(weekly)}><MessageCircle /> LINE</Button>}
          {weekly && <Button size="sm" variant="outline" onClick={() => window.print()}><Printer /> PDF</Button>}
          {counted?.counted
            ? <Badge variant="muted" className="bg-green-100 text-green-700"><ClipboardCheck className="w-3 h-3 mr-1" />{tr("本週已盤點", "Counted this week")}</Badge>
            : <Badge variant="muted" className="bg-amber-100 text-amber-800">{tr("本週未盤點：用理論庫存計算", "Not counted: using theoretical stock")}</Badge>}
        </div>

        {editable && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm print:hidden">
            <ClipboardCheck className="w-4 h-4 text-orange-500" />
            <span className="flex-1 min-w-[200px]">{changed > 0 ? tr(`改了 ${changed} 項庫存`, `${changed} item(s) changed`) : tr("在「庫存」欄填實際盤點量；空白＝跟理論值一樣。", "Type actual counts in Stock; blank = same as theoretical.")}</span>
            <Button size="sm" onClick={saveCount} disabled={busy || !catalog?.ingredients.length}><ClipboardCheck /> {counted?.counted ? tr("更新盤點並重算", "Update count & recalc") : tr("儲存盤點並重算", "Save count & recalc")}</Button>
          </div>
        )}
        {!editable && <p className="text-xs text-muted-foreground print:hidden">{tr("本週的叫貨單已經下過了；盤點請切到「下週」。", "This week's order is done; count stock under Next week.")}</p>}

        {!weekly ? (
          <EmptyState size="compact" icon={<ShoppingBasket size={32} />} title={tr("還沒有這週的叫貨單", "No list for this week yet")} description={tr("週六 12:00 自動產生；也可以先按「試算」。", "Generated Saturday 12:00, or preview now.")} />
        ) : (
          <>
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
                <p className="text-xs text-muted-foreground mt-2 print:hidden">{tr("點原物料名稱可以看是哪幾道菜需要。保存 ≤ 3 天的原物料（葉菜）自動建議分批到貨；冷凍與乾貨一次進。", "Click an item to see which dishes need it. Items keeping ≤3 days (greens) are split into deliveries.")}</p>
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

        {/* 不在叫貨單上的原物料（這週用不到、或久放品項庫存夠）也可以盤點 */}
        {editable && others.length > 0 && (
          <Card className="print:hidden">
            <CardHeader className="pb-2">
              <button type="button" className="text-left text-base font-semibold flex items-center gap-1" onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}>
                {showOthers ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{tr(`其他原物料盤點（${others.length} 項，不在這張叫貨單上）`, `Other ingredients (${others.length})`)}
              </button>
            </CardHeader>
            {showOthers && (
              <CardContent className="space-y-2">
                {others.map((ing) => (
                  <div key={ing.id} className="flex items-center gap-2 text-sm">
                    <span className="flex-1">{ing.name}</span>
                    {stockCell(ing.id, ing.unit)}
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        )}
      </div>
    </VendorPortalLayout>
  );
}

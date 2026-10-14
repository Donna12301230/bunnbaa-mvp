import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { AlertTriangle, Check, ChevronDown, ChevronRight, ClipboardCheck, Minus, MessageCircle, Plus, Printer, RefreshCw, ShoppingBasket } from "lucide-react";
import { Link, useLocation } from "wouter";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import RecipeGapCard from "@/components/RecipeGapCard";
import RecipeCraft from "@/components/RecipeCraft";
import InfoTip from "@/components/InfoTip";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, Tag } from "@/components/ds";
import PortalPageHeader from "@/components/PortalPageHeader";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { useVendorMenu } from "@/hooks/useVendorMenu";
import AiDraftWarning, { useConfirmAiDrafts } from "@/components/AiDraftWarning";
import { useToast } from "@/hooks/use-toast";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { addDaysStr, bookableDateRange, mondayOf, todayStr } from "@/lib/pickupSlots";
import { amountText } from "@/lib/prep";
import { purchaseText, shareToLine, toPurchaseUnits } from "@/lib/purchaseShare";
import { setPendingEdit } from "@/lib/pendingEdit";
import { ingredientGroup, GROUP_DOT } from "@/lib/foodColors";
import { loc, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Ingredient } from "@/types";

interface Line {
  ingredient_id: string;
  name: string;
  unit: string;
  purchase_unit_label: string;
  purchase_unit_size: number;
  supplier_id: string | null;
  long_lived?: boolean;
  by_day?: { date: string; confirmed: number; forecast: number }[];
  need: number;
  stock: number;
  order_units: number;
  deliveries?: { date: string; units: number }[];
  unit_price?: number;
  est_cost: number;
  /** Demand source: which items use it and how many portions each (older supplier orders lack this) */
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

/** How many weeks to restock at once when a long-shelf-life item runs short (matches LONG_LIVED_WEEKS in functions/src/purchasing.js) */
const LONG_LIVED_WEEKS = 4;
const WD = ["日", "一", "二", "三", "四", "五", "六"];
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Top stat cards */
function StatCard({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex-1 min-w-[10rem]">
      <CardContent className="p-4 space-y-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        {children}
      </CardContent>
    </Card>
  );
}

/** Mini bar chart of next week's orders: solid = ordered, light = forecast */
function BoardBars({ board }: { board: NonNullable<PurchaseList["board"]> }) {
  const max = Math.max(1, ...board.map((b) => b.confirmed + b.forecast));
  return (
    <div className="flex items-end gap-1.5 h-16" role="img" aria-label={board.map((b) => `${b.date.slice(5)} ${b.closed ? tr("休", "closed") : `${b.confirmed}+${b.forecast}`}`).join("，")}>
      {board.map((b) => {
        const wd = new Date(`${b.date}T00:00:00`).getDay();
        return (
          <div key={b.date} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
            <div className="w-full flex flex-col justify-end h-11 rounded-sm bg-muted overflow-hidden">
              {!b.closed && (
                <>
                  <div className="w-full bg-brand/30" style={{ height: `${(b.forecast / max) * 100}%` }} title={tr(`預測 ${b.forecast}`, `forecast ${b.forecast}`)} />
                  <div className="w-full bg-primary" style={{ height: `${(b.confirmed / max) * 100}%` }} title={tr(`已訂 ${b.confirmed}`, `booked ${b.confirmed}`)} />
                </>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground leading-none">{b.closed ? tr("休", "–") : tr(WD[wd], ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][wd])}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Purchasing: the page only answers "what do I buy".
 * - Top: three stat cards: total to spend, mini bar chart of next week's orders, supplier order deadline
 * - Shopping list grouped by supplier: one card and one "Send via LINE" button per supplier
 * - Each row does three things: what's left in the fridge (− + is the stock count), how much to buy, and bought or not (ticked = struck through); grey "Enough" when stock covers it
 * - Stock counting is no longer a separate step: unadjusted items use theoretical stock; saving adjustments recalculates the supplier order
 * Shortages from daily prep after cut-off show at the top under "Urgent restock".
 */
export default function VendorPortalPurchasing() {
  const { data: vendor } = useMyVendor();
  const vendorId = vendor?.id;
  const { data: catalog } = useVendorCatalog(vendorId);
  const { data: menuItems = [] } = useVendorMenu(vendorId);
  const confirmAiDrafts = useConfirmAiDrafts(vendorId);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const thisMonday = mondayOf(todayStr());
  const nextMonday = addDaysStr(thisMonday, 7);
  const [week, setWeek] = useState(nextMonday);
  const [weekly, setWeekly] = useState<PurchaseList | null>(null);
  // Whether the selected week's supplier order has loaded (switching weeks shows loading again)
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null);
  /** Adjusted fridge stock (in ingredient units); unadjusted items use the theoretical value */
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [counted, setCounted] = useState<{ counted?: boolean; counts?: Record<string, number> } | null>(null);
  const [bought, setBought] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [restock, setRestock] = useState<Record<string, Shortage[]>>({});
  // Stock counts only affect "next week's" supplier order (the Saturday count is stored on this week and used when generating next week's order)
  const editable = week === nextMonday;
  const prepDates = useMemo(() => {
    const today = todayStr();
    return [today, ...bookableDateRange().filter((d) => d > today).slice(0, 1)];
  }, []);

  useEffect(() => {
    if (!vendorId) return;
    return onSnapshot(doc(db, "vendors", vendorId, "purchaseLists", `weekly_${week}`), (s) => {
      setWeekly(s.exists() ? (s.data() as PurchaseList) : null);
      setLoadedWeek(week);
    }, () => {
      setWeekly(null);
      setLoadedWeek(week);
    });
  }, [vendorId, week]);
  useEffect(() => {
    if (!vendorId) return;
    return onSnapshot(doc(db, "vendors", vendorId, "inventory", thisMonday), (s) => setCounted(s.exists() ? s.data() : null), () => setCounted(null));
  }, [vendorId, thisMonday]);
  // Bought or not: stored in inventory/bought_{monday} (vendor owner can write), so it shows on any phone
  useEffect(() => {
    if (!vendorId) return;
    return onSnapshot(doc(db, "vendors", vendorId, "inventory", `bought_${week}`), (s) => setBought(s.exists() ? (s.data().items ?? {}) : {}), () => setBought({}));
  }, [vendorId, week]);
  // Urgent restock: prep shortages for today and the next business day
  useEffect(() => {
    if (!vendorId) return;
    const unsubs = prepDates.map((d) => onSnapshot(doc(db, "vendors", vendorId, "prepPlans", d), (s) => {
      setRestock((r) => ({ ...r, [d]: s.exists() && s.data().locked_at ? (s.data().shortages ?? []) : [] }));
    }, () => undefined));
    return () => unsubs.forEach((u) => u());
  }, [vendorId, prepDates]);

  const suppliers = catalog?.suppliers ?? [];
  const ingById = catalog?.ingredientsById ?? {};
  // Lines and shortages carry the Chinese name snapshot; the English UI looks up the current ingredient / item for its English name
  const ingName = (id: string, name: string) => tr(name, loc(ingById[id], "name") || name);
  const itemName = (id: string, name: string) => tr(name, loc(menuItems.find((m) => m.id === id), "name") || name);
  const theoretical = (id: string) => counted?.counts?.[id] ?? weekly?.lines.find((l) => l.ingredient_id === id)?.stock ?? 0;
  const stockOf = (id: string) => (editable && counts[id] !== undefined ? counts[id] : theoretical(id));
  const changed = Object.keys(counts).length;

  /** How many purchase units to buy: unadjusted stock uses the supplier order's figure; adjusted stock is recomputed with the same rules */
  const unitsOf = (l: Line) => {
    if (!editable || counts[l.ingredient_id] === undefined) return l.order_units;
    const have = counts[l.ingredient_id];
    if (l.long_lived) return have >= l.need ? 0 : toPurchaseUnits(Math.max(0, l.need * LONG_LIVED_WEEKS - have), l.purchase_unit_size);
    return toPurchaseUnits(Math.max(0, l.need - have), l.purchase_unit_size);
  };
  const priceOf = (l: Line) => l.unit_price ?? ingById[l.ingredient_id]?.unit_price ?? 0;
  const costOf = (l: Line) => Math.round(unitsOf(l) * priceOf(l));

  const groups = useMemo(() => {
    if (!weekly) return [];
    const map = new Map<string, Line[]>();
    for (const l of weekly.lines) map.set(l.supplier_id ?? "", [...(map.get(l.supplier_id ?? "") ?? []), l]);
    return [...map.entries()]
      .map(([sid, lines]) => ({ sid, name: suppliers.find((s) => s.id === sid)?.name ?? tr("未指定供應商", "No supplier"), lines }))
      .sort((a, b) => Number(!a.sid) - Number(!b.sid) || a.name.localeCompare(b.name, "zh-Hant"));
  }, [weekly, suppliers]);
  const total = weekly ? weekly.lines.reduce((s, l) => s + costOf(l), 0) : 0;

  async function regenerate() {
    setBusy(true);
    try {
      await httpsCallable(functions, "triggerPurchaseListNow")({ type: "weekly", week_start: week });
      toast({ title: weekly ? tr("已重新產生", "Regenerated") : tr("已試算", "Preview ready") });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function shareSupplier(lines: Line[]) {
    if (!(await confirmAiDrafts())) return;
    const title = tr(`${vendor?.name ?? ""} 叫貨（${weekly?.week_start?.slice(5) ?? ""} 那週）`, `${vendor?.name ?? ""} order (week of ${weekly?.week_start ?? ""})`);
    shareToLine(purchaseText(title, lines.map((l) => ({ name: l.name, supplier_id: l.supplier_id, units: unitsOf(l), unit_label: l.purchase_unit_label, deliveries: counts[l.ingredient_id] === undefined ? l.deliveries : undefined })), suppliers));
  }

  async function shareRestock(date: string, shortages: Shortage[]) {
    if (!(await confirmAiDrafts())) return;
    shareToLine(purchaseText(tr(`${vendor?.name ?? ""} 臨時補貨（${date} 用）`, `${vendor?.name ?? ""} restock for ${date}`), shortages.map((s) => {
      const ing = ingById[s.ingredient_id];
      return { name: s.name, supplier_id: ing?.supplier_id ?? null, units: toPurchaseUnits(s.short, ing?.purchase_unit_size ?? 1), unit_label: ing?.purchase_unit_label || s.unit };
    }), suppliers));
  }

  async function toggleBought(id: string) {
    if (!vendorId) return;
    const next = { ...bought, [id]: !bought[id] };
    setBought(next);
    await setDoc(doc(db, "vendors", vendorId, "inventory", `bought_${week}`), { items: next, updated_at: new Date() }).catch((err) => toast({ variant: "destructive", title: (err as Error).message }));
  }

  /** Save stock count (unchanged items use the theoretical value) → automatically recalculates next week's supplier order */
  async function saveCount() {
    if (!vendorId || !catalog) return;
    const out: Record<string, number> = {};
    for (const ing of catalog.ingredients) out[ing.id] = counts[ing.id] ?? theoretical(ing.id);
    setBusy(true);
    try {
      await setDoc(doc(db, "vendors", vendorId, "inventory", thisMonday), { counts: out, counted: true, counted_at: new Date() });
      setCounts({});
      toast({ title: tr("冰箱存量已記下，正在重算…", "Stock saved — recalculating…") });
    } catch (err) {
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
      setBusy(false);
      return;
    }
    await regenerate();
  }

  /** − + adjusts "what's left in the fridge"; one step = one purchase unit */
  const stepper = (id: string, size: number, label: string) => {
    const s = size > 0 ? size : 1;
    const v = stockOf(id);
    const set = (n: number) => setCounts((c) => ({ ...c, [id]: Math.max(0, n) }));
    if (!editable) return <span className="text-sm">{round1(v / s)} {label}</span>;
    return (
      <span className={cn("inline-flex items-center rounded-full border", counts[id] !== undefined ? "border-brand bg-accent" : "border-border")}>
        <button type="button" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-accent disabled:opacity-40" onClick={() => set(v - s)} disabled={v <= 0} aria-label={tr("少一個", "One less")}><Minus className="w-4 h-4" /></button>
        <input
          className="w-10 bg-transparent text-center text-sm font-semibold focus:outline-none [appearance:textfield]"
          type="number"
          min={0}
          value={round1(v / s)}
          onChange={(e) => set((Number(e.target.value) || 0) * s)}
          aria-label={tr("冰箱還剩", "On hand")}
        />
        <button type="button" className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-accent" onClick={() => set(v + s)} aria-label={tr("多一個", "One more")}><Plus className="w-4 h-4" /></button>
        <span className="pr-3 text-xs text-muted-foreground">{label}</span>
      </span>
    );
  };

  // Supplier order deadline: 12:00 on the Saturday before this order's week (the order locks then)
  const deadline = new Date(`${addDaysStr(week, -2)}T12:00:00`);
  const msLeft = deadline.getTime() - Date.now();
  const left = msLeft > 0 ? (() => {
    const h = Math.floor(msLeft / 3_600_000);
    return h >= 24 ? tr(`還有 ${Math.floor(h / 24)} 天 ${h % 24} 小時`, `${Math.floor(h / 24)}d ${h % 24}h left`) : tr(`還有 ${h} 小時`, `${h}h left`);
  })() : null;

  const others = (catalog?.ingredients ?? []).filter((i) => !weekly?.lines.some((l) => l.ingredient_id === i.id));
  const restockDays = prepDates.filter((d) => (restock[d] ?? []).length > 0);
  const boardTotal = weekly?.board?.reduce((s, b) => s + b.confirmed, 0) ?? 0;

  const row = (l: Line) => {
    const units = unitsOf(l);
    const enough = units === 0;
    const done = !!bought[l.ingredient_id];
    const open = openLine === l.ingredient_id;
    const ing: Ingredient | undefined = ingById[l.ingredient_id];
    return (
      <Fragment key={l.ingredient_id}>
        <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 border-b last:border-0", done && "opacity-60")}>
          <button
            type="button"
            onClick={() => toggleBought(l.ingredient_id)}
            disabled={enough}
            aria-pressed={done}
            aria-label={done ? tr(`${l.name} 已買到`, `${ingName(l.ingredient_id, l.name)} bought`) : tr(`${l.name} 還沒買`, `${ingName(l.ingredient_id, l.name)} not bought`)}
            className={cn("w-8 h-8 shrink-0 rounded-full border-2 flex items-center justify-center print:border-black", done ? "border-success bg-success-strong text-white" : "border-input", enough && "invisible")}
          >
            {done && <Check className="w-4 h-4" />}
          </button>
          <button type="button" className="flex-1 min-w-[6rem] text-left flex items-center gap-1.5" onClick={() => setOpenLine(open ? null : l.ingredient_id)} aria-expanded={open}>
            <span className={cn("w-2.5 h-2.5 rounded-sm shrink-0", GROUP_DOT[ingredientGroup(ing?.category)])} aria-hidden="true" />
            <span className={cn("font-medium", done && "line-through")}>{ingName(l.ingredient_id, l.name)}</span>
            <span className="print:hidden text-muted-foreground">{open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}</span>
          </button>
          <span className="print:hidden">{stepper(l.ingredient_id, l.purchase_unit_size, l.purchase_unit_label)}</span>
          <span className="ml-auto sm:ml-0 flex items-center gap-x-3">
          <span className="w-20 text-right">
            {enough ? <span className="text-sm text-muted-foreground">{tr("夠了", "Enough")}</span> : <span className="text-lg font-bold">{units} <span className="text-sm font-medium">{l.purchase_unit_label}</span></span>}
          </span>
          <span className={cn("w-16 text-right text-sm", enough && "text-muted-foreground")}>{enough ? "—" : `NT$${costOf(l)}`}</span>
          </span>
        </div>
        {open && (
          <div className="bg-accent/60 rounded-md px-3 py-2 mb-2 text-xs space-y-1 print:hidden">
            <p className="font-semibold">{tr(`這週要用 ${amountText(l.need, l.unit)}，冰箱還剩 ${amountText(stockOf(l.ingredient_id), l.unit)}`, `Need ${amountText(l.need, l.unit)}, have ${amountText(stockOf(l.ingredient_id), l.unit)}`)}</p>
            {l.sources?.length ? (
              <ul className="space-y-0.5">
                {l.sources.map((s) => (
                  <li key={s.menu_item_id} className="flex flex-wrap gap-x-2">
                    <button type="button" className="text-primary underline" onClick={() => { setPendingEdit("menu_item", s.menu_item_id); navigate("/vendor-portal/menu"); }}>{itemName(s.menu_item_id, s.name)}</button>
                    <span>{tr(`${s.confirmed + s.forecast} 份（已訂 ${s.confirmed} ＋ 預測 ${s.forecast}）`, `${s.confirmed + s.forecast} meals (${s.confirmed} booked + ${s.forecast} forecast)`)}</span>
                    <span className="text-muted-foreground">→ {amountText(s.amount, l.unit)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted-foreground">{tr("按「重新產生」就會列出是哪幾道菜需要。", "Regenerate to see which dishes need this.")}</p>}
            {(l.deliveries?.length ?? 0) > 1 && counts[l.ingredient_id] === undefined && <p>{tr("分批到貨：", "Deliveries: ")}{l.deliveries!.map((d) => `${d.date.slice(5)} × ${d.units}`).join("、")}</p>}
            <p className="text-muted-foreground">{tr(`含安全庫存 ${Math.round((weekly?.safety_rate ?? 0) * 100)}%；每${l.purchase_unit_label} ${l.purchase_unit_size}${l.unit}${l.long_lived ? `；久放品項不夠時一次補 ${LONG_LIVED_WEEKS} 週` : ""}。`, `Includes safety stock; 1 ${l.purchase_unit_label} = ${l.purchase_unit_size}${l.unit}.`)}</p>
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <VendorPortalLayout>
      <div className="space-y-4">
        <div className="print:hidden space-y-3">
          <RecipeGapCard />
          <AiDraftWarning vendorId={vendorId} what={tr("叫貨量", "order quantities")} />
          <PortalPageHeader icon={ShoppingBasket} title={<>
            {tr("採購叫貨", "Purchasing")}
            <InfoTip>{tr("叫貨單每週六 12:00 依下週訂單＋預測自動鎖定。週六前用 − ＋ 改「冰箱還剩多少」就是盤點，沒改的照理論庫存算；存起來會自動重算。米、油、調味料等久放品項不夠才會列出來。", "Lists lock every Saturday 12:00 from next week's orders + forecast. Before then, use − + to set what's left — that's your stock count; untouched items use theoretical stock. Long-life items only appear when running low.")}</InfoTip>
          </>} />
          <div className="flex flex-wrap gap-2 items-center">
            <Tag selected={week === thisMonday} onClick={() => { setWeek(thisMonday); setCounts({}); }}>{tr("本週", "This week")} {thisMonday.slice(5)}</Tag>
            <Tag selected={week === nextMonday} onClick={() => setWeek(nextMonday)}>{tr("下週", "Next week")} {nextMonday.slice(5)}</Tag>
            <Button size="sm" variant="ghost" onClick={regenerate} disabled={busy}><RefreshCw /> {weekly ? tr("重新產生", "Regenerate") : tr("試算", "Preview")}</Button>
            {weekly && <Button size="sm" variant="ghost" onClick={() => window.print()}><Printer /> {tr("列印", "Print")}</Button>}
          </div>
        </div>

        {/* Urgent restock: shortages computed after the daily prep cut-off */}
        {restockDays.map((d) => (
          <Card key={d} className="border-danger/40 print:hidden">
            <CardContent className="p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex-1 min-w-[12rem] font-semibold text-danger-text flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{tr(`臨時補貨（${d === todayStr() ? "今天" : d.slice(5)}）：${restock[d].map((s) => s.name).join("、")}`, `Restock for ${d}: ${restock[d].map((s) => ingName(s.ingredient_id, s.name)).join(", ")}`)}</p>
                <Button size="sm" variant="outline" onClick={() => navigate("/vendor-portal/prep")}>{tr("看備料", "View prep")}</Button>
                <Button size="sm" onClick={() => shareRestock(d, restock[d])} disabled={!catalog}><MessageCircle /> {tr("傳 LINE", "Send via LINE")}</Button>
              </div>
              <RecipeCraft items={restock[d].map((s) => ({ id: s.ingredient_id, name: ingName(s.ingredient_id, s.name), need: s.need, unit: s.unit, have: s.have }))} compact />
            </CardContent>
          </Card>
        ))}

        {/* Top three stat cards */}
        {weekly && (
          <div className="flex flex-wrap gap-3 print:hidden">
            <StatCard label={tr(`${week === thisMonday ? "這週" : "下週"}要買`, week === thisMonday ? "This week" : "Next week")}>
              <p className="text-3xl font-bold text-accent-foreground leading-none">NT${total.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">{tr(`${weekly.lines.filter((l) => unitsOf(l) > 0).length} 樣`, `${weekly.lines.filter((l) => unitsOf(l) > 0).length} items`)}</p>
            </StatCard>
            {weekly.board && weekly.board.length > 0 && (
              <StatCard label={<span className="flex items-center gap-1">{tr(`訂單 ${boardTotal} 份＋預測`, `${boardTotal} booked + forecast`)}</span>}>
                <BoardBars board={weekly.board} />
              </StatCard>
            )}
            <StatCard label={tr("叫貨截止", "Order by")}>
              <p className="text-xl font-bold leading-tight">{tr(`週六 ${deadline.getMonth() + 1}/${deadline.getDate()} 12:00`, `Sat ${deadline.getMonth() + 1}/${deadline.getDate()} 12:00`)}</p>
              <p className={cn("text-xs", left ? "text-accent-foreground font-semibold" : "text-muted-foreground")}>{left ?? tr("已鎖定", "Locked")}</p>
            </StatCard>
          </div>
        )}

        {/* Fridge stock changed: save and recalculate */}
        {editable && weekly && (
          <div className={cn("flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm print:hidden", changed > 0 ? "border-brand bg-accent" : "border-border bg-card")}>
            <ClipboardCheck className="w-4 h-4 text-accent-foreground" />
            <span className="flex-1 min-w-[12rem]">
              {changed > 0
                ? tr(`改了 ${changed} 樣的存量`, `${changed} item(s) changed`)
                : counted?.counted ? tr("這週已經盤點過；還可以再改", "Counted this week — you can still adjust") : tr("冰箱還剩多少？用 − ＋ 改，沒改的照理論庫存算", "What's left? Use − +; the rest use theoretical stock")}
            </span>
            <Button size="sm" variant={changed > 0 ? "default" : "outline"} onClick={saveCount} disabled={busy || !catalog?.ingredients.length}>
              {changed > 0 ? tr("存起來並重算", "Save & recalc") : counted?.counted ? tr("重新確認", "Confirm again") : tr("都對，確認盤點", "Looks right — confirm")}
            </Button>
          </div>
        )}
        {!editable && weekly && <p className="text-xs text-muted-foreground print:hidden">{tr("這週的單已經叫了，勾一勾買到了沒；要盤點請切到「下週」。", "This week's order is placed — tick off what arrived. Count stock under Next week.")}</p>}

        {vendorId && loadedWeek !== week ? (
          <SkeletonBlocks count={3} height={64} className="space-y-3 print:hidden" />
        ) : !weekly ? (
          <EmptyState size="compact" icon={<ShoppingBasket size={32} />} title={tr("這週還沒有叫貨單", "No list for this week yet")} description={tr("週六 12:00 自動產生，也可以現在先試算。", "Generated Saturday 12:00 — or preview now.")} action={<Button onClick={regenerate} disabled={busy}><RefreshCw /> {tr("試算", "Preview")}</Button>} />
        ) : weekly.lines.length === 0 ? (
          <EmptyState size="compact" icon={<Check size={32} />} title={tr("這週不用叫貨", "Nothing to order")} description={tr("沒有訂單或預測用量；如果菜單還沒填組成，叫貨單會是空的。", "No demand yet — or menu cells have no recipes.")} action={<Button variant="outline" asChild><Link href="/vendor-portal/menu">{tr("看菜單", "Open menu")}</Link></Button>} />
        ) : (
          <div className="space-y-4">
            {groups.map((g) => {
              const sub = g.lines.reduce((s, l) => s + costOf(l), 0);
              const toBuy = g.lines.filter((l) => unitsOf(l) > 0);
              const sorted = [...toBuy, ...g.lines.filter((l) => unitsOf(l) === 0)];
              const boughtAll = toBuy.length > 0 && toBuy.every((l) => bought[l.ingredient_id]);
              return (
                <Card key={g.sid || "none"} className={cn("break-inside-avoid", boughtAll && "border-success")}>
                  <CardContent className="p-4">
                    <div className="flex flex-wrap items-center gap-2 pb-2 border-b">
                      <p className="flex-1 min-w-[10rem] font-semibold text-lg">
                        {g.name}
                        <span className="ml-2 text-base font-normal text-muted-foreground">NT${sub.toLocaleString()}</span>
                        {boughtAll && <span className="ml-2 text-sm text-success-text">✓ {tr("都買到了", "All bought")}</span>}
                      </p>
                      {!g.sid && <Link href="/vendor-portal/recipes" className="text-xs text-primary underline print:hidden">{tr("設定供應商", "Set suppliers")}</Link>}
                      {toBuy.length > 0 && <Button size="sm" className="print:hidden" onClick={() => shareSupplier(toBuy)}><MessageCircle /> {tr("傳 LINE", "Send via LINE")}</Button>}
                    </div>
                    <div className="hidden sm:flex items-center gap-3 pt-2 text-[11px] text-muted-foreground print:hidden">
                      <span className="w-8 text-center">{tr("買到", "Got")}</span>
                      <span className="flex-1">{tr("品項", "Item")}</span>
                      <span>{tr("冰箱還剩", "On hand")}</span>
                      <span className="w-20 text-right">{tr("要買", "Buy")}</span>
                      <span className="w-16 text-right">{tr("小計", "Subtotal")}</span>
                    </div>
                    {sorted.map(row)}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Ingredients not on the supplier order (not used this week, or long-shelf-life items with enough stock) can still have their stock edited */}
        {editable && others.length > 0 && (
          <Card className="print:hidden">
            <CardContent className="p-0">
              <button type="button" className="w-full text-left px-4 py-3 text-sm font-semibold flex items-center gap-1" onClick={() => setShowOthers((v) => !v)} aria-expanded={showOthers}>
                {showOthers ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{tr(`其他食材（${others.length} 樣，這週不用買）`, `Other ingredients (${others.length}, nothing to buy)`)}
              </button>
              {showOthers && (
                <div className="px-4 pb-3 space-y-2">
                  {others.map((ing) => (
                    <div key={ing.id} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className={cn("w-2.5 h-2.5 rounded-sm shrink-0", GROUP_DOT[ingredientGroup(ing.category)])} aria-hidden="true" />
                      <span className="flex-1">{loc(ing, "name")}</span>
                      {stepper(ing.id, ing.purchase_unit_size, ing.purchase_unit_label || ing.unit)}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </VendorPortalLayout>
  );
}

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { AlertTriangle, ChefHat, ChevronDown, ChevronRight, ClipboardList, Clock, MessageCircle, MessageCircleQuestion, Pencil, Printer, RefreshCw, Replace, Sparkles, TrendingUp } from "lucide-react";
import { useLocation } from "wouter";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import MenuPrepProgress from "@/components/MenuPrepProgress";
import RecipeCraft from "@/components/RecipeCraft";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState, Tag } from "@/components/ds";
import { useAuth } from "@/hooks/useAuth";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { useVendorMenu } from "@/hooks/useVendorMenu";
import { useStockOnHand } from "@/hooks/useStockOnHand";
import { amountText, componentPortions, craftItems, rawNeeds } from "@/lib/prep";
import { purchaseText, shareToLine, toPurchaseUnits } from "@/lib/purchaseShare";
import { setPendingEdit } from "@/lib/pendingEdit";
import { rawAmount } from "@/lib/bento";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { MEAL_PERIODS, addDaysStr, bookableDateRange, cutoffAt, isPastCutoff, mealPeriodLabel, todayStr, vendorCutoffTime } from "@/lib/pickupSlots";
import type { MealPeriod } from "@/types";
import { PENDING_STATUSES } from "@/lib/lockOutcome";
import { tr } from "@/lib/i18n";
import type { Lock } from "@/types";

interface Timeline {
  overnight: { component_id: string; task: string }[];
  slots: { start: string; end: string; equipment: string; component_id: string; task: string }[];
  packing: { start: string; task: string };
}

function TimelineTable({ timeline }: { timeline: Timeline }) {
  return (
    <table className="w-full">
      <tbody>
        {timeline.overnight.length > 0 && (
          <tr className="align-top"><td className="pr-3 py-1 font-semibold whitespace-nowrap">{tr("前一晚", "Night before")}</td><td className="py-1">{timeline.overnight.map((o) => o.task).join("、")}</td></tr>
        )}
        {timeline.slots.map((s, i) => (
          <tr key={i} className="align-top"><td className="pr-3 py-1 font-mono whitespace-nowrap">{s.start}</td><td className="py-1">{s.task} <span className="text-xs text-muted-foreground">（{s.equipment}）</span></td></tr>
        ))}
        <tr className="align-top"><td className="pr-3 py-1 font-mono">{timeline.packing.start}</td><td className="py-1">{tr("裝盒、貼出餐標籤", "Pack & label")}</td></tr>
      </tbody>
    </table>
  );
}

interface PrepPlan {
  date: string;
  order_count: number;
  pickup_range: string;
  components: { component_id: string; name: string; portions: number }[];
  timeline: Timeline;
  // 1002 規格 §5.2：時間軸依每個餐期的取餐開始時間分別往回推
  timelines?: Partial<Record<MealPeriod, Timeline & { range: string; order_count: number }>>;
  labels: { lock_id: string; pickup_code: string; pickup_window: string; item: string; main: string | null; fixed?: string[]; sides: string[]; rice: string | null; note: string | null }[];
  shortages: { ingredient_id: string; name: string; unit: string; need: number; have: number; short: number }[];
  raw_needs?: Record<string, number>;
  wish_results: Record<string, { dish: string; count: number; min_qty: number; ok: boolean }>;
  done?: Record<string, boolean>;
  substitutions?: { from: string; to: string }[];
  charity_result?: { total: number; given_onsite: number; wasted: number };
}

// 預估取餐區間（functions/src/pickupForecast.js）：一般統計算的數字，不經 LLM
interface PickupForecast {
  date: string;
  locked: number;
  enough: boolean;
  days_used: number;
  same_weekday: boolean;
  low?: number;
  high?: number;
  expected?: number;
  disclaimer: string;
}

/**
 * 備料頁上方的「預估實際取餐」區間（AI 功能 4，強化現有校準）。區間用統計算，
 * 白話追問接既有的 askCalibrationScenario（Gemini）。預付制每份都要做，
 * 區間是讓店家預期大約幾份會轉成愛心餐。
 */
function PickupForecastCard({ vendorId, date, lockCount }: { vendorId: string; date: string; lockCount: number }) {
  const [forecast, setForecast] = useState<PickupForecast | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    httpsCallable(functions, "getPickupForecast")({ vendor_id: vendorId, date })
      .then((res) => { if (!cancelled) setForecast(res.data as PickupForecast); })
      .catch(() => { if (!cancelled) setForecast(null); });
    return () => { cancelled = true; };
  }, [vendorId, date, lockCount]);

  async function ask() {
    const q = question.trim();
    if (!q) return;
    setAsking(true);
    setAnswer("");
    try {
      const res = await httpsCallable(functions, "askCalibrationScenario")({ vendor_id: vendorId, question: q });
      setAnswer((res.data as { scenario_answer: string }).scenario_answer);
    } catch (err) {
      setAnswer(tr(`追問失敗：${(err as Error).message}`, `Couldn't get an answer: ${(err as Error).message}`));
    } finally {
      setAsking(false);
    }
  }

  if (!forecast || forecast.locked === 0) return null;
  const basis = forecast.same_weekday
    ? tr(`過去 ${forecast.days_used} 個同星期幾`, `the last ${forecast.days_used} same weekdays`)
    : tr(`過去 ${forecast.days_used} 個營業日`, `the last ${forecast.days_used} business days`);
  return (
    <Card className="mb-4 print:hidden">
      <CardContent className="p-4 space-y-2">
        <p className="text-sm flex items-center gap-1.5 font-semibold"><TrendingUp className="w-4 h-4 text-orange-500" /> {tr("預估實際取餐", "Expected pickups")}</p>
        {forecast.enough && forecast.low !== undefined && forecast.high !== undefined ? (
          <p className="text-sm">
            {tr(`已鎖定 ${forecast.locked} 份，依${basis}的取餐紀錄，預估實際取餐 `, `${forecast.locked} locked. Based on ${basis}, expect `)}
            <span className="text-lg font-bold text-orange-600">{forecast.low === forecast.high ? forecast.low : `${forecast.low}–${forecast.high}`}</span>
            {tr(" 份；其餘會在取餐時段結束後轉為愛心餐。", " pickups; the rest become charity meals after the window.")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{tr(`已鎖定 ${forecast.locked} 份。取餐紀錄還不夠（至少 3 個營業日），暫時算不出區間。`, `${forecast.locked} locked. Not enough pickup history yet (3+ days) for a range.`)}</p>
        )}
        <p className="text-xs text-muted-foreground">{forecast.disclaimer}</p>
        <div className="flex gap-2 pt-1">
          <Input className="h-9" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }} placeholder={tr("追問，例如：下雨天取餐率會差多少？", "Ask, e.g. how do rainy days affect pickups?")} />
          <Button size="sm" variant="outline" onClick={ask} disabled={asking || !question.trim()}><MessageCircleQuestion /> {asking ? tr("思考中…", "Thinking…") : tr("追問", "Ask")}</Button>
        </div>
        {answer && <p className="text-sm bg-orange-50 rounded p-2 whitespace-pre-line">{answer}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * 每日備料（規格 §5.4）：截單後產生——採購差額與缺料警示、半成品任務清單（遊戲化勾選）、
 * 流程時間軸（從取餐開始往回推，依製程時間、設備容量、可提前時間排程；確定性演算法，不用 AI）、
 * 出餐標籤（每盒一張、不印姓名，§6.3）。天災期間可等值替換配菜（§11）。
 */
export default function VendorPortalPrep() {
  const vendorId = useAuth().user?.vendorId;
  const { data: vendor } = useMyVendor();
  const { toast } = useToast();
  const confirm = useConfirm();
  const today = todayStr();
  const dates = useMemo(() => {
    const next = bookableDateRange().filter((d) => d > today).slice(0, 1);
    return [today, ...next, addDaysStr(today, -1)];
  }, [today]);
  const [date, setDate] = useState(dates[1] ?? today);
  const [plan, setPlan] = useState<PrepPlan | null>(null);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState({ from: "", to: "" });
  // 列印：出餐標籤或領料單（分開印）
  const [printMode, setPrintMode] = useState<"labels" | "picklist">("labels");
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const { data: catalog } = useVendorCatalog(vendorId);
  const { data: menuItems = [] } = useVendorMenu(vendorId);
  const { stock, counted } = useStockOnHand(vendorId, date);
  const ingById = catalog?.ingredientsById ?? {};
  const compById = catalog?.componentsById ?? {};

  useEffect(() => {
    if (!vendorId) return;
    const unsubPlan = onSnapshot(doc(db, "vendors", vendorId, "prepPlans", date), (snap) => setPlan(snap.exists() && snap.data().locked_at ? (snap.data() as PrepPlan) : null), () => setPlan(null));
    const unsubLocks = onSnapshot(query(collection(db, "locks"), where("vendor_id", "==", vendorId), where("pickup_date", "==", date)), (snap) => {
      setLocks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Lock).filter((l) => PENDING_STATUSES.has(l.status) || l.status === "fulfilled" || l.status === "resold_and_fulfilled" || l.status === "charity"));
    }, (err) => toast({ variant: "destructive", title: tr("訂單讀取失敗", "Couldn't load orders"), description: err.message }));
    return () => {
      unsubPlan();
      unsubLocks();
    };
  }, [vendorId, date]);

  // 還沒截單：只看已確定份數（依品項）
  const itemCounts = useMemo(() => {
    const m = new Map<string, number>();
    locks.forEach((l) => m.set(l.item_name, (m.get(l.item_name) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [locks]);

  async function runCutoff(force: boolean) {
    if (!isPastCutoff(date, vendor) && !(await confirm({
      title: tr("現在就截單？", "Close orders now?"),
      description: tr(`還沒到截單時間（${cutoffAt(date, vendor).toLocaleString("zh-TW")}）。現在截單會提早判定許願結果、產生備料清單；之後的新訂單要再按一次「重新計算」。`, "It's before the cutoff. Closing now decides wishes early; press recalculate again for later orders."),
      confirmLabel: tr("仍要產生", "Generate anyway"),
    }))) return;
    setBusy(true);
    try {
      const res = await httpsCallable(functions, "triggerLockOrdersNow")({ date, force });
      const r = res.data as { order_count?: number; shortages?: number; skipped?: boolean };
      toast({ title: r.skipped ? tr("已經產生過了", "Already generated") : tr(`已產生備料清單（${r.order_count} 份）`, `Prep list ready (${r.order_count})`) });
    } catch (err) {
      toast({ variant: "destructive", title: tr("產生失敗", "Couldn't generate"), description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function toggleDone(key: string, value: boolean) {
    if (!vendorId) return;
    await updateDoc(doc(db, "vendors", vendorId, "prepPlans", date), { done: { ...(plan?.done ?? {}), [key]: value } }).catch((err) => toast({ variant: "destructive", title: (err as Error).message }));
  }

  async function substitute() {
    if (!sub.from || !sub.to) return;
    if (!(await confirm({ title: tr(`把「${sub.from}」換成「${sub.to}」？`, `Replace ${sub.from} with ${sub.to}?`), description: tr("僅限天災或菜價異常期間的等值替換，會通知受影響的消費者。", "Only for equivalent swaps during disasters or price spikes; affected customers are notified."), confirmLabel: tr("替換並通知", "Replace & notify") }))) return;
    setBusy(true);
    try {
      const res = await httpsCallable(functions, "substituteDish")({ date, from: sub.from, to: sub.to });
      toast({ title: tr(`已替換 ${(res.data as { changed: number }).changed} 份`, `Replaced ${(res.data as { changed: number }).changed}`) });
      setSub({ from: "", to: "" });
      await runCutoff(true);
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // 截單前的預估：用目前的訂單在前端先算（跟後端同一套規則，許願結果還沒判定，一律當預設菜）
  const estimate = useMemo(() => {
    if (plan || !catalog || locks.length === 0) return null;
    const itemsById = Object.fromEntries(menuItems.map((i) => [i.id, i]));
    const portions = componentPortions(locks.filter((l) => PENDING_STATUSES.has(l.status)), itemsById, compById);
    return { portions, needs: rawNeeds(portions, compById, ingById) };
  }, [plan, catalog, menuItems, locks]);
  const planNeeds = useMemo(() => new Map(Object.entries(plan?.raw_needs ?? {})), [plan]);
  const stockNote = counted ? tr("上週六盤點＋本週到貨−已用", "last count + deliveries − used") : tr("理論庫存（上週六未盤點）", "theoretical stock (not counted)");

  function printWith(mode: "labels" | "picklist") {
    setPrintMode(mode);
    window.setTimeout(() => window.print(), 50);
  }

  /** 缺料 → LINE 叫貨（依小盤商分組，進位到採購單位） */
  function shareShortages() {
    if (!plan || !catalog) return;
    const lines = plan.shortages.map((s) => {
      const ing = ingById[s.ingredient_id];
      return { name: s.name, supplier_id: ing?.supplier_id ?? null, units: toPurchaseUnits(s.short, ing?.purchase_unit_size ?? 1), unit_label: ing?.purchase_unit_label || s.unit };
    });
    shareToLine(purchaseText(tr(`${vendor?.name ?? ""} 臨時補貨（${date} 用）`, `${vendor?.name ?? ""} restock for ${date}`), lines, catalog.suppliers));
  }

  function editComponent(id: string) {
    setPendingEdit("component", id);
    navigate("/vendor-portal/recipes");
  }

  const doneCount = plan ? plan.components.filter((c) => plan.done?.[c.component_id]).length : 0;
  const dishes = plan ? [...new Set(plan.labels.flatMap((l) => l.sides))].filter((s) => !s.includes("不要")) : [];

  return (
    <VendorPortalLayout>
      <div className="print:hidden">
        <MenuPrepProgress />
        <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-1 flex items-center gap-2"><ChefHat className="w-5 h-5 text-orange-500" /> {tr("今日備料", "Today's prep")}</h1>
        <p className="text-sm text-muted-foreground mb-4">{tr(`前一天 ${vendorCutoffTime(vendor)} 截單後自動產生：半成品份數、流程時間軸、出餐標籤與缺料警示。`, `Generated automatically after the ${vendorCutoffTime(vendor)} cutoff the day before.`)}</p>
        <div className="flex gap-2 mb-4 flex-wrap">
          {dates.map((d) => <Tag key={d} selected={date === d} onClick={() => setDate(d)}>{d === today ? tr("今天", "Today") : d < today ? tr("昨天", "Yesterday") : tr("下一個營業日", "Next day")} {d.slice(5)}</Tag>)}
        </div>
      </div>

      {vendorId && date >= today && <PickupForecastCard vendorId={vendorId} date={date} lockCount={locks.length} />}

      {!plan ? (
        <div className="space-y-4 print:hidden">
          <EmptyState
            icon={<Clock size={32} />}
            title={tr("還沒截單", "Not closed yet")}
            description={tr(`${date} 的訂單會在 ${cutoffAt(date, vendor).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 截單並判定許願。目前已確定 ${locks.length} 份。`, `Orders for ${date} close at the cutoff. ${locks.length} confirmed so far.`)}
            action={<Button onClick={() => runCutoff(false)} disabled={busy || locks.length === 0}><RefreshCw /> {tr("產生備料清單", "Generate prep list")}</Button>}
          />
          {itemCounts.length > 0 && (
            <Card><CardContent className="p-4 space-y-1">{itemCounts.map(([name, n]) => <div key={name} className="flex justify-between text-sm"><span>{name}</span><span className="font-semibold">× {n}</span></div>)}</CardContent></Card>
          )}
          {estimate && estimate.portions.size > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{tr("目前預估要備的料", "Estimated prep so far")}</CardTitle>
                <p className="text-xs text-muted-foreground">{tr("用目前已確定的訂單先算，許願菜一律當預設菜；截單後以正式備料清單為準。", "Based on confirmed orders, wishes counted as default dishes; the official list comes after cutoff.")}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2 text-sm">
                  {[...estimate.portions].sort((a, b) => b[1] - a[1]).map(([id, n]) => (
                    <span key={id} className="rounded border border-border px-2 py-0.5">{compById[id]?.name ?? id} <b>{Math.round(n * 10) / 10}</b> {tr("份", "")}</span>
                  ))}
                </div>
                <RecipeCraft items={craftItems(estimate.needs, ingById, stock)} haveNote={stockNote} compact />
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 print:hidden">
            <Card className="flex-1 min-w-[160px]"><CardContent className="p-3"><p className="text-xs text-muted-foreground">{tr("總份數", "Meals")}</p><p className="text-2xl font-bold text-orange-600">{plan.order_count}</p></CardContent></Card>
            <Card className="flex-1 min-w-[160px]"><CardContent className="p-3"><p className="text-xs text-muted-foreground">{tr("任務完成", "Tasks done")}</p><p className="text-2xl font-bold">{doneCount}/{plan.components.length}</p></CardContent></Card>
            <Button variant="outline" onClick={() => runCutoff(true)} disabled={busy}><RefreshCw /> {tr("重新計算", "Recalculate")}</Button>
            <Button variant="outline" onClick={() => printWith("labels")}><Printer /> {tr("列印出餐標籤", "Print labels")}</Button>
            <Button variant="outline" onClick={() => printWith("picklist")}><ClipboardList /> {tr("列印領料單", "Print pick list")}</Button>
          </div>

          {plan.shortages.length > 0 && (
            <Card className="border-red-300 print:hidden">
              <CardHeader className="pb-2 flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="text-base text-red-700 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {tr("缺料警示：當日需求超過週庫存，請臨時補貨", "Shortage: today's need exceeds this week's stock")}</CardTitle>
                <Button size="sm" onClick={shareShortages} disabled={!catalog}><MessageCircle /> {tr("LINE 叫貨", "Order via LINE")}</Button>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                <RecipeCraft items={plan.shortages.map((s) => ({ id: s.ingredient_id, name: s.name, need: s.need, unit: s.unit, have: s.have }))} compact />
                <p className="text-xs text-muted-foreground">{plan.shortages.map((s) => {
                  const ing = ingById[s.ingredient_id];
                  return tr(`${s.name} 缺 ${amountText(s.short, s.unit)}${ing ? `（叫 ${toPurchaseUnits(s.short, ing.purchase_unit_size)} ${ing.purchase_unit_label}）` : ""}`, `${s.name}: short ${amountText(s.short, s.unit)}`);
                }).join("、")}</p>
              </CardContent>
            </Card>
          )}

          {Object.keys(plan.wish_results ?? {}).length > 0 && (
            <Card className="print:hidden">
              <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-orange-500" /> {tr("配菜許願判定", "Side-dish wishes")}</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-1">
                {Object.values(plan.wish_results).map((w, i) => (
                  <div key={i} className="flex justify-between"><span>{w.dish}</span><span className={w.ok ? "text-green-700" : "text-muted-foreground"}>{w.count}/{w.min_qty} {w.ok ? tr("成立，進入備料", "on") : tr("未成立，改預設菜", "off")}</span></div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-4 print:hidden">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{tr("半成品任務清單", "Prep tasks")}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {plan.components.map((c) => {
                  const comp = compById[c.component_id];
                  const open = openTask === c.component_id;
                  const done = !!plan.done?.[c.component_id];
                  return (
                    <div key={c.component_id} className={cn("rounded-md", done && "bg-green-50")}>
                      <div className="flex items-center gap-2 text-sm px-2 py-1.5">
                        <Checkbox checked={done} onCheckedChange={(v) => toggleDone(c.component_id, !!v)} aria-label={c.name} />
                        <button type="button" className={cn("flex-1 text-left flex items-center gap-1", done && "line-through text-muted-foreground")} onClick={() => setOpenTask(open ? null : c.component_id)} aria-expanded={open}>
                          {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}{c.name}
                        </button>
                        <span className="font-semibold">{c.portions} {tr("份", "")}</span>
                      </div>
                      {open && (
                        <div className="pl-9 pr-2 pb-2 text-xs space-y-1.5">
                          {comp ? (
                            <>
                              <p className="text-muted-foreground">{tr(`${comp.equipment}・每批 ${comp.batch_capacity} 份 → 做 ${Math.ceil(c.portions / Math.max(1, comp.batch_capacity))} 批・每批 ${comp.prep_minutes} 分鐘`, `${comp.equipment} · ${Math.ceil(c.portions / Math.max(1, comp.batch_capacity))} batch(es) × ${comp.prep_minutes} min`)}</p>
                              <RecipeCraft
                                items={comp.ingredients.flatMap((l) => {
                                  const ing = ingById[l.ingredient_id];
                                  return ing ? [{ id: l.ingredient_id, name: ing.name, need: rawAmount((l.grams || 0) * c.portions, ing), unit: ing.unit || "g" }] : [];
                                })}
                                target={{ name: comp.name, sub: tr(`${c.portions} 份`, `× ${c.portions}`) }}
                                compact
                              />
                              <button type="button" className="text-primary underline inline-flex items-center gap-0.5" onClick={() => editComponent(comp.id)}><Pencil className="w-3 h-3" /> {tr("編輯配方", "Edit recipe")}</button>
                            </>
                          ) : <p className="text-muted-foreground">{tr("找不到這個半成品的配方（可能已刪除）", "Recipe not found")}</p>}
                        </div>
                      )}
                    </div>
                  );
                })}
                {doneCount === plan.components.length && plan.components.length > 0 && <p className="text-sm text-green-700 font-semibold">{tr("全部完成，辛苦了！", "All done — great work!")}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{plan.timelines && Object.keys(plan.timelines).length > 0 ? tr("流程時間軸（依餐期）", "Timeline (by meal)") : tr(`流程時間軸（取餐 ${plan.pickup_range}）`, `Timeline (pickup ${plan.pickup_range})`)}</CardTitle></CardHeader>
              <CardContent className="text-sm space-y-4">
                {plan.timelines && Object.keys(plan.timelines).length > 0 ? (
                  MEAL_PERIODS.filter((p) => plan.timelines![p]).map((p) => (
                    <div key={p}>
                      <p className="font-semibold mb-1">{mealPeriodLabel(p)}・{tr(`取餐 ${plan.timelines![p]!.range}・${plan.timelines![p]!.order_count} 份`, `pickup ${plan.timelines![p]!.range} · ${plan.timelines![p]!.order_count} meals`)}</p>
                      <TimelineTable timeline={plan.timelines![p]!} />
                    </div>
                  ))
                ) : (
                  <TimelineTable timeline={plan.timeline} />
                )}
                <p className="text-xs text-muted-foreground mt-2">{tr("排程依製程時間、設備容量、可提前時間倒推計算，不使用 AI。", "Scheduled backwards from pickup by prep time, equipment and lead time — no AI.")}</p>
              </CardContent>
            </Card>
          </div>

          {/* 領料單：今天從冰箱、倉庫拿出的生料（prepPlans.raw_needs） */}
          {planNeeds.size > 0 && (
            <Card className={printMode === "picklist" ? "" : "print:hidden"}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> {tr(`領料單（${date}，${plan.order_count} 份）`, `Pick list (${date}, ${plan.order_count} meals)`)}</CardTitle>
                <p className="text-xs text-muted-foreground print:hidden">{tr("今天要從冰箱、倉庫拿出的生料；紅色＝現有不夠，請看上面的缺料警示。", "Raw ingredients to take out today; red = not enough on hand.")}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="print:hidden"><RecipeCraft items={craftItems(planNeeds, ingById, stock)} haveNote={stockNote} compact /></div>
                <table className="hidden print:table w-full text-sm">
                  <tbody>
                    {craftItems(planNeeds, ingById).map((i) => (
                      <tr key={i.id} className="border-b"><td className="py-1 w-6">☐</td><td className="py-1">{i.name}</td><td className="py-1 text-right font-semibold">{amountText(i.need, i.unit)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          <Card className="print:hidden">
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-1.5"><Replace className="w-4 h-4" /> {tr("天災期間等值替換配菜", "Substitute a side (disasters)")}</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-2 items-center">
              <select className="h-9 rounded-md border border-input px-2 text-sm" value={sub.from} onChange={(e) => setSub({ ...sub, from: e.target.value })}>
                <option value="">{tr("原配菜", "From")}</option>
                {dishes.map((d) => <option key={d}>{d}</option>)}
              </select>
              <span>→</span>
              <Input className="w-40 h-9" value={sub.to} onChange={(e) => setSub({ ...sub, to: e.target.value })} placeholder={tr("替換成", "To")} />
              <Button size="sm" onClick={substitute} disabled={busy || !sub.from || !sub.to}>{tr("替換並通知", "Replace & notify")}</Button>
              {plan.substitutions?.length ? <span className="text-xs text-muted-foreground">{plan.substitutions.map((x) => `${x.from}→${x.to}`).join("、")}</span> : null}
            </CardContent>
          </Card>

          {/* 出餐標籤：每盒一張，不印姓名（便當可能轉為愛心餐） */}
          <div className={printMode === "labels" ? "" : "print:hidden"}>
            <h3 className="font-semibold mb-2 print:hidden">{tr(`出餐標籤（${plan.labels.length} 張）`, `Labels (${plan.labels.length})`)}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 print:grid-cols-3">
              {plan.labels.map((l) => (
                <div key={l.lock_id} className="border border-dashed border-gray-400 rounded p-2 text-xs bg-white break-inside-avoid">
                  <div className="flex justify-between items-baseline"><span className="text-xl font-extrabold tracking-widest">{l.pickup_code}</span><span>{l.pickup_window}</span></div>
                  <p className="font-semibold">{l.item}</p>
                  {l.main && <p>{l.main}{l.fixed?.length ? `＋${l.fixed.join("、")}` : ""}</p>}
                  <p>{l.sides.join("・")}</p>
                  {l.rice && <p className="font-bold">{l.rice}</p>}
                  {l.note && <p className="italic">{l.note}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </VendorPortalLayout>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { paren } from "@/lib/format";
import { selectClass } from "@/lib/fieldStyles";
import { collection, doc, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { AlertTriangle, Check, ChefHat, ChevronDown, ChevronRight, ClipboardList, MessageCircle, MessageCircleQuestion, Pencil, Printer, RefreshCw, Replace, Sparkles, Tag as TagIcon, TrendingUp, Zap } from "lucide-react";
import { useLocation } from "wouter";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import RecipeCraft from "@/components/RecipeCraft";
import InfoTip from "@/components/InfoTip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, Tag } from "@/components/ds";
import PortalPageHeader from "@/components/PortalPageHeader";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { useAuth } from "@/hooks/useAuth";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import AiDraftWarning, { useConfirmAiDrafts } from "@/components/AiDraftWarning";
import { useVendorMenu } from "@/hooks/useVendorMenu";
import { useStockOnHand } from "@/hooks/useStockOnHand";
import { amountText, componentPortions, craftItems, rawNeeds } from "@/lib/prep";
import { purchaseText, shareToLine, toPurchaseUnits } from "@/lib/purchaseShare";
import { setPendingEdit } from "@/lib/pendingEdit";
import { rawAmount } from "@/lib/bento";
import { componentGroup, GROUP_CELL, type FoodGroup } from "@/lib/foodColors";
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
          <tr key={i} className="align-top"><td className="pr-3 py-1 font-mono whitespace-nowrap">{s.start}</td><td className="py-1">{s.task} <span className="text-xs text-muted-foreground">{paren(s.equipment)}</span></td></tr>
        ))}
        <tr className="align-top"><td className="pr-3 py-1 font-mono">{timeline.packing.start}</td><td className="py-1">{tr("裝盒、貼出餐標籤", "Pack & label")}</td></tr>
      </tbody>
    </table>
  );
}

const toMin = (hm: string | undefined) => {
  const [h, m] = String(hm ?? "").split(":").map(Number);
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : NaN;
};
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/**
 * Draws the timeline (simplification proposal §4, §5.1): cook → pack → pickup as three horizontal bars, replacing the "10:40 pack" text list.
 * Fine-grained equipment and batch scheduling lives under "Detailed schedule" (third tier, only high-volume vendors need it).
 */
function PickupTimeline({ timeline, range, label, showNow }: { timeline: Timeline; range: string; label?: string; showNow?: boolean }) {
  const [ps, pe] = range.split("-").map((x) => toMin(x.trim()));
  const pack = toMin(timeline.packing.start);
  const starts = timeline.slots.map((s) => toMin(s.start)).filter(Number.isFinite);
  const fire = starts.length ? Math.min(...starts) : pack - 30;
  const pickupEnd = Number.isFinite(pe) ? pe : ps + 60;
  if (![ps, pack, fire].every(Number.isFinite)) return null;
  const from = Math.floor(Math.min(fire, pack) / 60) * 60;
  const to = Math.max(from + 60, Math.ceil(pickupEnd / 60) * 60);
  const pct = (m: number) => `${((Math.min(Math.max(m, from), to) - from) / (to - from)) * 100}%`;
  const width = (a: number, b: number) => `${(Math.max(0, Math.min(b, to) - Math.max(a, from)) / (to - from)) * 100}%`;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const segs = [
    { key: "fire", a: fire, b: pack, text: tr("開火", "Cook"), cls: "bg-brand text-brand-foreground" },
    { key: "pack", a: pack, b: ps, text: tr("裝盒", "Pack"), cls: "bg-plum text-plum-foreground" },
    { key: "pickup", a: ps, b: pickupEnd, text: tr("取餐", "Pickup"), cls: "bg-success-soft text-success-text" },
  ].filter((x) => x.b > x.a);
  const hours: number[] = [];
  for (let m = from; m <= to; m += 60) hours.push(m);
  return (
    <div className="space-y-1">
      {label && <p className="text-xs font-semibold">{label}</p>}
      <div className="relative h-9 rounded-md bg-muted overflow-hidden" role="img" aria-label={segs.map((x) => `${x.text} ${hhmm(x.a)}–${hhmm(x.b)}`).join("，")}>
        {segs.map((x) => (
          <div key={x.key} className={cn("absolute top-0 bottom-0 flex items-center justify-center text-xs font-semibold border-r border-white/70", x.cls)} style={{ left: pct(x.a), width: width(x.a, x.b) }} title={`${x.text} ${hhmm(x.a)}–${hhmm(x.b)}`}>
            <span className="truncate px-1">{x.text}</span>
          </div>
        ))}
        {showNow && nowMin > from && nowMin < to && <div className="absolute top-0 bottom-0 w-0.5 bg-foreground" style={{ left: pct(nowMin) }} aria-hidden="true" />}
      </div>
      <div className="relative h-4 text-[11px] text-muted-foreground font-mono">
        {hours.map((m, i) => (
          <span key={m} className={cn("absolute", i === 0 ? "" : i === hours.length - 1 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: pct(m) }}>{hhmm(m)}</span>
        ))}
      </div>
    </div>
  );
}

interface PrepPlan {
  date: string;
  order_count: number;
  pickup_range: string;
  components: { component_id: string; name: string; portions: number }[];
  timeline: Timeline;
  // Spec 1002 §5.2: the timeline works backward from each meal period's pickup start time
  timelines?: Partial<Record<MealPeriod, Timeline & { range: string; order_count: number }>>;
  labels: { lock_id: string; pickup_code: string; pickup_window: string; item: string; main: string | null; fixed?: string[]; sides: string[]; rice: string | null; note: string | null }[];
  shortages: { ingredient_id: string; name: string; unit: string; need: number; have: number; short: number }[];
  raw_needs?: Record<string, number>;
  wish_results: Record<string, { dish: string; count: number; min_qty: number; ok: boolean }>;
  done?: Record<string, boolean>;
  substitutions?: { from: string; to: string }[];
  charity_result?: { total: number; given_onsite: number; wasted: number };
}

// Estimated pickup window (functions/src/pickupForecast.js): plain statistics, no LLM
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
 * Estimated actual pickup (AI feature 4). With too few samples (under 3 business days of pickup records) the card is hidden rather than showing a meaningless forecast;
 * plain-language follow-up questions sit behind "Ask AI".
 */
function PickupForecastCard({ vendorId, date, lockCount }: { vendorId: string; date: string; lockCount: number }) {
  const [forecast, setForecast] = useState<PickupForecast | null>(null);
  const [asking, setAsking] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

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

  if (!forecast || forecast.locked === 0 || !forecast.enough || forecast.low === undefined || forecast.high === undefined) return null;
  const basis = forecast.same_weekday
    ? tr(`過去 ${forecast.days_used} 個同星期幾`, `the last ${forecast.days_used} same weekdays`)
    : tr(`過去 ${forecast.days_used} 個營業日`, `the last ${forecast.days_used} business days`);
  return (
    <Card className="print:hidden">
      <CardContent className="p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <TrendingUp className="w-4 h-4 text-accent-foreground" />
          <span className="text-sm">{tr("預估實際取餐", "Expected pickups")}</span>
          <span className="text-2xl font-bold text-accent-foreground">{forecast.low === forecast.high ? forecast.low : `${forecast.low}–${forecast.high}`}</span>
          <span className="text-sm text-muted-foreground">/ {forecast.locked} {tr("份", "")}</span>
          <InfoTip>{tr(`依${basis}的取餐紀錄估的；沒來拿的會在取餐時段結束後轉為愛心餐。`, `Based on ${basis}; unclaimed meals become charity meals.`)} {forecast.disclaimer}</InfoTip>
          <button type="button" className="ml-auto text-xs text-primary underline" onClick={() => setAskOpen((v) => !v)}>{tr("問 AI", "Ask AI")}</button>
        </div>
        {askOpen && (
          <div className="flex gap-2">
            <Input className="h-9" value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }} placeholder={tr("例：下雨天取餐率會差多少？", "e.g. how do rainy days affect pickups?")} />
            <Button size="sm" variant="outline" onClick={ask} disabled={asking || !question.trim()}><MessageCircleQuestion /> {asking ? tr("思考中…", "Thinking…") : tr("追問", "Ask")}</Button>
          </div>
        )}
        {answer && <p className="text-sm bg-accent rounded p-2 whitespace-pre-line">{answer}</p>}
      </CardContent>
    </Card>
  );
}

/** Top stat cards */
function StatCard({ label, children, tone }: { label: ReactNode; children: ReactNode; tone?: "red" | "green" }) {
  return (
    <Card className={cn("flex-1 min-w-[9rem]", tone === "red" && "border-danger/40 bg-danger-soft/60", tone === "green" && "border-success/40 bg-success-soft/60")}>
      <CardContent className="p-4 space-y-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        {children}
      </CardContent>
    </Card>
  );
}

/** Prep tile: tap = done, the tile turns green */
function PrepTile({ name, sub, group, done, onToggle, onDetail }: { name: string; sub: string; group: FoodGroup; done: boolean; onToggle?: () => void; onDetail?: () => void }) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        aria-pressed={done}
        className={cn(
          "w-full min-h-[5.5rem] rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          done ? "border-success bg-success-strong text-white" : GROUP_CELL[group],
          onToggle && !done && "hover:brightness-95",
        )}
      >
        <span className="flex items-start gap-1.5">
          {done && <Check className="w-5 h-5 shrink-0" aria-hidden="true" />}
          <span className={cn("text-base font-semibold leading-tight", done && "line-through decoration-2")}>{name}</span>
        </span>
        <span className={cn("block mt-1 text-sm", done ? "text-white/90" : "opacity-80")}>{sub}</span>
      </button>
      {onDetail && (
        <button type="button" onClick={onDetail} className={cn("absolute bottom-2 right-2 rounded-full px-2 py-0.5 text-[11px] underline", done ? "text-white" : "text-foreground/70")}>
          {tr("做法", "How")}
        </button>
      )}
    </div>
  );
}

/** Collapsible section: help text and exception features start collapsed */
function Fold({ title, open, onToggle, children, className }: { title: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="p-0">
        <button type="button" className="w-full flex items-center gap-1.5 px-4 py-3 text-left text-sm font-semibold" onClick={onToggle} aria-expanded={open}>
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}{title}
        </button>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

/**
 * Today's prep (spec §5.4; simplification proposal §5.1): the page only answers "what do I do now".
 * - Top: three stat cards: portions, progress, shortages
 * - Middle: pickup timeline (cook → pack → pickup)
 * - Bottom: prep tiles, tap = done. Works without recipes (first tier): uses item portion counts from orders as tiles
 * - Empty sections are hidden; forecast hidden when samples are too few; disaster substitution lives under "Something wrong today?"
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
  const [date, setDate] = useState(today);
  const [plan, setPlan] = useState<PrepPlan | null>(null);
  const [locks, setLocks] = useState<Lock[]>([]);
  // Whether orders / prep plan for the current date have loaded (switching dates shows loading again)
  const [loadedLocksDate, setLoadedLocksDate] = useState<string | null>(null);
  const [loadedPlanDate, setLoadedPlanDate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState({ from: "", to: "" });
  // Print: meal labels or pick list (printed separately)
  const [printMode, setPrintMode] = useState<"labels" | "picklist">("labels");
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [fold, setFold] = useState<Record<string, boolean>>({});
  const toggleFold = (k: string) => setFold((f) => ({ ...f, [k]: !f[k] }));
  const [, navigate] = useLocation();
  const { data: catalog } = useVendorCatalog(vendorId);
  const confirmAiDrafts = useConfirmAiDrafts(vendorId);
  const { data: menuItems = [] } = useVendorMenu(vendorId);
  const { stock, counted } = useStockOnHand(vendorId, date);
  const ingById = catalog?.ingredientsById ?? {};
  const compById = catalog?.componentsById ?? {};

  useEffect(() => {
    if (!vendorId) return;
    const unsubPlan = onSnapshot(doc(db, "vendors", vendorId, "prepPlans", date), (snap) => {
      setPlan(snap.exists() && snap.data().locked_at ? (snap.data() as PrepPlan) : null);
      setLoadedPlanDate(date);
    }, () => {
      setPlan(null);
      setLoadedPlanDate(date);
    });
    const unsubLocks = onSnapshot(query(collection(db, "locks"), where("vendor_id", "==", vendorId), where("pickup_date", "==", date)), (snap) => {
      setLocks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Lock).filter((l) => PENDING_STATUSES.has(l.status) || l.status === "fulfilled" || l.status === "resold_and_fulfilled" || l.status === "charity"));
      setLoadedLocksDate(date);
    }, (err) => {
      setLoadedLocksDate(date);
      toast({ variant: "destructive", title: tr("訂單讀取失敗", "Couldn't load orders"), description: err.message });
    });
    return () => {
      unsubPlan();
      unsubLocks();
    };
  }, [vendorId, date]);

  // First tier: orders only, portions per item
  const itemCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (plan) plan.labels.forEach((l) => m.set(l.item, (m.get(l.item) ?? 0) + 1));
    else locks.forEach((l) => m.set(l.item_name, (m.get(l.item_name) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [locks, plan]);

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

  // Pre-cut-off estimate: computed client-side from current orders (same rules as the backend; wishes aren't decided yet, so all count as the default dish)
  const estimate = useMemo(() => {
    if (plan || !catalog || locks.length === 0) return null;
    const itemsById = Object.fromEntries(menuItems.map((i) => [i.id, i]));
    const portions = componentPortions(locks.filter((l) => PENDING_STATUSES.has(l.status)), itemsById, compById);
    return { portions, needs: rawNeeds(portions, compById, ingById) };
  }, [plan, catalog, menuItems, locks]);
  const planNeeds = useMemo(() => new Map(Object.entries(plan?.raw_needs ?? {})), [plan]);
  const stockNote = counted ? tr("上週六盤點＋本週到貨−已用", "last count + deliveries − used") : tr("理論庫存（上週六未盤點）", "theoretical stock (not counted)");

  // Shortages: after cut-off use the backend result; before cut-off use the estimate (need > on hand)
  const shortNames = useMemo(() => {
    if (plan) return plan.shortages.map((s) => s.name);
    if (!estimate) return [];
    return [...estimate.needs].filter(([id, need]) => ingById[id] && need > (stock[id] ?? 0) + 1e-6).map(([id]) => ingById[id].name);
  }, [plan, estimate, stock, ingById]);

  function printWith(mode: "labels" | "picklist") {
    setPrintMode(mode);
    window.setTimeout(() => window.print(), 50);
  }

  /** Shortages → LINE supplier order (grouped by small supplier, rounded up to purchase units); if portions still have an AI draft, ask first */
  async function shareShortages() {
    if (!plan || !catalog) return;
    if (!(await confirmAiDrafts())) return;
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

  // Prep tiles: use semi-finished components when there's a recipe (second tier), otherwise item portion counts (first tier)
  const tiles = plan
    ? plan.components.length > 0
      ? plan.components.map((c) => {
        const comp = compById[c.component_id];
        const n = Math.round(c.portions * 10) / 10;
        return { key: c.component_id, name: c.name, sub: comp?.portion_grams ? `${comp.portion_grams}g × ${n}` : `× ${n}`, group: componentGroup(comp, ingById), detail: c.component_id };
      })
      : itemCounts.map(([name, n]) => ({ key: `item:${name}`, name, sub: tr(`${n} 份`, `× ${n}`), group: "other" as FoodGroup, detail: null as string | null }))
    : [];
  const doneCount = plan ? tiles.filter((t) => plan.done?.[t.key]).length : 0;
  const dishes = plan ? [...new Set(plan.labels.flatMap((l) => l.sides))].filter((s) => !s.includes("不要")) : [];
  const total = plan ? plan.order_count : locks.length;
  const loadingDay = !!vendorId && (loadedLocksDate !== date || loadedPlanDate !== date);
  const dayLabel = date === today ? tr("今天", "Today") : date < today ? tr("昨天", "Yesterday") : tr("下一個營業日", "Next day");
  const periodTimelines = plan?.timelines && Object.keys(plan.timelines).length > 0
    ? MEAL_PERIODS.filter((p) => plan.timelines![p]).map((p) => ({ key: p, label: `${mealPeriodLabel(p)}・${plan.timelines![p]!.order_count} ${tr("份", "")}`, timeline: plan.timelines![p]!, range: plan.timelines![p]!.range }))
    : plan ? [{ key: "all", label: undefined as string | undefined, timeline: plan.timeline, range: plan.pickup_range }] : [];
  const detailComp = openTask ? compById[openTask] : undefined;
  const detailPortions = openTask ? plan?.components.find((c) => c.component_id === openTask)?.portions ?? 0 : 0;

  return (
    <VendorPortalLayout>
      <div className="space-y-4">
        <div className="print:hidden space-y-3">
          <PortalPageHeader icon={ChefHat} title={<>
            {tr("今日備料", "Today's prep")}
            <InfoTip>{tr(`前一天 ${vendorCutoffTime(vendor)} 截單後自動產生。點一張卡片＝那一樣做好了。菜單的格子填好組成後，卡片會變成每道配菜的份量，並算出缺料。`, `Generated after the ${vendorCutoffTime(vendor)} cutoff the day before. Tap a card when it's done. Once menu cells have recipes, cards show each dish and shortages.`)}</InfoTip>
          </>} />
          <div className="flex gap-2 flex-wrap">
            {dates.map((d) => <Tag key={d} selected={date === d} onClick={() => setDate(d)}>{d === today ? tr("今天", "Today") : d < today ? tr("昨天", "Yesterday") : tr("下一個營業日", "Next day")} {d.slice(5)}</Tag>)}
          </div>
        </div>

        <div className="print:hidden"><AiDraftWarning vendorId={vendorId} what={tr("備料份量與缺料", "prep amounts and shortages")} /></div>

        {/* Top three stat cards */}
        <div className="flex flex-wrap gap-3 print:hidden">
          <StatCard label={`${dayLabel} ${date.slice(5).replace("-", "/")}`}>
            <p className="text-3xl font-bold text-accent-foreground leading-none">{total}<span className="text-base font-semibold text-foreground"> {tr(plan ? "份要做" : "份已訂", plan ? " to make" : " ordered")}</span></p>
          </StatCard>
          <StatCard label={tr("完成進度", "Progress")} tone={plan && tiles.length > 0 && doneCount === tiles.length ? "green" : undefined}>
            {plan ? (
              <>
                <p className="text-3xl font-bold leading-none">{doneCount}<span className="text-base text-muted-foreground"> / {tiles.length}</span></p>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={tiles.length}>
                  <div className="h-full bg-success-strong transition-all" style={{ width: `${tiles.length ? (doneCount / tiles.length) * 100 : 0}%` }} />
                </div>
              </>
            ) : <p className="text-sm font-semibold pt-1">{tr("截單後開始", "Starts at cutoff")}</p>}
          </StatCard>
          <StatCard label={plan ? tr("缺料", "Short") : tr("缺料（預估）", "Short (est.)")} tone={shortNames.length > 0 ? "red" : undefined}>
            {shortNames.length > 0 ? (
              <p className="text-xl font-bold text-danger-text leading-tight flex items-center gap-1"><AlertTriangle className="w-5 h-5 shrink-0" />{shortNames.slice(0, 2).join("、")}{shortNames.length > 2 ? tr(` 等 ${shortNames.length} 項`, ` +${shortNames.length - 2}`) : ""}</p>
            ) : <p className="text-xl font-bold text-success-text leading-tight">{total > 0 && (plan ? planNeeds.size > 0 : !!estimate?.needs.size) ? tr("都夠", "All good") : "—"}</p>}
          </StatCard>
        </div>

        {vendorId && date >= today && <PickupForecastCard vendorId={vendorId} date={date} lockCount={locks.length} />}

        {loadingDay ? (
          <SkeletonBlocks count={4} height={96} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 print:hidden" />
        ) : !plan ? (
          locks.length === 0 ? (
            <EmptyState size="compact" className="print:hidden" icon={<ChefHat size={32} />} title={tr(`${date.slice(5)} 還沒有訂單`, "No orders yet for this day")} description={tr("有人訂了，這裡會出現要做的品項。", "Items to prepare will appear here once orders come in.")} />
          ) : (
            <div className="space-y-4 print:hidden">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {itemCounts.map(([name, n]) => <PrepTile key={name} name={name} sub={tr(`${n} 份`, `× ${n}`)} group="other" done={false} />)}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => runCutoff(false)} disabled={busy}><RefreshCw /> {tr("產生備料清單", "Generate prep list")}</Button>
                <span className="text-xs text-muted-foreground">{tr(`${cutoffAt(date, vendor).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 自動截單`, "Closes automatically at cutoff")}</span>
              </div>
              {estimate && estimate.needs.size > 0 && (
                <Fold title={tr("目前預估要備的料", "Estimated ingredients so far")} open={!!fold.estimate} onToggle={() => toggleFold("estimate")}>
                  <RecipeCraft items={craftItems(estimate.needs, ingById, stock)} haveNote={stockNote} compact />
                  <p className="text-xs text-muted-foreground mt-2">{tr("許願菜先當預設菜算；截單後以正式清單為準。", "Wishes counted as defaults until cutoff.")}</p>
                </Fold>
              )}
            </div>
          )
        ) : (
          <>
            {/* Pickup timeline */}
            {periodTimelines.length > 0 && (
              <Card className="print:hidden">
                <CardContent className="p-4 space-y-3">
                  {periodTimelines.map((t) => <PickupTimeline key={t.key} timeline={t.timeline} range={t.range} label={t.label} showNow={date === today} />)}
                </CardContent>
              </Card>
            )}

            {/* Shortages: one icon, one word; details on tap */}
            {plan.shortages.length > 0 && (
              <Card className="border-danger/40 print:hidden">
                <CardContent className="p-3 flex flex-wrap items-center gap-2">
                  <button type="button" className="flex-1 min-w-[12rem] flex items-center gap-1.5 text-left font-semibold text-danger-text" onClick={() => toggleFold("short")} aria-expanded={!!fold.short}>
                    <AlertTriangle className="w-4 h-4 shrink-0" />{tr(`缺料：${plan.shortages.map((s) => s.name).join("、")}`, `Short: ${plan.shortages.map((s) => s.name).join(", ")}`)}
                    {fold.short ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <Button size="sm" onClick={shareShortages} disabled={!catalog}><MessageCircle /> {tr("LINE 叫貨", "Order via LINE")}</Button>
                  {fold.short && (
                    <div className="w-full space-y-2 pt-1">
                      <RecipeCraft items={plan.shortages.map((s) => ({ id: s.ingredient_id, name: s.name, need: s.need, unit: s.unit, have: s.have }))} compact />
                      <p className="text-xs text-muted-foreground">{plan.shortages.map((s) => {
                        const ing = ingById[s.ingredient_id];
                        return tr(`${s.name} 缺 ${amountText(s.short, s.unit)}${ing ? `（叫 ${toPurchaseUnits(s.short, ing.purchase_unit_size)} ${ing.purchase_unit_label}）` : ""}`, `${s.name}: short ${amountText(s.short, s.unit)}`);
                      }).join("、")}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Prep tiles: tap = done */}
            <div className="print:hidden space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{tr("要做的", "To make")}</h2>
                {plan.components.length === 0 && <span className="text-xs text-muted-foreground">{tr("菜單格子填好組成後，這裡會拆成每道配菜", "Fill menu cells to see each dish here")}</span>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {tiles.map((t) => (
                  <PrepTile key={t.key} name={t.name} sub={t.sub} group={t.group} done={!!plan.done?.[t.key]} onToggle={() => toggleDone(t.key, !plan.done?.[t.key])} onDetail={t.detail ? () => setOpenTask(openTask === t.detail ? null : t.detail) : undefined} />
                ))}
              </div>
              {tiles.length > 0 && doneCount === tiles.length && <p className="text-sm text-success-text font-semibold">{tr("全部完成，辛苦了！", "All done — great work!")}</p>}
              {openTask && (
                <Card>
                  <CardContent className="p-4 space-y-2 text-sm">
                    {detailComp ? (
                      <>
                        <p className="font-semibold">{detailComp.name}{tr("・", " · ")}{tr(`${Math.round(detailPortions * 10) / 10} 份`, `× ${detailPortions}`)}</p>
                        <p className="text-xs text-muted-foreground">{tr(`${detailComp.equipment}・每批 ${detailComp.batch_capacity} 份 → 做 ${Math.ceil(detailPortions / Math.max(1, detailComp.batch_capacity))} 批・每批 ${detailComp.prep_minutes} 分鐘`, `${detailComp.equipment} · ${Math.ceil(detailPortions / Math.max(1, detailComp.batch_capacity))} batch(es) × ${detailComp.prep_minutes} min`)}</p>
                        <RecipeCraft
                          items={detailComp.ingredients.flatMap((l) => {
                            const ing = ingById[l.ingredient_id];
                            return ing ? [{ id: l.ingredient_id, name: ing.name, need: rawAmount((l.grams || 0) * detailPortions, ing), unit: ing.unit || "g" }] : [];
                          })}
                          target={{ name: detailComp.name, sub: tr(`${Math.round(detailPortions * 10) / 10} 份`, `× ${detailPortions}`) }}
                          compact
                        />
                        <button type="button" className="text-primary underline inline-flex items-center gap-0.5 text-xs" onClick={() => editComponent(detailComp.id)}><Pencil className="w-3 h-3" /> {tr("改配方", "Edit recipe")}</button>
                      </>
                    ) : <p className="text-muted-foreground">{tr("找不到這道菜的配方（可能已刪除）", "Recipe not found")}</p>}
                  </CardContent>
                </Card>
              )}
            </div>

            {Object.keys(plan.wish_results ?? {}).length > 0 && (
              <Fold className="print:hidden" title={<span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-accent-foreground" />{tr("配菜許願結果", "Side-dish wishes")}</span>} open={!!fold.wish} onToggle={() => toggleFold("wish")}>
                <div className="text-sm space-y-1">
                  {Object.values(plan.wish_results).map((w, i) => (
                    <div key={i} className="flex justify-between"><span>{w.dish}</span><span className={w.ok ? "text-success-text" : "text-muted-foreground"}>{w.count}/{w.min_qty} {w.ok ? tr("成立", "on") : tr("未成立，改預設菜", "off")}</span></div>
                  ))}
                </div>
              </Fold>
            )}

            {/* Toolbar: print, recalculate, exceptions */}
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button variant="outline" onClick={() => printWith("labels")}><Printer /> {tr("印出餐標籤", "Print labels")}</Button>
              {planNeeds.size > 0 && <Button variant="outline" onClick={() => printWith("picklist")}><ClipboardList /> {tr("印領料單", "Print pick list")}</Button>}
              <Button variant="outline" onClick={() => toggleFold("labels")}><TagIcon /> {fold.labels ? tr("收起標籤", "Hide labels") : tr("看標籤", "View labels")}</Button>
              <Button variant="ghost" onClick={() => runCutoff(true)} disabled={busy}><RefreshCw /> {tr("重新計算", "Recalculate")}</Button>
              <Button variant="ghost" onClick={() => toggleFold("issue")}><Zap /> {tr("今天有狀況？", "Something came up?")}</Button>
            </div>

            {fold.issue && (
              <Card className="print:hidden">
                <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-1.5"><Replace className="w-4 h-4" /> {tr("天災、缺貨：等值替換配菜", "Swap a side (disaster / out of stock)")}</CardTitle></CardHeader>
                <CardContent className="flex flex-wrap gap-2 items-center">
                  <select className={selectClass()} value={sub.from} onChange={(e) => setSub({ ...sub, from: e.target.value })} aria-label={tr("原配菜", "From")}>
                    <option value="">{tr("原配菜", "From")}</option>
                    {dishes.map((d) => <option key={d}>{d}</option>)}
                  </select>
                  <span>→</span>
                  <Input className="w-40 h-10" value={sub.to} onChange={(e) => setSub({ ...sub, to: e.target.value })} placeholder={tr("替換成", "To")} />
                  <Button size="sm" onClick={substitute} disabled={busy || !sub.from || !sub.to}>{tr("替換並通知", "Replace & notify")}</Button>
                  {plan.substitutions?.length ? <span className="text-xs text-muted-foreground">{plan.substitutions.map((x) => `${x.from}→${x.to}`).join("、")}</span> : null}
                  <p className="w-full text-xs text-muted-foreground">{tr("只限天災或菜價異常期間的等值替換，會通知受影響的消費者。", "Equivalent swaps only; affected customers are notified.")}</p>
                </CardContent>
              </Card>
            )}

            {/* Pick list: raw ingredients taken from the fridge / storeroom today (prepPlans.raw_needs) */}
            {planNeeds.size > 0 && (
              <>
                <Fold className="print:hidden" title={<span className="flex items-center gap-1.5"><ClipboardList className="w-4 h-4" />{tr("領料單（今天要拿出來的生料）", "Pick list (raw ingredients)")}</span>} open={!!fold.pick} onToggle={() => toggleFold("pick")}>
                  <RecipeCraft items={craftItems(planNeeds, ingById, stock)} haveNote={stockNote} compact />
                </Fold>
                <div className={printMode === "picklist" ? "hidden print:block" : "hidden"}>
                  <h2 className="font-semibold mb-2">{tr(`領料單（${date}，${plan.order_count} 份）`, `Pick list (${date}, ${plan.order_count} meals)`)}</h2>
                  <table className="w-full text-sm">
                    <tbody>
                      {craftItems(planNeeds, ingById).map((i) => (
                        <tr key={i.id} className="border-b"><td className="py-1 w-6">☐</td><td className="py-1">{i.name}</td><td className="py-1 text-right font-semibold">{amountText(i.need, i.unit)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Detailed schedule (third tier: equipment, batches) */}
            {periodTimelines.some((t) => t.timeline.slots.length > 0) && (
              <Fold className="print:hidden" title={tr("詳細排程（設備、批次）", "Detailed schedule (equipment, batches)")} open={!!fold.schedule} onToggle={() => toggleFold("schedule")}>
                <div className="text-sm space-y-4">
                  {periodTimelines.map((t) => (
                    <div key={t.key}>
                      {t.label && <p className="font-semibold mb-1">{t.label}{tr("・", " · ")}{tr(`取餐 ${t.range}`, `pickup ${t.range}`)}</p>}
                      <TimelineTable timeline={t.timeline} />
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">{tr("依製程時間、設備容量、可提前時間從取餐往回推，不使用 AI。", "Scheduled backwards from pickup — no AI.")}</p>
                </div>
              </Fold>
            )}

            {/* Meal labels: one per box, no names printed (the bento may become a charity meal) */}
            <div className={cn(printMode === "labels" ? "print:block" : "print:hidden", !fold.labels && "hidden")}>
              <h3 className="font-semibold mb-2 print:hidden">{tr(`出餐標籤（${plan.labels.length} 張）`, `Labels (${plan.labels.length})`)}</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 print:grid-cols-3">
                {plan.labels.map((l) => (
                  <div key={l.lock_id} className="border border-dashed border-input rounded p-2 text-xs bg-card break-inside-avoid">
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
          </>
        )}
      </div>
    </VendorPortalLayout>
  );
}

import { useEffect, useMemo, useState } from "react";
import { selectClass } from "@/lib/fieldStyles";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, limit, onSnapshot, query, where } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useAuth } from "@/hooks/useAuth";
import { httpsCallable } from "@/lib/callable";
import {
  Clock, Star, MapPin, BadgeCheck, CheckCircle2, AlertTriangle, Repeat, Store, Bot, UtensilsCrossed, Search, X, Plus,
  Sunrise, Sun, Moon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import UsePointsToggle from "@/components/UsePointsToggle";
import WaiverText from "@/components/WaiverText";
import { policy } from "@/lib/policy";
import { liveConfig } from "@/lib/platformConfig";
import { useWallet } from "@/hooks/useWallet";
import { formatNT } from "@/lib/format";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { auth, db, functions } from "@/lib/firebase";
import type { Vendor, MenuItem, MealPlan, Lock, MealPeriod, RewardStatus } from "@/types";
import { summarizeRatings, useReviews } from "@/hooks/useReviews";
import { areaLabel, setSelectedArea, useSelectedArea, vendorInArea } from "@/lib/location";
import { applyEarlyBirdPrice, discountText } from "@/lib/pricing";
import { tr, useI18n, loc } from "@/lib/i18n";
import {
  DEFAULT_PICKUP_WINDOWS, MEAL_PERIODS, bookableDateRange, itemWindows, mealPeriodLabel, nextAvailablePickup, openWindowsOn,
  planPickupSchedule, setPreferredPickup, slotLabel, todayStr, addDaysStr, vendorClosedReason, vendorCutoffTime, servesPeriod,
} from "@/lib/pickupSlots";
import { isBento, itemMinPrice } from "@/lib/bento";
import PickupPicker from "@/components/PickupPicker";
import PriceDateStrip from "@/components/PriceDateStrip";
import VendorCardHeader from "@/components/VendorCardHeader";
import { Checkbox } from "@/components/ui/checkbox";
import { useVendors } from "@/hooks/useVendors";
import ShoppingAssistant from "@/components/ShoppingAssistant";
import { avatarUrl } from "@/lib/avatar";
import { matchesQuery, setSearchQuery, useSearchQuery } from "@/lib/searchQuery";
import { cn } from "@/lib/utils";
import { useCart } from "@/hooks/useCart";
import { notifyCartAdded } from "@/components/CartPreview";

const bannedHint = () =>
  tr("您的帳號已被限制下單，請至會員中心提交解封申訴", "Your account can't place orders. Please submit an appeal from My account.");

const PERIOD_ICONS: Record<MealPeriod, typeof Sun> = { breakfast: Sunrise, lunch: Sun, dinner: Moon };

function formatResaleCountdown(deadline: Date, now: number): string {
  const diffMin = Math.round((deadline.getTime() - now) / 60000);
  if (diffMin <= 0) return tr("已逾期", "Expired");
  if (diffMin < 60) return tr(`${diffMin} 分後截止`, `Ends in ${diffMin} min`);
  return tr(`${Math.floor(diffMin / 60)} 小時 ${diffMin % 60} 分後截止`, `Ends in ${Math.floor(diffMin / 60)} h ${diffMin % 60} min`);
}

const SORT_OPTIONS = [
  { id: "relevance", label: "相關性", labelEn: "Relevance" },
  { id: "earliest", label: "最快可取餐", labelEn: "Earliest pickup" },
  { id: "price", label: "價格低到高", labelEn: "Price: low to high" },
  { id: "rating", label: "評分高到低", labelEn: "Rating: high to low" },
] as const;
type SortId = (typeof SORT_OPTIONS)[number]["id"];

export default function HomePage() {
  const { toast } = useToast();
  const { isOrderBanned, user } = useAuth();
  // Vendor accounts viewing the storefront see their own store first
  const myVendorId = user?.role === "vendor" ? user.vendorId : undefined;
  const { t } = useI18n();
  const [location, navigate] = useLocation();
  const { add: addToCart, vendorId: cartVendorId } = useCart();
  // The second row "À la carte | Meal plans" is two separate pages (/home, /plans)
  const mode: "single" | "plans" = location.startsWith("/plans") ? "plans" : "single";
  const [period, setPeriod] = useState<MealPeriod>("lunch");
  const [pickupDate, setPickupDate] = useState(() => nextAvailablePickup()?.date ?? addDaysStr(todayStr(), 1));
  const [selectedSort, setSelectedSort] = useState<SortId>("relevance");
  const [uid, setUid] = useState<string | null>(null);
  const requireLogin = useRequireLogin();
  const searchQuery = useSearchQuery();
  const searching = searchQuery.trim().length > 0;
  // Join-meal-plan confirmation dialog: the diner picks the start date and pickup slot; the server schedules the dates and takes payment
  const [planDialog, setPlanDialog] = useState<{ plan: MealPlan; vendor: Vendor; item: MenuItem | null } | null>(null);
  const [planUsePoints, setPlanUsePoints] = useState(true);
  const { balance: pointBalance } = useWallet();
  const [planStartDate, setPlanStartDate] = useState("");
  const [planWindow, setPlanWindow] = useState("");
  const [planAck, setPlanAck] = useState(false);
  const [joiningPlan, setJoiningPlan] = useState(false);
  const [rewardStatuses, setRewardStatuses] = useState<Map<string, RewardStatus>>(new Map());
  const [assistantOpen, setAssistantOpen] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  // Public growth reward progress ("N more dollars until the draw" shows before "View vendor" on the vendor card)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "rewardStatus"), (snap) => {
      setRewardStatuses(new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as RewardStatus])));
    }, () => setRewardStatuses(new Map()));
    return () => unsub();
  }, []);

  const { data: vendors = [] } = useVendors();

  const { data: lockMealCards = [] } = useQuery({
    queryKey: ["lockMealCards", vendors.map((v) => v.id).join(",")],
    queryFn: async () => {
      if (vendors.length === 0) return [];
      const snap = await getDocs(query(collection(db, "menu_items"), where("is_available", "==", true)));
      const vendorsById = new Map(vendors.map((v) => [v.id, v]));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as MenuItem)
        .map((item) => ({ item, vendor: vendorsById.get(item.vendor_id) }))
        .filter((x): x is { item: MenuItem; vendor: Vendor } => !!x.vendor);
    },
    enabled: vendors.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const itemsById = useMemo(() => new Map(lockMealCards.map(({ item }) => [item.id, item])), [lockMealCards]);

  const { data: vendorPlanGroups = [] } = useQuery({
    queryKey: ["vendorMealPlans", vendors.map((v) => v.id).join(",")],
    queryFn: async () => {
      const groups: { vendorId: string; vendor: Vendor; plans: MealPlan[] }[] = [];
      for (const v of vendors) {
        const snap = await getDocs(query(collection(db, "meal_plans"), where("vendor_id", "==", v.id)));
        const plans = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MealPlan);
        if (plans.length > 0) groups.push({ vendorId: v.id, vendor: v, plans });
      }
      return groups;
    },
    enabled: vendors.length > 0,
    staleTime: 15 * 60 * 1000,
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const { data: transfers = [] } = useQuery({
    queryKey: ["homeTransferPreview"],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "locks"), where("status", "==", "for_resale"), limit(200)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Lock & { created_at?: { toMillis?: () => number } })
        .sort((a, b) => (b.created_at?.toMillis?.() ?? 0) - (a.created_at?.toMillis?.() ?? 0))
        .slice(0, 6);
    },
    staleTime: 2 * 60 * 1000,
  });

  const { data: reviews = [] } = useReviews();
  const vendorRatings = useMemo(() => summarizeRatings(reviews, (r) => r.vendor_id), [reviews]);
  const planRatings = useMemo(() => summarizeRatings(reviews, (r) => r.meal_plan_id), [reviews]);
  const area = useSelectedArea();
  const bookableDates = useMemo(() => bookableDateRange(), []);

  // Meal period buttons: grayed out when no item is offered
  const periodAvailable = useMemo(() => {
    const set = new Set<MealPeriod>();
    for (const { item, vendor } of lockMealCards) for (const p of MEAL_PERIODS) if (servesPeriod(vendor, item, p)) set.add(p);
    return set;
  }, [lockMealCards]);
  useEffect(() => {
    if (periodAvailable.size > 0 && !periodAvailable.has(period)) setPeriod(MEAL_PERIODS.find((p) => periodAvailable.has(p)) ?? "lunch");
  }, [periodAvailable, period]);

  /** Whether an item can be ordered for the current meal period and selected date; when searching, any orderable day within 30 days counts (search only covers what can currently be pre-ordered) */
  const itemOpen = (vendor: Vendor, item: MenuItem | null) =>
    searching
      ? bookableDates.some((d) => openWindowsOn(vendor, d, new Date(), item, period).length > 0)
      : openWindowsOn(vendor, pickupDate, new Date(), item, period).length > 0;

  const itemMatches = (vendor: Vendor, item: MenuItem) =>
    matchesQuery(searchQuery, vendor.name, vendor.name_en, vendor.item_focus, item.name, item.name_en, item.category, item.category_en,
      item.main?.name, ...(item.mains || []).map((m) => m.name), ...(item.slots || []).flatMap((s) => [s.default?.name, ...(s.candidates || []).map((c) => c.name)]));

  const vendorMealGroups = useMemo(() => {
    const cards = lockMealCards.filter(({ item, vendor }) => vendorInArea(vendor, area) && servesPeriod(vendor, item, period) && itemOpen(vendor, item) && itemMatches(vendor, item));
    const earliest = (v: Vendor) => nextAvailablePickup(v)?.date ?? "9999-12-31";
    const rating = (v: Vendor) => vendorRatings.get(v.id)?.average ?? -1;
    if (selectedSort === "earliest") cards.sort((a, b) => earliest(a.vendor).localeCompare(earliest(b.vendor)));
    if (selectedSort === "price") cards.sort((a, b) => itemMinPrice(a.item) - itemMinPrice(b.item));
    if (selectedSort === "rating") cards.sort((a, b) => rating(b.vendor) - rating(a.vendor));
    const groups: { vendor: Vendor; items: MenuItem[] }[] = [];
    const index = new Map<string, number>();
    for (const { item, vendor } of cards) {
      let i = index.get(vendor.id);
      if (i === undefined) {
        i = groups.length;
        index.set(vendor.id, i);
        groups.push({ vendor, items: [] });
      }
      groups[i].items.push(item);
    }
    if (myVendorId) groups.sort((a, b) => Number(b.vendor.id === myVendorId) - Number(a.vendor.id === myVendorId));
    return groups;
  }, [lockMealCards, area, period, pickupDate, selectedSort, vendorRatings, searchQuery, myVendorId]);

  const visiblePlanGroups = useMemo(() => {
    const groups = vendorPlanGroups
      .map((g) => {
        const plans = g.plans.filter((p) => {
          const item = p.menu_item_id ? itemsById.get(p.menu_item_id) ?? null : null;
          return servesPeriod(g.vendor, item, period) && itemOpen(g.vendor, item)
            && matchesQuery(searchQuery, g.vendor.name, g.vendor.name_en, g.vendor.item_focus, p.name, p.name_en, p.label, p.description, item?.name);
        });
        return { ...g, plans };
      })
      .filter((g) => vendorInArea(g.vendor, area) && g.plans.length > 0);
    if (selectedSort === "rating") {
      groups.sort((a, b) => (vendorRatings.get(b.vendorId)?.average ?? -1) - (vendorRatings.get(a.vendorId)?.average ?? -1));
    }
    if (selectedSort === "price") groups.sort((a, b) => Math.min(...a.plans.map((p) => p.price_per_meal)) - Math.min(...b.plans.map((p) => p.price_per_meal)));
    if (myVendorId) groups.sort((a, b) => Number(b.vendorId === myVendorId) - Number(a.vendorId === myVendorId));
    return groups;
  }, [vendorPlanGroups, itemsById, area, period, pickupDate, selectedSort, vendorRatings, searchQuery, myVendorId]);

  const visibleTransfers = transfers.filter((x) => !area || vendorInArea(vendors.find((v) => v.id === x.vendor_id), area));

  // Bentos need a main, sides and rice amount: go to the item page with the chosen date and meal period to build the bento, then add it to the cart
  function openItem(item: MenuItem, vendor: Vendor) {
    const date = searching ? bookableDates.find((d) => openWindowsOn(vendor, d, new Date(), item, period).length > 0) ?? pickupDate : pickupDate;
    const windows = openWindowsOn(vendor, date, new Date(), item, period);
    if (windows.length === 0) {
      toast({
        title: t("這家店這天不開放預購", "This vendor isn't taking pre-orders that day"),
        description: vendorClosedReason(vendor, date) ?? t("可能已截單，請到品項頁改選其他日期。", "It may be past cutoff — choose another date on the item page."),
      });
    }
    setPreferredPickup({ date, window: windows[0] ?? itemWindows(vendor, item, period)[0] ?? DEFAULT_PICKUP_WINDOWS[0] });
    navigate(`/item/${item.id}`);
  }

  // Site-wide "Add to cart" behavior (same logic as quickAdd in VendorPage.tsx):
  // bentos and items with a choice of main need building, so go to the item page; single items are added directly with the chosen date + the earliest slot of this meal period, no page change.
  function quickAdd(item: MenuItem, vendor: Vendor) {
    const date = searching ? bookableDates.find((d) => openWindowsOn(vendor, d, new Date(), item, period).length > 0) ?? pickupDate : pickupDate;
    const window = openWindowsOn(vendor, date, new Date(), item, period)[0];
    if (isBento(item) || (item.mains || []).length > 0 || !window) {
      openItem(item, vendor);
      return;
    }
    if (cartVendorId && cartVendorId !== item.vendor_id) {
      toast({
        title: t("購物車裡有別家店家的品項", "Your cart has items from another vendor"),
        description: t("一次只能跟一家店家預購，請先結帳或清空購物車再加入。", "You can only pre-order from one vendor at a time. Check out or clear your cart first."),
        variant: "destructive",
      });
      return;
    }
    if (!addToCart({ menuItem: item, vendorId: item.vendor_id, pickupDate: date, pickupWindow: window, choices: [], rice: "normal", quantity: 1, note: "", couponId: null })) return;
    notifyCartAdded();
  }

  // Meal plans: at checkout pick the first day + one pickup slot applied to every day; each day gets its own early-bird price and closed days are pushed back; slots can be changed per day later in "My meals"
  function openPlanDialog(vendor: Vendor, plan: MealPlan) {
    if (!requireLogin() || !uid) return;
    if (isOrderBanned) {
      toast({ title: t("目前無法加入計畫", "Can't join a plan right now"), description: bannedHint(), variant: "destructive" });
      return;
    }
    const item = plan.menu_item_id ? itemsById.get(plan.menu_item_id) ?? null : null;
    const windows = openWindowsOn(vendor, pickupDate, new Date(), item, period);
    const next = windows.length > 0 ? { date: pickupDate, window: windows[0] } : nextAvailablePickup(vendor);
    setPlanStartDate(next?.date ?? pickupDate);
    setPlanWindow(next?.window ?? itemWindows(vendor, item, period)[0] ?? DEFAULT_PICKUP_WINDOWS[0]);
    setPlanAck(false);
    setPlanDialog({ plan, vendor, item });
  }

  async function handleJoinPlan(plan: MealPlan) {
    setJoiningPlan(true);
    try {
      const fn = httpsCallable(functions, "createPlanLinePayReservation");
      const result = await fn({ plan_id: plan.id, start_date: planStartDate, pickup_window: planWindow, use_points: planUsePoints && pointBalance > 0 });
      const { order_id: orderId, payment_url: paymentUrl, free } = result.data as { order_id: string; payment_url: string; free?: boolean };
      if (free) navigate(`/payment/confirm/${orderId}`);
      else window.location.href = paymentUrl;
    } catch (err) {
      toast({ title: t("加入計畫失敗", "Couldn't join the plan"), description: (err as Error).message, variant: "destructive" });
      setJoiningPlan(false);
    }
  }

  const dateText = pickupDate.slice(5).replace("-", "/");

  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader active="plans" />

      {/* ── Header ── */}
      <section className="max-w-[1400px] mx-auto px-4 md:px-6 pt-10 md:pt-14 pb-2 flex flex-wrap items-end justify-between gap-6 bb-home-hero">
        <div className="min-w-0">
          <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.14em] uppercase text-muted-foreground mb-4">
            <span className="w-8 h-px bg-current opacity-60" aria-hidden="true" />
            {t("越早訂，越開心。", "Book early, eat happy.")}
          </p>
          <h1 className="font-heading font-semibold text-[clamp(36px,5.5vw,76px)] leading-[1.04] tracking-[-0.025em]">
            {t("今天想吃什麼？", "What are you eating?")}
          </h1>
          <p className="mt-4 text-muted-foreground max-w-xl leading-relaxed">
            {t(`${policy.earlyBird()}，${policy.bookingRange()}。`, `${policy.earlyBird()} — ${policy.bookingRange()}.`)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAssistantOpen(true)}
          className="inline-flex items-center gap-2 h-12 px-5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Bot className="w-4 h-4" aria-hidden="true" /> {t("問問預購助理", "Ask the meal assistant")}
        </button>
        <ShoppingAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} />
      </section>

      <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 space-y-8">
        {/* ── Row 1: meal period; row 2: à la carte | meal plans ── */}
        <div className="space-y-3">
          <div className="flex gap-2 flex-wrap" role="tablist" aria-label={t("餐期", "Meal")}>
            {MEAL_PERIODS.map((p) => {
              const Icon = PERIOD_ICONS[p];
              const available = periodAvailable.size === 0 || periodAvailable.has(p);
              return (
                <button
                  key={p}
                  type="button"
                  role="tab"
                  aria-selected={period === p}
                  disabled={!available}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "inline-flex items-center gap-2 h-11 px-6 rounded-full border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    period === p ? "bg-ink text-[var(--text-on-inverse)] border-ink" : "bg-card border-ink hover:bg-secondary",
                    !available && "opacity-40 cursor-not-allowed hover:bg-card"
                  )}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" /> {mealPeriodLabel(p)}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-full border border-ink p-1 bg-card" role="tablist" aria-label={t("單點或方案", "Single or plan")}>
              {([["single", "/home", t("單點", "Single meals")], ["plans", "/plans", t("方案", "Meal plans")]] as const).map(([m, href, label]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => navigate(href)}
                  className={cn(
                    "h-9 px-6 rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
              {t("排序", "Sort")}
              <select
                value={selectedSort}
                onChange={(e) => setSelectedSort(e.target.value as SortId)}
                className={selectClass("md", "h-9 rounded-full border-border bg-card px-3")}
              >
                {SORT_OPTIONS.map((opt) => <option key={opt.id} value={opt.id}>{t(opt.label, opt.labelEn)}</option>)}
              </select>
            </label>
          </div>
          {area && (
            <p className="text-xs text-muted-foreground">
              {t("地區：", "Area: ")}{areaLabel(area)}{" "}
              <button type="button" className="text-primary underline" onClick={() => setSelectedArea(null)}>{t("清除", "Clear")}</button>
            </p>
          )}
        </div>

        {/* ── Search results notice ── */}
        {searching && (
          <div className="flex items-center gap-2 rounded-2xl border border-ink bg-card px-4 py-3 text-sm">
            <Search className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            <span className="flex-1">
              {t(`搜尋「${searchQuery}」：單點 ${vendorMealGroups.reduce((s, g) => s + g.items.length, 0)} 項、方案 ${visiblePlanGroups.reduce((s, g) => s + g.plans.length, 0)} 個（只列目前可預購的）`,
                `"${searchQuery}": ${vendorMealGroups.reduce((s, g) => s + g.items.length, 0)} meals, ${visiblePlanGroups.reduce((s, g) => s + g.plans.length, 0)} plans (bookable only)`)}
            </span>
            <button type="button" onClick={() => setSearchQuery("")} className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" /> {t("清除搜尋", "Clear")}
            </button>
          </div>
        )}

        {/* ── Price/date bar: the only date picker used site-wide ── */}
        {!searching && (
          <div className="rounded-2xl border border-ink bg-card p-4">
            <PriceDateStrip value={pickupDate} onChange={setPickupDate} />
          </div>
        )}

        {/* ── À la carte ── */}
        {(mode === "single" || searching) && (
          <section className="space-y-4">
            <h2 className="font-heading text-3xl font-semibold">
              {searching ? t("單點", "Single meals") : t(`${mealPeriodLabel(period)}・單點`, `${mealPeriodLabel(period)} · single meals`)}
            </h2>
            <div className="space-y-5">
              {vendorMealGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {searching ? t("沒有符合的單點品項。", "No matching meals.") : t(`${dateText} 的${mealPeriodLabel(period)}沒有開放預購的品項，換一天或換個餐期試試。`, `Nothing open for ${mealPeriodLabel(period)} on ${dateText} — try another day or meal.`)}
                </p>
              )}
              {vendorMealGroups.map(({ vendor, items }) => (
                <article key={vendor.id} className="bg-card rounded-3xl border border-ink p-4 md:p-5" aria-label={loc(vendor, "name")}>
                  <VendorCardHeader
                    vendor={vendor}
                    reward={rewardStatuses.get(vendor.id)}
                    subtitle={searching ? t(`${items.length} 項可預購`, `${items.length} items`) : `${t(`${items.length} 項可預購`, `${items.length} items`)}${t("・", " · ")}${t("取餐", "Pickup")} ${dateText}`}
                  />
                  <ul className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 bb-thin-scroll bb-fade-x">
                    {items.map((item) => {
                      const base = itemMinPrice(item);
                      const { lockedPrice, discountPercent } = applyEarlyBirdPrice(base, pickupDate);
                      const hasMains = (item.mains || []).length > 1;
                      return (
                        <li key={item.id} className="shrink-0 w-[172px] md:w-[188px] snap-start">
                          <div className="group w-full text-left">
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => openItem(item, vendor)}
                                className="block w-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              >
                                <span className="relative block aspect-[4/3] rounded-2xl overflow-hidden border border-ink bg-secondary">
                                  {item.image ? (
                                    <img src={item.image} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]" />
                                  ) : (
                                    <span className="w-full h-full flex items-center justify-center">
                                      <UtensilsCrossed className="w-7 h-7 text-secondary-foreground/50" strokeWidth={1.5} aria-hidden="true" />
                                    </span>
                                  )}
                                  {discountPercent > 0 && !searching && (
                                    <span className="absolute top-2 left-2 text-caption font-bold px-2 py-0.5 rounded-full bg-brand text-brand-foreground">
                                      {discountText(discountPercent)}
                                    </span>
                                  )}
                                </span>
                              </button>
                              {/* Site-wide "Add to cart" action (same round + icon as the vendor page): bentos go to the bento builder, single items go straight into the cart */}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); quickAdd(item, vendor); }}
                                aria-label={t(`加入購物車：${loc(item, "name")}`, `Add to cart: ${loc(item, "name")}`)}
                                className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-sm hover:bg-primary-hover active:scale-95 transition-[transform,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                              >
                                <Plus className="w-4 h-4" aria-hidden="true" />
                              </button>
                            </div>
                            <button type="button" onClick={() => openItem(item, vendor)} className="block w-full text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                              <span className="block mt-2.5 text-sm font-semibold truncate">{loc(item, "name")}</span>
                              <span className="flex items-baseline gap-1.5">
                                {discountPercent > 0 && !searching && <span className="text-xs text-muted-foreground line-through">NT${base}</span>}
                                <span className="font-heading text-lg font-semibold">NT${searching ? base : lockedPrice}{hasMains ? t(" 起", "+") : ""}</span>
                                <span className="ml-auto text-xs font-semibold text-primary underline underline-offset-4 decoration-1 group-hover:decoration-2">
                                  {isBento(item) && item.item_type !== "single" ? t("組便當", "Build") : t("預訂", "Book")}
                                </span>
                              </span>
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* ── Meal plans ── */}
        {(mode === "plans" || searching) && (
          <section className="space-y-4">
            <h2 className="font-heading text-3xl font-semibold">
              {searching ? t("方案", "Meal plans") : t(`${mealPeriodLabel(period)}・方案`, `${mealPeriodLabel(period)} · meal plans`)}
            </h2>
            <div className="space-y-4">
              {visiblePlanGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {searching ? t("沒有符合的方案。", "No matching plans.") : t(`${dateText} 起的${mealPeriodLabel(period)}沒有可加入的方案。`, `No ${mealPeriodLabel(period)} plans start on ${dateText}.`)}
                </p>
              )}
              {visiblePlanGroups.map((group) => (
                <article key={group.vendorId} className="bg-card rounded-3xl border border-ink p-4 md:p-5">
                  <VendorCardHeader
                    vendor={group.vendor}
                    reward={rewardStatuses.get(group.vendorId)}
                    subtitle={t(`${group.plans.length} 個方案・每天各自算早鳥、遇公休順延`, `${group.plans.length} plans · early-bird per day, skips closed days`)}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {group.plans.map((plan) => {
                      const firstPrice = applyEarlyBirdPrice(plan.price_per_meal, pickupDate).lockedPrice;
                      return (
                        <div key={plan.id} className="rounded-2xl border border-ink bg-accent p-4 flex flex-col">
                          <p className="font-heading text-base font-semibold mb-0.5">{loc(plan, "label")}{t("：", ": ")}{loc(plan, "name")}</p>
                          <p className="text-xs text-muted-foreground mb-3">{loc(plan, "description")}</p>
                          <p className="text-sm mb-1">
                            <span className="font-heading text-lg font-semibold">NT${firstPrice}</span>
                            <span className="text-muted-foreground"> {t("/ 餐", "/ meal")}・{plan.days} {t("天", "days")}</span>
                            {firstPrice < plan.price_per_meal && <span className="ml-1.5 text-xs text-muted-foreground line-through">NT${plan.price_per_meal}</span>}
                          </p>
                          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                            {planRatings.get(plan.id) ? (
                              <><Star className="w-3 h-3 fill-warning text-warning" /> {planRatings.get(plan.id)!.average}（{planRatings.get(plan.id)!.count}）</>
                            ) : t("尚無評分", "No ratings yet")}
                          </p>
                          <Button className="mt-auto w-full text-sm" onClick={() => openPlanDialog(group.vendor, plan)}>
                            {t("預約加入方案", "Join this plan")}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* Join-meal-plan confirmation: lists each day's date and price (pushed-back days are marked); every day uses the same slot, editable individually later; payment only after confirming */}
        <Dialog open={!!planDialog} onOpenChange={(open) => { if (!open && !joiningPlan) setPlanDialog(null); }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            {planDialog && (() => {
              const { plan, vendor, item } = planDialog;
              const schedule = planPickupSchedule(vendor, planStartDate, planWindow, plan.days);
              const dayPrices = schedule?.dates.map((d) => ({ date: d, ...applyEarlyBirdPrice(plan.price_per_meal, d), postponed: schedule.postponed.includes(d) })) ?? [];
              const total = dayPrices.reduce((s, d) => s + d.lockedPrice, 0);
              return (
                <>
                  <DialogHeader>
                    <DialogTitle>{loc(plan, "label")}{t("：", ": ")}{loc(plan, "name")}</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 py-1">
                    <p className="text-sm text-muted-foreground">
                      {loc(vendor, "name")}{tr("・", " · ")}{t(`原價 NT$${plan.price_per_meal} × ${plan.days} 天，每天依提前天數各自打早鳥折扣`, `NT$${plan.price_per_meal} × ${plan.days} days, early-bird applied per day`)}
                    </p>
                    <PickupPicker
                      date={planStartDate}
                      window={planWindow}
                      onDateChange={setPlanStartDate}
                      onWindowChange={setPlanWindow}
                      uid={uid}
                      vendor={vendor}
                      item={item}
                      period={period}
                      basePrice={plan.price_per_meal}
                      dateLabel={t("第一天取餐日期", "First pickup date")}
                    />
                    {schedule ? (
                      <div className="rounded-xl border border-border bg-muted p-3">
                        <ul className="divide-y divide-border text-sm">
                          {dayPrices.map((d, i) => (
                            <li key={d.date} className="flex items-center gap-2 py-1.5">
                              <span className="w-14 text-xs text-muted-foreground">{t(`第 ${i + 1} 天`, `Day ${i + 1}`)}</span>
                              <span className="font-medium">{d.date.slice(5).replace("-", "/")}</span>
                              {d.postponed && <span className="text-caption font-bold px-1.5 py-0.5 rounded bg-warning-soft text-warning-text">{t("順延", "Postponed")}</span>}
                              <span className="text-xs text-muted-foreground">{slotLabel(planWindow)}</span>
                              <span className="ml-auto text-xs text-muted-foreground">{discountText(d.discountPercent)}</span>
                              <span className="w-14 text-right font-semibold">NT${d.lockedPrice}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="flex justify-between pt-2 mt-1 border-t border-border text-sm font-semibold">
                          <span>{t("合計", "Total")}</span><span>{formatNT(total)}</span>
                        </p>
                      </div>
                    ) : (
                      <div className="flex gap-1.5 p-2.5 rounded-lg bg-danger-soft border border-danger/40 text-caption text-danger-text">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        {t(`這個開始日期／時段排不滿 ${plan.days} 天（${policy.bookingRange()}），請改選其他日期或時段。`, `This start date and time can't fit ${plan.days} days within the 30-day booking range. Please pick another date or time.`)}
                      </div>
                    )}
                    <div className="flex gap-1.5 p-2.5 rounded-lg bg-secondary border border-border text-caption leading-relaxed">
                      <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
                      <span>{t("所有天數同一時段，之後可以到「我的餐點」個別修改某一天的取餐時段（截單前都可以改）。", "Every day uses the same pickup time; you can change any single day later in My meals (until that day's cutoff).")}</span>
                    </div>
                    <label className="flex items-start gap-1.5 p-2 rounded-lg bg-muted border border-border cursor-pointer">
                      <Checkbox checked={planAck} onCheckedChange={() => setPlanAck((v) => !v)} className="mt-0.5 shrink-0" />
                      <span className="text-caption leading-relaxed text-muted-foreground"><WaiverText vendor={vendor} /></span>
                    </label>
                    <div className="flex gap-1.5 p-2 rounded-lg bg-accent border border-brand/40">
                      <AlertTriangle className="w-3.5 h-3.5 text-accent-foreground shrink-0 mt-0.5" />
                      <span className="text-caption leading-relaxed text-accent-foreground">
                        {t(`每一天都是獨立的一份，當天沒空可以單獨轉讓或捐為愛心餐；取餐時段結束 ${liveConfig().charityConvertAfterMinutes} 分鐘仍未取餐，將`, `Each day is a separate meal you can transfer or donate on its own. If it isn't picked up ${liveConfig().charityConvertAfterMinutes} min after the window ends, it `)}<strong>{t("轉為愛心餐、開放給需要的人", "becomes a charity meal for someone in need")}</strong>
                      </span>
                    </div>
                  </div>
                  {schedule && <UsePointsToggle total={total} checked={planUsePoints} onChange={setPlanUsePoints} />}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setPlanDialog(null)} disabled={joiningPlan}>{t("取消", "Cancel")}</Button>
                    <Button disabled={!schedule || !planAck || joiningPlan} onClick={() => handleJoinPlan(plan)}>
                      {(() => {
                        const pay = Math.max(0, total - (planUsePoints ? Math.min(pointBalance, total) : 0));
                        return joiningPlan ? t("前往付款中…", "Redirecting to payment…") : pay === 0 ? t("已全額折抵，確認加入", "Fully covered — confirm") : t(`確認並付款 ${formatNT(pay)}`, `Confirm & pay ${formatNT(pay)}`);
                      })()}
                    </Button>
                  </DialogFooter>
                </>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* Student resales (the resale market is merged into "My meals"; only a preview here) */}
        {mode === "single" && !searching && (
          <section className="rounded-card p-6 md:p-10 bg-[var(--surface-inverse)] text-[var(--text-on-inverse)] space-y-6">
            <div className="flex items-center justify-between gap-6 flex-wrap">
              <div className="flex items-center gap-3.5">
                <Repeat className="w-7 h-7 shrink-0" />
                <div>
                  <h2 className="font-heading text-3xl font-semibold mb-1">{t("同學轉讓", "Classmate transfers")}</h2>
                  <p className="text-sm max-w-xl opacity-90">
                    {t("臨時去不了？截單後也能轉讓給同學，或捐為愛心餐，不浪費一份便當。", "Can't make it? Transfer your meal to a classmate even after cutoff, or donate it — no meal wasted.")}
                  </p>
                </div>
              </div>
              <Link href="/my-bookings?tab=market" className="shrink-0 text-sm font-bold px-5 py-2.5 rounded-full bg-secondary text-secondary-foreground border border-ink hover:bg-secondary/85 transition-colors">
                {t("前往轉讓市集", "Go to transfers")}
              </Link>
            </div>
            <div className="flex gap-3 overflow-x-auto pb-1 bb-thin-scroll rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight" tabIndex={0} role="region" aria-label={t("同學轉讓清單（可左右捲動）", "Classmate transfers (scrolls sideways)")}>
              {visibleTransfers.length === 0 && <p className="text-sm opacity-80">{t("目前沒有同學轉讓的餐點。", "No transfers right now.")}</p>}
              {visibleTransfers.map((x) => (
                <div key={x.id} className="shrink-0 w-64 bg-card text-foreground rounded-2xl p-3 border border-ink">
                  <div className="flex items-center gap-2 mb-2">
                    <img src={avatarUrl(x.buyer_uid)} alt="" className="w-6 h-6 rounded-full bg-secondary border border-ink shrink-0" />
                    <span className="text-xs font-medium truncate">{t(`使用者 ${x.buyer_uid.slice(-6)} 轉讓`, `Transferred by user ${x.buyer_uid.slice(-6)}`)}</span>
                  </div>
                  <p className="text-sm font-semibold line-clamp-1 mb-2">{loc(x, "item_name")}</p>
                  <span className="font-heading text-base font-semibold">{t("轉讓價", "Price")} ${x.locked_price}</span>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1.5 mt-1.5 border-t border-border">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {(x as any).resale_deadline?.toDate ? formatResaleCountdown((x as any).resale_deadline.toDate(), now) : "—"}
                    </span>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {loc(vendors.find((v) => v.id === x.vendor_id), "name") || "—"}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

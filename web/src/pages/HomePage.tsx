import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  collection, doc, getDocs, limit, onSnapshot, orderBy, query, where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useAuth } from "@/hooks/useAuth";
import { httpsCallable } from "@/lib/callable";
import {
  Clock, CalendarDays, Rocket, Star, MapPin, Trophy,
  BadgeCheck, CheckCircle2, AlertTriangle, Repeat, SlidersHorizontal, Store, Bot, UtensilsCrossed } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import GrowthRewardTicker from "@/components/GrowthRewardTicker";
import { auth, db, functions } from "@/lib/firebase";
import type { Vendor, MenuItem, MealPlan, Lock } from "@/types";
import { summarizeRatings, useReviews } from "@/hooks/useReviews";
import { areaLabel, setSelectedArea, useSelectedArea, vendorInArea } from "@/lib/location";
import { applyEarlyBirdPrice, discountText, VISIBLE_EARLY_BIRD_TIERS, tierRangeText } from "@/lib/pricing";
import type { RewardStatus } from "@/types";
import { tr, useI18n, loc } from "@/lib/i18n";
import { addDaysStr, DEFAULT_PICKUP_WINDOWS, maxPickupDateStr, nextAvailablePickup, openWindowsOn, planPickupDates, setPreferredPickup, slotLabel, todayStr, vendorClosedReason, vendorCutoffTime } from "@/lib/pickupSlots";
import { isBento } from "@/lib/bento";
import PickupPicker from "@/components/PickupPicker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useVendors } from "@/hooks/useVendors";
import ShoppingAssistant from "@/components/ShoppingAssistant";
import { avatarUrl } from "@/lib/avatar";

const bannedHint = () =>
  tr("您的帳號已被限制下單，請至會員中心提交解封申訴", "Your account can't place orders. Please submit an appeal from My account.");
const EARLY_BIRD_ICONS = [Clock, CalendarDays, Rocket];

// 取餐時段清單在 lib/pickupSlots.ts（pickup_window 用 ASCII 連字號，跟
// discount_explanations 的 cacheKeyFor()/其他真實 locks 一致）。

function formatResaleCountdown(deadline: Date, now: number): string {
  const diffMin = Math.round((deadline.getTime() - now) / 60000);
  if (diffMin <= 0) return tr("已逾期", "Expired");
  if (diffMin < 60) return tr(`${diffMin} 分後截止`, `Ends in ${diffMin} min`);
  return tr(`${Math.floor(diffMin / 60)} 小時 ${diffMin % 60} 分後截止`, `Ends in ${Math.floor(diffMin / 60)} h ${diffMin % 60} min`);
}

// 首頁模板 — 對應 UI草圖的 Main.dc.html（現在是合併版：原本 PlanSchedule.dc.html
// 的「合作店家與計畫」已經整段併進 Main，這裡也已經做過）。
// 排序只保留有資料能算的：草圖的「距離」沒有位置資料所以拿掉，「最快送達」改成
// 最快可取餐日（平台是自取不外送），評分讀 reviews 的店家平均。
const SORT_OPTIONS = [
  { id: "relevance", label: "相關性", labelEn: "Relevance" },
  { id: "earliest", label: "最快可取餐", labelEn: "Earliest pickup" },
  { id: "price", label: "價格低到高", labelEn: "Price: low to high" },
  { id: "rating", label: "評分高到低", labelEn: "Rating: high to low" },
] as const;
type SortId = (typeof SORT_OPTIONS)[number]["id"];

// 預約日曆最多看到下週五（第一階段規格的預訂範圍）
const MAX_RANGE_DAYS = 14;


// 消保法聲明（鎖定單點、加入計畫共用）
function WaiverText() {
  const { t } = useI18n();
  return (
    <>
      {t("我了解本商品為現做餐點，依消保法通訊交易解除權合理例外情事適用準則，", "I understand these are freshly made meals. Under Taiwan's Consumer Protection Act exceptions for distance sales, ")}
      <strong className="text-foreground">{t(`取餐前一天 ${vendorCutoffTime(null)} 截單前可免費取消，截單後不適用 7 天猶豫期、恕不退款`, `meals can be cancelled for free until ${vendorCutoffTime(null)} the day before; after cutoff the 7-day cooling-off period doesn't apply and there are no refunds`)}</strong>
      {t("（可轉讓、贈送或捐為愛心餐；停班停課自動全額退款，天災期間店家可等值替換配菜）", " (you can still transfer, gift or donate it; work-suspension days are refunded automatically, and vendors may substitute an equivalent side during disasters)")}
    </>
  );
}

export default function HomePage() {
  const { toast } = useToast();
  const { isOrderBanned } = useAuth();
  const { t } = useI18n();
  // 預約日曆：篩選「這段期間有開放取餐」的店家／品項／計畫，以及取餐日在期間內的轉讓
  const [startDate, setStartDate] = useState(() => todayStr());
  const [endDate, setEndDate] = useState(() => addDaysStr(todayStr(), 6));
  const [pickupDate, setPickupDate] = useState(() => nextAvailablePickup()?.date ?? todayStr());
  const [pickupWindow, setPickupWindow] = useState(() => nextAvailablePickup()?.window ?? DEFAULT_PICKUP_WINDOWS[0]);
  const [selectedSort, setSelectedSort] = useState<SortId>("relevance");
  const [, navigate] = useLocation();
  const [uid, setUid] = useState<string | null>(null);
  const requireLogin = useRequireLogin();
  // 加入計畫確認視窗：開始日期＋時段由消費者選，送伺服器排日期、收款
  const [planDialog, setPlanDialog] = useState<{ plan: MealPlan; vendor: Vendor } | null>(null);
  const [planStartDate, setPlanStartDate] = useState("");
  const [planWindow, setPlanWindow] = useState("");
  const [planAck, setPlanAck] = useState(false);
  const [joiningPlan, setJoiningPlan] = useState(false);
  const [rewardStatuses, setRewardStatuses] = useState<RewardStatus[]>([]);
  const [assistantOpen, setAssistantOpen] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  // 成長獎勵（規格 §8）：公開進度 rewardStatus（只有抽獎券張數與開池狀態，不含營業額）
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "rewardStatus"), (snap) => {
      setRewardStatuses(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as RewardStatus));
    }, () => setRewardStatuses([]));
    return () => unsub();
  }, []);

  // 真實商家清單，「今日推薦鎖定方案」跟「合作店家與計畫」都要用（各自的
  // 品項/方案是分開的子集合查詢，商家本身只查一次）。
  const { data: vendors = [] } = useVendors();

  // 今日推薦鎖定方案（單點型）——真實 menu_items，早鳥折扣依 pickupDate 現算
  // （跟左側「早鳥預約折扣」說明欄位同一套 web/src/lib/pricing.ts 規則）。
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

  // 合作店家與計畫——真實 vendors + 各自的 meal_plans。
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

  // 同學轉讓保底專區——真實 locks，跟 TransferMarketPage.tsx 同一套查詢慣例
  // （vendor_id+created_at 索引，status 篩選交給前端做）。真實 Lock 沒有「原價/
  // 轉讓價」兩個價格（平台不經手轉讓價），也沒有賣家姓名，卡片改顯示唯一的
  // locked_price + resale_deadline 倒數。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // 所有商家的轉讓中鎖定。只用 status 單一等值（自動索引），排序交給前端，
  // 不另外要求 status+created_at 複合索引；firestore.rules 也要求查詢帶 status 才能公開讀。
  const { data: transfers = [] } = useQuery({
    queryKey: ["homeTransferPreview"],
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, "locks"), where("status", "==", "for_resale"), limit(200))
      );
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

  const rangeDates = useMemo(() => {
    if (!startDate || !endDate || endDate < startDate) return [];
    const dates: string[] = [];
    for (let d = startDate; d <= endDate && dates.length < MAX_RANGE_DAYS; d = addDaysStr(d, 1)) dates.push(d);
    return dates;
  }, [startDate, endDate]);
  const rangeInvalid = rangeDates.length === 0;
  // 頂部列選的地區也一起篩（店家地址），跟預約日曆疊加
  const area = useSelectedArea();
  const openInRange = (vendor: Vendor) =>
    vendorInArea(vendor, area) && rangeDates.some((d) => openWindowsOn(vendor, d).length > 0);

  const sortedMealCards = useMemo(() => {
    const cards = lockMealCards.filter(({ vendor }) => openInRange(vendor));
    const earliest = (v: Vendor) => nextAvailablePickup(v)?.date ?? "9999-12-31";
    const rating = (v: Vendor) => vendorRatings.get(v.id)?.average ?? -1;
    if (selectedSort === "earliest") cards.sort((a, b) => earliest(a.vendor).localeCompare(earliest(b.vendor)));
    if (selectedSort === "price") cards.sort((a, b) => applyEarlyBirdPrice(a.item.price, pickupDate).lockedPrice - applyEarlyBirdPrice(b.item.price, pickupDate).lockedPrice);
    if (selectedSort === "rating") cards.sort((a, b) => rating(b.vendor) - rating(a.vendor));
    return cards;
  }, [lockMealCards, rangeDates, area, selectedSort, vendorRatings, pickupDate]);

  // 依商家分組（「哪些店家有什麼」），避免每個品項各自一張大圖卡片排成一片、太雜亂；
  // 商家順序沿用 sortedMealCards 已經排好的順序（第一次出現該商家的位置）。
  const vendorMealGroups = useMemo(() => {
    const groups: { vendor: Vendor; items: MenuItem[] }[] = [];
    const index = new Map<string, number>();
    for (const { item, vendor } of sortedMealCards) {
      let i = index.get(vendor.id);
      if (i === undefined) {
        i = groups.length;
        index.set(vendor.id, i);
        groups.push({ vendor, items: [] });
      }
      groups[i].items.push(item);
    }
    return groups;
  }, [sortedMealCards]);

  const visiblePlanGroups = useMemo(() => {
    const groups = vendorPlanGroups.filter((g) => {
      const vendor = vendors.find((v) => v.id === g.vendorId);
      return vendor ? openInRange(vendor) : false;
    });
    if (selectedSort === "rating") {
      groups.sort((a, b) => (vendorRatings.get(b.vendorId)?.average ?? -1) - (vendorRatings.get(a.vendorId)?.average ?? -1));
    }
    return groups;
  }, [vendorPlanGroups, vendors, rangeDates, area, selectedSort, vendorRatings]);

  const visibleTransfers = transfers
    .filter((t) => !area || vendorInArea(vendors.find((v) => v.id === t.vendor_id), area))
    .filter((t) => rangeInvalid || (t.pickup_date >= rangeDates[0] && t.pickup_date <= rangeDates[rangeDates.length - 1]));

  // 便當要選配菜、加減飯，帶著左側選好的日期時段到品項頁組便當再加入購物車（規格 §4）
  function openItem(item: MenuItem, vendor: Vendor) {
    if (!openWindowsOn(vendor, pickupDate).includes(pickupWindow)) {
      toast({
        title: t("這家店這個時段不開放預購", "This vendor doesn't take pre-orders for that slot"),
        description: vendorClosedReason(vendor, pickupDate) ?? t("可能已截單，請改選其他日期，或到品項頁選這家店的時段。", "It may be past cutoff — pick another date, or choose a slot on the item page."),
      });
    }
    setPreferredPickup({ date: pickupDate, window: pickupWindow });
    navigate(`/item/${item.id}`);
  }

  // 「計畫型」（訂閱制多日方案）沒有另外的 plan/subscription collection——付款
  // 成功後 confirmLinePayPayment 一次寫入 N 筆 locks（plan_id＝這張訂單 id）。
  // 2026-09-28 起改走伺服器 createPlanLinePayReservation：原本前端直接寫 locks，
  // 不經付款、固定 12:00-13:00，也不看商家時段／公休／份數上限。
  function openPlanDialog(vendorId: string, plan: MealPlan) {
    if (!requireLogin() || !uid) return;
    if (isOrderBanned) {
      toast({ title: t("目前無法加入計畫", "Can't join a plan right now"), description: bannedHint(), variant: "destructive" });
      return;
    }
    const vendor = vendors.find((v) => v.id === vendorId);
    if (!vendor) return;
    const next = nextAvailablePickup(vendor);
    setPlanStartDate(next?.date ?? todayStr());
    setPlanWindow(next?.window ?? DEFAULT_PICKUP_WINDOWS[0]);
    setPlanAck(false);
    setPlanDialog({ plan, vendor });
  }

  async function handleJoinPlan(plan: MealPlan) {
    setJoiningPlan(true);
    try {
      const fn = httpsCallable(functions, "createPlanLinePayReservation");
      const result = await fn({ plan_id: plan.id, start_date: planStartDate, pickup_window: planWindow });
      const { payment_url: paymentUrl } = result.data as { order_id: string; payment_url: string };
      window.location.href = paymentUrl;
    } catch (err) {
      // 伺服器的錯誤訊息已經是白話（封鎖、額滿、公休等），直接顯示
      toast({ title: t("加入計畫失敗", "Couldn't join the plan"), description: (err as Error).message, variant: "destructive" });
      setJoiningPlan(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader active="plans" />
      <GrowthRewardTicker />

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 flex flex-col lg:flex-row gap-6">
        {/* ── 左側：計畫工具箱 ── */}
        <aside className="lg:w-72 shrink-0 space-y-4">
          <h2 className="font-heading text-2xl font-semibold">{t("計畫工具箱", "Planner")}</h2>

          {/* 對話式預購助理（AI）：用一句話找符合條件、還有名額的預購 */}
          <button
            type="button"
            onClick={() => setAssistantOpen(true)}
            className="w-full text-left bg-card rounded-2xl border border-ink p-4 flex gap-3 items-center hover:border-primary transition-colors"
          >
            <Bot className="w-8 h-8 text-primary shrink-0" />
            <span>
              <span className="block text-sm font-semibold">{t("問問預購助理", "Ask the meal assistant")}</span>
              <span className="block text-xs text-muted-foreground">{t("「下週一到五中午，預算 120，不吃牛」", "\"Weekday lunches next week, under NT$120, no beef\"")}</span>
            </span>
          </button>
          <ShoppingAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} />

          <div className="bg-card rounded-2xl border border-ink p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-primary" /> {t("預約日曆", "Date range")}
            </h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1" htmlFor="home-range-start">{t("開始日期", "From")}</label>
              <Input
                id="home-range-start"
                type="date"
                value={startDate}
                min={todayStr()}
                max={maxPickupDateStr()}
                onChange={e => setStartDate(e.target.value)}
                className="h-10"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1" htmlFor="home-range-end">{t("結束日期", "To")}</label>
              <Input
                id="home-range-end"
                type="date"
                value={endDate}
                min={startDate}
                max={maxPickupDateStr()}
                onChange={e => setEndDate(e.target.value)}
                className="h-10"
              />
            </div>
            <p className="text-xs text-center text-muted-foreground pt-1 border-t border-border">
              {rangeInvalid ? t("結束日期要在開始日期之後", "The end date must be after the start date") : t("只顯示這段期間有開放取餐的店家與轉讓", "Only vendors and transfers with pickups in this range are shown")}
            </p>
            {area && (
              <p className="text-xs text-center text-muted-foreground">
                {t("地區：", "Area: ")}{areaLabel(area)}{" "}
                <button type="button" className="text-primary underline" onClick={() => setSelectedArea(null)}>{t("清除", "Clear")}</button>
              </p>
            )}
          </div>

          <div className="bg-card rounded-2xl border border-ink p-4 space-y-3">
            <h3 className="text-sm font-semibold">{t("取餐時段", "Pickup time")}</h3>
            <label className="text-xs text-muted-foreground block -mt-1">{t("單點型鎖定用，選一個日期跟時段", "For single meals — choose a date and time")}</label>
            <PickupPicker
              date={pickupDate}
              window={pickupWindow}
              onDateChange={setPickupDate}
              onWindowChange={setPickupWindow}
              uid={uid}
            />
          </div>

          <div className="bg-card rounded-2xl border border-ink p-4 space-y-3">
            <h3 className="text-sm font-semibold">{t("早鳥預約折扣", "Early-bird discounts")}</h3>
            <div className="space-y-2.5 text-sm">
              {VISIBLE_EARLY_BIRD_TIERS.map((tier, i) => {
                const Icon = EARLY_BIRD_ICONS[i] ?? Rocket;
                return (
                  <div key={tier.minDays} className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 text-primary shrink-0" />
                    <span className="flex-1 text-muted-foreground">{tierRangeText(tier)}</span>
                    <span className="font-heading text-base font-semibold">{discountText(tier.discountPercent)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-ink p-4 space-y-2.5">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-primary" /> {t("成長獎勵抽獎", "Growth reward draw")}
            </h3>
            <p className="text-xs text-muted-foreground">{t("每累計實付 100 元一張抽獎券，店家每週拿營業額 10% 當回饋池，滿 100 張開獎、人人有獎。", "Every NT$100 you pay earns a ticket. Vendors put 10% of weekly revenue into a pool — 100 tickets opens the draw, and everyone wins.")}</p>
            {rewardStatuses.slice(0, 5).map((st) => (
              <div key={st.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{st.vendor_name || loc(vendors.find((v) => v.id === st.id), "name")}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {st.pool_open ? t("開獎中", "Draw open") : t(`再 ${st.amount_to_open} 元開獎`, `NT$${st.amount_to_open} to open`)}
                </span>
              </div>
            ))}
            <Button asChild size="sm" variant="outline" className="w-full"><Link href="/rewards">{t("我的抽獎券與折價券", "My tickets & coupons")}</Link></Button>
          </div>

          <div className="bg-card rounded-2xl border border-ink p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <SlidersHorizontal className="w-4 h-4 text-primary" /> {t("進階篩選", "Filters")}
            </h3>
            <p className="text-xs font-semibold text-muted-foreground">{t("排序依", "Sort by")}</p>
            <div className="space-y-1.5">
              {SORT_OPTIONS.map(opt => (
                <label key={opt.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="sortBy"
                    checked={selectedSort === opt.id}
                    onChange={() => setSelectedSort(opt.id)}
                    className="accent-primary w-4 h-4"
                  />
                  <span className={`text-sm ${selectedSort === opt.id ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                    {t(opt.label, opt.labelEn)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </aside>

        {/* ── 右側：主內容 ── */}
        <main className="flex-1 min-w-0 space-y-8">
          {/* 今日推薦方案（單點型）——改成依商家分組的清單，取代原本一格一張大圖卡片
              （每個品項都要放大圖、徽章、價格，排成一片太雜亂），改成「哪些店家有什麼」：
              一家店一張卡片，底下用一行一行列出品項名稱＋價格＋按鈕。 */}
          <section className="space-y-4">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground border border-ink">{t("單點型", "Single meal")}</span>
                <h3 className="font-heading text-2xl font-semibold">{t("今日推薦方案", "Today's picks")}</h3>
              </div>
              <span className="text-sm text-muted-foreground font-semibold">{pickupDate}・{pickupWindow}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {vendorMealGroups.length === 0 && (
                <p className="text-sm text-muted-foreground md:col-span-2">{t("這段期間沒有開放預購的品項，試著調整左側的預約日曆。", "Nothing is open for pre-order in this range — try adjusting the dates on the left.")}</p>
              )}
              {vendorMealGroups.map(({ vendor, items }) => (
                <article key={vendor.id} className="bg-card rounded-2xl border border-ink p-4">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h4 className="font-heading text-lg font-semibold">{loc(vendor, "name")}</h4>
                    {vendor.verified && (
                      <span className="flex items-center gap-1 text-caption font-bold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-ink">
                        <BadgeCheck className="w-3 h-3" /> {t("認證商家", "Verified")}
                      </span>
                    )}
                    {vendor.reliability_tone === "stable" && (
                      <span className="flex items-center gap-1 text-caption font-bold px-2 py-0.5 rounded-full bg-secondary text-green-700 border border-ink">
                        <CheckCircle2 className="w-3 h-3" /> {t("履約穩定", "Stable")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground font-semibold mb-2">{t("取餐時段：", "Pickup: ")}{pickupDate}（{pickupWindow}）</p>

                  <div className="divide-y divide-border">
                    {items.map((item) => {
                      const { lockedPrice, discountPercent } = applyEarlyBirdPrice(item.price, pickupDate);
                      return (
                        <div key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-lg bg-secondary shrink-0 overflow-hidden flex items-center justify-center">
                              {item.image ? (
                                <img src={item.image} alt="" loading="lazy" className="w-full h-full object-cover" />
                              ) : (
                                <UtensilsCrossed className="w-4 h-4 text-secondary-foreground/60" strokeWidth={1.75} aria-hidden="true" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{loc(item, "name")}</p>
                              <div>
                                {discountPercent > 0 && <span className="text-xs text-muted-foreground line-through mr-1.5">${item.price}</span>}
                                <span className="font-heading text-lg font-semibold">${lockedPrice}</span>
                              </div>
                            </div>
                          </div>
                          <Button size="sm" variant="outline" onClick={() => openItem(item, vendor)}>
                            {isBento(item) ? t("選配菜", "Choose sides") : t("立即預付", "Prepay")}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          </section>

          {/* 加入計畫確認彈窗——選第一天＋時段、預覽每天的取餐日，確認後前往 LINE Pay */}
          <Dialog open={!!planDialog} onOpenChange={(open) => { if (!open && !joiningPlan) setPlanDialog(null); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              {planDialog && (() => {
                const { plan, vendor } = planDialog;
                const dates = planPickupDates(vendor, planStartDate, planWindow, plan.days);
                return (
                  <>
                    <DialogHeader>
                      <DialogTitle>{loc(plan, "label")}{t("：", ": ")}{loc(plan, "name")}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                      <p className="text-sm text-muted-foreground">
                        {loc(vendor, "name")}・NT$ {plan.price_per_meal} × {plan.days} {t("餐", "meals")} = <strong className="text-foreground">NT$ {plan.price_per_meal * plan.days}</strong>
                      </p>
                      <div>
                        <p className="text-xs font-semibold mb-2">{t("第一天取餐日期與每天的取餐時段", "First pickup date and daily pickup time")}</p>
                        <PickupPicker
                          date={planStartDate}
                          window={planWindow}
                          onDateChange={setPlanStartDate}
                          onWindowChange={setPlanWindow}
                          uid={uid}
                          vendor={vendor}
                        />
                      </div>
                      {dates ? (
                        <div className="p-2.5 rounded-lg bg-muted border border-border text-caption leading-relaxed">
                          <span className="font-semibold">{t("取餐日（遇公休自動順延）：", "Pickup days (skips closing days): ")}</span>
                          {dates.map((d) => d.slice(5).replace("-", "/")).join(t("、", ", "))}
                          <span className="text-muted-foreground">・{t("每天", "daily")} {slotLabel(planWindow)}</span>
                        </div>
                      ) : (
                        <div className="flex gap-1.5 p-2.5 rounded-lg bg-red-50 border border-red-200 text-caption text-red-800">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          {t(`這個開始日期／時段排不滿 ${plan.days} 天（最遠只能預約到下週五），請改選其他日期或時段。`, `This start date and time can't fit ${plan.days} days (bookings go up to next Friday). Please pick another date or time.`)}
                        </div>
                      )}
                      <label className="flex items-start gap-1.5 p-2 rounded-lg bg-muted border border-border cursor-pointer">
                        <Checkbox checked={planAck} onCheckedChange={() => setPlanAck((v) => !v)} className="mt-0.5 shrink-0" />
                        <span className="text-caption leading-relaxed text-muted-foreground">
                          <WaiverText />
                        </span>
                      </label>
                      <div className="flex gap-1.5 p-2 rounded-lg bg-orange-50 border border-orange-200">
                        <AlertTriangle className="w-3.5 h-3.5 text-orange-700 shrink-0 mt-0.5" />
                        <span className="text-caption leading-relaxed text-orange-900">
                          {t("每一天都是獨立的一份，當天沒空可以單獨轉讓或捐為愛心餐；取餐時段結束 30 分鐘仍未取餐，將", "Each day is a separate meal you can transfer or donate on its own. If it isn't picked up 30 min after the window ends, it ")}<strong>{t("轉為愛心餐、開放給需要的人", "becomes a charity meal for someone in need")}</strong>
                        </span>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setPlanDialog(null)} disabled={joiningPlan}>
                        {t("取消", "Cancel")}
                      </Button>
                      <Button disabled={!dates || !planAck || joiningPlan} onClick={() => handleJoinPlan(plan)}>
                        {joiningPlan ? t("前往付款中…", "Redirecting to payment…") : t("確認加入並付款", "Join & pay")}
                      </Button>
                    </DialogFooter>
                  </>
                );
              })()}
            </DialogContent>
          </Dialog>

          {/* 合作店家與計畫 */}
          <section>
            <h3 className="font-heading text-2xl font-semibold mb-3">{t("合作店家與計畫", "Vendors & meal plans")}</h3>
            <div className="space-y-4">
              {visiblePlanGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("這段期間沒有開放取餐的合作店家計畫。", "No vendor plans have pickups in this range.")}</p>
              )}
              {visiblePlanGroups.map(group => (
                <div key={group.vendorId} className="bg-accent rounded-3xl border border-ink p-5 grid grid-cols-1 md:grid-cols-[220px_1fr_1fr] gap-4">
                  {/* 店家資訊 */}
                  <Link href={`/vendor/${group.vendorId}`} className="flex md:flex-col gap-3 hover:opacity-90">
                    {group.vendor.cover_image ? (
                      <img src={group.vendor.cover_image} alt="" loading="lazy" className="w-20 h-20 md:w-full md:h-32 rounded-2xl border border-ink object-cover shrink-0" />
                    ) : (
                      <div className="w-20 h-20 md:w-full md:h-32 rounded-2xl bg-secondary border border-ink flex items-center justify-center shrink-0">
                        <Store className="h-8 w-8 text-secondary-foreground/70" strokeWidth={1.75} aria-hidden="true" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="font-heading text-h3 mb-1 truncate">{loc(group.vendor, "name")}</p>
                      {group.plans.map(p => (
                        <div key={p.id} className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="truncate">{loc(p, "label")}{t("：", ": ")}{loc(p, "name")}</span>
                          {planRatings.get(p.id) ? (
                            <span className="flex items-center gap-0.5 text-amber-500 shrink-0">
                              <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {planRatings.get(p.id)!.average}
                              <span className="text-muted-foreground">（{planRatings.get(p.id)!.count}）</span>
                            </span>
                          ) : (
                            <span className="shrink-0">{t("尚無評分", "No ratings yet")}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </Link>

                  {/* 方案卡片 */}
                  {group.plans.map(plan => (
                    <div key={plan.id} className="bg-card rounded-2xl border border-ink p-4 flex flex-col">
                      <p className="font-heading text-base font-semibold mb-0.5">{loc(plan, "label")}{t("：", ": ")}{loc(plan, "name")}</p>
                      <p className="text-xs text-muted-foreground mb-3">{loc(plan, "description")}</p>
                      <p className="font-heading text-lg font-semibold mb-2">{t(`NT$ ${plan.price_per_meal} / 餐起`, `From NT$ ${plan.price_per_meal} / meal`)}</p>
                      <span className="inline-block w-fit text-xs bg-secondary text-secondary-foreground border border-ink px-2.5 py-0.5 rounded-full mb-3">
                        {t("最快履約：", "Starts: ")}{loc(plan, "fastest_booking")}
                      </span>
                      <Button className="mt-auto w-full text-sm" onClick={() => openPlanDialog(group.vendorId, plan)}>
                        {t("預約加入計畫", "Join this plan")}
                      </Button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          {/* 同學轉讓保底專區（含轉讓優惠橫捲清單，併成同一區塊放最下面）；底色跟轉讓市集橫幅一樣用 logo「飯」字色 */}
          <section className="rounded-3xl p-6 md:p-8 bg-rice text-rice-foreground space-y-5">
            <div className="flex items-center justify-between gap-6 flex-wrap">
              <div className="flex items-center gap-3.5">
                <Repeat className="w-7 h-7 shrink-0" />
                <div>
                  <h3 className="font-heading text-2xl font-semibold mb-1">{t("同學轉讓保底專區", "Classmate transfers")}</h3>
                  <p className="text-sm max-w-xl">
                    {t("臨時去不了？截單後也能安全轉讓給同學；逾時沒人接手會開放 $0 元領取，或直接捐為愛心餐，不浪費一份便當。", "Can't make it? Transfer your meal to a classmate, even after cutoff. Unclaimed transfers open for $0, or donate it as a charity meal — no meal wasted.")}
                  </p>
                </div>
              </div>
              <Link
                href="/marketplace"
                className="shrink-0 text-sm font-bold px-5 py-2.5 rounded-full bg-secondary text-secondary-foreground border border-ink hover:bg-secondary/85 transition-colors"
              >
                {t("前往轉讓市集", "Go to transfers")}
              </Link>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-1">
              {visibleTransfers.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("這段期間目前沒有同學轉讓的餐點。", "No transfers in this range right now.")}</p>
              )}
              {visibleTransfers.map(tr_ => (
                <div key={tr_.id} className="shrink-0 w-64 bg-card text-foreground rounded-2xl p-3 border border-ink">
                  <div className="flex items-center gap-2 mb-2">
                    <img src={avatarUrl(tr_.buyer_uid)} alt="" className="w-6 h-6 rounded-full bg-secondary border border-ink shrink-0" />
                    <span className="text-xs font-medium truncate">{t(`使用者 ${tr_.buyer_uid.slice(-6)} 轉讓`, `Transferred by user ${tr_.buyer_uid.slice(-6)}`)}</span>
                  </div>
                  <p className="text-sm font-semibold line-clamp-1 mb-2">{loc(tr_, "item_name")}</p>
                  <div className="flex items-baseline gap-1.5 mb-1">
                    <span className="font-heading text-base font-semibold">{t("轉讓價", "Price")} ${tr_.locked_price}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1.5 mt-1.5 border-t border-border">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {(tr_ as any).resale_deadline?.toDate ? formatResaleCountdown((tr_ as any).resale_deadline.toDate(), now) : "—"}
                    </span>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {loc(vendors.find((v) => v.id === tr_.vendor_id), "name") || "—"}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

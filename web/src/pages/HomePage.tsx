import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  collection, doc, getDocs, limit, onSnapshot, orderBy, query, where,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useAuth } from "@/hooks/useAuth";
import { httpsCallable } from "firebase/functions";
import {
  Clock, CalendarDays, Rocket, Star, User, MapPin, Trophy,
  ShieldCheck, Bell, BadgeCheck, CheckCircle2, AlertTriangle, Repeat, SlidersHorizontal, Store, UtensilsCrossed } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import GrowthRewardTicker from "@/components/GrowthRewardTicker";
import { auth, db, functions } from "@/lib/firebase";
import type { Vendor, MenuItem, MealPlan, Lock } from "@/types";
import { summarizeRatings, useReviews } from "@/hooks/useReviews";
import { applyEarlyBirdPrice } from "@/lib/pricing";
import { addDaysStr, DEFAULT_PICKUP_WINDOWS, nextAvailablePickup, openWindowsOn, planPickupDates, slotLabel, todayStr, vendorClosedReason } from "@/lib/pickupSlots";
import PickupPicker from "@/components/PickupPicker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useVendors } from "@/hooks/useVendors";

const BANNED_HINT = "您的帳號因多次未取餐已被限制下單，請至會員中心提交解封申訴";
const GROWTH_TIER_LABEL: Record<number, string> = { 80: "8折", 60: "6折", 50: "5折", 30: "3折", 10: "1折", 0: "整份 0 元" };

// 取餐時段清單在 lib/pickupSlots.ts（pickup_window 用 ASCII 連字號，跟
// discount_explanations 的 cacheKeyFor()/其他真實 locks 一致）。

function formatResaleCountdown(deadline: Date, now: number): string {
  const diffMin = Math.round((deadline.getTime() - now) / 60000);
  if (diffMin <= 0) return "已逾期";
  if (diffMin < 60) return `${diffMin} 分後截止`;
  return `${Math.floor(diffMin / 60)} 小時 ${diffMin % 60} 分後截止`;
}

// 首頁模板 — 對應 UI草圖的 Main.dc.html（現在是合併版：原本 PlanSchedule.dc.html
// 的「合作店家與計畫」已經整段併進 Main，這裡也已經做過）。
// 排序只保留有資料能算的：草圖的「距離」沒有位置資料所以拿掉，「最快送達」改成
// 最快可取餐日（平台是自取不外送），評分讀 reviews 的店家平均。
const SORT_OPTIONS = [
  { id: "relevance", label: "相關性" },
  { id: "earliest", label: "最快可取餐" },
  { id: "price", label: "價格低到高" },
  { id: "rating", label: "評分高到低" },
] as const;
type SortId = (typeof SORT_OPTIONS)[number]["id"];

// 預約日曆最多看 31 天，跟取餐日選擇的上限（30 天內）一致
const MAX_RANGE_DAYS = 31;


export default function HomePage() {
  const { toast } = useToast();
  const { isOrderBanned } = useAuth();
  // 預約日曆：篩選「這段期間有開放取餐」的店家／品項／計畫，以及取餐日在期間內的轉讓
  const [startDate, setStartDate] = useState(() => todayStr());
  const [endDate, setEndDate] = useState(() => addDaysStr(todayStr(), 6));
  const [pickupDate, setPickupDate] = useState(() => nextAvailablePickup()?.date ?? todayStr());
  const [pickupWindow, setPickupWindow] = useState(() => nextAvailablePickup()?.window ?? DEFAULT_PICKUP_WINDOWS[0]);
  const [selectedSort, setSelectedSort] = useState<SortId>("relevance");
  const [waiverAck, setWaiverAck] = useState<Record<string, boolean>>({});
  const [lockingMealId, setLockingMealId] = useState<string | null>(null);
  const [lockDialogItem, setLockDialogItem] = useState<{ item: MenuItem; vendor: Vendor } | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const requireLogin = useRequireLogin();
  // 加入計畫確認視窗：開始日期＋時段由消費者選，送伺服器排日期、收款
  const [planDialog, setPlanDialog] = useState<{ plan: MealPlan; vendor: Vendor } | null>(null);
  const [planStartDate, setPlanStartDate] = useState("");
  const [planWindow, setPlanWindow] = useState("");
  const [planAck, setPlanAck] = useState(false);
  const [joiningPlan, setJoiningPlan] = useState(false);
  const [growthUnlockedIds, setGrowthUnlockedIds] = useState<string[]>([]);
  const [drawingVendorId, setDrawingVendorId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  // payouts（營收金額）只有管理員／店主能讀，消費者端改讀公開的
  // growth_rewards.unlocked_milestones——撥款結算時由 Functions syncGrowthUnlock 更新，
  // 只寫達到哪些門檻，不寫金額。真正能不能抽還是 drawGrowthReward 伺服器端再驗一次。
  // 每家商家一份 growth_rewards/{vendorId}，列出所有已達 tier1 的商家。
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "growth_rewards"), (snap) => {
      setGrowthUnlockedIds(
        snap.docs
          .filter((d) => ((d.data().unlocked_milestones as string[] | undefined) ?? []).includes("tier1"))
          .map((d) => d.id)
      );
    });
    return () => unsub();
  }, []);

  async function handleDrawGrowthReward(vendorId: string) {
    if (!requireLogin()) return;
    setDrawingVendorId(vendorId);
    try {
      const fn = httpsCallable(functions, "drawGrowthReward");
      const result = await fn({ vendor_id: vendorId });
      const pricePercent = (result.data as { price_percent: number }).price_percent;
      const label = GROWTH_TIER_LABEL[pricePercent] ?? `${pricePercent}%`;
      toast({ title: "抽獎結果", description: `恭喜抽中 ${label}！` });
    } catch (err) {
      toast({ title: "抽獎失敗", description: (err as Error).message, variant: "destructive" });
    } finally {
      setDrawingVendorId(null);
    }
  }

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
      const groups: { vendorId: string; vendorName: string; plans: MealPlan[] }[] = [];
      for (const v of vendors) {
        const snap = await getDocs(query(collection(db, "meal_plans"), where("vendor_id", "==", v.id)));
        const plans = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MealPlan);
        if (plans.length > 0) groups.push({ vendorId: v.id, vendorName: v.name, plans });
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
  const openInRange = (vendor: Vendor) => rangeDates.some((d) => openWindowsOn(vendor, d).length > 0);

  const sortedMealCards = useMemo(() => {
    const cards = lockMealCards.filter(({ vendor }) => openInRange(vendor));
    const earliest = (v: Vendor) => nextAvailablePickup(v)?.date ?? "9999-12-31";
    const rating = (v: Vendor) => vendorRatings.get(v.id)?.average ?? -1;
    if (selectedSort === "earliest") cards.sort((a, b) => earliest(a.vendor).localeCompare(earliest(b.vendor)));
    if (selectedSort === "price") cards.sort((a, b) => applyEarlyBirdPrice(a.item.price, pickupDate).lockedPrice - applyEarlyBirdPrice(b.item.price, pickupDate).lockedPrice);
    if (selectedSort === "rating") cards.sort((a, b) => rating(b.vendor) - rating(a.vendor));
    return cards;
  }, [lockMealCards, rangeDates, selectedSort, vendorRatings, pickupDate]);

  const visiblePlanGroups = useMemo(() => {
    const groups = vendorPlanGroups.filter((g) => {
      const vendor = vendors.find((v) => v.id === g.vendorId);
      return vendor ? openInRange(vendor) : false;
    });
    if (selectedSort === "rating") {
      groups.sort((a, b) => (vendorRatings.get(b.vendorId)?.average ?? -1) - (vendorRatings.get(a.vendorId)?.average ?? -1));
    }
    return groups;
  }, [vendorPlanGroups, vendors, rangeDates, selectedSort, vendorRatings]);

  const visibleTransfers = rangeInvalid
    ? transfers
    : transfers.filter((t) => t.pickup_date >= rangeDates[0] && t.pickup_date <= rangeDates[rangeDates.length - 1]);

  async function handleLockMeal(item: MenuItem, vendor: Vendor) {
    if (!requireLogin() || !uid) return;
    // 首頁左側的時段是先選的、所有店共用；下單前確認這家店這天有開這個時段
    if (!openWindowsOn(vendor, pickupDate).includes(pickupWindow)) {
      toast({
        title: "這家店這個時段不開放預購",
        description: vendorClosedReason(vendor, pickupDate) ?? "請到左側改選其他日期或時段，或從商家頁點餐選這家店的時段。",
        variant: "destructive",
      });
      return;
    }
    setLockingMealId(item.id);
    try {
      // 價格由伺服器依 menu_items 重算，只送品項 id 跟取餐時間
      const fn = httpsCallable(functions, "createLinePayReservation");
      const result = await fn({
        menu_item_id: item.id,
        pickup_window: pickupWindow,
        pickup_date: pickupDate,
      });
      const { payment_url: paymentUrl } = result.data as { order_id: string; payment_url: string };
      window.location.href = paymentUrl;
    } catch (err) {
      toast({ title: "前往付款失敗", description: (err as Error).message, variant: "destructive" });
      setLockingMealId(null);
    }
  }

  // 「計畫型」（訂閱制多日方案）沒有另外的 plan/subscription collection——付款
  // 成功後 confirmLinePayPayment 一次寫入 N 筆 locks（plan_id＝這張訂單 id）。
  // 2026-09-28 起改走伺服器 createPlanLinePayReservation：原本前端直接寫 locks，
  // 不經付款、固定 12:00-13:00，也不看商家時段／公休／份數上限。
  function openPlanDialog(vendorId: string, plan: MealPlan) {
    if (!requireLogin() || !uid) return;
    if (isOrderBanned) {
      toast({ title: "目前無法加入計畫", description: BANNED_HINT, variant: "destructive" });
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
      toast({ title: "加入計畫失敗", description: (err as Error).message, variant: "destructive" });
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
          <h2 className="font-heading text-2xl font-semibold">計畫工具箱</h2>

          <div className="bg-card rounded-2xl border border-ink p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-primary" /> 預約日曆
            </h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1" htmlFor="home-range-start">開始日期</label>
              <Input
                id="home-range-start"
                type="date"
                value={startDate}
                min={todayStr()}
                onChange={e => setStartDate(e.target.value)}
                className="h-10"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1" htmlFor="home-range-end">結束日期</label>
              <Input
                id="home-range-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={e => setEndDate(e.target.value)}
                className="h-10"
              />
            </div>
            <p className="text-xs text-center text-muted-foreground pt-1 border-t border-border">
              {rangeInvalid ? "結束日期要在開始日期之後" : "只顯示這段期間有開放取餐的店家與轉讓"}
            </p>
          </div>

          <div className="bg-card rounded-2xl border border-ink p-4 space-y-3">
            <h3 className="text-sm font-semibold">取餐時段</h3>
            <label className="text-xs text-muted-foreground block -mt-1">單點型鎖定用，選一個日期跟時段</label>
            <PickupPicker
              date={pickupDate}
              window={pickupWindow}
              onDateChange={setPickupDate}
              onWindowChange={setPickupWindow}
              uid={uid}
            />
          </div>

          <div className="bg-green-50 border border-green-200 rounded-2xl p-3.5 flex gap-2.5">
            <ShieldCheck className="w-4 h-4 text-green-700 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-green-800">保障說明：店家若未如期出餐，全額退款並加贈 20 點回饋金。</p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 flex gap-2.5">
            <Bell className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-amber-800">取餐提醒：鎖定成功後，我們會在取餐時段開始前推播通知，降低錯過取餐的機率。</p>
          </div>

          <div className="bg-card rounded-2xl border border-ink p-4 space-y-3">
            <h3 className="text-sm font-semibold">早鳥預約折扣</h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-primary shrink-0" />
                <span className="flex-1 text-muted-foreground">預約今天/明天</span>
                <span className="font-heading text-base font-semibold">95折</span>
              </div>
              <div className="flex items-center gap-2.5">
                <CalendarDays className="w-4 h-4 text-primary shrink-0" />
                <span className="flex-1 text-muted-foreground">提前 2-13 天</span>
                <span className="font-heading text-base font-semibold">8折</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Rocket className="w-4 h-4 text-primary shrink-0" />
                <span className="flex-1 text-muted-foreground">提前 14-30 天</span>
                <span className="font-heading text-base font-semibold">7折</span>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-ink p-4 space-y-2.5">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-primary" /> 成長獎勵抽獎
            </h3>
            {growthUnlockedIds.length > 0 ? (
              <>
                <p className="text-xs text-muted-foreground">以下店家已解鎖抽獎，手氣好可以抽到整份 0 元！</p>
                {growthUnlockedIds.map((vendorId) => (
                  <div key={vendorId} className="flex items-center gap-2">
                    <span className="flex-1 text-sm truncate">{vendors.find((v) => v.id === vendorId)?.name ?? "合作店家"}</span>
                    <Button
                      size="sm"
                      disabled={drawingVendorId !== null}
                      onClick={() => handleDrawGrowthReward(vendorId)}
                    >
                      {drawingVendorId === vendorId ? "抽獎中…" : "抽一次"}
                    </Button>
                  </div>
                ))}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">合作店家累積營收還沒達到解鎖門檻，尚無法抽獎。</p>
            )}
          </div>

          <div className="bg-card rounded-2xl border border-ink p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <SlidersHorizontal className="w-4 h-4 text-primary" /> 進階篩選
            </h3>
            <p className="text-xs font-semibold text-muted-foreground">排序依</p>
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
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </aside>

        {/* ── 右側：主內容 ── */}
        <main className="flex-1 min-w-0 space-y-8">
          {/* 今日推薦鎖定方案（單點型） */}
          <section className="space-y-4">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground border border-ink">單點型</span>
                <h3 className="font-heading text-2xl font-semibold">今日推薦鎖定方案</h3>
              </div>
              <span className="text-sm text-muted-foreground font-semibold">{pickupDate}・{pickupWindow}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {sortedMealCards.length === 0 && (
                <p className="text-sm text-muted-foreground md:col-span-3">這段期間沒有開放預購的品項，試著調整左側的預約日曆。</p>
              )}
              {sortedMealCards.map(({ item, vendor }) => {
                const { lockedPrice, discountPercent } = applyEarlyBirdPrice(item.price, pickupDate);
                return (
                  <article key={item.id} className="bg-card rounded-2xl border border-ink overflow-hidden flex flex-col">
                    <div className="relative h-32 bg-secondary border-b border-ink flex items-center justify-center">
                      <UtensilsCrossed className="h-10 w-10 text-secondary-foreground/70" strokeWidth={1.75} aria-hidden="true" />
                      {vendor.verified && (
                        <span className="absolute top-2.5 left-2.5 flex items-center gap-1 text-caption font-bold px-2.5 py-1 rounded-full bg-card text-foreground border border-ink">
                          <BadgeCheck className="w-3 h-3" /> 認證商家
                        </span>
                      )}
                      {vendor.reliability_tone === "stable" && (
                        <span className="absolute top-2.5 right-2.5 flex items-center gap-1 text-caption font-bold px-2.5 py-1 rounded-full bg-card text-green-700 border border-ink">
                          <CheckCircle2 className="w-3 h-3" /> 履約穩定度：穩定
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-2.5 p-4 flex-1">
                      <div>
                        <h4 className="font-heading text-h3 leading-snug">{item.name}</h4>
                        <p className="text-xs text-muted-foreground font-semibold mt-0.5">{vendor.name}・取餐時段：{pickupDate}（{pickupWindow}）</p>
                      </div>

                      <div className="flex items-center justify-between mt-auto pt-1">
                        <div>
                          {discountPercent > 0 && <span className="text-xs text-muted-foreground line-through mr-1.5">原價 ${item.price}</span>}
                          <span className="font-heading text-2xl font-semibold">${lockedPrice}</span>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => setLockDialogItem({ item, vendor })}
                        >
                          立即預付鎖定
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* 立即預付鎖定確認彈窗——折扣說明/消保法聲明/轉讓市集提醒改成點按鈕當下才顯示，不塞在每張卡片上 */}
          <Dialog open={!!lockDialogItem} onOpenChange={(open) => { if (!open) setLockDialogItem(null); }}>
            <DialogContent>
              {lockDialogItem && (() => {
                const { item, vendor } = lockDialogItem;
                const { lockedPrice, discountPercent } = applyEarlyBirdPrice(item.price, pickupDate);
                const hasAcked = !!waiverAck[item.id];
                const isSubmitting = lockingMealId === item.id;
                return (
                  <>
                    <DialogHeader>
                      <DialogTitle>{item.name}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                      <p className="text-sm text-muted-foreground">{vendor.name}・取餐時段：{pickupDate}（{pickupWindow}）・${lockedPrice}</p>

                      <div className="flex gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                        <Star className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5 fill-amber-500" />
                        <p className="text-caption leading-relaxed text-amber-900">
                          {discountPercent > 0
                            ? `提前預付鎖定，換到 ${10 - discountPercent / 10}折早鳥價；全額預付、不可退款但可轉賣過戶。`
                            : "當日鎖定；全額預付、不可退款但可轉賣過戶。"}
                        </p>
                      </div>

                      <label className="flex items-start gap-1.5 p-2 rounded-lg bg-muted border border-border cursor-pointer">
                        <Checkbox
                          checked={hasAcked}
                          onCheckedChange={() => setWaiverAck(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
                          className="mt-0.5 shrink-0"
                        />
                        <span className="text-caption leading-relaxed text-muted-foreground">
                          我了解本商品為現做餐點，依消保法通訊交易解除權合理例外情事適用準則，<strong className="text-foreground">鎖定後不適用 7 天猶豫期</strong>，除商家未履約外恕不接受退款
                        </span>
                      </label>
                      <div className="flex gap-1.5 p-2 rounded-lg bg-orange-50 border border-orange-200">
                        <AlertTriangle className="w-3.5 h-3.5 text-orange-700 shrink-0 mt-0.5" />
                        <span className="text-caption leading-relaxed text-orange-900">
                          取餐時段結束仍未取餐，將<strong>自動開放到轉讓市集、$0 元供人領取</strong>，避免整份浪費
                        </span>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setLockDialogItem(null)} disabled={isSubmitting}>
                        取消
                      </Button>
                      <Button
                        disabled={!hasAcked || isSubmitting}
                        onClick={() => handleLockMeal(item, vendor)}
                      >
                        {isSubmitting ? "前往付款中…" : "確認鎖定並付款"}
                      </Button>
                    </DialogFooter>
                  </>
                );
              })()}
            </DialogContent>
          </Dialog>

          {/* 加入計畫確認彈窗——選第一天＋時段、預覽每天的取餐日，確認後前往 LINE Pay */}
          <Dialog open={!!planDialog} onOpenChange={(open) => { if (!open && !joiningPlan) setPlanDialog(null); }}>
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              {planDialog && (() => {
                const { plan, vendor } = planDialog;
                const dates = planPickupDates(vendor, planStartDate, planWindow, plan.days);
                return (
                  <>
                    <DialogHeader>
                      <DialogTitle>{plan.label}：{plan.name}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-1">
                      <p className="text-sm text-muted-foreground">
                        {vendor.name}・NT$ {plan.price_per_meal} × {plan.days} 餐＝<strong className="text-foreground">NT$ {plan.price_per_meal * plan.days}</strong>
                      </p>
                      <div>
                        <p className="text-xs font-semibold mb-2">第一天取餐日期與每天的取餐時段</p>
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
                          <span className="font-semibold">取餐日（遇公休自動順延）：</span>
                          {dates.map((d) => d.slice(5).replace("-", "/")).join("、")}
                          <span className="text-muted-foreground">・每天 {slotLabel(planWindow)}</span>
                        </div>
                      ) : (
                        <div className="flex gap-1.5 p-2.5 rounded-lg bg-red-50 border border-red-200 text-caption text-red-800">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          這個開始日期／時段排不滿 {plan.days} 天（最遠只能預約 30 天內），請改選其他日期或時段。
                        </div>
                      )}
                      <label className="flex items-start gap-1.5 p-2 rounded-lg bg-muted border border-border cursor-pointer">
                        <Checkbox checked={planAck} onCheckedChange={() => setPlanAck((v) => !v)} className="mt-0.5 shrink-0" />
                        <span className="text-caption leading-relaxed text-muted-foreground">
                          我了解本商品為現做餐點，依消保法通訊交易解除權合理例外情事適用準則，<strong className="text-foreground">鎖定後不適用 7 天猶豫期</strong>，除商家未履約外恕不接受退款
                        </span>
                      </label>
                      <div className="flex gap-1.5 p-2 rounded-lg bg-orange-50 border border-orange-200">
                        <AlertTriangle className="w-3.5 h-3.5 text-orange-700 shrink-0 mt-0.5" />
                        <span className="text-caption leading-relaxed text-orange-900">
                          每一天都是獨立的一份，當天沒空可以單獨轉讓；取餐時段結束仍未取餐，將<strong>自動開放到轉讓市集、$0 元供人領取</strong>
                        </span>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setPlanDialog(null)} disabled={joiningPlan}>
                        取消
                      </Button>
                      <Button disabled={!dates || !planAck || joiningPlan} onClick={() => handleJoinPlan(plan)}>
                        {joiningPlan ? "前往付款中…" : "確認加入並付款"}
                      </Button>
                    </DialogFooter>
                  </>
                );
              })()}
            </DialogContent>
          </Dialog>

          {/* 合作店家與計畫 */}
          <section>
            <h3 className="font-heading text-2xl font-semibold mb-3">合作店家與計畫</h3>
            <div className="space-y-4">
              {visiblePlanGroups.length === 0 && (
                <p className="text-sm text-muted-foreground">這段期間沒有開放取餐的合作店家計畫。</p>
              )}
              {visiblePlanGroups.map(group => (
                <div key={group.vendorId} className="bg-accent rounded-3xl border border-ink p-5 grid grid-cols-1 md:grid-cols-[220px_1fr_1fr] gap-4">
                  {/* 店家資訊 */}
                  <Link href={`/vendor/${group.vendorId}`} className="flex md:flex-col gap-3 hover:opacity-90">
                    <div className="w-20 h-20 md:w-full md:h-32 rounded-2xl bg-secondary border border-ink flex items-center justify-center shrink-0">
                      <Store className="h-8 w-8 text-secondary-foreground/70" strokeWidth={1.75} aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-heading text-h3 mb-1 truncate">{group.vendorName}</p>
                      {group.plans.map(p => (
                        <div key={p.id} className="flex items-center gap-1 text-xs text-muted-foreground">
                          <span className="truncate">{p.label}：{p.name}</span>
                          {planRatings.get(p.id) ? (
                            <span className="flex items-center gap-0.5 text-amber-500 shrink-0">
                              <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {planRatings.get(p.id)!.average}
                              <span className="text-muted-foreground">（{planRatings.get(p.id)!.count}）</span>
                            </span>
                          ) : (
                            <span className="shrink-0">尚無評分</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </Link>

                  {/* 方案卡片 */}
                  {group.plans.map(plan => (
                    <div key={plan.id} className="bg-card rounded-2xl border border-ink p-4 flex flex-col">
                      <p className="font-heading text-base font-semibold mb-0.5">{plan.label}：{plan.name}</p>
                      <p className="text-xs text-muted-foreground mb-3">{plan.description}</p>
                      <p className="font-heading text-lg font-semibold mb-2">NT$ {plan.price_per_meal} / 餐起</p>
                      <span className="inline-block w-fit text-xs bg-secondary text-secondary-foreground border border-ink px-2.5 py-0.5 rounded-full mb-3">
                        最快履約：{plan.fastest_booking}
                      </span>
                      <Button className="mt-auto w-full text-sm" onClick={() => openPlanDialog(group.vendorId, plan)}>
                        預約加入計畫
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
                  <h3 className="font-heading text-2xl font-semibold mb-1">同學轉讓保底專區</h3>
                  <p className="text-sm max-w-xl">
                    臨時去不了？可安全轉讓給同學，全額入袋；逾時沒人接手，系統會自動開放到轉讓市集、$0 元供人領取，不浪費一份鎖定。
                  </p>
                </div>
              </div>
              <Link
                href="/marketplace"
                className="shrink-0 text-sm font-bold px-5 py-2.5 rounded-full bg-secondary text-secondary-foreground border border-ink hover:bg-secondary/85 transition-colors"
              >
                前往轉讓市集
              </Link>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-1">
              {visibleTransfers.length === 0 && (
                <p className="text-sm text-muted-foreground">這段期間目前沒有同學轉讓的餐點。</p>
              )}
              {visibleTransfers.map(t => (
                <div key={t.id} className="shrink-0 w-64 bg-card text-foreground rounded-2xl p-3 border border-ink">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-secondary border border-ink flex items-center justify-center shrink-0">
                      <User className="w-3.5 h-3.5 text-secondary-foreground" />
                    </div>
                    <span className="text-xs font-medium truncate">使用者 {t.buyer_uid.slice(-6)} 轉讓</span>
                  </div>
                  <p className="text-sm font-semibold line-clamp-1 mb-2">{t.item_name}</p>
                  <div className="flex items-baseline gap-1.5 mb-1">
                    <span className="font-heading text-base font-semibold">轉讓價 ${t.locked_price}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1.5 mt-1.5 border-t border-border">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {(t as any).resale_deadline?.toDate ? formatResaleCountdown((t as any).resale_deadline.toDate(), now) : "—"}
                    </span>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> 仁和雅咖啡</span>
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

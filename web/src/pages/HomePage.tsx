import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, where, writeBatch,
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
import { applyEarlyBirdPrice } from "@/lib/pricing";
import { DEFAULT_PICKUP_WINDOWS, nextAvailablePickup, openWindowsOn, todayStr, vendorClosedReason } from "@/lib/pickupSlots";
import PickupPicker from "@/components/PickupPicker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

const GROWTH_VENDOR_ID = "cafe-renheya-demo";
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
// 的「合作店家與計畫」已經整段併進 Main，這裡也已經做過）。地址／語言選單目前
// 只是靜態外觀（見 MarketplaceHeader）。
const SORT_OPTIONS = [
  { id: "relevance", label: "相關性" },
  { id: "fastest", label: "最快送達" },
  { id: "distance", label: "距離" },
  { id: "rating", label: "評分" },
] as const;


export default function HomePage() {
  const { toast } = useToast();
  const { isOrderBanned } = useAuth();
  const [startDate, setStartDate] = useState("2026-09-22");
  const [endDate, setEndDate] = useState("2026-09-26");
  const [pickupDate, setPickupDate] = useState(() => nextAvailablePickup()?.date ?? todayStr());
  const [pickupWindow, setPickupWindow] = useState(() => nextAvailablePickup()?.window ?? DEFAULT_PICKUP_WINDOWS[0]);
  const [selectedSort, setSelectedSort] = useState<string>("relevance");
  const [waiverAck, setWaiverAck] = useState<Record<string, boolean>>({});
  const [lockingMealId, setLockingMealId] = useState<string | null>(null);
  const [lockDialogItem, setLockDialogItem] = useState<{ item: MenuItem; vendor: Vendor } | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const requireLogin = useRequireLogin();
  const [joiningPlanId, setJoiningPlanId] = useState<string | null>(null);
  const [joinedPlanIds, setJoinedPlanIds] = useState<Record<string, boolean>>({});
  const [growthUnlocked, setGrowthUnlocked] = useState(false);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  // payouts（營收金額）只有管理員／店主能讀，消費者端改讀公開的
  // growth_rewards.unlocked_milestones——撥款結算時由 Functions syncGrowthUnlock 更新，
  // 只寫達到哪些門檻，不寫金額。真正能不能抽還是 drawGrowthReward 伺服器端再驗一次。
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "growth_rewards", GROWTH_VENDOR_ID), (snap) => {
      const unlocked: string[] = snap.data()?.unlocked_milestones ?? [];
      setGrowthUnlocked(unlocked.includes("tier1"));
    });
    return () => unsub();
  }, []);

  async function handleDrawGrowthReward() {
    if (!requireLogin()) return;
    setDrawing(true);
    try {
      const fn = httpsCallable(functions, "drawGrowthReward");
      const result = await fn({ vendor_id: GROWTH_VENDOR_ID });
      const pricePercent = (result.data as { price_percent: number }).price_percent;
      const label = GROWTH_TIER_LABEL[pricePercent] ?? `${pricePercent}%`;
      toast({ title: "抽獎結果", description: `恭喜抽中 ${label}！` });
    } catch (err) {
      toast({ title: "抽獎失敗", description: (err as Error).message, variant: "destructive" });
    } finally {
      setDrawing(false);
    }
  }

  // 真實商家清單，「今日推薦鎖定方案」跟「合作店家與計畫」都要用（各自的
  // 品項/方案是分開的子集合查詢，商家本身只查一次）。
  const { data: vendors = [] } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const snap = await getDocs(collection(db, "vendors"));
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as Vendor)
        .filter((v) => v.status !== "disabled");
    },
    staleTime: 15 * 60 * 1000,
  });

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

  const { data: transfers = [] } = useQuery({
    queryKey: ["homeTransferPreview"],
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, "locks"), where("vendor_id", "==", GROWTH_VENDOR_ID), where("status", "==", "for_resale"), orderBy("created_at", "desc"), limit(50))
      );
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Lock)
        .filter((l) => l.status === "for_resale")
        .slice(0, 6);
    },
    staleTime: 2 * 60 * 1000,
  });

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

  // 「計畫型」（訂閱制多日方案）沒有另外的 plan/subscription collection——加入
  // 計畫當下直接一次寫入 N 筆真實 locks（同一個 plan_id 串起來），不用排程
  // Cloud Function 每天生一筆，所以不受 Blaze 卡住。之後在「我的餐點」會依
  // pickup_date 自動分組出現。
  async function handleJoinPlan(group: { vendorId: string; vendorName: string; plans: MealPlan[] }, plan: MealPlan) {
    if (!requireLogin() || !uid) return;
    if (isOrderBanned) {
      toast({ title: "目前無法加入計畫", description: BANNED_HINT, variant: "destructive" });
      return;
    }
    const planKey = `${group.vendorId}-${plan.id}`;
    setJoiningPlanId(planKey);
    try {
      const batch = writeBatch(db);
      const planLabel = `${plan.label}：${plan.name}`;
      for (let day = 1; day <= plan.days; day++) {
        const pickupDate = new Date();
        pickupDate.setDate(pickupDate.getDate() + day);
        const ref = doc(collection(db, "locks"));
        batch.set(ref, {
          vendor_id: group.vendorId,
          item_name: `${planLabel}・第${day}/${plan.days}天`,
          pickup_window: "12:00-13:00",
          pickup_date: pickupDate.toISOString().slice(0, 10),
          discount_percent: 0,
          resellable: true,
          locked_price: plan.price_per_meal,
          status: "locked",
          buyer_uid: uid,
          created_at: serverTimestamp(),
          plan_id: planKey,
          plan_label: planLabel,
        });
      }
      await batch.commit();
      setJoinedPlanIds(prev => ({ ...prev, [planKey]: true }));
      toast({ title: "已加入計畫", description: `${group.vendorName} · ${plan.name}・已生成 ${plan.days} 筆鎖定，可在「我的餐點」查看。` });
    } catch (err) {
      // 登入期間才被封鎖的話 isOrderBanned 還是舊值，會一路寫到 firestore.rules
      // 才被擋，這時錯誤是看不懂的 PERMISSION_DENIED 原文，換成白話提示。
      const denied = (err as { code?: string }).code === "permission-denied";
      toast({ title: "加入計畫失敗", description: denied ? BANNED_HINT : (err as Error).message, variant: "destructive" });
    } finally {
      setJoiningPlanId(null);
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
              <label className="text-xs text-muted-foreground block mb-1">開始日期</label>
              <Input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="h-10"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">結束日期</label>
              <Input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="h-10"
              />
            </div>
            <p className="text-xs text-center text-muted-foreground pt-1 border-t border-border">最快下週一供餐</p>
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
            {growthUnlocked ? (
              <>
                <p className="text-xs text-muted-foreground">校園咖啡廳已解鎖抽獎，手氣好可以抽到整份 0 元！</p>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={drawing}
                  onClick={handleDrawGrowthReward}
                >
                  {drawing ? "抽獎中…" : "抽一次"}
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">校園咖啡廳累積合作營收還沒達到解鎖門檻，尚無法抽獎。</p>
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
              {lockMealCards.map(({ item, vendor }) => {
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

          {/* 合作店家與計畫 */}
          <section>
            <h3 className="font-heading text-2xl font-semibold mb-3">合作店家與計畫</h3>
            <div className="space-y-4">
              {vendorPlanGroups.map(group => (
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
                          <span className="flex items-center gap-0.5 text-amber-500 shrink-0">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" /> {p.rating}
                          </span>
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
                      <Button
                        className="mt-auto w-full text-sm"
                        disabled={joiningPlanId === `${group.vendorId}-${plan.id}` || !!joinedPlanIds[`${group.vendorId}-${plan.id}`]}
                        onClick={() => handleJoinPlan(group, plan)}
                      >
                        {joinedPlanIds[`${group.vendorId}-${plan.id}`]
                          ? "已加入計畫"
                          : joiningPlanId === `${group.vendorId}-${plan.id}`
                          ? "處理中…"
                          : "預約加入計畫"}
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
              {transfers.map(t => (
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

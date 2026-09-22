import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { collection, doc, onSnapshot, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import {
  Clock, CalendarDays, Rocket, Star, User, MapPin, Trophy,
  ShieldCheck, Bell, BadgeCheck, CheckCircle2, AlertTriangle, Repeat, SlidersHorizontal,
} from "lucide-react";
import { mockMealPlanTransfers, mockVendorMealPlans, mockLockMeals, type MealPlanOption, type VendorMealPlanGroup } from "@/lib/mockData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import GrowthRewardTicker from "@/components/GrowthRewardTicker";
import { auth, db, functions } from "@/lib/firebase";

const GROWTH_VENDOR_ID = "cafe-renheya-demo";
const GROWTH_UNLOCK_THRESHOLD = 200000;
const GROWTH_TIER_LABEL: Record<number, string> = { 80: "8折", 60: "6折", 50: "5折", 30: "3折", 10: "1折", 0: "整份 0 元" };

// 首頁模板 — 對應 UI草圖的 Main.dc.html（現在是合併版：原本 PlanSchedule.dc.html
// 的「合作店家與計畫」已經整段併進 Main，這裡也已經做過；這次新增的是 Main 上半部
// 的「今日推薦鎖定方案」單點型卡片區，見下面 mockLockMeals 段落）。
// TODO(firebase): 下方 useQuery 讀的是 mockData.ts 的假資料，之後接
// Firestore 時把 queryFn 換掉即可；地址／語言選單目前只是靜態外觀（見 MarketplaceHeader）。
const SORT_OPTIONS = [
  { id: "relevance", label: "相關性" },
  { id: "fastest", label: "最快送達" },
  { id: "distance", label: "距離" },
  { id: "rating", label: "評分" },
] as const;

const TIME_SLOTS = [
  { id: "slot1", label: "11:30–12:00" },
  { id: "slot2", label: "12:00–12:30" },
  { id: "slot3", label: "12:30–13:00" },
] as const;

export default function HomePage() {
  const { toast } = useToast();
  const [startDate, setStartDate] = useState("2026-09-22");
  const [endDate, setEndDate] = useState("2026-09-26");
  const [pickupDate, setPickupDate] = useState("2026-09-25");
  const [selectedSlot, setSelectedSlot] = useState<string>("slot2");
  const [selectedSort, setSelectedSort] = useState<string>("relevance");
  const [waiverAck, setWaiverAck] = useState<Record<string, boolean>>({});
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const [uid, setUid] = useState<string | null>(null);
  const [joiningPlanId, setJoiningPlanId] = useState<string | null>(null);
  const [joinedPlanIds, setJoinedPlanIds] = useState<Record<string, boolean>>({});
  const [growthRevenue, setGrowthRevenue] = useState(0);
  const [drawing, setDrawing] = useState(false);

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, "payouts"), where("vendor_id", "==", GROWTH_VENDOR_ID)), (snap) => {
      setGrowthRevenue(snap.docs.reduce((sum, d) => sum + (d.data().amount || 0), 0));
    });
    return () => unsub();
  }, []);

  const growthUnlocked = growthRevenue >= GROWTH_UNLOCK_THRESHOLD;

  async function handleDrawGrowthReward() {
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

  const { data: transfers = [] } = useQuery({
    queryKey: ["mealPlanTransfers"],
    queryFn: async () => mockMealPlanTransfers,
    staleTime: 15 * 60 * 1000,
  });

  const { data: vendorPlans = [] } = useQuery({
    queryKey: ["vendorMealPlans"],
    queryFn: async () => mockVendorMealPlans,
    staleTime: 15 * 60 * 1000,
  });

  function handleToggleLock(id: string, title: string) {
    setLocked(prev => {
      const next = !prev[id];
      if (next) {
        toast({ title: "已鎖定", description: `${title}・示意畫面：實際下單需串接 locks collection（參照 /lock 的 ConsumerLockPage）。` });
      }
      return { ...prev, [id]: next };
    });
  }

  // 「計畫型」（訂閱制多日方案）沒有另外的 plan/subscription collection——加入
  // 計畫當下直接一次寫入 N 筆真實 locks（同一個 plan_id 串起來），不用排程
  // Cloud Function 每天生一筆，所以不受 Blaze 卡住。之後在「我的餐點」會依
  // pickup_date 自動分組出現。
  async function handleJoinPlan(group: VendorMealPlanGroup, plan: MealPlanOption) {
    if (!uid) return;
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
          locked_price: plan.pricePerMeal,
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
      toast({ title: "加入計畫失敗", description: (err as Error).message, variant: "destructive" });
    } finally {
      setJoiningPlanId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader active="plans" />
      <GrowthRewardTicker />

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 flex flex-col lg:flex-row gap-6">
        {/* ── 左側：計畫工具箱 ── */}
        <aside className="lg:w-72 shrink-0 space-y-4">
          <h2 className="text-lg font-bold">計畫工具箱</h2>

          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4 text-orange-500" /> 預約日曆
            </h3>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">開始日期</label>
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">結束日期</label>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
            </div>
            <p className="text-xs text-center text-muted-foreground pt-1 border-t border-border">最快下週一供餐</p>
          </div>

          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold">取餐時段</h3>
            <label className="text-xs text-muted-foreground block -mt-1">單點型鎖定用，選一個日期跟時段</label>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">取餐日期</label>
              <input
                type="date"
                value={pickupDate}
                onChange={e => setPickupDate(e.target.value)}
                className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
            </div>
            <div className="space-y-2">
              {TIME_SLOTS.map(slot => (
                <label
                  key={slot.id}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                    selectedSlot === slot.id ? "border-orange-400 bg-orange-50" : "border-border bg-gray-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="pickupSlot"
                    checked={selectedSlot === slot.id}
                    onChange={() => setSelectedSlot(slot.id)}
                    className="accent-orange-500 w-4 h-4"
                  />
                  <span className="text-sm font-medium">{slot.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="bg-green-50 border border-green-200 rounded-xl p-3.5 flex gap-2.5">
            <ShieldCheck className="w-4 h-4 text-green-700 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-green-800">保障說明：店家若未如期出餐，全額退款並加贈 20 點回饋金。</p>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex gap-2.5">
            <Bell className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-xs leading-relaxed text-amber-800">取餐提醒：鎖定成功後，我們會在取餐時段開始前推播通知，降低錯過取餐的機率。</p>
          </div>

          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold">早鳥預約折扣</h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-orange-500 shrink-0" />
                <span className="flex-1 text-muted-foreground">預約今天/明天</span>
                <span className="font-bold text-orange-600">95折</span>
              </div>
              <div className="flex items-center gap-2.5">
                <CalendarDays className="w-4 h-4 text-orange-500 shrink-0" />
                <span className="flex-1 text-muted-foreground">提前 2-13 天</span>
                <span className="font-bold text-orange-600">8折</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Rocket className="w-4 h-4 text-orange-500 shrink-0" />
                <span className="flex-1 text-muted-foreground">提前 14-30 天</span>
                <span className="font-bold text-orange-600">7折</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border p-4 space-y-2.5">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Trophy className="w-4 h-4 text-orange-500" /> 成長獎勵抽獎
            </h3>
            {growthUnlocked ? (
              <>
                <p className="text-xs text-muted-foreground">校園咖啡廳已解鎖抽獎，手氣好可以抽到整份 0 元！</p>
                <Button
                  size="sm"
                  className="w-full bg-brand-navy hover:bg-brand-navy-hover text-white"
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

          <div className="bg-white rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <SlidersHorizontal className="w-4 h-4 text-orange-500" /> 進階篩選
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
                    className="accent-orange-500 w-4 h-4"
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
                <span className="text-xs font-extrabold px-2.5 py-1 rounded-full bg-orange-500 text-white">單點型</span>
                <h3 className="text-lg font-bold">今日推薦鎖定方案</h3>
              </div>
              <span className="text-sm text-muted-foreground font-semibold">校園咖啡廳・09/25（五）</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {mockLockMeals.map(meal => {
                const isLocked = !!locked[meal.id];
                const hasAcked = !!waiverAck[meal.id];
                const ctaDisabled = !isLocked && !hasAcked;
                return (
                  <article key={meal.id} className="bg-white rounded-2xl border border-border overflow-hidden flex flex-col">
                    <div className={`relative h-32 bg-gradient-to-br ${meal.photoFrom} ${meal.photoTo} flex items-center justify-center text-4xl`}>
                      🍱
                      <span className="absolute top-2.5 left-2.5 flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-orange-500 text-white">
                        <BadgeCheck className="w-3 h-3" /> 認證商家
                      </span>
                      <span className="absolute top-2.5 right-2.5 flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-white text-green-700">
                        <CheckCircle2 className="w-3 h-3" /> 履約穩定度：穩定
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 p-4 flex-1">
                      <div>
                        <h4 className="font-bold text-[15px] leading-snug">{meal.title}</h4>
                        <p className="text-xs text-muted-foreground font-semibold mt-0.5">取餐時段：09/25（五）{meal.time}</p>
                      </div>

                      <div className="flex gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200">
                        <Star className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5 fill-amber-500" />
                        <p className="text-[11px] leading-relaxed text-amber-900">
                          Gemini 折扣說明：全額預付、不可退款但可轉賣過戶；搭配店家近期穩定的履約表現，換到這組確定性 8 折。
                        </p>
                      </div>

                      {!isLocked && (
                        <div className="flex flex-col gap-1.5">
                          <label className="flex items-start gap-1.5 p-2 rounded-lg bg-gray-50 border border-border cursor-pointer">
                            <input
                              type="checkbox"
                              checked={hasAcked}
                              onChange={() => setWaiverAck(prev => ({ ...prev, [meal.id]: !prev[meal.id] }))}
                              className="mt-0.5 accent-orange-500 w-3.5 h-3.5 shrink-0"
                            />
                            <span className="text-[10.5px] leading-relaxed text-muted-foreground">
                              我了解本商品為現做餐點，依消保法通訊交易解除權合理例外情事適用準則，<strong className="text-foreground">鎖定後不適用 7 天猶豫期</strong>，除商家未履約外恕不接受退款
                            </span>
                          </label>
                          <div className="flex gap-1.5 p-2 rounded-lg bg-orange-50 border border-orange-200">
                            <AlertTriangle className="w-3.5 h-3.5 text-orange-700 shrink-0 mt-0.5" />
                            <span className="text-[10.5px] leading-relaxed text-orange-900">
                              取餐時段結束仍未取餐，將<strong>自動開放到轉讓市集、$0 元供人領取</strong>，避免整份浪費
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between mt-auto pt-1">
                        <div>
                          <span className="text-xs text-gray-400 line-through mr-1.5">原價 ${meal.original}</span>
                          <span className="text-xl font-extrabold">${meal.price}</span>
                        </div>
                        <Button
                          size="sm"
                          disabled={ctaDisabled}
                          onClick={() => handleToggleLock(meal.id, meal.title)}
                          className={isLocked ? "bg-green-700 hover:bg-green-800 text-white" : "bg-orange-500 hover:bg-orange-600 text-white disabled:bg-gray-200 disabled:text-gray-400"}
                        >
                          {isLocked ? "已鎖定" : "立即預付鎖定"}
                        </Button>
                      </div>
                      {isLocked && (
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
                          <CheckCircle2 className="w-3.5 h-3.5" /> 已鎖定，取餐前將推播提醒
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {/* 合作店家與計畫 */}
          <section>
            <h3 className="text-lg font-bold mb-3">合作店家與計畫</h3>
            <div className="space-y-4">
              {vendorPlans.map(group => (
                <div key={group.vendorId} className="bg-white rounded-xl border border-border p-4 grid grid-cols-1 md:grid-cols-[220px_1fr_1fr] gap-4">
                  {/* 店家資訊 */}
                  <Link href={`/vendor/${group.vendorId}`} className="flex md:flex-col gap-3 hover:opacity-90">
                    <div className="w-20 h-20 md:w-full md:h-32 rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center text-3xl shrink-0">
                      🥩
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm mb-1 truncate">{group.vendorName}</p>
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
                    <div key={plan.id} className="bg-gray-50 rounded-lg p-3 flex flex-col">
                      <p className="text-sm font-semibold mb-0.5">{plan.label}：{plan.name}</p>
                      <p className="text-xs text-muted-foreground mb-3">{plan.description}</p>
                      <p className="text-sm font-bold text-orange-600 mb-2">NT$ {plan.pricePerMeal} / 餐起</p>
                      <span className="inline-block w-fit text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full mb-3">
                        最快履約：{plan.fastestBooking}
                      </span>
                      <Button
                        className="mt-auto w-full bg-brand-navy hover:bg-brand-navy-hover text-white text-sm"
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

          {/* 同學轉讓保底專區（含轉讓優惠橫捲清單，併成同一區塊放最下面） */}
          <section className="rounded-2xl p-6 bg-gradient-to-br from-amber-400 to-orange-400 space-y-5">
            <div className="flex items-center justify-between gap-6 flex-wrap">
              <div className="flex items-center gap-3.5">
                <Repeat className="w-7 h-7 text-white shrink-0" />
                <div>
                  <h3 className="font-bold text-white text-[15.5px] mb-0.5">同學轉讓保底專區</h3>
                  <p className="text-sm text-amber-50 max-w-xl">
                    臨時去不了？可安全轉讓給同學，全額入袋；逾時沒人接手，系統會自動開放到轉讓市集、$0 元供人領取，不浪費一份鎖定。
                  </p>
                </div>
              </div>
              <Link
                href="/marketplace"
                className="shrink-0 text-sm font-bold px-5 py-2.5 rounded-xl bg-white text-orange-600 hover:bg-amber-50 transition-colors"
              >
                前往轉讓市集
              </Link>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-1">
              {transfers.map(t => (
                <div key={t.id} className="shrink-0 w-64 bg-white rounded-xl p-3 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                      <User className="w-3.5 h-3.5 text-orange-500" />
                    </div>
                    <span className="text-xs font-medium truncate">{t.sellerName} 轉讓</span>
                  </div>
                  <p className="text-sm font-semibold line-clamp-1 mb-2">{t.planName}</p>
                  <div className="flex items-baseline gap-1.5 mb-1">
                    <span className="text-xs text-muted-foreground line-through">${t.originalPrice}</span>
                    <span className="text-xs text-muted-foreground">→</span>
                    <span className="text-sm font-bold text-orange-600">接盤價 ${t.resalePrice}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1.5 mt-1.5 border-t border-gray-100">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {t.daysLeftLabel}</span>
                    <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {t.location}</span>
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

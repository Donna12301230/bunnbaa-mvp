import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Search, MapPin, Globe, User, ChevronDown, Gift, Clock, CalendarDays,
  Rocket, Star, ClipboardList, Repeat, LogOut, Store, ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { mockLogout } from "@/lib/mockAuth";
import { mockMealPlanTransfers, mockVendorMealPlans } from "@/lib/mockData";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// 首頁「計畫方案」模板 — 依使用者提供的草圖重做（訂閱式計畫餐 + 轉讓市集）。
// TODO(firebase): 下方兩個 useQuery 讀的是 mockData.ts 的假資料，之後接
// Firestore 時把 queryFn 換掉即可；搜尋框、地址／語言選單目前只是靜態外觀。
export default function HomePage() {
  const [, navigate] = useLocation();
  const { user, isVendor, isAdmin } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<"plans" | "transfer" | "calendar">("plans");
  const [searchInput, setSearchInput] = useState("");
  const [startDate, setStartDate] = useState("2026-09-22");
  const [endDate, setEndDate] = useState("2026-09-26");

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

  const logoutMutation = useMutation({
    mutationFn: () => mockLogout(),
    onError: (err: Error) => toast({ variant: "destructive", title: "登出失敗", description: err.message }),
  });

  function goToTransferMarket() {
    setTab("transfer");
    toast({ title: "轉讓市集即將推出", description: "這個分頁還在開發中，敬請期待。" });
  }

  function goToMyCalendar() {
    setTab("calendar");
    toast({ title: "我的預約日曆即將推出", description: "這個分頁還在開發中，敬請期待。" });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── 頂部列 ── */}
      <header className="sticky top-0 z-40 bg-white border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 h-16 flex items-center gap-6">
          <img src="/飯飽wordR.png" alt="飯飽BunnBaa" className="h-8 shrink-0" />

          <nav className="hidden md:flex items-center gap-6 shrink-0">
            <button
              onClick={() => setTab("plans")}
              className={`flex items-center gap-1.5 h-16 text-sm font-medium border-b-2 transition-colors ${
                tab === "plans" ? "border-orange-500 text-orange-600" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <ClipboardList className="w-4 h-4" /> 預購餐點
            </button>
            <button
              onClick={goToTransferMarket}
              className={`flex items-center gap-1.5 h-16 text-sm font-medium border-b-2 transition-colors ${
                tab === "transfer" ? "border-orange-500 text-orange-600" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Repeat className="w-4 h-4" /> 轉讓市集
            </button>
            <button
              onClick={goToMyCalendar}
              className={`flex items-center gap-1.5 h-16 text-sm font-medium border-b-2 transition-colors ${
                tab === "calendar" ? "border-orange-500 text-orange-600" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays className="w-4 h-4" /> 我的預約日曆
            </button>
            <button
              onClick={() => navigate("/vendors")}
              className="flex items-center gap-1.5 h-16 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
            >
              <Store className="w-4 h-4" /> 商家
            </button>
          </nav>

          <div className="flex-1 relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="搜尋餐廳、料理或菜餚"
              className="w-full pl-9 pr-3 h-10 rounded-full border border-border bg-gray-50 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </div>

          <div className="flex items-center gap-3 md:gap-4 shrink-0 ml-auto text-sm">
            <button className="hidden lg:flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <MapPin className="w-4 h-4" />
              <span>新地址 選擇地址</span>
            </button>
            <button className="hidden sm:flex items-center gap-1 text-muted-foreground hover:text-foreground">
              <Globe className="w-4 h-4" />
              <span>ZH</span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {!user ? (
              <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" onClick={() => navigate("/login")}>
                登入 / 註冊
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-1 text-foreground">
                    <User className="w-4 h-4" />
                    <span className="max-w-[80px] truncate">{user.displayName || user.username}</span>
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => navigate("/profile")}>
                    <User className="w-4 h-4 mr-2" /> 會員中心
                  </DropdownMenuItem>
                  {isVendor && (
                    <DropdownMenuItem onClick={() => navigate("/vendor-portal/dashboard")}>
                      <Store className="w-4 h-4 mr-2" /> 廠商後台
                    </DropdownMenuItem>
                  )}
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => navigate("/admin/vendors")}>
                      <ShieldCheck className="w-4 h-4 mr-2" /> 管理後台
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-red-600"
                    onClick={() => logoutMutation.mutate()}
                    disabled={logoutMutation.isPending}
                  >
                    <LogOut className="w-4 h-4 mr-2" /> 登出
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

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
        </aside>

        {/* ── 右側：主內容 ── */}
        <main className="flex-1 min-w-0 space-y-8">
          {/* 轉讓優惠 */}
          <section className="rounded-2xl p-5 bg-gradient-to-br from-amber-400 to-orange-400">
            <h3 className="flex items-center gap-2 text-base font-bold text-white mb-4">
              <Gift className="w-5 h-5" /> 轉讓優惠
            </h3>
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
                        className="mt-auto w-full bg-[#0f2a4a] hover:bg-[#16375c] text-white text-sm"
                        onClick={() => toast({ title: "已加入計畫", description: `${group.vendorName} · ${plan.name}` })}
                      >
                        預約加入計畫
                      </Button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

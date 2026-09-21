import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  Search, MapPin, Globe, User, ChevronDown, ClipboardList, Repeat,
  CalendarDays, LogOut, Store, ShieldCheck, QrCode,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { mockLogout } from "@/lib/mockAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// 抽自 HomePage 的共用頂部列——依 UI草圖（Main/Marketplace/MyBookings 三頁共用同一組
// 導覽）統一給三頁用：預購餐點（計畫方案首頁）／轉讓市集／我的餐點。也給
// CustomerLayout（/vendors、/vendor/:id、/item/:id）用，取代原本另一套 Navbar.tsx，
// 讓商家瀏覽動線跟其他分頁共用同一顆導覽列。
// 搜尋框、地址／語言選單目前仍是靜態外觀（沿用原本 HomePage 的做法，尚未接功能）。
//
// 2026-09-21：「我的餐點」（原「我的商品」）這個分頁只給一般使用者看，是消費端
// 查看自己鎖定紀錄的地方（/my-bookings）；廠商登入時這個分頁位置換成「接受端」
// ——核對取餐（/lock/vendor/redeem，真的接 Firestore 核銷 locks 的商家頁，對應
// MyBookingsPage「使用」面板的核銷碼）。
export type MarketplaceTab = "plans" | "transfer" | "bookings" | "vendors";

export default function MarketplaceHeader({ active }: { active: MarketplaceTab }) {
  const [, navigate] = useLocation();
  const { user, isVendor, isAdmin } = useAuth();
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState("");

  const logoutMutation = useMutation({
    mutationFn: () => mockLogout(),
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "登出失敗", description: err.message });
    },
  });

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-border">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 h-16 flex items-center gap-6">
        <img
          src="/飯飽wordR.png"
          alt="飯飽BunnBaa"
          className="h-8 shrink-0 cursor-pointer"
          onClick={() => navigate("/home")}
        />

        <nav className="hidden md:flex items-center gap-6 shrink-0">
          <button
            onClick={() => navigate("/home")}
            className={`flex items-center gap-1.5 h-16 text-sm font-medium border-b-2 transition-colors ${
              active === "plans" ? "border-orange-500 text-orange-600" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <ClipboardList className="w-4 h-4" /> 預購餐點
          </button>
          <button
            onClick={() => navigate("/marketplace")}
            className={`flex items-center gap-1.5 h-16 text-sm font-medium border-b-2 transition-colors ${
              active === "transfer" ? "border-orange-500 text-orange-600" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Repeat className="w-4 h-4" /> 轉讓市集
          </button>
          {isVendor ? (
            <button
              onClick={() => navigate("/lock/vendor/redeem")}
              className={`flex items-center gap-1.5 h-16 text-sm font-medium border-b-2 transition-colors ${
                active === "bookings" ? "border-orange-500 text-orange-600" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <QrCode className="w-4 h-4" /> 核對取餐
            </button>
          ) : (
            <button
              onClick={() => navigate("/my-bookings")}
              className={`flex items-center gap-1.5 h-16 text-sm font-medium border-b-2 transition-colors ${
                active === "bookings" ? "border-orange-500 text-orange-600" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarDays className="w-4 h-4" /> 我的餐點
            </button>
          )}
          <button
            onClick={() => navigate("/vendors")}
            className={`flex items-center gap-1.5 h-16 text-sm font-medium border-b-2 transition-colors ${
              active === "vendors" ? "border-orange-500 text-orange-600" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
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
  );
}

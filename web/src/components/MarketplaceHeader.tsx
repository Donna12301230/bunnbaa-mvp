import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  Search, MapPin, Globe, User, ChevronDown, ClipboardList, Repeat,
  CalendarDays, LogOut, Store, ShieldCheck, QrCode, Menu, ShoppingCart, House,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { logout } from "@/lib/auth";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";

// 抽自 HomePage 的共用頂部列——依 UI草圖(Main/Marketplace/MyBookings 三頁共用同一組
// 導覽)統一給三頁用:預購餐點(計畫方案首頁)／轉讓市集／我的餐點。也給
// CustomerLayout(/vendors、/vendor/:id、/item/:id)用,取代原本另一套 Navbar.tsx,
// 讓商家瀏覽動線跟其他分頁共用同一顆導覽列。
// 搜尋框、地址／語言選單目前仍是靜態外觀(沿用原本 HomePage 的做法,尚未接功能)。
//
// 2026-09-21:「我的餐點」(原「我的商品」)這個分頁只給一般使用者看,是消費端
// 查看自己鎖定紀錄的地方(/my-bookings);廠商登入時這個分頁位置換成「接受端」
// ——核對取餐(/lock/vendor/redeem,真的接 Firestore 核銷 locks 的商家頁,對應
// MyBookingsPage「使用」面板的核銷碼)。
//
// UIUX 檢視後補上:桌機以下(<md)原本整組主導覽會被 `hidden md:flex` 藏起來,
// 手機沒有任何入替(沒有漢堡選單也沒有底部 tab bar),等於手機使用者看不到
// 「預購餐點/轉讓市集/我的餐點/商家」這幾個分頁。這裡加一顆漢堡按鈕,用 Sheet
// 抽屜補齊手機導覽;同時補上購物車圖示(MenuItemPage 加入購物車後,原本整站
// 沒有任何地方能查看/結帳購物車,是斷掉的動線),見 CartPage.tsx。
//
// 2026-09-28:最前面加「首頁」分頁,連到品牌形象頁(/landing,LandingPage.tsx)。
export type MarketplaceTab = "landing" | "plans" | "transfer" | "bookings" | "vendors";

interface NavItem {
  tab: MarketplaceTab;
  href: string;
  label: string;
  icon: typeof ClipboardList;
}

export default function MarketplaceHeader({ active }: { active?: MarketplaceTab }) {
  const [, navigate] = useLocation();
  const { user, isVendor, isAdmin } = useAuth();
  const { toast } = useToast();
  const { count: cartCount } = useCart();
  const [searchInput, setSearchInput] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onError: (err: Error) => {
      toast({ variant: "destructive", title: "登出失敗", description: err.message });
    },
  });

  const navItems: NavItem[] = [
    { tab: "landing", href: "/landing", label: "首頁", icon: House },
    { tab: "plans", href: "/home", label: "預購餐點", icon: ClipboardList },
    { tab: "transfer", href: "/marketplace", label: "轉讓市集", icon: Repeat },
    isVendor
      ? { tab: "bookings", href: "/lock/vendor/redeem", label: "核對取餐", icon: QrCode }
      : { tab: "bookings", href: "/my-bookings", label: "我的餐點", icon: CalendarDays },
    { tab: "vendors", href: "/vendors", label: "商家", icon: Store },
  ];

  function go(href: string) {
    setMobileNavOpen(false);
    navigate(href);
  }

  return (
    <header className="sticky top-0 z-40 bg-card border-b border-border">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 h-16 flex items-center gap-3 md:gap-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileNavOpen(true)}
          className="md:hidden shrink-0 w-10 h-10 -ml-1.5 text-muted-foreground [&_svg]:size-5"
          aria-label="開啟導覽選單"
        >
          <Menu />
        </Button>

        <img
          src="/飯飽wordR.png"
          alt="飯飽BunnBaa"
          className="h-8 shrink-0 cursor-pointer"
          onClick={() => navigate("/home")}
        />

        <nav className="hidden md:flex items-center gap-6 shrink-0">
          {navItems.map(({ tab, href, label, icon: Icon }) => (
            <button
              key={tab}
              onClick={() => navigate(href)}
              className={cn(
                "flex items-center gap-1.5 h-16 text-sm font-medium border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                active === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 relative max-w-md hidden sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          {/* 設計系統 Input：淡灰底無框，hover 出現細框，focus 轉白底 + 品牌橘 ring */}
          <Input
            type="search"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="搜尋餐廳、料理或菜餚"
            aria-label="搜尋餐廳、料理或菜餚"
            className="h-10 pl-9"
          />
        </div>

        <div className="flex items-center gap-2 md:gap-4 shrink-0 ml-auto text-sm">
          <button type="button" className="hidden lg:flex items-center gap-1 text-muted-foreground hover:text-foreground rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <MapPin className="w-4 h-4" />
            <span>新地址 選擇地址</span>
          </button>
          <button type="button" className="hidden sm:flex items-center gap-1 text-muted-foreground hover:text-foreground rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Globe className="w-4 h-4" />
            <span>ZH</span>
            <ChevronDown className="w-3 h-3" />
          </button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/cart")}
            className="relative w-10 h-10 text-muted-foreground [&_svg]:size-5"
            aria-label={`購物車${cartCount > 0 ? `，${cartCount} 項商品` : ""}`}
          >
            <ShoppingCart />
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-micro font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </Button>

          {!user ? (
            <Button size="sm"  onClick={() => navigate("/login")}>
              登入 / 註冊
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex items-center gap-1 text-foreground rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <User className="w-4 h-4" />
                  <span className="max-w-[80px] truncate hidden sm:inline">{user.displayName || user.username}</span>
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

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent side="left" className="w-72 p-0 flex flex-col">
          <SheetHeader className="p-4 border-b border-border text-left">
            <SheetTitle className="text-base">飯飽 BunnBaa</SheetTitle>
          </SheetHeader>
          <nav className="flex-1 p-2">
            {navItems.map(({ tab, href, label, icon: Icon }) => (
              <SheetClose asChild key={tab}>
                <button
                  onClick={() => go(href)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active === tab ? "bg-orange-50 text-orange-600" : "text-foreground hover:bg-gray-50"
                  )}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              </SheetClose>
            ))}
            <SheetClose asChild>
              <button
                onClick={() => go("/cart")}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-foreground hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ShoppingCart className="w-4 h-4" /> 購物車
                {cartCount > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center">
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </button>
            </SheetClose>
          </nav>
          {!user && (
            <div className="p-3 border-t border-border">
              <Button className="w-full" onClick={() => go("/login")}>
                登入 / 註冊
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </header>
  );
}

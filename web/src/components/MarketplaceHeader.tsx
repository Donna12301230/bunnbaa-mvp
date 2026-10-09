import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  Search, Globe, User, ChevronDown, ClipboardList, Repeat,
  CalendarDays, LogOut, Store, ShieldCheck, Menu, ShoppingCart, Trophy, Heart,
} from "lucide-react";
import NotificationBell from "@/components/NotificationBell";
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
import AreaPicker from "@/components/AreaPicker";
import { setLang, useI18n } from "@/lib/i18n";
import { avatarUrl } from "@/lib/avatar";
import { setSearchQuery, useSearchQuery } from "@/lib/searchQuery";
import { isClean } from "@/lib/searchFilter";
import { rememberReturnPath } from "@/lib/returnPath";

// 抽自 HomePage 的共用頂部列——依 UI草圖(Main/Marketplace/MyBookings 三頁共用同一組
// 導覽)統一給三頁用:預購餐點(計畫方案首頁)／轉讓市集／我的餐點。也給
// CustomerLayout(/vendors、/vendor/:id、/item/:id)用,取代原本另一套 Navbar.tsx,
// 讓商家瀏覽動線跟其他分頁共用同一顆導覽列。
// 搜尋框目前仍是靜態外觀。地區選單(AreaPicker)2026-09-28 改成台灣縣市＋鄉鎮市區篩選,
// 選擇存在 lib/location.ts,首頁／商家列表／轉讓市集依店家地址過濾。
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
// 2026-10-02(1002 規格 §4.5):導覽列只留 4 個——預購餐點、我的餐點、我的最愛、成長獎勵。
// 「商家」拿掉(跟預購餐點重複);「轉讓・愛心餐」併入我的餐點的分頁。搜尋框接上預購餐點頁的搜尋。
export type MarketplaceTab = "landing" | "plans" | "transfer" | "bookings" | "vendors" | "rewards" | "favorites" | "portal";

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
  const searchQuery = useSearchQuery();
  const [searchInput, setSearchInput] = useState(searchQuery);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { t, lang } = useI18n();

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onError: (err: Error) => {
      toast({ variant: "destructive", title: t("登出失敗", "Sign-out failed"), description: err.message });
    },
  });

  // 2026-10-09：廠商帳號不需要會員功能（我的餐點、我的最愛、成長獎勵、購物車、會員中心），只留
  // 「上架顯示」（看自己的品項在前台長什麼樣子）與「廠商後台」；核對取餐在廠商後台裡
  const navItems: NavItem[] = isVendor
    ? [
        { tab: "plans", href: "/home", label: t("上架顯示", "Storefront"), icon: ClipboardList },
        { tab: "portal", href: "/vendor-portal/dashboard", label: t("店家後台", "Vendor portal"), icon: Store },
      ]
    : [
        { tab: "plans", href: "/home", label: t("預購餐點", "Pre-order"), icon: ClipboardList },
        { tab: "bookings", href: "/my-bookings", label: t("我的餐點", "My meals"), icon: CalendarDays },
        { tab: "favorites", href: "/favorites", label: t("我的最愛", "Favorites"), icon: Heart },
        { tab: "rewards", href: "/rewards", label: t("成長獎勵", "Rewards"), icon: Trophy },
      ];

  // 搜尋店家名稱、菜名、料理類型；結果顯示在預購餐點頁（分單點／方案兩組）
  function submitSearch(value: string) {
    const q = value.trim().slice(0, 30);
    if (q && !isClean(q)) {
      toast({ variant: "destructive", title: t("請換個關鍵字", "Please try another keyword") });
      return;
    }
    setSearchQuery(q);
    if (q && active !== "plans") navigate("/home");
  }

  function go(href: string) {
    setMobileNavOpen(false);
    navigate(href);
  }

  // 表單送出（Enter 或放大鏡按鈕，桌機、手機兩個搜尋框共用）
  function onSearchSubmit(e: FormEvent) {
    e.preventDefault();
    setMobileNavOpen(false);
    submitSearch(searchInput);
  }

  return (
    <header className="sticky top-0 z-40 bg-card/90 backdrop-blur-xl backdrop-saturate-150 border-b border-border">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 h-16 flex items-center gap-3 md:gap-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileNavOpen(true)}
          className="md:hidden shrink-0 w-10 h-10 -ml-1.5 text-muted-foreground [&_svg]:size-5"
          aria-label={t("開啟導覽選單", "Open navigation menu")}
        >
          <Menu />
        </Button>

        {/* 真正的連結（原本是 img role=button）：可中鍵開新分頁、螢幕閱讀器讀成連結 */}
        <Link href="/landing" className="shrink-0 rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          <img src="/飯飽wordR.png" alt={t("飯飽 BunnBaa 首頁", "BunnBaa home")} className="h-8" />
        </Link>

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

        <form onSubmit={onSearchSubmit} className="flex-1 relative max-w-md hidden sm:flex items-center">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          {/* 設計系統 Input：淡灰底無框，hover 出現細框，focus 轉白底 + 品牌橘 ring */}
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              // 在預購餐點頁直接邊打邊篩；清空也立即恢復
              if (active === "plans" || !e.target.value) submitSearch(e.target.value);
            }}
            placeholder={t("搜尋店家、菜名或料理類型", "Search vendors, dishes or cuisines")}
            aria-label={t("搜尋店家、菜名或料理類型", "Search vendors, dishes or cuisines")}
            className="h-10 pl-9 pr-10"
          />
          <button
            type="submit"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("開始搜尋", "Search")}
          >
            <Search className="w-4 h-4" />
          </button>
        </form>

        <div className="flex items-center gap-2 md:gap-4 shrink-0 ml-auto text-sm">
          <AreaPicker className="hidden lg:flex" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="hidden sm:flex items-center gap-1 text-muted-foreground hover:text-foreground rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={t("切換語言", "Change language")}
              >
                <Globe className="w-4 h-4" />
                <span>{lang === "en" ? "EN" : "中"}</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem onClick={() => setLang("zh")} className={lang === "zh" ? "font-semibold" : undefined}>中文</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLang("en")} className={lang === "en" ? "font-semibold" : undefined}>English</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <NotificationBell />
          {!isVendor && <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/cart")}
            className="relative w-10 h-10 text-muted-foreground [&_svg]:size-5"
            aria-label={cartCount > 0 ? t(`購物車，${cartCount} 項商品`, `Cart, ${cartCount} items`) : t("購物車", "Cart")}
          >
            <ShoppingCart />
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-micro font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </Button>}

          {!user ? (
            <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => { rememberReturnPath(); navigate("/login"); }}>
              {/* 窄螢幕英文「Sign in / Sign up」會被切掉，只留「Sign in」 */}
              <span className="sm:hidden">{t("登入", "Sign in")}</span>
              <span className="hidden sm:inline">{t("登入 / 註冊", "Sign in / Sign up")}</span>
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex items-center gap-1.5 text-foreground rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <img src={avatarUrl(user.id)} alt="" className="w-5 h-5 rounded-full bg-orange-100" />
                  <span className="max-w-[80px] truncate hidden sm:inline">{user.displayName || user.username}</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {!isVendor && (
                  <DropdownMenuItem onClick={() => navigate("/profile")}>
                    <User className="w-4 h-4 mr-2" /> {t("會員中心", "My account")}
                  </DropdownMenuItem>
                )}
                {isVendor && (
                  <DropdownMenuItem onClick={() => navigate("/vendor-portal/dashboard")}>
                    <Store className="w-4 h-4 mr-2" /> {t("店家後台", "Vendor portal")}
                  </DropdownMenuItem>
                )}
                {isAdmin && (
                  <DropdownMenuItem onClick={() => navigate("/admin/vendors")}>
                    <ShieldCheck className="w-4 h-4 mr-2" /> {t("管理後台", "Admin")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                >
                  <LogOut className="w-4 h-4 mr-2" /> {t("登出", "Sign out")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* 手機版搜尋——桌機版用 sm:flex 的那份擠不進窄螢幕，之前整個被 hidden sm:block
          藏掉，手機完全沒有搜尋入口；改成獨立一排，寬度跟著 header 滿版。 */}
      <form onSubmit={onSearchSubmit} className="sm:hidden relative px-4 pb-3">
        <Search className="pointer-events-none absolute left-7 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            if (active === "plans" || !e.target.value) submitSearch(e.target.value);
          }}
          placeholder={t("搜尋店家、菜名或料理類型", "Search vendors, dishes or cuisines")}
          aria-label={t("搜尋店家、菜名或料理類型", "Search vendors, dishes or cuisines")}
          className="h-10 pl-9 pr-10"
        />
        <button
          type="submit"
          className="absolute right-5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t("開始搜尋", "Search")}
        >
          <Search className="w-4 h-4" />
        </button>
      </form>

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
            {!isVendor && <SheetClose asChild>
              <button
                onClick={() => go("/cart")}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-foreground hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ShoppingCart className="w-4 h-4" /> {t("購物車", "Cart")}
                {cartCount > 0 && (
                  <span className="ml-auto bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center">
                    {cartCount > 99 ? "99+" : cartCount}
                  </span>
                )}
              </button>
            </SheetClose>}
            <div className="px-3 py-3 text-sm flex items-center justify-between gap-2">
              <AreaPicker />
              <div className="flex gap-1" role="group" aria-label={t("切換語言", "Change language")}>
                <Button size="sm" variant={lang === "zh" ? "secondary" : "ghost"} onClick={() => setLang("zh")}>中</Button>
                <Button size="sm" variant={lang === "en" ? "secondary" : "ghost"} onClick={() => setLang("en")}>EN</Button>
              </div>
            </div>
          </nav>
          {!user && (
            <div className="p-3 border-t border-border">
              <Button className="w-full" onClick={() => { rememberReturnPath(); go("/login"); }}>
                {t("登入 / 註冊", "Sign in / Sign up")}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </header>
  );
}

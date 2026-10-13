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
import { demoDisplayName } from "@/lib/demoAccounts";
import { avatarUrl } from "@/lib/avatar";
import { setSearchQuery, useSearchQuery } from "@/lib/searchQuery";
import { isClean } from "@/lib/searchFilter";
import { rememberReturnPath } from "@/lib/returnPath";

// Shared top bar extracted from HomePage — per the UI sketch (Main/Marketplace/MyBookings share one
// nav), used by three pages: Pre-order meals (meal plan home) / Resale market / My meals. Also used by
// CustomerLayout (/vendors, /vendor/:id, /item/:id), replacing the separate Navbar.tsx,
// so the vendor browsing flow shares the same nav bar as the other tabs.
// The search box is still static. The area menu (AreaPicker) became a Taiwan city/county + district filter on 2026-09-28;
// the choice is stored in lib/location.ts, and home / vendor list / resale market filter by vendor address.
//
// 2026-09-21: the "My meals" tab (formerly "My items") is only for regular users; it is where diners
// view their own locks (/my-bookings). When a vendor signs in, this tab slot becomes the "receiving side"
// — pickup verification (/lock/vendor/redeem, the vendor page that really redeems locks in Firestore, matching
// the redemption code in MyBookingsPage's "Use" panel).
//
// Added after the UI/UX review: below desktop (<md) the whole main nav was hidden by `hidden md:flex`,
// and phones had no alternative (no hamburger menu, no bottom tab bar), so mobile users never saw
// the "Pre-order meals / Resale market / My meals / Vendors" tabs. This adds a hamburger button with a Sheet
// drawer for mobile nav, plus a cart icon (after MenuItemPage added items to the cart, there was
// nowhere on the site to view or check out the cart — a broken flow); see CartPage.tsx.
//
// 2026-09-28: added a "Home" tab at the front, linking to the brand page (/landing, LandingPage.tsx).
// 2026-10-02 (1002 spec §4.5): the nav keeps only 4 tabs — Pre-order meals, My meals, Favorites, Growth rewards.
// "Vendors" removed (duplicates Pre-order meals); "Resale · Charity meals" merged into a My meals tab. The search box now drives the Pre-order meals page search.
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

  // 2026-10-09: vendor accounts don't need member features (My meals, Favorites, Growth rewards, cart, member center); they only keep
  // "Public listing" (see how their items look on the storefront) and "Vendor portal"; pickup verification lives in the vendor portal
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

  // Search vendor names, dish names and cuisine types; results show on the Pre-order meals page (split into Single / Meal plan groups)
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

  // Form submit (Enter or the magnifier button; shared by the desktop and mobile search boxes)
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

        {/* A real link (formerly img role=button): middle-click opens a new tab, screen readers read it as a link */}
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
          {/* Design-system Input: light grey fill, no border; thin border on hover, white fill + brand orange ring on focus */}
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              // On the Pre-order meals page, filter as you type; clearing restores immediately
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
              <span className="absolute -top-0.5 -right-0.5 bg-destructive text-white text-micro font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </Button>}

          {!user ? (
            <Button size="sm" className="shrink-0 whitespace-nowrap" onClick={() => { rememberReturnPath(); navigate("/login"); }}>
              {/* On narrow screens the English "Sign in / Sign up" gets cut off, so only "Sign in" is shown */}
              <span className="sm:hidden">{t("登入", "Sign in")}</span>
              <span className="hidden sm:inline">{t("登入 / 註冊", "Sign in / Sign up")}</span>
            </Button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="flex items-center gap-1.5 text-foreground rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <img src={avatarUrl(user.id)} alt="" className="w-5 h-5 rounded-full bg-secondary" />
                  <span className="max-w-[80px] truncate hidden sm:inline">{demoDisplayName(user.email) || user.displayName || user.username}</span>
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
                  className="text-danger-text"
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

      {/* Mobile search — the desktop one (sm:flex) doesn't fit narrow screens and used to be hidden entirely by hidden sm:block,
          leaving phones with no search at all; now it's its own row, full header width. */}
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
                    active === tab ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-background"
                  )}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              </SheetClose>
            ))}
            {!isVendor && <SheetClose asChild>
              <button
                onClick={() => go("/cart")}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-foreground hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ShoppingCart className="w-4 h-4" /> {t("購物車", "Cart")}
                {cartCount > 0 && (
                  <span className="ml-auto bg-destructive text-white text-xs font-bold rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center">
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

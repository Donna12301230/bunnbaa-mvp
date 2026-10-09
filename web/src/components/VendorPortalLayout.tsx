import { tr } from "@/lib/i18n";
import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, UtensilsCrossed, ClipboardList, Settings, ArrowLeft, CalendarDays, ScanLine, TrendingUp, ChefHat, Trophy, BookOpen, ShoppingBasket, HeartHandshake, MapPinned } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

// 用函式包起來，每次 render 依目前語言組標籤。
// 依「時間」分組（簡化提案 §3-6）：今天要做的、這週要做的、有空時回顧的、偶爾調整的
const navGroups = () => [
  {
    title: null,
    items: [
      { href: "/vendor-portal/dashboard", label: tr("總覽", "Overview"), icon: LayoutDashboard },
    ],
  },
  {
    title: tr("今天", "Today"),
    items: [
      // 訂單、取餐掃碼、愛心餐、訂餐時段合成一頁（四個分頁）；舊路徑也算在這一項
      { href: "/vendor-portal/orders", label: tr("訂單取餐", "Orders & pickup"), icon: ScanLine, also: ["/lock/vendor/redeem", "/vendor-portal/sessions", "/vendor-portal/charity"] },
      { href: "/vendor-portal/prep", label: tr("今日備料", "Today's prep"), icon: ChefHat },
    ],
  },
  {
    title: tr("這週", "This week"),
    items: [
      { href: "/vendor-portal/purchasing", label: tr("採購叫貨", "Purchasing"), icon: ShoppingBasket },
      { href: "/vendor-portal/menu", label: tr("菜單管理", "Menu"), icon: UtensilsCrossed },
    ],
  },
  {
    title: tr("看數據", "Insights"),
    items: [
      // 統計報表、區域洞察、券負債看板合成一頁（三個分頁）；舊路徑也算在這一項
      { href: "/vendor-portal/reports", label: tr("報表與洞察", "Reports & insights"), icon: TrendingUp, also: ["/vendor-portal/insights", "/vendor-portal/growth"] },
    ],
  },
  {
    title: tr("店家", "Store"),
    items: [
      // 食材、單價、供應商：開店或漲價時才改，菜色的組成在菜單管理裡直接改
      { href: "/vendor-portal/recipes", label: tr("食材與供應商", "Ingredients"), icon: BookOpen },
      { href: "/vendor-portal/settings", label: tr("店家設定", "Store settings"), icon: Settings },
    ],
  },
];

const navItems = () => navGroups().flatMap((g) => g.items);

type NavItem = { href: string; also?: string[] };
const isActive = (location: string, item: NavItem) => [item.href, ...(item.also ?? [])].some((h) => location === h || location.startsWith(h));

// Ported from BunnBaa Parse_Ref's client/src/components/VendorLayout.tsx.
export default function VendorPortalLayout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, isVendor, isLoading } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isVendor) {
      toast(
        user
          ? { variant: "destructive", title: tr("沒有權限瀏覽此頁面", "You don't have access to this page"), description: tr("此頁面僅限店家帳號使用，目前登入的帳號權限不足。", "This page is for vendor accounts only.") }
          : { variant: "destructive", title: tr("請先登入 / 註冊帳號", "Please sign in or sign up"), description: tr("此頁面僅限店家帳號使用，請先登入店家帳號。", "This page is for vendor accounts only. Please sign in with a vendor account.") }
      );
      navigate("/");
    }
  }, [isLoading, isVendor]);

  // 放在所有 hooks 之後，登入狀態從載入中變成確定時 hook 數量才不會變
  if (isLoading || !isVendor) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-card/90 backdrop-blur-xl border-b border-border px-4 md:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/landing" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <img src="/飯飽wordR.png" alt={tr("飯飽 BunnBaa 首頁", "BunnBaa home")} className="h-8" />
          </Link>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground border border-ink">{tr("店家後台", "Vendor portal")}</span>
        </div>
        <Link href="/home" className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {tr("看上架顯示", "View storefront")}
        </Link>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 min-h-[calc(100vh-4rem)] border-r border-border p-4 hidden md:flex flex-col">
          <nav className="flex-1 sticky top-20 space-y-4" aria-label={tr("店家後台", "Vendor portal")}>
            {navGroups().map((group, i) => (
              <div key={group.title ?? i} className="space-y-1">
                {group.title && (
                  <div className="px-4 pb-1 text-xs font-semibold tracking-wide text-muted-foreground/80">{group.title}</div>
                )}
                {group.items.map((item) => { const { href, label, icon: Icon } = item; const active = isActive(location, item); return (
                  <Link key={href} href={href} aria-current={active ? "page" : undefined} className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <div className={cn(
                      "flex items-center gap-2.5 px-4 py-2.5 rounded-full text-sm cursor-pointer transition-colors",
                      active
                        ? "bg-secondary text-secondary-foreground font-semibold shadow-[inset_0_0_0_1px_var(--border-ink)]"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}>
                      <Icon className="w-4 h-4" />
                      <span>{label}</span>
                    </div>
                  </Link>
                ); })}
              </div>
            ))}
          </nav>
          <div className="text-xs text-muted-foreground pt-3 border-t space-y-1">
            <a href="mailto:herzbaa@gmail.com" className="block hover:text-foreground hover:underline">{tr("聯絡客服", "Contact support")}</a>
          </div>
        </aside>

        {/* Mobile bottom nav */}
        <nav aria-label={tr("店家後台", "Vendor portal")} className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border flex md:hidden z-50 overflow-x-auto">
          {navItems().map((item) => { const { href, label, icon: Icon } = item; const active = isActive(location, item); return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className="flex-1 min-w-[64px]">
              <div className={cn(
                "flex flex-col items-center py-2 text-xs",
                active ? "text-primary" : "text-muted-foreground"
              )}>
                <Icon className="w-5 h-5 mb-0.5" />
                {label}
              </div>
            </Link>
          ); })}
        </nav>

        {/* Content */}
        <main className="flex-1 min-w-0 p-4 md:p-8 pb-24 md:pb-10">
          {children}
        </main>
      </div>
    </div>
  );
}

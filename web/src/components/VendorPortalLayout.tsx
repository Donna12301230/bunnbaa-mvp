import { tr } from "@/lib/i18n";
import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, UtensilsCrossed, ClipboardList, Settings, ArrowLeft, CalendarDays, ScanLine, TrendingUp, AlertTriangle, ChefHat, Trophy, BookOpen, ShoppingBasket, HeartHandshake, MapPinned } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useMyVendor } from "@/hooks/useMyVendor";
import { getSubscriptionState, PLATFORM_CONTACT_EMAIL } from "@/lib/subscription";
import { Button } from "@/components/ui/button";
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
      // 訂單、取餐掃碼、訂餐時段合成一頁（三個分頁）；舊路徑也算在這一項
      { href: "/vendor-portal/orders", label: tr("訂單取餐", "Orders & pickup"), icon: ScanLine, also: ["/lock/vendor/redeem", "/vendor-portal/sessions"] },
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
      { href: "/vendor-portal/reports", label: tr("統計報表", "Reports"), icon: TrendingUp },
      { href: "/vendor-portal/insights", label: tr("區域洞察", "Area insights"), icon: MapPinned },
      { href: "/vendor-portal/growth", label: tr("券負債看板", "Rewards"), icon: Trophy },
    ],
  },
  {
    title: tr("店家", "Store"),
    items: [
      { href: "/vendor-portal/charity", label: tr("愛心餐", "Charity"), icon: HeartHandshake },
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
// 訂閱狀態讀真實 vendors/{id}（lib/subscription.ts）：到期後整個廠商後台擋住，
// 沒有訂閱金流，所以續約要聯絡平台、由管理員在 /admin/vendors 延長。
export default function VendorPortalLayout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, isVendor, isLoading } = useAuth();
  const { toast } = useToast();
  const { data: myVendor } = useMyVendor();

  useEffect(() => {
    if (!isLoading && !isVendor) {
      toast(
        user
          ? { variant: "destructive", title: tr("沒有權限瀏覽此頁面", "You don't have access to this page"), description: tr("此頁面僅限廠商帳號使用，目前登入的帳號權限不足。", "This page is for vendor accounts only.") }
          : { variant: "destructive", title: tr("請先登入 / 註冊帳號", "Please sign in or sign up"), description: tr("此頁面僅限廠商帳號使用，請先登入廠商帳號。", "This page is for vendor accounts only. Please sign in with a vendor account.") }
      );
      navigate("/");
    }
  }, [isLoading, isVendor]);

  // 放在所有 hooks 之後，登入狀態從載入中變成確定時 hook 數量才不會變
  if (isLoading || !isVendor) {
    return null;
  }

  const subscription = myVendor ? getSubscriptionState(myVendor) : null;

  if (subscription?.blocked) {
    return (
      <div className="min-h-screen bg-background">
        <div className="bg-sidebar border-b border-sidebar-border px-4 h-12 flex items-center justify-between">
          <img src="/飯飽wordR.png" alt="飯飽BunnBaa" className="h-7" />
          <Link href="/home" className="flex items-center text-sm text-sidebar-primary opacity-80 hover:opacity-100">
            <ArrowLeft className="w-4 h-4 mr-1" /> {tr("回首頁", "Home")}
          </Link>
        </div>
        <div className="flex items-center justify-center min-h-[calc(100vh-3rem)] px-4">
          <div className="bb-receipt max-w-md w-full text-center space-y-4">
            <AlertTriangle className="w-12 h-12 mx-auto text-amber-500" />
            <h2 className="font-heading text-3xl font-semibold">{tr("帳號已暫停", "Account suspended")}</h2>
            <p className="text-sm text-muted-foreground">
              {tr("您的訂閱已到期", "Your subscription expired")}{subscription.endDate ? `（${subscription.endDate.toLocaleDateString(tr("zh-TW", "en-US"))}）` : ""}{tr("，廠商後台功能暫時停用。", " and the vendor portal is paused.")}
              <br />{tr("所有店家資料、菜單及訂單記錄均已保留，續約後即可完整恢復。", "All your store data, menus and orders are kept and will be fully restored when you renew.")}
            </p>
            <div className="bg-amber-50 rounded-lg p-3 text-sm text-amber-800">
              {tr("續約方案：", "Renewal: ")}<b>{tr("每月 NT$1,999", "NT$1,999 / month")}</b>{tr("，付款確認後由平台為您恢復", " — the platform restores your account once payment is confirmed")}
            </div>
            <Button asChild className="w-full">
              <a href={`mailto:${PLATFORM_CONTACT_EMAIL}?subject=${encodeURIComponent(`續約：${myVendor?.name ?? ""}`)}`}>
                {tr("聯絡平台續約", "Contact us to renew")}
              </a>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-card/90 backdrop-blur-xl border-b border-border px-4 md:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/landing" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <img src="/飯飽wordR.png" alt={tr("飯飽 BunnBaa 首頁", "BunnBaa home")} className="h-8" />
          </Link>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground border border-ink">{tr("商家後台", "Vendor portal")}</span>
        </div>
        <Link href="/home" className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {tr("回首頁", "Home")}
        </Link>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 min-h-[calc(100vh-4rem)] border-r border-border p-4 hidden md:flex flex-col">
          <nav className="flex-1 sticky top-20 space-y-4" aria-label={tr("商家後台", "Vendor portal")}>
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
        <nav aria-label={tr("商家後台", "Vendor portal")} className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border flex md:hidden z-50 overflow-x-auto">
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

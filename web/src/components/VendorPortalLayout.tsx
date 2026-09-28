import { tr } from "@/lib/i18n";
import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, UtensilsCrossed, ClipboardList, Settings, ArrowLeft, CalendarDays, Search, TrendingUp, AlertTriangle, ChefHat, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useMyVendor } from "@/hooks/useMyVendor";
import { getSubscriptionState, PLATFORM_CONTACT_EMAIL } from "@/lib/subscription";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// 用函式包起來，每次 render 依目前語言組標籤
const navItems = () => [
  { href: "/vendor-portal/dashboard", label: tr("總覽", "Overview"), icon: LayoutDashboard },
  { href: "/vendor-portal/sessions", label: tr("訂餐時段", "Pickup slots"), icon: CalendarDays },
  // 核對取餐指向真的接 Firestore 的 /lock/vendor/redeem（跟 MarketplaceHeader 同一個入口）
  { href: "/lock/vendor/redeem", label: tr("核對取餐", "Redeem"), icon: Search },
  { href: "/vendor-portal/menu", label: tr("菜單管理", "Menu"), icon: UtensilsCrossed },
  { href: "/vendor-portal/orders", label: tr("訂單管理", "Orders"), icon: ClipboardList },
  { href: "/vendor-portal/prep", label: tr("今日備料", "Today's prep"), icon: ChefHat },
  { href: "/vendor-portal/reports", label: tr("統計報表", "Reports"), icon: TrendingUp },
  { href: "/vendor-portal/growth", label: tr("成長獎勵", "Growth rewards"), icon: Trophy },
  { href: "/vendor-portal/settings", label: tr("店家設定", "Store settings"), icon: Settings },
];

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
      <div className="min-h-screen bg-gray-50">
        <div className="bg-sidebar border-b border-sidebar-border px-4 h-12 flex items-center justify-between">
          <img src="/飯飽wordR.png" alt="飯飽BunnBaa" className="h-7" />
          <Link href="/home" className="flex items-center text-sm text-sidebar-primary opacity-80 hover:opacity-100">
            <ArrowLeft className="w-4 h-4 mr-1" /> {tr("回首頁", "Home")}
          </Link>
        </div>
        <div className="flex items-center justify-center min-h-[calc(100vh-3rem)] px-4">
          <div className="bg-white rounded-xl shadow-lg p-8 max-w-md w-full text-center space-y-4">
            <AlertTriangle className="w-12 h-12 mx-auto text-amber-500" />
            <h2 className="text-xl font-bold text-gray-800">{tr("帳號已暫停", "Account suspended")}</h2>
            <p className="text-sm text-gray-600">
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
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-sidebar border-b border-sidebar-border px-4 h-12 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <img src="/飯飽wordR.png" alt="飯飽BunnBaa" className="h-7" />
        </div>
        <Link href="/home" className="flex items-center text-sm text-sidebar-primary opacity-80 hover:opacity-100">
          <ArrowLeft className="w-4 h-4 mr-1" /> {tr("回首頁", "Home")}
        </Link>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-48 min-h-[calc(100vh-3rem)] bg-white border-r border-border p-3 hidden md:flex flex-col">
          <nav className="space-y-1 flex-1">
            {navItems().map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href}>
                <div className={cn(
                  "flex items-center space-x-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors",
                  location === href || location.startsWith(href)
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted"
                )}>
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                </div>
              </Link>
            ))}
          </nav>
          <div className="text-xs text-muted-foreground pt-3 border-t space-y-1">
            <a href="mailto:herzbaa@gmail.com" className="block hover:text-orange-600 hover:underline">{tr("聯絡客服", "Contact support")}</a>
          </div>
        </aside>

        {/* Mobile bottom nav */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border flex md:hidden z-50">
          {navItems().map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex-1">
              <div className={cn(
                "flex flex-col items-center py-2 text-xs",
                location === href || location.startsWith(href) ? "text-primary" : "text-muted-foreground"
              )}>
                <Icon className="w-5 h-5 mb-0.5" />
                {label}
              </div>
            </Link>
          ))}
        </div>

        {/* Content */}
        <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}

import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, UtensilsCrossed, ClipboardList, Settings, ArrowLeft, CalendarDays, Search, TrendingUp, AlertTriangle, ChefHat, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { mockVendors } from "@/lib/mockData";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  { href: "/vendor-portal/dashboard", label: "總覽", icon: LayoutDashboard },
  { href: "/vendor-portal/sessions", label: "訂餐時段", icon: CalendarDays },
  { href: "/vendor-portal/scan", label: "核對取餐", icon: Search },
  { href: "/vendor-portal/menu", label: "菜單管理", icon: UtensilsCrossed },
  { href: "/vendor-portal/orders", label: "訂單管理", icon: ClipboardList },
  { href: "/vendor-portal/prep", label: "今日備料", icon: ChefHat },
  { href: "/vendor-portal/reports", label: "統計報表", icon: TrendingUp },
  { href: "/vendor-portal/growth", label: "成長獎勵", icon: Trophy },
  { href: "/vendor-portal/settings", label: "店家設定", icon: Settings },
];

// Ported from BunnBaa Parse_Ref's client/src/components/VendorLayout.tsx.
// TODO(firebase): the subscription-status query and the reactivate mutation
// read/mutate mockVendors instead of Parse.Query("Vendor")/Parse.Cloud.run —
// swap for real Firestore + Cloud Functions once the backend is wired up.
export default function VendorPortalLayout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, isVendor, isLoading } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isVendor) {
      toast(
        user
          ? { variant: "destructive", title: "沒有權限瀏覽此頁面", description: "此頁面僅限廠商帳號使用，目前登入的帳號權限不足。" }
          : { variant: "destructive", title: "請先登入 / 註冊帳號", description: "此頁面僅限廠商帳號使用，請先登入廠商帳號。" }
      );
      navigate("/");
    }
  }, [isLoading, isVendor]);

  if (!isLoading && !isVendor) {
    return null;
  }

  const { data: subInfo } = useQuery({
    queryKey: ["myVendorSub", user?.id],
    queryFn: async () => {
      const v = mockVendors[0];
      if (!v) return null;
      return { status: v.subscriptionStatus, endDate: v.subscriptionEndDate };
    },
    enabled: !!user && isVendor,
  });

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const v = mockVendors[0];
      if (v) v.subscriptionStatus = "active";
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myVendorSub", user?.id] });
      toast({ title: "訂閱已恢復", description: "歡迎回來！帳號已恢復正常使用。" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });

  const now = new Date();
  const isSubscriptionBlocked = subInfo && (
    subInfo.status === "expired" ||
    (subInfo.status === "cancelled" && subInfo.endDate && subInfo.endDate <= now)
  );

  if (isSubscriptionBlocked) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-sidebar border-b border-sidebar-border px-4 h-12 flex items-center justify-between">
          <img src="/飯飽wordR.png" alt="飯飽BunnBaa" className="h-7" />
          <Link href="/home" className="flex items-center text-sm text-sidebar-primary opacity-80 hover:opacity-100">
            <ArrowLeft className="w-4 h-4 mr-1" /> 回首頁
          </Link>
        </div>
        <div className="flex items-center justify-center min-h-[calc(100vh-3rem)] px-4">
          <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center space-y-4">
            <AlertTriangle className="w-12 h-12 mx-auto text-amber-500" />
            <h2 className="text-xl font-bold text-gray-800">帳號已暫停</h2>
            <p className="text-sm text-gray-600">
              您的訂閱已到期，廠商後台功能暫時停用。
              <br />所有店家資料、菜單及訂單記錄均已保留，重新訂閱即可完整恢復。
            </p>
            <div className="bg-amber-50 rounded-lg p-3 text-sm text-amber-800">
              重新訂閱方案：<b>首月免費，之後每月 NT$1,999</b>
            </div>
            <Button
              className="w-full bg-amber-500 hover:bg-amber-600 text-white"
              disabled={reactivateMutation.isPending}
              onClick={() => reactivateMutation.mutate()}
            >
              {reactivateMutation.isPending ? "處理中..." : "立即重新訂閱"}
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
          <ArrowLeft className="w-4 h-4 mr-1" /> 回首頁
        </Link>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-48 min-h-[calc(100vh-3rem)] bg-white border-r border-border p-3 hidden md:flex flex-col">
          <nav className="space-y-1 flex-1">
            {navItems.map(({ href, label, icon: Icon }) => (
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
            <a href="mailto:herzbaa@gmail.com" className="block hover:text-orange-600 hover:underline">聯絡客服</a>
          </div>
        </aside>

        {/* Mobile bottom nav */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border flex md:hidden z-50">
          {navItems.map(({ href, label, icon: Icon }) => (
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

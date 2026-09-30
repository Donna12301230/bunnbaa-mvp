import { tr } from "@/lib/i18n";
import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Store, ShieldAlert, ArrowLeft, ClipboardList, Wallet, Settings, SlidersHorizontal, BookMarked, CloudLightning, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

// 用函式包起來，每次 render 依目前語言組標籤
const navItems = () => [
  { href: "/admin/vendors", label: tr("廠商管理", "Vendors"), icon: Store },
  { href: "/admin/platform", label: tr("平台參數", "Parameters"), icon: SlidersHorizontal },
  { href: "/admin/dishes", label: tr("菜色庫與模板", "Dishes"), icon: BookMarked },
  { href: "/admin/anomalies", label: tr("異常審核", "Anomalies"), icon: AlertOctagon },
  { href: "/admin/disasters", label: tr("天災事件", "Disasters"), icon: CloudLightning },
  { href: "/admin/appeals", label: tr("解封申訴", "Appeals"), icon: ShieldAlert },
  { href: "/admin/locks", label: tr("訂單總覽", "Orders"), icon: ClipboardList },
  { href: "/admin/payouts", label: tr("撥款總覽", "Payouts"), icon: Wallet },
  { href: "/admin/settings", label: tr("系統設定", "Settings"), icon: Settings },
];

// Sidebar/top-bar layout for the platform admin backend, styled to match
// VendorPortalLayout.tsx so the two backends share one visual language.
export default function AdminLayout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, isAdmin, isLoading } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      toast(
        user
          ? { variant: "destructive", title: tr("沒有權限瀏覽此頁面", "You don't have access to this page"), description: tr("此頁面僅限平台管理員帳號使用，目前登入的帳號權限不足。", "This page is for platform admins only.") }
          : { variant: "destructive", title: tr("請先登入 / 註冊帳號", "Please sign in or sign up"), description: tr("此頁面僅限平台管理員使用，請先登入平台管理員帳號。", "This page is for platform admins only. Please sign in with an admin account.") }
      );
      navigate("/");
    }
  }, [isLoading, isAdmin]);

  const { data: pendingAppealsCount = 0 } = useQuery({
    queryKey: ["adminAppeals", "pendingCount"],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "ban_appeals"), where("status", "==", "pending")));
      return snap.size;
    },
    enabled: isAdmin,
  });

  if (isLoading || !isAdmin) {
    return null;
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
                  {href === "/admin/appeals" && pendingAppealsCount > 0 && (
                    <span className="ml-auto bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center shrink-0">
                      {pendingAppealsCount}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </nav>
        </aside>

        {/* Mobile bottom nav */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border flex md:hidden z-50 overflow-x-auto">
          {navItems().map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex-1 min-w-[64px]">
              <div className={cn(
                "relative flex flex-col items-center py-2 text-xs",
                location === href || location.startsWith(href) ? "text-primary" : "text-muted-foreground"
              )}>
                <Icon className="w-5 h-5 mb-0.5" />
                {label}
                {href === "/admin/appeals" && pendingAppealsCount > 0 && (
                  <span className="absolute top-1 right-1/4 bg-red-500 text-white text-micro rounded-full w-4 h-4 flex items-center justify-center">
                    {pendingAppealsCount}
                  </span>
                )}
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

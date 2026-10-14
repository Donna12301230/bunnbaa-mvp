import { tr } from "@/lib/i18n";
import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { AreaChart, Store, ShieldAlert, ArrowLeft, ClipboardList, Wallet, Settings, SlidersHorizontal, BookMarked, CloudLightning, AlertOctagon, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

// Wrapped in a function so labels are built in the current language on every render
const navItems = () => [
  { href: "/admin/vendors", label: tr("店家管理", "Vendors"), icon: Store },
  { href: "/admin/platform", label: tr("平台參數", "Platform parameters"), icon: SlidersHorizontal },
  { href: "/admin/dishes", label: tr("菜色庫與模板", "Dishes & templates"), icon: BookMarked },
  { href: "/admin/anomalies", label: tr("異常審核", "Anomalies"), icon: AlertOctagon },
  { href: "/admin/disasters", label: tr("天災事件", "Disaster events"), icon: CloudLightning },
  { href: "/admin/appeals", label: tr("解封申訴", "Appeals"), icon: ShieldAlert },
  { href: "/admin/locks", label: tr("訂單總覽", "Orders"), icon: ClipboardList },
  { href: "/admin/payouts", label: tr("撥款總覽", "Payouts"), icon: Wallet },
  { href: "/admin/analytics", label: tr("平台儀表板", "Dashboard"), icon: AreaChart },
  { href: "/admin/settings", label: tr("系統設定", "Settings"), icon: Settings },
];

// Sidebar/top-bar layout for the platform admin backend, styled to match
// VendorPortalLayout.tsx so the two backends share one visual language.
export default function AdminLayout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { user, isAdmin, isReadOnlyAdmin, isLoading } = useAuth();
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
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-card/90 backdrop-blur-xl border-b border-border px-4 md:px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/landing" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <img src="/飯飽wordR-sm.webp" alt={tr("飯飽 BunnBaa 首頁", "BunnBaa home")} className="h-8" />
          </Link>
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-secondary text-secondary-foreground border border-ink">{tr("管理後台", "Admin")}</span>
        </div>
        <Link href="/home" className="flex items-center gap-1 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {tr("回首頁", "Home")}
        </Link>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className="w-60 shrink-0 min-h-[calc(100vh-4rem)] border-r border-border p-4 hidden md:flex flex-col">
          <nav className="space-y-1 flex-1 sticky top-20" aria-label={tr("管理後台", "Admin")}>
            {navItems().map(({ href, label, icon: Icon }) => (
              <Link key={href} href={href} aria-current={location === href || location.startsWith(href) ? "page" : undefined} className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <div className={cn(
                  "flex items-center gap-2.5 px-4 py-2.5 rounded-full text-sm cursor-pointer transition-colors",
                  location === href || location.startsWith(href)
                    ? "bg-secondary text-secondary-foreground font-semibold shadow-[inset_0_0_0_1px_var(--border-ink)]"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}>
                  <Icon className="w-4 h-4" />
                  <span>{label}</span>
                  {href === "/admin/appeals" && pendingAppealsCount > 0 && (
                    <span className="ml-auto bg-destructive text-white text-xs rounded-full w-4 h-4 flex items-center justify-center shrink-0">
                      {pendingAppealsCount}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </nav>
        </aside>

        {/* Mobile bottom nav */}
        <nav aria-label={tr("管理後台", "Admin")} className="fixed bottom-0 left-0 right-0 bg-card/95 backdrop-blur-md border-t border-border flex md:hidden z-50 overflow-x-auto">
          {navItems().map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={location === href || location.startsWith(href) ? "page" : undefined} className="flex-1 min-w-[64px]">
              <div className={cn(
                "relative flex flex-col items-center py-2 text-xs",
                location === href || location.startsWith(href) ? "text-primary" : "text-muted-foreground"
              )}>
                <Icon className="w-5 h-5 mb-0.5" />
                {label}
                {href === "/admin/appeals" && pendingAppealsCount > 0 && (
                  <span className="absolute top-1 right-1/4 bg-destructive text-white text-micro rounded-full w-4 h-4 flex items-center justify-center">
                    {pendingAppealsCount}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 min-w-0 p-4 md:p-8 pb-24 md:pb-10">
          {/* Read-only demo admin: firestore.rules and Functions refuse its writes, so say so up front */}
          {isReadOnlyAdmin && (
            <div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-accent px-4 py-3 text-sm text-accent-foreground">
              <Eye className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{tr("你正在使用管理員體驗帳號：可以瀏覽所有後台頁面，但新增、修改、退款等操作都不會生效。", "You're using the demo admin account: you can browse every admin page, but creating, editing or refunding won't go through.")}</span>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

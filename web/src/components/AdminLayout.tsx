import { ReactNode, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Store, ShieldAlert, ArrowLeft, ClipboardList, Wallet, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { mockBanAppeals } from "@/lib/mockData";
import { useToast } from "@/hooks/use-toast";

const navItems = [
  { href: "/admin/vendors", label: "廠商管理", icon: Store },
  { href: "/admin/appeals", label: "解封申訴", icon: ShieldAlert },
  { href: "/admin/locks", label: "訂單總覽", icon: ClipboardList },
  { href: "/admin/payouts", label: "撥款總覽", icon: Wallet },
  { href: "/admin/settings", label: "系統設定", icon: Settings },
];

// Sidebar/top-bar layout for the platform admin backend, styled to match
// VendorPortalLayout.tsx so the two backends share one visual language.
export default function AdminLayout({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const { isAdmin, isLoading } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      toast({ variant: "destructive", title: "請先登入 / 註冊帳號", description: "此頁面僅限平台管理員使用。" });
      navigate("/");
    }
  }, [isLoading, isAdmin]);

  const { data: pendingAppealsCount = 0 } = useQuery({
    queryKey: ["adminAppeals", "pendingCount"],
    queryFn: async () => mockBanAppeals.filter(a => a.status === "pending").length,
    enabled: isAdmin,
  });

  if (!isLoading && !isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-[#f5f0e8] border-b border-[#e0d5c0] px-4 h-12 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <img src="/飯飽wordR.png" alt="飯飽BunnBaa" className="h-7" />
        </div>
        <Link href="/home" className="flex items-center text-sm text-[#8B6914] opacity-80 hover:opacity-100">
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
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border flex md:hidden z-50">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex-1">
              <div className={cn(
                "relative flex flex-col items-center py-2 text-xs",
                location === href || location.startsWith(href) ? "text-primary" : "text-muted-foreground"
              )}>
                <Icon className="w-5 h-5 mb-0.5" />
                {label}
                {href === "/admin/appeals" && pendingAppealsCount > 0 && (
                  <span className="absolute top-1 right-1/4 bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
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

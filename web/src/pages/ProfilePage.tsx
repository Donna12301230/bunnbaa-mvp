import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import {
  User, Mail, Phone, GraduationCap, ArrowLeft, LogOut,
  ClipboardList, Users, Store, History,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { mockLogout } from "@/lib/mockAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

const roleLabel: Record<string, string> = {
  customer: "一般會員",
  vendor: "廠商",
  admin: "平台管理員",
};

export default function ProfilePage() {
  const [, navigate] = useLocation();
  const { user, isLoading } = useAuth();
  const { toast } = useToast();

  const logoutMutation = useMutation({
    mutationFn: () => mockLogout(),
    onSuccess: () => navigate("/"),
    onError: (err: Error) => toast({ variant: "destructive", title: "登出失敗", description: err.message }),
  });

  function comingSoon(label: string) {
    toast({ title: `${label}即將推出`, description: "這個功能還在開發中，敬請期待。" });
  }

  if (!isLoading && !user) {
    navigate("/login");
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 bg-white border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <img src="/飯飽wordR.png" alt="飯飽BunnBaa" className="h-8" />
          <button
            onClick={() => navigate("/home")}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> 回首頁
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-8 space-y-6">
        <h1 className="text-xl font-bold">會員中心</h1>

        {/* 帳號資訊 */}
        <section className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
              <User className="w-7 h-7 text-orange-500" />
            </div>
            <div>
              <p className="font-semibold text-lg">{user?.displayName || user?.username}</p>
              <span className="inline-block mt-1 text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                {roleLabel[user?.role ?? "customer"]}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="w-4 h-4 shrink-0" /> {user?.email || "尚未設定"}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="w-4 h-4 shrink-0" /> {user?.phone || "尚未設定"}
            </div>
            {user?.department && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <GraduationCap className="w-4 h-4 shrink-0" />
                {user.department}{user.studentId ? `・${user.studentId}` : ""}
              </div>
            )}
          </div>
        </section>

        {/* 快速功能 */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <button
            onClick={() => navigate("/my-bookings")}
            className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left hover:border-orange-300 transition-colors"
          >
            <ClipboardList className="w-5 h-5 text-orange-500 shrink-0" />
            <div>
              <p className="font-medium text-sm">我的訂單</p>
              <p className="text-xs text-muted-foreground">查看鎖定與取餐紀錄</p>
            </div>
          </button>
          <button
            onClick={() => navigate("/my-locks")}
            className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left hover:border-orange-300 transition-colors"
          >
            <History className="w-5 h-5 text-orange-500 shrink-0" />
            <div>
              <p className="font-medium text-sm">我的鎖定紀錄</p>
              <p className="text-xs text-muted-foreground">真實資料簡易列表（開發用）</p>
            </div>
          </button>
          <button
            onClick={() => comingSoon("我的開團")}
            className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left hover:border-orange-300 transition-colors"
          >
            <Users className="w-5 h-5 text-orange-500 shrink-0" />
            <div>
              <p className="font-medium text-sm">我的開團</p>
              <p className="text-xs text-muted-foreground">管理你發起的合購</p>
            </div>
          </button>
          {user?.role === "customer" && (
            <button
              onClick={() => comingSoon("申請成為廠商")}
              className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left hover:border-orange-300 transition-colors"
            >
              <Store className="w-5 h-5 text-orange-500 shrink-0" />
              <div>
                <p className="font-medium text-sm">申請成為廠商</p>
                <p className="text-xs text-muted-foreground">上架自己的餐點方案</p>
              </div>
            </button>
          )}
        </section>

        <Button
          variant="ghost"
          className="text-red-600 hover:text-red-700 hover:bg-red-50"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
        >
          <LogOut className="w-4 h-4 mr-2" /> 登出
        </Button>
      </main>
    </div>
  );
}

import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, where } from "firebase/firestore";
import {
  User, Mail, Phone, GraduationCap, ArrowLeft, LogOut,
  ClipboardList, Users, Store, History, ShieldAlert,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { logout } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/firebase";
import type { UserProfile } from "@/types";

interface BanAppeal {
  id: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
}

const APPEAL_STATUS_LABEL: Record<BanAppeal["status"], string> = {
  pending: "審核中",
  approved: "已核准",
  rejected: "已拒絕",
};

// 只有目前狀態是 isOrderBanned 才會顯示這塊；規則上 ban_appeals 的 create 也要求
// isBanned()，所以未被封鎖的人就算硬呼叫也會被擋。
function BanAppealSection({ user }: { user: UserProfile }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const { data: latestAppeal, isLoading } = useQuery({
    queryKey: ["myLatestBanAppeal", user.id],
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, "ban_appeals"), where("buyer_uid", "==", user.id), orderBy("created_at", "desc"), limit(1))
      );
      return snap.empty ? null : ({ id: snap.docs[0].id, ...(snap.docs[0].data() as any) } as BanAppeal);
    },
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!reason.trim()) throw new Error("請填寫申訴原因");
      await addDoc(collection(db, "ban_appeals"), {
        buyer_uid: user.id,
        username: user.username,
        display_name: user.displayName ?? "",
        reason: reason.trim(),
        status: "pending",
        created_at: serverTimestamp(),
      });
    },
    onSuccess: () => {
      toast({ title: "申訴已送出", description: "管理員審核後會解除限制，請耐心等候。" });
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["myLatestBanAppeal", user.id] });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "送出失敗", description: err.message }),
  });

  const canSubmitNew = !isLoading && (!latestAppeal || latestAppeal.status === "rejected");

  return (
    <section className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2 text-red-700 font-semibold">
        <ShieldAlert className="w-5 h-5 shrink-0" /> 帳號目前限制下單
      </div>
      <p className="text-sm text-red-700">
        因累計多次未取餐，暫時無法鎖定新的餐點。如果有特殊狀況，可以在下面提出申訴，管理員審核通過後會立即解除限制。
      </p>

      {!isLoading && latestAppeal && (
        <div className="text-sm bg-white rounded-lg border border-red-100 p-3">
          <p className="font-medium">
            最近一次申訴：{APPEAL_STATUS_LABEL[latestAppeal.status]}
          </p>
          {latestAppeal.status === "pending" && (
            <p className="text-muted-foreground mt-1">管理員審核中，請耐心等候，不需要重複送出。</p>
          )}
          {latestAppeal.status === "rejected" && latestAppeal.admin_note && (
            <p className="text-muted-foreground mt-1">管理員備註：{latestAppeal.admin_note}</p>
          )}
        </div>
      )}

      {canSubmitNew && (
        <div className="space-y-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="請說明這次未取餐的原因……"
            rows={3}
          />
          <Button
            size="sm"
            disabled={submitMutation.isPending || !reason.trim()}
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? "送出中…" : "送出申訴"}
          </Button>
        </div>
      )}
    </section>
  );
}

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
    mutationFn: () => logout(),
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

        {user?.orderBanned && <BanAppealSection user={user} />}

        {/* 快速功能 */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <button
            onClick={() => navigate("/my-bookings")}
            className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <ClipboardList className="w-5 h-5 text-orange-500 shrink-0" />
            <div>
              <p className="font-medium text-sm">我的訂單</p>
              <p className="text-xs text-muted-foreground">查看鎖定與取餐紀錄</p>
            </div>
          </button>
          <button
            onClick={() => navigate("/my-locks")}
            className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <History className="w-5 h-5 text-orange-500 shrink-0" />
            <div>
              <p className="font-medium text-sm">我的鎖定紀錄</p>
              <p className="text-xs text-muted-foreground">真實資料簡易列表（開發用）</p>
            </div>
          </button>
          <button
            onClick={() => comingSoon("我的開團")}
            className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
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
              className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
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

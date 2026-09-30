import { tr } from "@/lib/i18n";
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
import TasteAndNotifySection from "@/components/TasteAndNotifySection";

interface BanAppeal {
  id: string;
  status: "pending" | "approved" | "rejected";
  admin_note: string | null;
}

const appealStatusLabel = (status: BanAppeal["status"]) =>
  ({ pending: tr("審核中", "Under review"), approved: tr("已核准", "Approved"), rejected: tr("已拒絕", "Rejected") })[status];

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
      if (!reason.trim()) throw new Error(tr("請填寫申訴原因", "Please explain the reason for your appeal"));
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
      toast({ title: tr("申訴已送出", "Appeal submitted"), description: tr("管理員審核後會解除限制，請耐心等候。", "The restriction will be lifted once an admin approves it.") });
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["myLatestBanAppeal", user.id] });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("送出失敗", "Couldn't submit"), description: err.message }),
  });

  const canSubmitNew = !isLoading && (!latestAppeal || latestAppeal.status === "rejected");

  return (
    <section className="bg-red-50 border border-red-200 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2 text-red-700 font-semibold">
        <ShieldAlert className="w-5 h-5 shrink-0" /> {tr("帳號目前限制下單", "Ordering is restricted on your account")}
      </div>
      <p className="text-sm text-red-700">
        {tr("因累計多次未取餐，暫時無法鎖定新的餐點。如果有特殊狀況，可以在下面提出申訴，管理員審核通過後會立即解除限制。", "After repeated no-shows you can't lock new meals for now. If there were special circumstances, submit an appeal below — the restriction is lifted as soon as an admin approves it.")}
      </p>

      {!isLoading && latestAppeal && (
        <div className="text-sm bg-white rounded-lg border border-red-100 p-3">
          <p className="font-medium">
            {tr("最近一次申訴：", "Latest appeal: ")}{appealStatusLabel(latestAppeal.status)}
          </p>
          {latestAppeal.status === "pending" && (
            <p className="text-muted-foreground mt-1">{tr("管理員審核中，請耐心等候，不需要重複送出。", "An admin is reviewing it — no need to submit again.")}</p>
          )}
          {latestAppeal.status === "rejected" && latestAppeal.admin_note && (
            <p className="text-muted-foreground mt-1">{tr("管理員備註：", "Admin note: ")}{latestAppeal.admin_note}</p>
          )}
        </div>
      )}

      {canSubmitNew && (
        <div className="space-y-2">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={tr("請說明這次未取餐的原因……", "Tell us why the meal wasn't picked up…")}
            rows={3}
          />
          <Button
            size="sm"
            disabled={submitMutation.isPending || !reason.trim()}
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? tr("送出中…", "Submitting…") : tr("送出申訴", "Submit appeal")}
          </Button>
        </div>
      )}
    </section>
  );
}

const roleLabel = (role: string) =>
  ({ customer: tr("一般會員", "Member"), vendor: tr("廠商", "Vendor"), admin: tr("平台管理員", "Admin") } as Record<string, string>)[role] ?? role;

export default function ProfilePage() {
  const [, navigate] = useLocation();
  const { user, isLoading } = useAuth();
  const { toast } = useToast();

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: () => navigate("/"),
    onError: (err: Error) => toast({ variant: "destructive", title: tr("登出失敗", "Sign-out failed"), description: err.message }),
  });

  function comingSoon(label: string) {
    toast({ title: tr(`${label}即將推出`, `${label} is coming soon`), description: tr("這個功能還在開發中，敬請期待。", "This feature is still in development.") });
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
            <ArrowLeft className="w-4 h-4 mr-1" /> {tr("回首頁", "Home")}
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-8 space-y-6">
        <h1 className="text-xl font-bold">{tr("會員中心", "My account")}</h1>

        {/* 帳號資訊 */}
        <section className="bg-white rounded-xl border border-border p-5">
          <div className="flex items-center gap-4 mb-5">
            <div className="w-14 h-14 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
              <User className="w-7 h-7 text-orange-500" />
            </div>
            <div>
              <p className="font-semibold text-lg">{user?.displayName || user?.username}</p>
              <span className="inline-block mt-1 text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                {roleLabel(user?.role ?? "customer")}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Mail className="w-4 h-4 shrink-0" /> {user?.email || tr("尚未設定", "Not set")}
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="w-4 h-4 shrink-0" /> {user?.phone || tr("尚未設定", "Not set")}
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

        {user && <TasteAndNotifySection user={user} />}

        {/* 快速功能 */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <button
            onClick={() => navigate("/my-bookings")}
            className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <ClipboardList className="w-5 h-5 text-orange-500 shrink-0" />
            <div>
              <p className="font-medium text-sm">{tr("我的訂單", "My orders")}</p>
              <p className="text-xs text-muted-foreground">{tr("查看鎖定與取餐紀錄", "See your locked meals and pickups")}</p>
            </div>
          </button>
          <button
            onClick={() => navigate("/rewards")}
            className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <History className="w-5 h-5 text-orange-500 shrink-0" />
            <div>
              <p className="font-medium text-sm">{tr("抽獎券與折價券", "Tickets & coupons")}</p>
              <p className="text-xs text-muted-foreground">{tr("成長獎勵：抽獎、查看折價券到期日", "Draw and check coupon expiry")}</p>
            </div>
          </button>
          <button
            onClick={() => comingSoon(tr("我的開團", "My group orders"))}
            className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
          >
            <Users className="w-5 h-5 text-orange-500 shrink-0" />
            <div>
              <p className="font-medium text-sm">{tr("我的開團", "My group orders")}</p>
              <p className="text-xs text-muted-foreground">{tr("管理你發起的合購", "Manage group orders you started")}</p>
            </div>
          </button>
          {user?.role === "customer" && (
            <button
              onClick={() => comingSoon(tr("申請成為廠商", "Vendor applications"))}
              className="bg-white rounded-xl border border-border p-4 flex items-center gap-3 text-left shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <Store className="w-5 h-5 text-orange-500 shrink-0" />
              <div>
                <p className="font-medium text-sm">{tr("申請成為廠商", "Become a vendor")}</p>
                <p className="text-xs text-muted-foreground">{tr("上架自己的餐點方案", "List your own meals")}</p>
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
          <LogOut className="w-4 h-4 mr-2" /> {tr("登出", "Sign out")}
        </Button>
      </main>
    </div>
  );
}

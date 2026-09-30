import { tr, loc } from "@/lib/i18n";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, where } from "firebase/firestore";
import {
  Mail, Phone, GraduationCap, ArrowLeft, LogOut,
  ClipboardList, Store, History, ShieldAlert, User, Utensils,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { logout } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useVendors } from "@/hooks/useVendors";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { db } from "@/lib/firebase";
import { avatarUrl } from "@/lib/avatar";
import { slotLabel } from "@/lib/pickupSlots";
import { cn } from "@/lib/utils";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import type { Lock, LockStatus, UserProfile } from "@/types";
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

const orderStatusLabel = (): Record<LockStatus, string> => ({
  locked: tr("鎖定中", "Locked"),
  for_resale: tr("轉賣中", "For resale"),
  for_gift: tr("贈送中", "Being gifted"),
  resold_and_fulfilled: tr("已轉賣完成取餐", "Picked up by new owner"),
  fulfilled: tr("已完成取餐", "Picked up"),
  no_show: tr("未取餐（舊制）", "No-show (legacy)"),
  charity: tr("已轉愛心餐", "Charity meal"),
  cancelling: tr("退款中", "Refunding"),
  cancelled: tr("已取消退款", "Cancelled"),
});

const orderStatusTone: Record<LockStatus, string> = {
  locked: "bg-orange-50 text-orange-700",
  for_resale: "bg-blue-50 text-blue-700",
  for_gift: "bg-blue-50 text-blue-700",
  resold_and_fulfilled: "bg-green-50 text-green-700",
  fulfilled: "bg-green-50 text-green-700",
  no_show: "bg-gray-100 text-gray-600",
  charity: "bg-pink-50 text-pink-700",
  cancelling: "bg-gray-100 text-gray-600",
  cancelled: "bg-gray-100 text-gray-600",
};

function formatDate(ts: unknown): string {
  const d = (ts as { toDate?: () => Date } | undefined)?.toDate?.();
  return d ? d.toLocaleDateString() : "—";
}

// 我的訂單——表格呈現最近的鎖定紀錄，完整功能（QR、轉讓、贈送、評分）還是在 /my-bookings。
function OrdersPanel({ uid }: { uid: string }) {
  const { data: vendors = [] } = useVendors();
  const { data: locks = [], isLoading } = useQuery({
    queryKey: ["myProfileRecentLocks", uid],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "locks"), where("buyer_uid", "==", uid), limit(200)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Lock & { created_at?: { toMillis?: () => number } });
    },
  });
  const recent = [...locks]
    .sort((a, b) => (b.created_at?.toMillis?.() ?? 0) - (a.created_at?.toMillis?.() ?? 0))
    .slice(0, 20);
  const labels = orderStatusLabel();

  return (
    <section className="bg-white rounded-xl border border-border overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between gap-2">
        <h2 className="font-semibold">{tr("我的訂單", "My orders")}</h2>
        <Button asChild size="sm" variant="outline"><Link href="/my-bookings">{tr("查看完整我的餐點", "See full order history")}</Link></Button>
      </div>
      {isLoading ? (
        <div className="p-4"><SkeletonBlocks count={3} height={44} className="space-y-2" /></div>
      ) : recent.length === 0 ? (
        <div className="p-6">
          <EmptyState size="compact" icon={<ClipboardList size={32} />} title={tr("還沒有訂單紀錄", "No orders yet")} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-muted-foreground">
                <th className="text-left font-medium px-4 py-2">{tr("品項", "Item")}</th>
                <th className="text-left font-medium px-4 py-2">{tr("商家", "Vendor")}</th>
                <th className="text-left font-medium px-4 py-2">{tr("取餐日期", "Pickup")}</th>
                <th className="text-left font-medium px-4 py-2">{tr("金額", "Price")}</th>
                <th className="text-left font-medium px-4 py-2">{tr("狀態", "Status")}</th>
                <th className="text-left font-medium px-4 py-2">{tr("建立日期", "Created")}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((lock) => (
                <tr key={lock.id} className="border-t border-border">
                  <td className="px-4 py-2.5">{loc(lock, "item_name")}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{loc(vendors.find((v) => v.id === lock.vendor_id), "name") || "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{lock.pickup_date}（{slotLabel(lock.pickup_window)}）</td>
                  <td className="px-4 py-2.5">${lock.locked_price}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn("inline-block text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap", orderStatusTone[lock.status])}>
                      {labels[lock.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{formatDate(lock.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AccountPanel({ user }: { user: UserProfile }) {
  return (
    <section className="bg-white rounded-xl border border-border p-5">
      <div className="flex items-center gap-4 mb-5">
        <div className="w-14 h-14 rounded-full bg-orange-100 shrink-0 overflow-hidden">
          <img src={avatarUrl(user.id)} alt="" className="w-full h-full" />
        </div>
        <div>
          <p className="font-semibold text-lg">{user.displayName || user.username}</p>
          <span className="inline-block mt-1 text-xs font-medium text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
            {roleLabel(user.role)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Mail className="w-4 h-4 shrink-0" /> {user.email || tr("尚未設定", "Not set")}
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Phone className="w-4 h-4 shrink-0" /> {user.phone || tr("尚未設定", "Not set")}
        </div>
        {user.department && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <GraduationCap className="w-4 h-4 shrink-0" />
            {user.department}{user.studentId ? `・${user.studentId}` : ""}
          </div>
        )}
      </div>
    </section>
  );
}

type Tab = "account" | "orders" | "taste";

function SidebarButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors",
        active ? "bg-orange-50 text-orange-700" : "text-muted-foreground hover:bg-gray-50 hover:text-foreground"
      )}
    >
      {icon} {label}
    </button>
  );
}

export default function ProfilePage() {
  const [, navigate] = useLocation();
  const { user, isLoading } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("account");

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

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-8 flex flex-col md:flex-row gap-6">
        {/* ── 左側：會員專區導覽 ── */}
        <aside className="md:w-56 shrink-0">
          <div className="bg-white rounded-xl border border-border p-3 space-y-1 md:sticky md:top-20">
            <p className="px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tr("會員專區", "Member area")}</p>
            <SidebarButton active={tab === "account"} icon={<User className="w-4 h-4" />} label={tr("帳號資訊", "Account")} onClick={() => setTab("account")} />
            <SidebarButton active={tab === "orders"} icon={<ClipboardList className="w-4 h-4" />} label={tr("我的訂單", "My orders")} onClick={() => setTab("orders")} />
            <SidebarButton active={tab === "taste"} icon={<Utensils className="w-4 h-4" />} label={tr("口味與通知", "Taste & notifications")} onClick={() => setTab("taste")} />

            <div className="my-2 border-t border-border" />

            <button
              onClick={() => navigate("/rewards")}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left text-muted-foreground hover:bg-gray-50 hover:text-foreground transition-colors"
            >
              <History className="w-4 h-4" /> {tr("抽獎券與折價券", "Tickets & coupons")}
            </button>
            {user?.role === "customer" && (
              <button
                onClick={() => comingSoon(tr("申請成為廠商", "Vendor applications"))}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left text-muted-foreground hover:bg-gray-50 hover:text-foreground transition-colors"
              >
                <Store className="w-4 h-4" /> {tr("申請成為廠商", "Become a vendor")}
              </button>
            )}

            <div className="my-2 border-t border-border" />

            <button
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-left text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" /> {tr("登出", "Sign out")}
            </button>
          </div>
        </aside>

        {/* ── 右側：內容 ── */}
        <main className="flex-1 min-w-0 space-y-6">
          {user?.orderBanned && <BanAppealSection user={user} />}
          {user && tab === "account" && <AccountPanel user={user} />}
          {user && tab === "orders" && <OrdersPanel uid={user.id} />}
          {user && tab === "taste" && <TasteAndNotifySection user={user} />}
        </main>
      </div>
    </div>
  );
}

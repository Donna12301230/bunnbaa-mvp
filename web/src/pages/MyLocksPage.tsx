import { LOCK_STATUS_STYLE } from "@/lib/lockOutcome";
import { tr } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { format } from "date-fns";
import { enUS, zhTW } from "date-fns/locale";
import { getLang } from "@/lib/i18n";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { db } from "@/lib/firebase";
import type { Lock } from "@/types";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { Button } from "@/components/ui/button";

// 「我的鎖定/訂單記錄頁」——TODO.md 本來沒描述範圍，跟使用者確認後決定做一個
// 獨立的真實資料簡易列表頁：直接查詢目前登入者自己的 locks（buyer_uid），
// 不做 MyBookingsPage.tsx 那種週曆版面。之後可以當作把 MyBookingsPage 從
// mock 換成真資料的中間步驟。
//
// 查詢只用單一 equality（buyer_uid），不加 orderBy，避免另外要求新的複合索引
// （同 VendorPortalPrep/TransferMarketPage 的慣例），排序交給前端做。


function formatDateLabel(dateStr: string): string {
  try {
    return format(new Date(`${dateStr}T00:00:00`), "M/d (EEE)", { locale: getLang() === "en" ? enUS : zhTW });
  } catch {
    return dateStr;
  }
}

function createdAtMillis(lock: Lock): number {
  const ts = lock.created_at as { toMillis?: () => number } | undefined;
  return ts?.toMillis ? ts.toMillis() : 0;
}

export default function MyLocksPage() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const uid = user?.id ?? null;
  const [locks, setLocks] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "locks"), where("buyer_uid", "==", uid), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [uid]);

  const sorted = [...locks].sort((a, b) => createdAtMillis(b) - createdAtMillis(a));

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 bg-white border-b border-border">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <h1 className="text-lg font-bold flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-orange-500" /> {tr("我的訂單記錄", "My order history")}
          </h1>
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => navigate("/profile")}>
            <ArrowLeft /> {tr("回會員中心", "Back to My account")}
          </Button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-8">
        {!authLoading && !uid ? (
          <EmptyState
            icon={<ClipboardList size={32} />}
            title={tr("請先登入", "Please sign in")}
            description={tr("登入後就能看到你的訂單記錄。", "Sign in to see your order history.")}
            action={<Button asChild><Link href="/login">{tr("前往登入", "Sign in")}</Link></Button>}
          />
        ) : loading ? (
          <SkeletonBlocks count={3} height={160} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={32} />}
            title={tr("還沒有預約紀錄", "No bookings yet")}
            description={tr("到「預購餐點」鎖一份餐點，隔天就不用排隊。", "Lock in a meal under Pre-order and skip tomorrow's queue.")}
            action={<Button asChild><Link href="/home">{tr("去預約餐點", "Pre-order a meal")}</Link></Button>}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map((lock) => {
              const statusInfo = LOCK_STATUS_STYLE[lock.status] ?? { label: lock.status, className: "bg-gray-100 text-gray-700" };
              return (
                <article key={lock.id} className="bg-white border border-border rounded-xl p-4 flex flex-col gap-1.5">
                  <span className={`self-start text-xs font-bold px-2 py-0.5 rounded-full ${statusInfo.className}`}>
                    {statusInfo.label}
                  </span>
                  <h3 className="font-semibold leading-snug">{lock.item_name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {formatDateLabel(lock.pickup_date)}・{lock.pickup_window}
                  </p>
                  <p className="font-bold text-orange-600">${lock.locked_price}</p>
                  {lock.consumer_feedback && (
                    <p className="text-xs text-muted-foreground mt-1">{tr("已回饋：", "Your feedback: ")}「{lock.consumer_feedback}」</p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

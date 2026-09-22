import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { auth, db } from "@/lib/firebase";
import type { Lock } from "@/types";

// 「我的鎖定/訂單記錄頁」——TODO.md 本來沒描述範圍，跟使用者確認後決定做一個
// 獨立的真實資料簡易列表頁：直接查詢目前登入者自己的 locks（buyer_uid），
// 不做 MyBookingsPage.tsx 那種週曆版面。之後可以當作把 MyBookingsPage 從
// mock 換成真資料的中間步驟。
//
// 查詢只用單一 equality（buyer_uid），不加 orderBy，避免另外要求新的複合索引
// （同 VendorPortalPrep/TransferMarketPage 的慣例），排序交給前端做。
const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  locked: { label: "已鎖定", className: "bg-orange-100 text-orange-700" },
  for_resale: { label: "轉賣中", className: "bg-amber-100 text-amber-800" },
  for_gift: { label: "贈送中", className: "bg-blue-100 text-blue-700" },
  fulfilled: { label: "已完成取餐", className: "bg-green-100 text-green-700" },
  resold_and_fulfilled: { label: "已由轉賣對象完成取餐", className: "bg-green-100 text-green-700" },
  no_show: { label: "已登記未取餐", className: "bg-red-100 text-red-700" },
};

function formatDateLabel(dateStr: string): string {
  try {
    return format(new Date(`${dateStr}T00:00:00`), "M/d (EEE)", { locale: zhTW });
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
  const [uid, setUid] = useState<string | null>(null);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

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
            <ClipboardList className="w-5 h-5 text-orange-500" /> 我的訂單記錄
          </h1>
          <button
            onClick={() => navigate("/profile")}
            className="flex items-center text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> 回會員中心
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 md:px-6 py-8">
        {loading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">目前沒有任何鎖定紀錄。到「預購鎖定」鎖一份餐點看看。</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sorted.map((lock) => {
              const statusInfo = STATUS_STYLE[lock.status] ?? { label: lock.status, className: "bg-gray-100 text-gray-700" };
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
                    <p className="text-xs text-muted-foreground mt-1">已回饋：「{lock.consumer_feedback}」</p>
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

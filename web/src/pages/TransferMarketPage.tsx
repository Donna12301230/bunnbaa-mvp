import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { Search, Clock, MapPin, UtensilsCrossed } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { auth, db, functions } from "@/lib/firebase";
import { isClean } from "@/lib/searchFilter";
import type { Lock } from "@/types";

// 對應 UI草圖 Marketplace.dc.html「轉讓市集」。接上真實 Firestore,沿用
// ConsumerLockPage.tsx 已驗證過的模式:
//   - 「我要接手」呼叫 claimResoldLock（functions/src/index.js，正式站要等 Blaze）
//   - 「免費領取」是純 client-side 規則（firestore.rules：for_resale 且
//     resale_deadline 已過，任何登入用戶可直接 updateDoc），不用排程
//   - 沿用同一組 vendor_id + created_at 索引，篩選 for_resale 交給前端做，
//     避免另外要求新的複合索引（跟 VendorRedeemPage/VendorPortalPrep 同慣例）
// 「取消轉讓」2026-09-22 補上 firestore.rules 規則（owner 可以把還沒被接手的
// for_resale 改回 locked），「我的轉讓」現在是真的可以取消。已被接手的項目一旦
// buyer_uid 換人就無法再用「我的」查回來（資料模型沒有記錄原轉讓者），這頁
// 「我的轉讓」只會顯示目前還在轉讓中、尚未被接手的項目。
// 轉賣價格由買家雙方私下議定、平台不經手，所以這裡不顯示「轉讓價」，只顯示
// 原鎖定價（locked_price）。
const VENDOR_ID = "cafe-renheya-demo";

function formatCountdown(deadline: Date, now: number): string {
  const diffMin = Math.round((deadline.getTime() - now) / 60000);
  if (diffMin <= 0) return "已逾期";
  if (diffMin < 60) return `${diffMin} 分後截止`;
  return `${Math.floor(diffMin / 60)} 小時 ${diffMin % 60} 分後截止`;
}

export default function TransferMarketPage() {
  const { toast } = useToast();
  const [browseTab, setBrowseTab] = useState<"browse" | "mine">("browse");
  const [search, setSearch] = useState("");
  const [uid, setUid] = useState<string | null>(null);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [claimingId, setClaimingId] = useState<string | null>(null);

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "locks"),
      where("vendor_id", "==", VENDOR_ID),
      orderBy("created_at", "desc"),
      limit(200)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  // 逾時判斷是純前端算的（沒有排程 Function 幫忙轉狀態），要固定重算才會即時從
  // 「我要接手」變成「免費領取」。
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  function deadlineOf(lock: Lock): Date | null {
    const ts = lock.resale_deadline as { toDate?: () => Date } | undefined;
    return ts?.toDate ? ts.toDate() : null;
  }

  // 不雅字詞當作沒輸入搜尋字串處理，不特別跳錯誤訊息。
  const searchLower = isClean(search) ? search.trim().toLowerCase() : "";
  const forResale = useMemo(
    () =>
      locks.filter(
        (l) =>
          l.status === "for_resale" &&
          l.buyer_uid !== uid &&
          (!searchLower || l.item_name.toLowerCase().includes(searchLower))
      ),
    [locks, uid, searchLower]
  );
  const activeListings = forResale.filter((l) => {
    const d = deadlineOf(l);
    return !d || d.getTime() > now;
  });
  const expiredListings = forResale.filter((l) => {
    const d = deadlineOf(l);
    return d && d.getTime() <= now;
  });
  const myListings = useMemo(
    () => locks.filter((l) => l.status === "for_resale" && l.buyer_uid === uid),
    [locks, uid]
  );

  async function handleClaim(lockId: string) {
    setClaimingId(lockId);
    try {
      const fn = httpsCallable(functions, "claimResoldLock");
      await fn({ lock_id: lockId });
      toast({ title: "已接手", description: "取餐編號可在「我的餐點」查看。" });
    } catch (err) {
      toast({ title: "接手失敗", description: (err as Error).message, variant: "destructive" });
    } finally {
      setClaimingId(null);
    }
  }

  async function handleClaimFree(lockId: string) {
    if (!uid) return;
    setClaimingId(lockId);
    try {
      await updateDoc(doc(db, "locks", lockId), {
        status: "locked",
        buyer_uid: uid,
        locked_price: 0,
      });
      toast({ title: "已免費領取", description: "取餐編號可在「我的餐點」查看。" });
    } catch (err) {
      toast({ title: "領取失敗", description: (err as Error).message, variant: "destructive" });
    } finally {
      setClaimingId(null);
    }
  }

  async function handleCancelListing(lockId: string) {
    setClaimingId(lockId);
    try {
      await updateDoc(doc(db, "locks", lockId), { status: "locked" });
      toast({ title: "已取消轉讓" });
    } catch (err) {
      toast({ title: "取消失敗", description: (err as Error).message, variant: "destructive" });
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader active="transfer" />

      {/* ── Hero ── */}
      <section className="bg-gradient-to-br from-orange-500 to-orange-600 px-4 md:px-6 py-10">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-6 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-1.5">轉讓市集</h1>
            <p className="text-sm text-white">同學安全轉讓已鎖定的方案，全額入袋；逾時沒人接手，系統會自動開放 $0 元供人領取。</p>
          </div>
          <div className="flex items-center gap-2 bg-white rounded-xl p-1.5 pl-4 min-w-[300px]">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <label htmlFor="marketplaceSearch" className="sr-only">搜尋轉讓項目</label>
            <input
              id="marketplaceSearch"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜尋餐點名稱"
              className="flex-1 border-none outline-none bg-transparent text-sm py-2"
            />
          </div>
        </div>
      </section>

      {/* ── Body ── */}
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-8 space-y-6">
        <div className="flex gap-2">
          <button
            onClick={() => setBrowseTab("browse")}
            className={`text-sm font-bold px-[18px] py-2.5 rounded-full transition-colors ${
              browseTab === "browse" ? "bg-orange-500 text-white" : "bg-white text-muted-foreground border border-border"
            }`}
          >
            瀏覽轉讓
          </button>
          <button
            onClick={() => setBrowseTab("mine")}
            className={`text-sm font-bold px-[18px] py-2.5 rounded-full transition-colors ${
              browseTab === "mine" ? "bg-orange-500 text-white" : "bg-white text-muted-foreground border border-border"
            }`}
          >
            我的轉讓
          </button>
        </div>

        {loading && <p className="text-sm text-muted-foreground">載入中…</p>}

        {!loading && browseTab === "browse" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3.5">
              <span className="text-sm text-muted-foreground font-semibold">目前 {activeListings.length} 筆轉讓中</span>
            </div>

            {activeListings.length === 0 ? (
              <p className="text-sm text-muted-foreground">目前沒有人轉讓，稍後再回來看看。</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {activeListings.map(item => {
                  const deadline = deadlineOf(item);
                  return (
                    <article key={item.id} className="rounded-xl bg-white border border-border overflow-hidden flex flex-col">
                      <div className="relative h-[130px] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
                        <UtensilsCrossed className="h-10 w-10 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
                        {deadline && (
                          <span className="absolute top-2.5 right-2.5 flex items-center gap-1 text-caption font-bold px-2.5 py-1 rounded-full bg-gray-900 text-white">
                            <Clock className="w-3 h-3" /> {formatCountdown(deadline, now)}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-2.5 p-4 flex-1">
                        <h3 className="text-body font-bold leading-snug">{item.item_name}</h3>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5" /> {item.pickup_date} · {item.pickup_window}
                        </div>
                        <div className="flex items-center justify-between mt-auto pt-1.5">
                          <span className="text-lg font-extrabold">${item.locked_price}</span>
                          <Button
                            size="sm"
                            disabled={claimingId === item.id}
                            onClick={() => handleClaim(item.id)}
                            className="bg-orange-500 hover:bg-orange-600 text-white"
                          >
                            {claimingId === item.id ? "處理中…" : "我要接手"}
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-2.5 pt-2 flex-wrap">
              <Clock className="w-5 h-5" />
              <h2 className="text-lg font-bold">已逾期・開放 $0 元領取</h2>
              <span className="text-xs text-muted-foreground">取餐時段結束仍未被接手，系統自動開放給任何人免費領取，先到先得</span>
            </div>

            {expiredListings.length === 0 ? (
              <p className="text-sm text-muted-foreground">目前沒有逾期的項目。</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {expiredListings.map(item => (
                  <article key={item.id} className="rounded-xl bg-white border border-border overflow-hidden flex flex-col">
                    <div className="relative h-[130px] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
                      <UtensilsCrossed className="h-10 w-10 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
                      <span className="absolute top-2.5 right-2.5 text-caption font-bold px-2.5 py-1 rounded-full bg-gray-900 text-white">
                        已逾期・開放中
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 p-4 flex-1">
                      <h3 className="text-body font-bold leading-snug">{item.item_name}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" /> {item.pickup_date} · {item.pickup_window}
                      </div>
                      <div className="flex items-center justify-between mt-auto pt-1.5">
                        <div>
                          <span className="text-xs text-gray-500 line-through mr-1.5">${item.locked_price}</span>
                          <span className="text-lg font-extrabold">$0</span>
                        </div>
                        <Button
                          size="sm"
                          disabled={claimingId === item.id}
                          onClick={() => handleClaimFree(item.id)}
                          className="bg-gray-900 hover:bg-gray-800 text-white"
                        >
                          {claimingId === item.id ? "處理中…" : "免費領取"}
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {!loading && browseTab === "mine" && (
          <>
            <span className="text-sm text-muted-foreground font-semibold">你目前有 {myListings.length} 筆商品在轉讓市集</span>

            {myListings.length === 0 ? (
              <p className="text-sm text-muted-foreground">你目前沒有轉讓中的項目。到「我的餐點」把還沒用到的份轉讓出去。</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {myListings.map(item => (
                  <article key={item.id} className="rounded-xl bg-white border border-border overflow-hidden flex flex-col">
                    <div className="relative h-[130px] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
                      <UtensilsCrossed className="h-10 w-10 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
                      <span className="absolute top-2.5 right-2.5 text-caption font-bold px-2.5 py-1 rounded-full bg-orange-500 text-white">
                        轉讓中
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 p-4 flex-1">
                      <h3 className="text-body font-bold leading-snug">{item.item_name}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" /> {item.pickup_date} · {item.pickup_window}
                      </div>
                      <div className="flex items-center justify-between mt-auto pt-1.5">
                        <span className="text-lg font-extrabold">${item.locked_price}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-300 text-red-600 hover:bg-red-50"
                          disabled={claimingId === item.id}
                          onClick={() => handleCancelListing(item.id)}
                        >
                          {claimingId === item.id ? "處理中…" : "取消轉讓"}
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              已被接手的項目目前無法在此追蹤紀錄，因為資料模型沒有記錄原轉讓者（buyer_uid 換人後就查不到了）。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { httpsCallable } from "@/lib/callable";
import { onAuthStateChanged } from "firebase/auth";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { Clock, MapPin, UtensilsCrossed, Repeat } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import PageHero, { HeroSearch } from "@/components/PageHero";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { auth, db, functions } from "@/lib/firebase";
import { isClean } from "@/lib/searchFilter";
import { takeOverLock } from "@/lib/transfers";
import type { Lock } from "@/types";
import { useVendors } from "@/hooks/useVendors";
import { useItemImages } from "@/hooks/useItemImages";
import { useSelectedArea, vendorInArea } from "@/lib/location";
import { tr, loc } from "@/lib/i18n";
import { EmptyState, Tag } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { Link } from "wouter";

// 對應 UI草圖 Marketplace.dc.html「轉讓市集」。接上真實 Firestore,沿用
// ConsumerLockPage.tsx 已驗證過的模式:
//   - 「我要接手」呼叫 claimResoldLock（functions/src/index.js，正式站要等 Blaze）
//   - 「免費領取」是純 client-side 規則（firestore.rules：for_resale 且
//     resale_deadline 已過，任何登入用戶可直接 updateDoc），不用排程
//   - 列出所有商家的轉讓，只用 status 單一等值查詢（自動索引），排序交給前端，
//     避免另外要求新的複合索引
// 「取消轉讓」2026-09-22 補上 firestore.rules 規則（owner 可以把還沒被接手的
// for_resale 改回 locked），「我的轉讓」現在是真的可以取消。已被接手的項目靠
// locks.transferred_from_uids（接手時由 claimResoldLock／firestore.rules 強制寫入
// 原持有人）查回來，原持有人也保有讀取權限。
// 轉賣價格由買家雙方私下議定、平台不經手，所以這裡不顯示「轉讓價」，只顯示
// 原鎖定價（locked_price）。

function millisOf(ts: unknown): number {
  return (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
}

function formatCountdown(deadline: Date, now: number): string {
  const diffMin = Math.round((deadline.getTime() - now) / 60000);
  if (diffMin <= 0) return tr("已逾期", "Expired");
  if (diffMin < 60) return tr(`${diffMin} 分後截止`, `Ends in ${diffMin} min`);
  return tr(`${Math.floor(diffMin / 60)} 小時 ${diffMin % 60} 分後截止`, `Ends in ${Math.floor(diffMin / 60)} h ${diffMin % 60} min`);
}

export default function TransferMarketPage() {
  const { toast } = useToast();
  const [browseTab, setBrowseTab] = useState<"browse" | "mine">("browse");
  const [search, setSearch] = useState("");
  const [uid, setUid] = useState<string | null>(null);
  const requireLogin = useRequireLogin();
  const [locks, setLocks] = useState<Lock[]>([]);
  const [handedOver, setHandedOver] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const { data: vendors = [] } = useVendors();
  const imageOf = useItemImages();
  const vendorName = (id: string) => loc(vendors.find((v) => v.id === id), "name");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  useEffect(() => {
    // 只查轉賣中的：locks 只有 for_resale／for_gift 是公開可讀（firestore.rules），
    // 查詢條件要讓規則能證明每一筆都符合，不然整個查詢會被拒絕
    // 所有商家一起列；只用 status 單一等值（自動索引），排序交給前端
    const q = query(collection(db, "locks"), where("status", "==", "for_resale"), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLocks(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock)
            .sort((a, b) => millisOf(b.created_at) - millisOf(a.created_at))
        );
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, []);

  // 已被接手的：只用 array-contains 單一條件（自動單欄位索引），店家篩選和排序
  // 交給前端，避免新的複合索引。
  useEffect(() => {
    if (!uid) {
      setHandedOver([]);
      return;
    }
    const q = query(collection(db, "locks"), where("transferred_from_uids", "array-contains", uid), limit(100));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock)
          // 接手後又轉回自己手上的，算在自己的項目，不算已被接手
          .filter((l) => l.buyer_uid !== uid)
          .sort((a, b) => millisOf(b.created_at) - millisOf(a.created_at));
        setHandedOver(rows);
      },
      () => setHandedOver([])
    );
    return () => unsub();
  }, [uid]);

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
  const area = useSelectedArea();
  const forResale = useMemo(
    () =>
      locks.filter(
        (l) =>
          l.status === "for_resale" &&
          l.buyer_uid !== uid &&
          (!area || vendorInArea(vendors.find((v) => v.id === l.vendor_id), area)) &&
          (!searchLower || l.item_name.toLowerCase().includes(searchLower) || (l.item_name_en ?? "").toLowerCase().includes(searchLower))
      ),
    [locks, uid, searchLower, area, vendors]
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
    if (!requireLogin()) return;
    setClaimingId(lockId);
    try {
      const fn = httpsCallable(functions, "claimResoldLock");
      await fn({ lock_id: lockId });
      toast({ title: tr("已接手", "It's yours"), description: tr("取餐編號可在「我的餐點」查看。", "Find the pickup code under My meals.") });
    } catch (err) {
      toast({ title: tr("接手失敗", "Couldn't take it over"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setClaimingId(null);
    }
  }

  async function handleClaimFree(lockId: string) {
    if (!requireLogin() || !uid) return;
    setClaimingId(lockId);
    try {
      await takeOverLock(lockId, uid, { locked_price: 0 });
      toast({ title: tr("已免費領取", "Claimed for free"), description: tr("取餐編號可在「我的餐點」查看。", "Find the pickup code under My meals.") });
    } catch (err) {
      toast({ title: tr("領取失敗", "Couldn't claim it"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setClaimingId(null);
    }
  }

  async function handleCancelListing(lockId: string) {
    setClaimingId(lockId);
    try {
      await updateDoc(doc(db, "locks", lockId), { status: "locked" });
      toast({ title: tr("已取消轉讓", "Transfer cancelled") });
    } catch (err) {
      toast({ title: tr("取消失敗", "Couldn't cancel"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader active="transfer" />

      <PageHero
        title={tr("轉讓市集", "Transfer market")}
        description={tr("同學安全轉讓已鎖定的方案，全額入袋；逾時沒人接手，系統會自動開放 $0 元供人領取。", "Safely pass locked meals between classmates. If nobody takes one in time, anyone can claim it for $0.")}
      >
        <HeroSearch id="marketplaceSearch" label={tr("搜尋轉讓項目", "Search transfers")} value={search} onChange={setSearch} placeholder={tr("搜尋餐點名稱", "Search by meal name")} />
      </PageHero>

      {/* ── Body ── */}
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-8 space-y-6">
        <div className="flex gap-2">
          <Tag selected={browseTab === "browse"} onClick={() => setBrowseTab("browse")}>
            {tr("瀏覽轉讓", "Browse")}
          </Tag>
          <Tag selected={browseTab === "mine"} onClick={() => setBrowseTab("mine")}>
            {tr("我的轉讓", "My transfers")}
          </Tag>
        </div>

        {loading && <SkeletonBlocks count={3} height={240} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5" />}

        {!loading && browseTab === "browse" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3.5">
              <span className="text-sm text-muted-foreground font-semibold">{tr(`目前 ${activeListings.length} 筆轉讓中`, `${activeListings.length} available`)}</span>
            </div>

            {activeListings.length === 0 ? (
              <EmptyState icon={<Repeat size={32} />} title={tr("目前沒有人轉讓", "Nothing up for transfer")} description={tr("稍後再回來看看，有新的轉讓會即時出現。", "Check back later — new transfers appear instantly.")} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {activeListings.map(item => {
                  const deadline = deadlineOf(item);
                  return (
                    <article key={item.id} className="rounded-xl bg-white border border-border overflow-hidden flex flex-col">
                      <div className="relative h-[130px] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
                        {imageOf(item) ? (
                        <img src={imageOf(item)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <UtensilsCrossed className="h-10 w-10 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
                      )}
                        {deadline && (
                          <span className="absolute top-2.5 right-2.5 flex items-center gap-1 text-caption font-bold px-2.5 py-1 rounded-full bg-rice text-rice-foreground">
                            <Clock className="w-3 h-3" /> {formatCountdown(deadline, now)}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-2.5 p-4 flex-1">
                        <h3 className="text-body font-bold leading-snug">{loc(item, "item_name")}</h3>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5" /> {vendorName(item.vendor_id) ? `${vendorName(item.vendor_id)} · ` : ""}{item.pickup_date} · {item.pickup_window}
                        </div>
                        <div className="flex items-center justify-between mt-auto pt-1.5">
                          <span className="text-lg font-extrabold">${item.locked_price}</span>
                          <Button
                            size="sm"
                            disabled={claimingId === item.id}
                            onClick={() => handleClaim(item.id)}
                          >
                            {claimingId === item.id ? tr("處理中…", "Working…") : tr("我要接手", "Take it")}
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
              <h2 className="text-lg font-bold">{tr("已逾期・開放 $0 元領取", "Expired · free to claim")}</h2>
              <span className="text-xs text-muted-foreground">{tr("取餐時段結束仍未被接手，系統自動開放給任何人免費領取，先到先得", "Not taken by the end of the pickup window, so anyone can claim it for free — first come, first served")}</span>
            </div>

            {expiredListings.length === 0 ? (
              <EmptyState size="compact" icon={<Clock size={32} />} title={tr("目前沒有逾期的項目", "No expired items")} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {expiredListings.map(item => (
                  <article key={item.id} className="rounded-xl bg-white border border-border overflow-hidden flex flex-col">
                    <div className="relative h-[130px] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
                      {imageOf(item) ? (
                        <img src={imageOf(item)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <UtensilsCrossed className="h-10 w-10 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
                      )}
                      <span className="absolute top-2.5 right-2.5 text-caption font-bold px-2.5 py-1 rounded-full bg-rice text-rice-foreground">
                        {tr("已逾期・開放中", "Expired · open")}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 p-4 flex-1">
                      <h3 className="text-body font-bold leading-snug">{loc(item, "item_name")}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" /> {vendorName(item.vendor_id) ? `${vendorName(item.vendor_id)} · ` : ""}{item.pickup_date} · {item.pickup_window}
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
                        >
                          {claimingId === item.id ? tr("處理中…", "Working…") : tr("免費領取", "Claim free")}
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
            <span className="text-sm text-muted-foreground font-semibold">{tr(`你目前有 ${myListings.length} 筆商品在轉讓市集`, `You have ${myListings.length} item(s) listed`)}</span>

            {myListings.length === 0 ? (
              <EmptyState
                icon={<Repeat size={32} />}
                title={tr("你目前沒有轉讓中的項目", "You have nothing listed")}
                description={tr("臨時不能去？到「我的餐點」把還沒用到的份轉讓出去。", "Can't make it? Transfer an unused meal from My meals.")}
                action={<Button asChild variant="outline"><Link href="/my-bookings">{tr("前往我的餐點", "Go to My meals")}</Link></Button>}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {myListings.map(item => (
                  <article key={item.id} className="rounded-xl bg-white border border-border overflow-hidden flex flex-col">
                    <div className="relative h-[130px] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
                      {imageOf(item) ? (
                        <img src={imageOf(item)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <UtensilsCrossed className="h-10 w-10 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
                      )}
                      <span className="absolute top-2.5 right-2.5 text-caption font-bold px-2.5 py-1 rounded-full bg-orange-500 text-white">
                        {tr("轉讓中", "Listed")}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 p-4 flex-1">
                      <h3 className="text-body font-bold leading-snug">{loc(item, "item_name")}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" /> {vendorName(item.vendor_id) ? `${vendorName(item.vendor_id)} · ` : ""}{item.pickup_date} · {item.pickup_window}
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
                          {claimingId === item.id ? tr("處理中…", "Working…") : tr("取消轉讓", "Cancel transfer")}
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2.5 pt-2 flex-wrap">
              <Repeat className="w-5 h-5" />
              <h2 className="text-lg font-bold">{tr("已被接手", "Taken over")}</h2>
              <span className="text-xs text-muted-foreground">{tr("你轉讓或贈送出去、已經有人接手的項目", "Meals you transferred or gifted that someone has taken")}</span>
            </div>

            {handedOver.length === 0 ? (
              <EmptyState size="compact" icon={<Repeat size={32} />} title={tr("還沒有被接手的項目", "Nothing taken over yet")} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {handedOver.map(item => (
                  <article key={item.id} className="rounded-xl bg-white border border-border overflow-hidden flex flex-col">
                    <div className="relative h-[130px] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
                      {imageOf(item) ? (
                        <img src={imageOf(item)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <UtensilsCrossed className="h-10 w-10 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
                      )}
                      <span className="absolute top-2.5 right-2.5 text-caption font-bold px-2.5 py-1 rounded-full bg-gray-200 text-gray-700">
                        {tr("已被接手", "Taken over")}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 p-4 flex-1">
                      <h3 className="text-body font-bold leading-snug">{loc(item, "item_name")}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" /> {vendorName(item.vendor_id) ? `${vendorName(item.vendor_id)} · ` : ""}{item.pickup_date} · {item.pickup_window}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

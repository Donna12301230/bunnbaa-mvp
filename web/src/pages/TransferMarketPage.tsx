import { useEffect, useMemo, useState } from "react";
import { formatNT, formatPickupDate } from "@/lib/format";
import { collection, doc, limit, onSnapshot, query, updateDoc, where } from "firebase/firestore";
import { httpsCallable } from "@/lib/callable";
import { onAuthStateChanged } from "firebase/auth";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { Clock, HeartHandshake, MapPin, UtensilsCrossed, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "@/hooks/use-toast";
import { auth, db, functions } from "@/lib/firebase";
import { isClean } from "@/lib/searchFilter";
import { isFreeTransfer, refundOnTakeover, resaleDeadlineOf, resalePrice } from "@/lib/transfers";
import { isSlotEnded } from "@/lib/pickupSlots";
import type { Lock } from "@/types";
import { useVendors } from "@/hooks/useVendors";
import { useItemImages } from "@/hooks/useItemImages";
import { useSelectedArea, vendorInArea } from "@/lib/location";
import { tr, loc } from "@/lib/i18n";
import { EmptyState, Tag } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { Link, useLocation } from "wouter";

// Matches the "Resale market" screen in the UI mockup Marketplace.dc.html. Wired to real Firestore, following
// the pattern already proven in ConsumerLockPage.tsx:
//   - "Take over" = paid takeover: createResaleLinePayReservation holds it for 15 minutes and redirects to
//     LINE Pay; after payment confirmation (confirmLinePayPayment) ownership changes and the original payer is refunded automatically (functions/src/orders.js)
//   - $0 resales (custom price 0, or opened up for free claim after the timeout) are no longer listed here since 2026-10-09;
//     they're on the "Nearby charity meals" tab instead (components/FreeTransfersSection.tsx)
//   - Lists resales from all vendors with a single status equality query (automatic index); sorting is done client-side
//     to avoid needing a new composite index
// "Cancel resale": firestore.rules was updated on 2026-09-22 (the owner can turn a for_resale that hasn't been taken over
// back into locked), so "My resales" can now really be cancelled. Items already taken over are found via
// locks.transferred_from_uids (written with the original holder on takeover, enforced by confirmLinePayPayment / firestore.rules),
// and the original holder keeps read access.
// Cards show the takeover price (before early-bird and coupons, lib/transfers.ts resalePrice); this is what the taker actually pays.

function millisOf(ts: unknown): number {
  return (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
}

function formatCountdown(deadline: Date, now: number): string {
  const diffMin = Math.round((deadline.getTime() - now) / 60000);
  if (diffMin <= 0) return tr("已逾期", "Expired");
  if (diffMin < 60) return tr(`${diffMin} 分後截止`, `Ends in ${diffMin} min`);
  return tr(`${Math.floor(diffMin / 60)} 小時 ${diffMin % 60} 分後截止`, `Ends in ${Math.floor(diffMin / 60)} h ${diffMin % 60} min`);
}

// the nav bar's "Resale · Charity meals" is merged into "My meals", with "Resale market" and "Nearby charity meals" tabs at the top.
// Lives in the "Resale market" tab of the My meals page; charity meals are shown on My meals' own tab.
export default function TransferMarketPage({ onShowFree }: { onShowFree?: () => void }) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [browseTab, setBrowseTab] = useState<"browse" | "mine">("browse");
  const [search, setSearch] = useState("");
  const [uid, setUid] = useState<string | null>(null);
  const requireLogin = useRequireLogin();
  const [locks, setLocks] = useState<Lock[]>([]);
  const [handedOver, setHandedOver] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [usePoints, setUsePoints] = useState(true);
  const { balance: pointBalance } = useWallet();
  const { data: vendors = [] } = useVendors();
  const imageOf = useItemImages();
  const vendorName = (id: string) => loc(vendors.find((v) => v.id === id), "name");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  useEffect(() => {
    // Only query items for resale: of locks, only for_resale / for_gift are publicly readable (firestore.rules),
    // and the query must let the rules prove every document matches, or the whole query is rejected
    // List all vendors together; single status equality only (automatic index), sorting done client-side
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

  // Already taken over: a single array-contains condition only (automatic single-field index); vendor filtering and sorting
  // are done client-side to avoid a new composite index.
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
          // Items that came back to me after a takeover count as my own items, not as taken over
          .filter((l) => l.buyer_uid !== uid)
          .sort((a, b) => millisOf(b.created_at) - millisOf(a.created_at));
        setHandedOver(rows);
      },
      () => setHandedOver([])
    );
    return () => unsub();
  }, [uid]);

  // The timeout is computed purely client-side (no scheduled Function to flip the status), so it must be recomputed regularly to switch
  // live from "Take over" to "Claim for free".
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const deadlineOf = resaleDeadlineOf;

  // Profane search terms are treated as an empty search, without showing an error.
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
  // $0 items (custom 0 or opened up for free after the timeout) aren't listed in the market; they're on the "Nearby charity meals" tab (FreeTransfersSection)
  const activeListings = forResale.filter((l) => !isFreeTransfer(l, now));
  // Free meals whose slot has ended can no longer be claimed; like FreeTransfersSection, don't count them
  const freeCount = forResale.filter((l) => isFreeTransfer(l, now) && !isSlotEnded(l.pickup_date, l.pickup_window, new Date(now))).length;
  const myListings = useMemo(
    () => locks.filter((l) => l.status === "for_resale" && l.buyer_uid === uid),
    [locks, uid]
  );

  async function handleClaim(lockId: string) {
    if (!requireLogin()) return;
    setClaimingId(lockId);
    try {
      const fn = httpsCallable(functions, "createResaleLinePayReservation");
      const result = await fn({ lock_id: lockId, use_points: usePoints && pointBalance > 0 });
      const { order_id: orderId, payment_url: paymentUrl, free } = result.data as { order_id: string; payment_url: string; free?: boolean };
      // After payment, the confirmation page (/payment/confirm) changes the owner and refunds the original payer
      if (free) navigate(`/payment/confirm/${orderId}`);
      else window.location.href = paymentUrl;
    } catch (err) {
      toast({ title: tr("接手失敗", "Couldn't take it over"), description: (err as Error).message, variant: "destructive" });
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
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground max-w-2xl">{tr("安全轉讓已鎖定的餐點，截單後也能轉；$0 與逾時沒人接手的餐點會移到「附近愛心餐」免費領取。", "Pass locked meals between classmates, even after cutoff. $0 meals and ones nobody took in time move to Charity meals nearby, free to claim.")}</p>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("搜尋餐點名稱", "Search by meal name")}
            aria-label={tr("搜尋轉讓項目", "Search transfers")}
            className="h-10 w-full sm:w-64 rounded-full border border-border bg-card px-4 text-sm"
          />
        </div>

        <div className="flex gap-2">
          <Tag selected={browseTab === "browse"} onClick={() => setBrowseTab("browse")}>
            {tr("瀏覽轉讓", "Browse")}
          </Tag>
          <Tag selected={browseTab === "mine"} onClick={() => setBrowseTab("mine")}>
            {tr("我的轉讓", "My transfers")}
          </Tag>
        </div>

        {loading && <SkeletonBlocks count={3} height={240} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" />}

        {!loading && browseTab === "browse" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3.5">
              <span className="text-sm text-muted-foreground font-semibold">{tr(`目前 ${activeListings.length} 筆轉讓中`, `${activeListings.length} available`)}</span>
              {pointBalance > 0 && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={usePoints} onCheckedChange={(v) => setUsePoints(v === true)} />
                  {tr(`接手時用平台點數折抵（可用 ${pointBalance} 點）`, `Use BunnBaa points when taking over (${pointBalance} available)`)}
                </label>
              )}
            </div>

            {activeListings.length === 0 ? (
              <EmptyState icon={<Repeat size={32} />} title={tr("目前沒有人轉讓", "Nothing up for transfer")} description={tr("稍後再回來看看，有新的轉讓會即時出現。", "Check back later — new transfers appear instantly.")} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeListings.map(item => {
                  const deadline = deadlineOf(item);
                  return (
                    <article key={item.id} className="group rounded-card bg-card border border-ink overflow-hidden flex flex-col transition-transform duration-500 hover:-translate-y-1 motion-reduce:transform-none">
                      <div className="relative aspect-[4/3] bg-secondary flex items-center justify-center border-b border-ink overflow-hidden">
                        {imageOf(item) ? (
                        <img src={imageOf(item)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 motion-reduce:transition-none" />
                      ) : (
                        <UtensilsCrossed className="h-10 w-10 text-secondary-foreground/50" strokeWidth={1.25} aria-hidden="true" />
                      )}
                        {deadline && (
                          <span className="absolute top-2.5 right-2.5 flex items-center gap-1 text-caption font-bold px-2.5 py-1 rounded-full bg-[var(--surface-inverse)] text-[var(--text-on-inverse)]">
                            <Clock className="w-3 h-3" /> {formatCountdown(deadline, now)}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col gap-2.5 p-5 flex-1">
                        <h3 className="font-heading text-xl font-semibold leading-snug">{loc(item, "item_name")}</h3>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5" /> {vendorName(item.vendor_id) ? `${vendorName(item.vendor_id)} · ` : ""}{formatPickupDate(item.pickup_date)} · {item.pickup_window}
                        </div>
                        <div className="flex items-center justify-between mt-auto pt-1.5">
                          <span className="flex flex-col leading-tight">
                            <span className="text-micro text-muted-foreground">{tr("接手價", "Price")}</span>
                            <span className="font-heading text-2xl font-semibold">NT${resalePrice(item)}</span>
                          </span>
                          <Button
                            size="sm"
                            disabled={claimingId === item.id}
                            onClick={() => handleClaim(item.id)}
                          >
                            {claimingId === item.id ? tr("處理中…", "Working…") : tr("付款接手", "Pay & take it")}
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {freeCount > 0 && (
              <p className="text-sm text-muted-foreground">
                <HeartHandshake className="inline w-4 h-4 mr-1 -mt-0.5 text-charity" aria-hidden="true" />
                {tr(`另有 ${freeCount} 份 $0 免費領取的餐點，放在`, `${freeCount} more meal(s) are free ($0) — see `)}
                <button type="button" className="font-semibold text-primary underline underline-offset-2" onClick={onShowFree}>{tr("「附近愛心餐」", "Charity meals nearby")}</button>
                {tr("分頁。", ".")}
              </p>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {myListings.map(item => (
                  <article key={item.id} className="group rounded-card bg-card border border-ink overflow-hidden flex flex-col transition-transform duration-500 hover:-translate-y-1 motion-reduce:transform-none">
                    <div className="relative aspect-[4/3] bg-secondary flex items-center justify-center border-b border-ink overflow-hidden">
                      {imageOf(item) ? (
                        <img src={imageOf(item)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 motion-reduce:transition-none" />
                      ) : (
                        <UtensilsCrossed className="h-10 w-10 text-secondary-foreground/50" strokeWidth={1.25} aria-hidden="true" />
                      )}
                      <span className="absolute top-2.5 right-2.5 text-caption font-bold px-2.5 py-1 rounded-full bg-brand text-brand-foreground">
                        {tr("轉讓中", "Listed")}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 p-5 flex-1">
                      <h3 className="font-heading text-xl font-semibold leading-snug">{loc(item, "item_name")}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" /> {vendorName(item.vendor_id) ? `${vendorName(item.vendor_id)} · ` : ""}{formatPickupDate(item.pickup_date)} · {item.pickup_window}
                      </div>
                      <div className="flex items-center justify-between mt-auto pt-1.5">
                        <span className="flex flex-col leading-tight">
                          <span className="font-heading text-2xl font-semibold">NT${resalePrice(item)}</span>
                          <span className="text-micro text-muted-foreground">{tr(`有人接手後退你 ${refundOnTakeover(item)} 點`, `${refundOnTakeover(item)} points back to you once taken`)}</span>
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-danger/40 text-danger-text hover:bg-danger-soft"
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
              <h2 className="font-heading text-2xl md:text-3xl font-semibold">{tr("已被接手", "Taken over")}</h2>
              <span className="text-xs text-muted-foreground">{tr("你轉讓或贈送出去、已經有人接手的項目", "Meals you transferred or gifted that someone has taken")}</span>
            </div>

            {handedOver.length === 0 ? (
              <EmptyState size="compact" icon={<Repeat size={32} />} title={tr("還沒有被接手的項目", "Nothing taken over yet")} />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {handedOver.map(item => (
                  <article key={item.id} className="group rounded-card bg-card border border-ink overflow-hidden flex flex-col transition-transform duration-500 hover:-translate-y-1 motion-reduce:transform-none">
                    <div className="relative aspect-[4/3] bg-secondary flex items-center justify-center border-b border-ink overflow-hidden">
                      {imageOf(item) ? (
                        <img src={imageOf(item)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105 motion-reduce:transition-none" />
                      ) : (
                        <UtensilsCrossed className="h-10 w-10 text-secondary-foreground/50" strokeWidth={1.25} aria-hidden="true" />
                      )}
                      <span className="absolute top-2.5 right-2.5 text-caption font-bold px-2.5 py-1 rounded-full bg-card text-foreground border border-ink">
                        {tr("已被接手", "Taken over")}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 p-5 flex-1">
                      <h3 className="font-heading text-xl font-semibold leading-snug">{loc(item, "item_name")}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" /> {vendorName(item.vendor_id) ? `${vendorName(item.vendor_id)} · ` : ""}{formatPickupDate(item.pickup_date)} · {item.pickup_window}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
  );
}

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, auth, functions } from "../lib/firebase";
import { useRequireLogin } from "../hooks/useRequireLogin";
import type { Lock, Vendor } from "../types";
import LockQRCode from "../components/LockQRCode";
import { applyEarlyBirdPrice } from "../lib/pricing";
import { nextAvailablePickup } from "@/lib/pickupSlots";
import { takeOverLock } from "@/lib/transfers";
import { toast } from "../hooks/use-toast";
import { Gift } from "lucide-react";

const VENDOR_ID = "cafe-renheya-demo";
const ITEM_NAME = "招牌鮭魚御飯糰便當";
// 跟 menu_items/cafe-renheya-demo-item-1 的原價一致（伺服器用那筆重算價格，這裡只是顯示）
const MENU_ITEM_ID = `${VENDOR_ID}-item-1`;
const ORIGINAL_PRICE = 160;

// Mirrors functions/src/index.js's pickupWindowStart, but for the window's
// end — used as the resale_deadline after which anyone may free-claim.
function pickupWindowEnd(pickupDate: string, pickupWindow: string): Date | null {
  const endTime = pickupWindow.split("-")[1]?.trim();
  if (!endTime) return null;
  return new Date(`${pickupDate}T${endTime}:00+08:00`);
}

/**
 * Spec ref: tech doc v6 §3.4 (single-location pickup), §4.2 (discount
 * explanation agent), §3.5 (vendor reliability badge).
 *
 * Consumer locks in a meal at a discount. On submit, a `locks` document is
 * created; the `onLockCreated` Cloud Function fills in `discount_explanation`
 * asynchronously, so this component listens for that field to appear.
 */
export default function ConsumerLockPage() {
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [locking, setLocking] = useState(false);
  const [myLock, setMyLock] = useState<Lock | null>(null);
  const [reselling, setReselling] = useState(false);
  const [resaleListings, setResaleListings] = useState<Lock[]>([]);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [gifting, setGifting] = useState(false);
  const [giftLink, setGiftLink] = useState<string | null>(null);
  const requireLogin = useRequireLogin();
  const [incomingGiftId, setIncomingGiftId] = useState<string | null>(null);
  const [claimingGift, setClaimingGift] = useState(false);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // 這頁沒有時段選擇，固定訂最近一個還能訂的時段（完整選擇在首頁／購物車）
  // 店家 30 天內都不開放時退回今天第一個預設時段，送出後由伺服器擋下並顯示原因
  const nextPickup = nextAvailablePickup(vendor) ?? { date: new Date().toLocaleDateString("en-CA"), window: "11:30-12:00" };
  const todayPricing = applyEarlyBirdPrice(ORIGINAL_PRICE, nextPickup.date);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "vendors", VENDOR_ID), (snap) => {
      if (snap.exists()) setVendor({ id: snap.id, ...(snap.data() as any) });
    });
    return () => unsub();
  }, []);

  // 別人轉賣中清單裡「已逾時」的判斷是純前端算出來的（沒有排程 Function 把它轉成
  // 另一個狀態），所以要固定重算一下，逾時的項目才會即時從「我要接手」變成「免費領取」。
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const giftParam = new URLSearchParams(window.location.search).get("gift");
    if (giftParam) setIncomingGiftId(giftParam);
  }, []);

  useEffect(() => {
    if (!myLock?.id) return;
    const unsub = onSnapshot(doc(db, "locks", myLock.id), (snap) => {
      if (snap.exists()) setMyLock({ id: snap.id, ...(snap.data() as any) });
    });
    return () => unsub();
  }, [myLock?.id]);

  // Reuses the same vendor_id + created_at index as the vendor redeem page's
  // lookup — filtering to for_resale (and excluding the viewer's own listing)
  // happens client-side rather than adding another composite index for what
  // is, at pilot scale, a handful of documents.
  useEffect(() => {
    const q = query(
      collection(db, "locks"),
      where("vendor_id", "==", VENDOR_ID),
      where("status", "==", "for_resale"),
      orderBy("created_at", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      const listings = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock)
        .filter((l) => l.status === "for_resale" && l.buyer_uid !== auth.currentUser?.uid);
      setResaleListings(listings);
    });
    return () => unsub();
  }, []);

  async function handleClaim(lockId: string) {
    if (!requireLogin()) return;
    setClaimingId(lockId);
    try {
      const fn = httpsCallable(functions, "claimResoldLock");
      await fn({ lock_id: lockId });
      setMyLock({ id: lockId } as Lock);
    } catch (err) {
      toast({ variant: "destructive", title: "接手失敗", description: (err as Error).message });
    } finally {
      setClaimingId(null);
    }
  }

  // Free-claim is intentionally a plain client write, not a Cloud Function:
  // firestore.rules only allows it once resale_deadline has passed, which
  // replaces a scheduled "release" job with a check made at claim time.
  async function handleClaimFree(lockId: string) {
    if (!requireLogin() || !auth.currentUser) return;
    setClaimingId(lockId);
    try {
      await takeOverLock(lockId, auth.currentUser.uid, { locked_price: 0 });
      setMyLock({ id: lockId } as Lock);
    } catch (err) {
      toast({ variant: "destructive", title: "領取失敗", description: (err as Error).message });
    } finally {
      setClaimingId(null);
    }
  }

  async function handleAcceptGift() {
    if (!incomingGiftId || !requireLogin() || !auth.currentUser) return;
    setClaimingGift(true);
    try {
      await takeOverLock(incomingGiftId, auth.currentUser.uid);
      setMyLock({ id: incomingGiftId } as Lock);
      setIncomingGiftId(null);
    } catch (err) {
      toast({ variant: "destructive", title: "接受贈送失敗", description: (err as Error).message });
    } finally {
      setClaimingGift(false);
    }
  }

  // Real money now: this reserves a LINE Pay payment and sends the buyer to
  // LINE Pay's checkout page. The `locks` doc itself is only created after
  // PaymentConfirmPage confirms the payment server-side (createLinePayReservation
  // / confirmLinePayPayment in functions/src/index.js) — never here, so a
  // buyer who abandons checkout doesn't end up with a "locked" doc.
  async function handleLock() {
    if (!requireLogin() || !auth.currentUser) return;
    setLocking(true);
    try {
      const fn = httpsCallable(functions, "createLinePayReservation");
      const result = await fn({
        menu_item_id: MENU_ITEM_ID,
        pickup_window: nextPickup.window,
        pickup_date: nextPickup.date,
      });
      const { payment_url: paymentUrl } = result.data as { order_id: string; payment_url: string };
      window.location.href = paymentUrl;
    } catch (err) {
      toast({ variant: "destructive", title: "前往付款失敗", description: (err as Error).message });
      setLocking(false);
    }
  }

  // firestore.rules only lets the buyer move their own lock to "for_resale" —
  // every other transition (fulfilled/no_show/resold_and_fulfilled) needs
  // vendor attestation via the markLockOutcome Cloud Function instead.
  async function handleResell() {
    if (!myLock) return;
    setReselling(true);
    try {
      const deadline = pickupWindowEnd(myLock.pickup_date, myLock.pickup_window);
      await updateDoc(doc(db, "locks", myLock.id), {
        status: "for_resale",
        ...(deadline ? { resale_deadline: Timestamp.fromDate(deadline) } : {}),
      });
    } finally {
      setReselling(false);
    }
  }

  // Gifting is a private hand-off (not listed in any public query) — the
  // recipient needs the link/lock_id itself, same trust model as sharing the
  // pickup QR code. firestore.rules lets any other signed-in user claim it.
  async function handleGift() {
    if (!myLock) return;
    setGifting(true);
    try {
      await updateDoc(doc(db, "locks", myLock.id), { status: "for_gift" });
      setGiftLink(`${window.location.origin}${window.location.pathname}?gift=${myLock.id}`);
    } finally {
      setGifting(false);
    }
  }

  // One-shot: firestore.rules only allows this while consumer_feedback isn't
  // already set, so it can't be edited after the fact.
  async function handleSubmitFeedback() {
    if (!myLock) return;
    const text = feedbackDraft.trim();
    if (!text) return;
    setSubmittingFeedback(true);
    try {
      await updateDoc(doc(db, "locks", myLock.id), { consumer_feedback: text });
    } catch (err) {
      toast({ variant: "destructive", title: "送出回饋失敗", description: (err as Error).message });
    } finally {
      setSubmittingFeedback(false);
    }
  }

  return (
    <div className="page">
      <div className="kicker">BunnBaa · 消費者端</div>
      <h1>鎖定今天的午餐</h1>

      {incomingGiftId && !myLock && (
        <div className="card tinted">
          <div className="row">
            <div>
              <h2 className="title-with-icon"><Gift aria-hidden="true" />有人送你一份餐點</h2>
              <p className="muted">有同學把已鎖定的餐點贈送給你，按下方即可收下並取得取餐編號。</p>
            </div>
            <button disabled={claimingGift} onClick={handleAcceptGift}>
              {claimingGift ? "處理中…" : "接受贈送"}
            </button>
          </div>
        </div>
      )}

      {vendor && (
        <div className="card">
          <div className="row">
            <div>
              <h2>{vendor.name} {vendor.verified && <span className="badge">認證商家</span>}</h2>
              <div className="muted">{ITEM_NAME} · {nextPickup.window} 取餐</div>
            </div>
            <span className="badge">
              近期履約穩定度：
              {vendor.reliability_tone === "stable" ? "穩定" : vendor.reliability_tone === "variable" ? "波動中" : "累積中"}
            </span>
          </div>
        </div>
      )}

      <div className="card tinted">
        <div className="row">
          <div>
            <div style={{ textDecoration: "line-through", color: "var(--faint)" }}>NT${ORIGINAL_PRICE}</div>
            <div className="stat">NT${todayPricing.lockedPrice}</div>
            <div className="muted">{todayPricing.tierLabel} · 取餐 {nextPickup.date} {nextPickup.window} · 全額預付，鎖定後直接歸商家</div>
          </div>
          <button onClick={handleLock} disabled={locking || !!myLock}>
            {myLock ? "已鎖定" : locking ? "處理中…" : "鎖定這份"}
          </button>
        </div>
      </div>

      {myLock && (
        <div className="card">
          <LockQRCode lockId={myLock.id} vendorId={VENDOR_ID} />
        </div>
      )}

      {myLock && (
        <div className="card">
          <h2>為什麼是這個折扣？</h2>
          {myLock.discount_explanation ? (
            <p className="muted">{myLock.discount_explanation}</p>
          ) : (
            <p className="faint">產生說明中…</p>
          )}
          <div className="disclaimer">此為鎖定規則說明，非購買建議</div>
        </div>
      )}

      {myLock && myLock.status === "locked" && (
        <div className="card">
          <div className="row">
            <div>
              <h2>臨時去不了？</h2>
              <p className="muted">取餐前可以把這份轉賣給其他人或直接贈送給朋友，把取餐編號給對方就好——這是解套機制，不是套利工具。</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="secondary" disabled={reselling} onClick={handleResell}>
                {reselling ? "處理中…" : "轉賣這份"}
              </button>
              <button className="secondary" disabled={gifting} onClick={handleGift}>
                {gifting ? "處理中…" : "贈送給朋友"}
              </button>
            </div>
          </div>
        </div>
      )}

      {myLock && myLock.status === "for_resale" && (
        <div className="card tinted">
          <p className="muted">已標記轉賣中。把上面的取餐編號給接手的人，對方憑編號到店取餐即可；逾時沒人接手會自動開放 $0 元免費領取。</p>
        </div>
      )}

      {myLock && myLock.status === "for_gift" && (
        <div className="card tinted">
          <p className="muted">已標記贈送中。把下面的連結傳給你要送的朋友，對方打開就能收下：</p>
          {giftLink && (
            <p className="muted" style={{ wordBreak: "break-all" }}>
              <a href={giftLink}>{giftLink}</a>
            </p>
          )}
        </div>
      )}

      {resaleListings.length > 0 && (
        <div className="card">
          <h2>別人轉賣中</h2>
          <p className="faint" style={{ marginBottom: 8 }}>
            接手後款項請直接私下轉給對方，平台只負責把這份的歸屬換成你——不經手轉賣金流。
          </p>
          {resaleListings.map((lock) => {
            const deadline = lock.resale_deadline as Timestamp | undefined;
            const expired = !!deadline && deadline.toMillis() < now;
            return (
              <div key={lock.id} className="row" style={{ marginBottom: 8 }}>
                <div>
                  <div>{lock.item_name}</div>
                  <div className="muted">
                    {lock.pickup_window} 取餐 · {expired ? "已逾時・開放 $0 元領取" : `NT$${lock.locked_price}`}
                  </div>
                </div>
                {expired ? (
                  <button disabled={claimingId === lock.id} onClick={() => handleClaimFree(lock.id)}>
                    {claimingId === lock.id ? "處理中…" : "免費領取"}
                  </button>
                ) : (
                  <button disabled={claimingId === lock.id} onClick={() => handleClaim(lock.id)}>
                    {claimingId === lock.id ? "處理中…" : "接手這份"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {myLock && ["fulfilled", "resold_and_fulfilled", "no_show"].includes(myLock.status) && (
        <div className="card">
          <h2>這一餐吃得如何？</h2>
          {myLock.consumer_feedback ? (
            <p className="muted">已回饋：「{myLock.consumer_feedback}」</p>
          ) : (
            <>
              <textarea
                rows={2}
                maxLength={280}
                value={feedbackDraft}
                onChange={(e) => setFeedbackDraft(e.target.value)}
                placeholder="這餐的心得…（送出後無法修改）"
              />
              <button disabled={submittingFeedback || !feedbackDraft.trim()} onClick={handleSubmitFeedback}>
                {submittingFeedback ? "處理中…" : "送出回饋"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

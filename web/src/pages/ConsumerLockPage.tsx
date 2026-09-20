import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, auth, functions } from "../lib/firebase";
import { signInAnonymously } from "firebase/auth";
import type { Lock, Vendor } from "../types";
import LockQRCode from "../components/LockQRCode";
import { registerForPickupReminders } from "../lib/messaging";

const VENDOR_ID = "cafe-renheya-demo";
const ITEM_NAME = "招牌鮭魚御飯糰便當";

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

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    const unsub = onSnapshot(doc(db, "vendors", VENDOR_ID), (snap) => {
      if (snap.exists()) setVendor({ id: snap.id, ...(snap.data() as any) });
    });
    return () => unsub();
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
    const q = query(collection(db, "locks"), where("vendor_id", "==", VENDOR_ID), orderBy("created_at", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      const listings = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock)
        .filter((l) => l.status === "for_resale" && l.buyer_uid !== auth.currentUser?.uid);
      setResaleListings(listings);
    });
    return () => unsub();
  }, []);

  async function handleClaim(lockId: string) {
    setClaimingId(lockId);
    try {
      const fn = httpsCallable(functions, "claimResoldLock");
      await fn({ lock_id: lockId });
      setMyLock({ id: lockId } as Lock);
    } catch (err) {
      alert("接手失敗：" + (err as Error).message);
    } finally {
      setClaimingId(null);
    }
  }

  async function handleLock() {
    if (!auth.currentUser) return;
    setLocking(true);
    try {
      // Requested before create, not after: firestore.rules only allows a
      // buyer to update their own lock when moving it to "for_resale", so an
      // update-after-create to attach the token would be rejected.
      const fcmToken = await registerForPickupReminders();

      const ref = await addDoc(collection(db, "locks"), {
        vendor_id: VENDOR_ID,
        item_name: ITEM_NAME,
        pickup_window: "12:00-13:00",
        pickup_date: new Date().toISOString().slice(0, 10),
        discount_percent: 20,
        resellable: true,
        locked_price: 96,
        status: "locked",
        buyer_uid: auth.currentUser.uid,
        created_at: serverTimestamp(),
        fcm_token: fcmToken,
      });
      setMyLock({ id: ref.id } as Lock);
    } finally {
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
      await updateDoc(doc(db, "locks", myLock.id), { status: "for_resale" });
    } finally {
      setReselling(false);
    }
  }

  return (
    <div className="page">
      <div className="kicker">BunnBaa · 消費者端</div>
      <h1>鎖定今天的午餐</h1>

      {vendor && (
        <div className="card">
          <div className="row">
            <div>
              <h2>{vendor.name}</h2>
              <div className="muted">{ITEM_NAME} · 12:00–13:00 取餐</div>
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
            <div style={{ textDecoration: "line-through", color: "var(--faint)" }}>NT$120</div>
            <div className="stat">NT$96</div>
            <div className="muted">今日 8 折 · 全額預付，鎖定後直接歸商家</div>
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
              <p className="muted">取餐前可以把這份轉賣給其他人，把取餐編號給對方就好——這是解套機制，不是套利工具。</p>
            </div>
            <button className="secondary" disabled={reselling} onClick={handleResell}>
              {reselling ? "處理中…" : "轉賣這份"}
            </button>
          </div>
        </div>
      )}

      {myLock && myLock.status === "for_resale" && (
        <div className="card tinted">
          <p className="muted">已標記轉賣中。把上面的取餐編號給接手的人，對方憑編號到店取餐即可。</p>
        </div>
      )}

      {resaleListings.length > 0 && (
        <div className="card">
          <h2>別人轉賣中</h2>
          <p className="faint" style={{ marginBottom: 8 }}>
            接手後款項請直接私下轉給對方，平台只負責把這份的歸屬換成你——不經手轉賣金流。
          </p>
          {resaleListings.map((lock) => (
            <div key={lock.id} className="row" style={{ marginBottom: 8 }}>
              <div>
                <div>{lock.item_name}</div>
                <div className="muted">
                  {lock.pickup_window} 取餐 · NT${lock.locked_price}
                </div>
              </div>
              <button disabled={claimingId === lock.id} onClick={() => handleClaim(lock.id)}>
                {claimingId === lock.id ? "處理中…" : "接手這份"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

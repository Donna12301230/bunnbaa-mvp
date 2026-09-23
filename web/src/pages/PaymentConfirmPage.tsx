import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { httpsCallable } from "firebase/functions";
import { doc, setDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db, functions } from "../lib/firebase";
import LockQRCode from "../components/LockQRCode";
import { registerForPickupReminders } from "../lib/messaging";

/**
 * LINE Pay redirects here after the buyer approves payment (confirmUrl set
 * in createLinePayReservation). We must wait for Firebase Auth to restore
 * the same anonymous session before calling confirmLinePayPayment — this is
 * a full page reload coming back from LINE Pay's domain, so auth.currentUser
 * is briefly null until onAuthStateChanged fires.
 */
export default function PaymentConfirmPage() {
  const [status, setStatus] = useState<"waiting-auth" | "confirming" | "done" | "error">("waiting-auth");
  const [lockId, setLockId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  // Route is /payment/confirm/:orderId. LINE Pay's ?transactionId=... append
  // can still end up glued onto this param (see App.tsx's comment on this
  // route) — strip anything from "?" or "&" onward defensively.
  const { orderId: rawOrderId } = useParams<{ orderId: string }>();
  const orderId = rawOrderId?.split(/[?&]/)[0];

  useEffect(() => {
    if (!orderId) {
      setStatus("error");
      setErrorMessage("缺少訂單編號，無法確認付款");
      return;
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return; // still restoring the anonymous session
      unsub();
      setStatus("confirming");
      try {
        const fn = httpsCallable(functions, "confirmLinePayPayment");
        const result = await fn({ order_id: orderId });
        const { lock_id: id } = result.data as { lock_id: string };
        setLockId(id);
        setStatus("done");

        try {
          const fcmToken = await registerForPickupReminders();
          if (fcmToken) {
            await setDoc(doc(db, "lock_tokens", id), { fcm_token: fcmToken, buyer_uid: user.uid });
          }
        } catch (err) {
          console.warn("Could not save pickup-reminder token:", err);
        }
      } catch (err) {
        setStatus("error");
        setErrorMessage((err as Error).message);
      }
    });
    return () => unsub();
  }, [orderId]);

  return (
    <div className="page">
      <div className="kicker">BunnBaa · 付款確認</div>
      {(status === "waiting-auth" || status === "confirming") && (
        <div className="card">
          <p className="muted">確認付款中…</p>
        </div>
      )}
      {status === "done" && lockId && (
        <div className="card">
          <h2>付款成功！</h2>
          <LockQRCode lockId={lockId} vendorId="cafe-renheya-demo" />
          <p className="muted" style={{ marginTop: 12 }}>
            <Link href="/lock">回鎖定頁面</Link>
          </p>
        </div>
      )}
      {status === "error" && (
        <div className="card">
          <h2>付款確認失敗</h2>
          <p className="muted">{errorMessage}</p>
          <p className="muted">
            <Link href="/lock">回鎖定頁面重新嘗試</Link>
          </p>
        </div>
      )}
    </div>
  );
}

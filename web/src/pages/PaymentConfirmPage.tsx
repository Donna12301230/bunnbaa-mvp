import { tr, loc } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { httpsCallable } from "@/lib/callable";
import { arrayUnion, doc, getDoc, setDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { CheckCircle2 } from "lucide-react";
import { auth, db, functions } from "../lib/firebase";
import { registerForPickupReminders } from "../lib/messaging";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { Button } from "@/components/ui/button";
import { riceLabel, slotText } from "@/lib/bento";
import { vendorCutoffTime } from "@/lib/pickupSlots";
import type { Lock } from "@/types";

/**
 * LINE Pay redirects here after the buyer approves payment (confirmUrl set in
 * createCartLinePayReservation). 折價券全額折抵（0 元）的訂單不經 LINE Pay，
 * 購物車直接導到這裡。We must wait for Firebase Auth to restore the buyer's
 * session before calling confirmLinePayPayment — this is a full page reload
 * coming back from LINE Pay's domain.
 */
export default function PaymentConfirmPage() {
  const [status, setStatus] = useState<"waiting-auth" | "confirming" | "done" | "error">("waiting-auth");
  const [locks, setLocks] = useState<Lock[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  // LINE Pay's ?transactionId=... append can end up glued onto this param
  const { orderId: rawOrderId } = useParams<{ orderId: string }>();
  const orderId = rawOrderId?.split(/[?&]/)[0];

  useEffect(() => {
    if (!orderId) {
      setStatus("error");
      setErrorMessage(tr("缺少訂單編號，無法確認付款", "Missing order ID — can't confirm the payment"));
      return;
    }
    const unsub = onAuthStateChanged(auth, async (user) => {
      unsub();
      if (!user || user.isAnonymous) {
        setStatus("error");
        setErrorMessage(tr("登入狀態已失效，請重新登入後到「我的餐點」確認，或聯絡客服", "Your session has expired. Sign in again and check My meals, or contact support"));
        return;
      }
      setStatus("confirming");
      try {
        const result = await httpsCallable(functions, "confirmLinePayPayment")({ order_id: orderId });
        const { lock_ids: ids } = result.data as { lock_ids: string[] };
        // 付款已成功，讀不到細節也不能讓頁面變成「付款確認失敗」
        const docs = await Promise.all(ids.map((id) => getDoc(doc(db, "locks", id)).catch(() => null)));
        setLocks(docs.filter((d) => d?.exists()).map((d) => ({ id: d!.id, ...d!.data() }) as Lock));
        setStatus("done");
        try {
          const fcmToken = await registerForPickupReminders();
          if (fcmToken) await setDoc(doc(db, "userTokens", user.uid), { tokens: arrayUnion(fcmToken) }, { merge: true });
        } catch (err) {
          console.warn("Could not save push token:", err);
        }
      } catch (err) {
        setStatus("error");
        setErrorMessage((err as Error).message);
      }
    });
    return () => unsub();
  }, [orderId]);

  return (
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader />
      <div className="max-w-lg mx-auto px-4 py-8 space-y-4">
        {(status === "waiting-auth" || status === "confirming") && (
          <div className="bg-white rounded-xl border border-border p-6 text-center text-muted-foreground">{tr("確認付款中…", "Confirming payment…")}</div>
        )}
        {status === "done" && (
          <div className="bg-white rounded-xl border border-border p-5 space-y-4">
            <h1 className="text-xl font-bold flex items-center gap-2"><CheckCircle2 className="w-6 h-6 text-green-600" /> {tr("預購成功！", "You're all set!")}</h1>
            <ul className="divide-y divide-border">
              {locks.map((l) => (
                <li key={l.id} className="py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{loc(l, "item_name")}</span>
                    <span>NT${l.locked_price}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{l.pickup_date}・{l.pickup_window}・{tr("取餐號", "Code")} {l.pickup_code}</p>
                  {(l.slots?.length ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground">{l.slots!.map(slotText).join("／")}{riceLabel(l.rice) ? `／${riceLabel(l.rice)}` : ""}</p>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {tr(`取餐前一天 ${vendorCutoffTime(null)} 截單並判定配菜許願，未成立會改預設菜並通知你。取餐時到「我的餐點」出示 QR Code。`,
                `Orders close at ${vendorCutoffTime(null)} the day before; side-dish wishes are decided then. Show your QR code from My meals at pickup.`)}
            </p>
            <Button asChild className="w-full"><Link href="/my-bookings">{tr("查看我的餐點", "View my meals")}</Link></Button>
          </div>
        )}
        {status === "error" && (
          <div className="bg-white rounded-xl border border-border p-5 space-y-2">
            <h1 className="text-lg font-bold">{tr("付款確認失敗", "Payment confirmation failed")}</h1>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            <Link href="/my-bookings" className="text-sm text-primary underline">{tr("查看我的餐點", "View my meals")}</Link>
          </div>
        )}
      </div>
    </div>
  );
}

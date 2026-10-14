import { tr, loc } from "@/lib/i18n";
import { formatNT, formatPickupDate } from "@/lib/format";
import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { httpsCallable } from "@/lib/callable";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { CheckCircle2 } from "lucide-react";
import { auth, db, functions } from "../lib/firebase";
import { registerForPickupReminders } from "../lib/messaging";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { Button } from "@/components/ui/button";
import { cartStore } from "@/hooks/useCart";
import { customOptionTexts, extraSideText, riceLabel, slotText } from "@/lib/bento";
import { vendorCutoffTime } from "@/lib/pickupSlots";
import type { Lock } from "@/types";

/**
 * LINE Pay redirects here after the buyer approves payment (confirmUrl set in
 * createCartLinePayReservation). Orders fully covered by a coupon (NT$0) skip LINE Pay
 * and the cart redirects straight here. We must wait for Firebase Auth to restore the buyer's
 * session before calling confirmLinePayPayment — this is a full page reload
 * coming back from LINE Pay's domain.
 */
export default function PaymentConfirmPage() {
  const [status, setStatus] = useState<"waiting-auth" | "confirming" | "done" | "error">("waiting-auth");
  const [locks, setLocks] = useState<Lock[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [isResale, setIsResale] = useState(false); // Paid takeover from the resale market (same confirmation page)
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
        const { lock_ids: ids, kind } = result.data as { lock_ids: string[]; kind?: string };
        setIsResale(kind === "resale");
        cartStore.discardPending();
        // Payment already succeeded; failing to read the details must not turn the page into "Payment confirmation failed"
        const docs = await Promise.all(ids.map((id) => getDoc(doc(db, "locks", id)).catch(() => null)));
        setLocks(docs.filter((d) => d?.exists()).map((d) => ({ id: d!.id, ...d!.data() }) as Lock));
        setStatus("done");
        try {
          const fcmToken = await registerForPickupReminders();
          if (fcmToken) {
            // The rules allow at most 5 tokens (firestore.rules userTokens): keep the newest 4 plus this device, so a 6th device onward doesn't fail to write
            const ref = doc(db, "userTokens", user.uid);
            const prev = ((await getDoc(ref).catch(() => null))?.data()?.tokens as string[] | undefined) ?? [];
            if (!prev.includes(fcmToken)) await setDoc(ref, { tokens: [...prev.slice(-4), fcmToken] }, { merge: true });
          }
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
    <div className="min-h-screen bg-background">
      <MarketplaceHeader />
      <div className="max-w-xl mx-auto px-4 pt-12 md:pt-20 pb-16 space-y-6">
        {(status === "waiting-auth" || status === "confirming") && (
          <div className="bb-receipt text-center" role="status" aria-live="polite">
            <img src="/飯飽R-sm.webp" alt="" width={72} height={64} className="mx-auto mb-4 animate-pulse motion-reduce:animate-none" />
            <p className="font-heading text-2xl font-semibold">{tr("確認付款中…", "Confirming payment…")}</p>
            <p className="text-sm text-muted-foreground mt-1">{tr("請不要關閉這個頁面。", "Please keep this page open.")}</p>
          </div>
        )}
        {status === "done" && (
          <div className="bb-receipt space-y-6">
            <div className="text-center">
              <span className="bb-receipt__check" aria-hidden="true"><CheckCircle2 className="w-9 h-9" /></span>
              <h1 className="font-heading font-semibold text-[clamp(36px,6vw,56px)] leading-tight mt-4">{isResale ? tr("接手成功！", "It's yours!") : tr("預購成功！", "You're all set!")}</h1>
              <p className="text-muted-foreground mt-1">{tr("越早訂，越開心。到時候見！", "Book early, eat happy — see you at pickup!")}</p>
            </div>
            <ul className="divide-y divide-dashed divide-border border-y border-dashed border-border">
              {locks.map((l) => (
                <li key={l.id} className="py-4 text-sm">
                  <div className="flex justify-between gap-2 items-baseline">
                    <span className="font-heading text-lg font-semibold">{loc(l, "item_name")}</span>
                    <span className="font-heading text-lg font-semibold">NT${l.locked_price}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{formatPickupDate(l.pickup_date)}{tr("・", " · ")}{l.pickup_window}{tr("・", " · ")}{tr("取餐號", "Pickup no.")} <strong className="text-foreground">{l.pickup_code}</strong></p>
                  {(l.slots?.length ?? 0) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {[
                        l.main_dish ? `${tr("主菜：", "Main: ")}${l.main_dish}` : null,
                        ...l.slots!.map(slotText),
                        extraSideText(l.extra_side),
                        ...customOptionTexts(l.custom_options),
                        riceLabel(l.rice),
                      ].filter(Boolean).join(tr("／", " / "))}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {tr(`取餐前一天 ${vendorCutoffTime(null)} 截單並判定配菜許願，未成立會改預設菜並通知你。取餐時到「我的餐點」出示 QR Code。`,
                `Orders close at ${vendorCutoffTime(null)} the day before; side-dish wishes are decided then. Show your QR code from My meals at pickup.`)}
            </p>
            <Button asChild className="w-full h-12 text-base"><Link href="/my-bookings">{tr("查看我的餐點", "View my meals")}</Link></Button>
          </div>
        )}
        {status === "error" && (
          <div className="bb-receipt space-y-3 text-center">
            <h1 className="font-heading text-3xl font-semibold">{tr("付款確認失敗", "Payment confirmation failed")}</h1>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
            <Button asChild variant="outline" className=""><Link href="/my-bookings">{tr("查看我的餐點", "View my meals")}</Link></Button>
          </div>
        )}
      </div>
    </div>
  );
}

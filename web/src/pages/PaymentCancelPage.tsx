import { useEffect } from "react";
import { tr } from "@/lib/i18n";
import { Link, useParams } from "wouter";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";

/**
 * LINE Pay redirects here when payment is cancelled (cancelUrl). 2026-10-09: tell the server to cancel this payment intent,
 * so platform points held at checkout are returned immediately and the 15-minute hold on a resale takeover is released (functions/src/wallet.js cancelPaymentIntent).
 */
export default function PaymentCancelPage() {
  const { orderId } = useParams<{ orderId: string }>();
  useEffect(() => {
    if (!orderId) return;
    httpsCallable(functions, "cancelPaymentIntent")({ order_id: orderId }).catch(() => undefined);
  }, [orderId]);
  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader />
      <div className="max-w-xl mx-auto px-4 pt-12 md:pt-20 pb-16">
        <div className="bb-receipt text-center space-y-3">
          <p className="text-xs font-semibold tracking-[0.14em] uppercase text-muted-foreground">BunnBaa · {tr("付款確認", "Payment")}</p>
          <h1 className="font-heading font-semibold text-[clamp(32px,5vw,48px)] leading-tight">{tr("付款已取消", "Payment cancelled")}</h1>
          <p className="text-muted-foreground">{tr("沒有扣款，這份餐點尚未預購成功；結帳時折抵的點數已退回。", "You weren't charged and the meal wasn't booked. Any points you applied have been returned.")}</p>
          <div className="flex flex-wrap justify-center gap-4 pt-3">
            <Link href="/cart" className="bb-404__btn">{tr("回購物車", "Back to cart")}</Link>
            <Link href="/home" className="bb-404__link self-center">{tr("回預購餐點", "Back to pre-order")}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

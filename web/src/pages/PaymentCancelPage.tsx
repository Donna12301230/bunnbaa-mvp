import { useEffect } from "react";
import { tr } from "@/lib/i18n";
import { Link, useParams } from "wouter";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import { cartStore } from "@/hooks/useCart";

/**
 * LINE Pay 取消付款會導回這裡（cancelUrl）。2026-10-09：通知伺服器取消這筆付款意圖，
 * 結帳時扣住的平台點數馬上還回去、轉讓接手的 15 分鐘保留也放掉（functions/src/wallet.js cancelPaymentIntent）。
 */
export default function PaymentCancelPage() {
  const { orderId } = useParams<{ orderId: string }>();
  useEffect(() => {
    if (!orderId) return;
    cartStore.restoreAfterCancel(orderId);
    httpsCallable(functions, "cancelPaymentIntent")({ order_id: orderId }).catch(() => undefined);
  }, [orderId]);
  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader />
      <div className="max-w-xl mx-auto px-4 pt-12 md:pt-20 pb-16">
        <div className="bb-receipt text-center space-y-3">
          <p className="text-xs font-semibold tracking-[0.14em] uppercase text-muted-foreground">BunnBaa · {tr("付款確認", "Payment")}</p>
          <h1 className="font-heading font-semibold text-[clamp(32px,5vw,48px)] leading-tight">{tr("付款已取消", "Payment cancelled")}</h1>
          <p className="text-muted-foreground">{tr("沒有扣款，這份餐點尚未預購成功；餐點已放回購物車，結帳時折抵的點數也已退回。", "You weren't charged and the meal wasn't booked. Your items are back in the cart and any points you applied have been returned.")}</p>
          <div className="flex flex-wrap justify-center gap-4 pt-3">
            <Link href="/cart" className="bb-404__btn">{tr("回購物車", "Back to cart")}</Link>
            <Link href="/home" className="bb-404__link self-center">{tr("回預購餐點", "Back to pre-order")}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

import { tr } from "@/lib/i18n";
import { Link } from "wouter";
import MarketplaceHeader from "@/components/MarketplaceHeader";

/** LINE Pay redirects here if the buyer cancels checkout (cancelUrl set in createLinePayReservation). */
export default function PaymentCancelPage() {
  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader />
      <div className="max-w-xl mx-auto px-4 pt-12 md:pt-20 pb-16">
        <div className="bb-receipt text-center space-y-3">
          <p className="text-xs font-semibold tracking-[0.14em] uppercase text-muted-foreground">BunnBaa · {tr("付款確認", "Payment")}</p>
          <h1 className="font-heading font-semibold text-[clamp(32px,5vw,48px)] leading-tight">{tr("付款已取消", "Payment cancelled")}</h1>
          <p className="text-muted-foreground">{tr("沒有扣款，這份餐點尚未鎖定。", "You weren't charged and the meal wasn't locked.")}</p>
          <div className="flex flex-wrap justify-center gap-4 pt-3">
            <Link href="/cart" className="bb-404__btn">{tr("回購物車", "Back to cart")}</Link>
            <Link href="/home" className="bb-404__link self-center">{tr("回預購餐點", "Back to Pre-order")}</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

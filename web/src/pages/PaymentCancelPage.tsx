import { tr } from "@/lib/i18n";
import { Link } from "wouter";

/** LINE Pay redirects here if the buyer cancels checkout (cancelUrl set in createLinePayReservation). */
export default function PaymentCancelPage() {
  return (
    <div className="page">
      <div className="kicker">BunnBaa · {tr("付款確認", "Payment")}</div>
      <div className="card">
        <h2>{tr("付款已取消", "Payment cancelled")}</h2>
        <p className="muted">{tr("沒有扣款，這份餐點尚未鎖定。", "You weren't charged and the meal wasn't locked.")}</p>
        <p className="muted">
          <Link href="/home">{tr("回預購餐點", "Back to Pre-order")}</Link>
        </p>
      </div>
    </div>
  );
}

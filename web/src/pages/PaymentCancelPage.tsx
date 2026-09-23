import { Link } from "wouter";

/** LINE Pay redirects here if the buyer cancels checkout (cancelUrl set in createLinePayReservation). */
export default function PaymentCancelPage() {
  return (
    <div className="page">
      <div className="kicker">BunnBaa · 付款確認</div>
      <div className="card">
        <h2>付款已取消</h2>
        <p className="muted">沒有扣款，這份餐點尚未鎖定。</p>
        <p className="muted">
          <Link href="/lock">回鎖定頁面</Link>
        </p>
      </div>
    </div>
  );
}

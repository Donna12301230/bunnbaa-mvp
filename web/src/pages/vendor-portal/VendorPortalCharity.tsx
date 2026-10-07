import { OrdersHub } from "@/pages/vendor-portal/VendorPortalOrders";

// 愛心餐併進「訂單取餐」頁的「愛心餐」分頁（2026-10-06）：就是今天沒來拿的便當，預約者也在取餐分頁掃 QR。保留路徑讓舊連結可用。
export default function VendorPortalCharity() {
  return <OrdersHub initial="charity" />;
}

import { OrdersHub } from "@/pages/vendor-portal/VendorPortalOrders";

// 訂餐時段併進「訂單取餐」頁的「時段」分頁（2026-10-06），保留路徑讓舊連結可用。
export { slotKey } from "@/components/orders/SlotsPanel";

export default function VendorPortalSessions() {
  return <OrdersHub initial="slots" />;
}

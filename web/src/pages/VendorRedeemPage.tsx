import { OrdersHub } from "@/pages/vendor-portal/VendorPortalOrders";

// 取餐掃碼併進「訂單取餐」頁的「取餐」分頁（2026-10-06）。路徑沿用 /lock/vendor/redeem，舊書籤、MarketplaceHeader 入口不會壞。
export default function VendorRedeemPage() {
  return <OrdersHub initial="pickup" />;
}

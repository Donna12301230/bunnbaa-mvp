import { OrdersHub } from "@/pages/vendor-portal/VendorPortalOrders";

// Pickup scanning was merged into the "Pickup" tab of the "Order pickup" page (2026-10-06). The /lock/vendor/redeem path is kept so old bookmarks and the MarketplaceHeader entry don't break.
export default function VendorRedeemPage() {
  return <OrdersHub initial="pickup" />;
}

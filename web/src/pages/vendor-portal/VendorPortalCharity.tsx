import { OrdersHub } from "@/pages/vendor-portal/VendorPortalOrders";

// Charity meals were merged into the "Charity meals" tab of the "Order pickup" page (2026-10-06): they're just today's uncollected bentos, and claimants also scan the QR on the pickup tab. The path is kept so old links still work.
export default function VendorPortalCharity() {
  return <OrdersHub initial="charity" />;
}

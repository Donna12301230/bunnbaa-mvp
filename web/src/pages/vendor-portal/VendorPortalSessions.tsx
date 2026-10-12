import { OrdersHub } from "@/pages/vendor-portal/VendorPortalOrders";

// Order slots were merged into the "Slots" tab of the "Orders & pickup" page (2026-10-06); this path stays so old links work.
export { slotKey } from "@/components/orders/SlotsPanel";

export default function VendorPortalSessions() {
  return <OrdersHub initial="slots" />;
}

import { InsightsHub } from "@/pages/vendor-portal/VendorPortalReports";

// The growth reward / coupon liability board was merged into the "Coupons" tab of the "Insights" page (2026-10-06); the path is kept so old links still work.
export default function VendorPortalGrowth() {
  return <InsightsHub initial="rewards" />;
}

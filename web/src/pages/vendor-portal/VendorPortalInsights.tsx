import { InsightsHub } from "@/pages/vendor-portal/VendorPortalReports";

// Area insights were merged into the "Area" tab of the "Insights" page (2026-10-06); the path is kept so old links still work.
export default function VendorPortalInsights() {
  return <InsightsHub initial="area" />;
}

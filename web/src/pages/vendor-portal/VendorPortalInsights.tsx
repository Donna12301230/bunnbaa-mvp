import { InsightsHub } from "@/pages/vendor-portal/VendorPortalReports";

// 區域洞察併進「看數據」頁的「區域」分頁（2026-10-06），保留路徑讓舊連結可用。
export default function VendorPortalInsights() {
  return <InsightsHub initial="area" />;
}

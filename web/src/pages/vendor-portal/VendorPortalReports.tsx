import { useState } from "react";
import { BarChart3, MapPinned, TicketPercent, TrendingUp } from "lucide-react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import RevenuePanel, { REPORT_DAYS } from "@/components/insights/RevenuePanel";
import AreaPanel from "@/components/insights/AreaPanel";
import RewardsPanel from "@/components/insights/RewardsPanel";
import { useAuth } from "@/hooks/useAuth";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatNT } from "@/lib/format";
import TabNumberLoading from "@/components/TabNumberLoading";
import PortalPageHeader from "@/components/PortalPageHeader";

export type InsightsTab = "revenue" | "area" | "rewards";

/**
 * Reports (merged 2026-10-06): the former "Reports", "Area insights" and "Coupon liability" pages are now three tabs on one page,
 * with each tab card showing its key number. Old paths still work: /vendor-portal/reports, /insights and /growth each open their tab.
 * All three panels stay mounted (only visibility toggles) so the tab cards can read their numbers.
 */
export function InsightsHub({ initial = "revenue" }: { initial?: InsightsTab }) {
  const vendorId = useAuth().user?.vendorId;
  const [tab, setTab] = useState<InsightsTab>(initial);
  // null = the panel is still loading; the tab card shows a skeleton instead of flashing 0
  const [head, setHead] = useState<Record<InsightsTab, number | null>>({ revenue: null, area: null, rewards: null });
  const set = (k: InsightsTab) => (n: number | null) => setHead((h) => (h[k] === n ? h : { ...h, [k]: n }));

  const tabs = [
    { key: "revenue" as const, icon: TrendingUp, label: tr("營收", "Revenue"), v: head.revenue == null ? null : formatNT(head.revenue), sub: tr(`最近 ${REPORT_DAYS} 天`, `last ${REPORT_DAYS} days`) },
    { key: "area" as const, icon: MapPinned, label: tr("區域", "Area"), v: head.area == null ? null : String(head.area), sub: tr("人向你許願", "wishes for you") },
    { key: "rewards" as const, icon: TicketPercent, label: tr("回饋券", "Coupons"), v: head.rewards == null ? null : formatNT(head.rewards), sub: tr("還在客人手上", "outstanding") },
  ];

  return (
    <VendorPortalLayout>
      <PortalPageHeader icon={BarChart3} title={tr("報表與洞察", "Reports & insights")} />
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === t.key ? "border-foreground bg-card shadow-sm" : "border-border bg-card/60 hover:bg-card")}>
            <span className="flex items-center gap-1.5 font-semibold"><t.icon className="w-5 h-5 text-accent-foreground" />{t.label}</span>
            <span className="mt-1 block text-xl sm:text-2xl font-bold leading-none tabular-nums truncate">{t.v ?? <TabNumberLoading />}</span>
            <span className="text-xs text-muted-foreground">{t.sub}</span>
          </button>
        ))}
      </div>
      <div className={tab === "revenue" ? "" : "hidden"}><RevenuePanel vendorId={vendorId} onHeadline={set("revenue")} /></div>
      <div className={tab === "area" ? "" : "hidden"}><AreaPanel vendorId={vendorId} onHeadline={set("area")} /></div>
      <div className={tab === "rewards" ? "" : "hidden"}><RewardsPanel vendorId={vendorId} onHeadline={set("rewards")} /></div>
    </VendorPortalLayout>
  );
}

export default function VendorPortalReports() {
  return <InsightsHub initial="revenue" />;
}

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
 * 看數據（2026-10-06 整合）：原本的「統計報表」「區域洞察」「券負債看板」合成一頁三個大分頁，
 * 分頁卡上直接顯示各自最重要的數字。舊路徑都保留：/vendor-portal/reports、/insights、/growth 各自打開對應分頁。
 * 三個面板都掛著（只切換顯示），分頁卡的數字才拿得到。
 */
export function InsightsHub({ initial = "revenue" }: { initial?: InsightsTab }) {
  const vendorId = useAuth().user?.vendorId;
  const [tab, setTab] = useState<InsightsTab>(initial);
  // null＝面板還在讀資料，分頁卡先顯示骨架，不要閃 0
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

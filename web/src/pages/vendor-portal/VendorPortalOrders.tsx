import { tr } from "@/lib/i18n";
import { useMemo, useState } from "react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import LockOrderRow from "@/components/LockOrderRow";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, Search } from "lucide-react";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { useVendorLocks } from "@/hooks/useVendorLocks";
import { DONE_STATUSES, PENDING_STATUSES, pickupCode } from "@/lib/lockOutcome";
import type { Lock } from "@/types";

// 訂單管理：2026-09-28 改用真實 locks（原本是 Parse 雛型的預約單／現場單 mock，
// TODO §7 決定不做揪團預購與現場點餐）。依狀態分頁，可用取餐編號或品名搜尋，
// 還沒取餐的可以直接確認取餐／登記未取餐。
// 用函式包起來，每次 render 依目前語言組標籤
const tabs = () => [
  { value: "pending", label: tr("待取餐", "To pick up"), match: (l: Lock) => PENDING_STATUSES.has(l.status) },
  { value: "done", label: tr("已完成", "Done"), match: (l: Lock) => DONE_STATUSES.has(l.status) },
  { value: "no_show", label: tr("未取餐", "No-show"), match: (l: Lock) => l.status === "no_show" },
  { value: "all", label: tr("全部", "All"), match: () => true },
] as const;

export default function VendorPortalOrders() {
  const { locks, loading, truncated } = useVendorLocks(500);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase().replace(/\s+/g, "");
    const rows = q
      ? locks.filter((l) => pickupCode(l).includes(q) || l.item_name.toUpperCase().includes(q))
      : locks;
    // 待取餐依取餐時間由近到遠，其餘也照取餐時間排
    return [...rows].sort((a, b) =>
      `${a.pickup_date} ${a.pickup_window}`.localeCompare(`${b.pickup_date} ${b.pickup_window}`)
    );
  }, [locks, search]);

  return (
    <VendorPortalLayout>
      <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-1 flex items-center gap-2">
        <ClipboardList className="w-5 h-5 text-orange-500" /> {tr("訂單管理", "Orders")}
      </h1>
      <p className="text-sm text-muted-foreground mb-4">
        {tr("消費者預付鎖定的訂單", "Meals customers have prepaid and locked")}{truncated ? tr("（只列最近 500 筆）", " (latest 500 only)") : ""}{tr("。", ".")}
      </p>

      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tr("取餐編號末 8 碼或品名", "Pickup code or item name")}
          aria-label={tr("搜尋訂單", "Search orders")}
          className="pl-9"
        />
      </div>

      {loading ? (
        <SkeletonBlocks count={4} height={88} className="space-y-3" />
      ) : (
        <Tabs defaultValue="pending">
          <TabsList className="mb-4 max-w-full justify-start overflow-x-auto">
            {tabs().map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}（{filtered.filter(t.match).length}）
              </TabsTrigger>
            ))}
          </TabsList>
          {tabs().map((t) => {
            const rows = filtered.filter(t.match);
            return (
              <TabsContent key={t.value} value={t.value}>
                {rows.length === 0 ? (
                  <EmptyState size="compact" icon={<ClipboardList size={32} />} title={tr("沒有符合的訂單", "No matching orders")} />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {rows.map((l) => <LockOrderRow key={l.id} lock={l} />)}
                  </div>
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </VendorPortalLayout>
  );
}

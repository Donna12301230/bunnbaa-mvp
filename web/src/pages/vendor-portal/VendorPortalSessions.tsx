import { useMemo, useState } from "react";
import { Link } from "wouter";
import { addDays, format, startOfWeek } from "date-fns";
import { zhTW } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, Settings } from "lucide-react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Button } from "@/components/ui/button";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useVendorLocks } from "@/hooks/useVendorLocks";
import { PENDING_STATUSES } from "@/lib/lockOutcome";
import { slotLabel, vendorClosedReason, vendorWindows } from "@/lib/pickupSlots";

// 訂餐時段：2026-09-28 改用真實資料（原本是 Parse 雛型的揪團「場次」mock，TODO §7
// 決定不做）。一週七天 × 這家店的取餐時段，每格顯示已訂份數、還沒取的份數，有設
// 份數上限就顯示剩幾份；公休／不營業的日子整欄灰掉。點格子看該時段明細。
// 時段、公休、份數上限在「店家設定」頁改。

/** 時段明細頁的網址參數：取餐日＋時段 */
export function slotKey(date: string, window: string): string {
  return encodeURIComponent(`${date}__${window}`);
}

export default function VendorPortalSessions() {
  const { data: vendor } = useMyVendor();
  const { locks, loading } = useVendorLocks(500);
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 1 });
  const weekDates = Array.from({ length: 7 }, (_, i) => format(addDays(weekStart, i), "yyyy-MM-dd"));
  const windows = vendorWindows(vendor);
  const capacity = vendor?.slot_capacity && vendor.slot_capacity > 0 ? vendor.slot_capacity : null;

  // date__window → { total, pending }（未取餐的不算進已訂份數）
  const counts = useMemo(() => {
    const map = new Map<string, { total: number; pending: number }>();
    for (const l of locks) {
      if (l.status === "no_show") continue;
      const key = `${l.pickup_date}__${l.pickup_window}`;
      const row = map.get(key) ?? { total: 0, pending: 0 };
      row.total += 1;
      if (PENDING_STATUSES.has(l.status)) row.pending += 1;
      map.set(key, row);
    }
    return map;
  }, [locks]);

  return (
    <VendorPortalLayout>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-orange-500" /> 訂餐時段
        </h2>
        <Link href="/vendor-portal/settings">
          <Button variant="outline" size="sm"><Settings className="w-4 h-4 mr-1" /> 調整時段／公休／份數上限</Button>
        </Link>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <Button variant="outline" size="icon" aria-label="上一週" onClick={() => setWeekOffset((w) => w - 1)}><ChevronLeft /></Button>
        <span className="text-sm font-medium">
          {format(weekStart, "M/d", { locale: zhTW })} – {format(addDays(weekStart, 6), "M/d", { locale: zhTW })}
        </span>
        <Button variant="outline" size="icon" aria-label="下一週" onClick={() => setWeekOffset((w) => w + 1)}><ChevronRight /></Button>
        {weekOffset !== 0 && <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>本週</Button>}
      </div>

      {loading || !vendor ? (
        <SkeletonBlocks height={280} />
      ) : (
        <div className="bg-white border border-border rounded-xl overflow-x-auto">
          <div className="min-w-[720px] grid" style={{ gridTemplateColumns: `110px repeat(7, minmax(88px, 1fr))` }}>
            <div className="border-b border-border" />
            {weekDates.map((d) => (
              <div key={d} className="border-b border-l border-border p-2 text-center text-xs font-semibold">
                {format(new Date(`${d}T00:00:00`), "M/d (EEE)", { locale: zhTW })}
              </div>
            ))}
            {windows.map((w) => (
              <div key={w} className="contents">
                <div className="border-b border-border p-2 text-xs font-semibold flex items-center">{slotLabel(w)}</div>
                {weekDates.map((d) => {
                  const closed = vendorClosedReason(vendor, d);
                  const row = counts.get(`${d}__${w}`);
                  if (closed && !row) {
                    return <div key={d} className="border-b border-l border-border bg-gray-50 p-2 text-caption text-muted-foreground text-center">公休</div>;
                  }
                  return (
                    <Link key={d} href={`/vendor-portal/sessions/${slotKey(d, w)}/summary`}>
                      <div className="border-b border-l border-border p-2 text-center cursor-pointer hover:bg-orange-50 h-full">
                        <div className="text-sm font-bold">{row?.total ?? 0} 份</div>
                        {row && row.pending > 0 && <div className="text-caption text-orange-600">待取 {row.pending}</div>}
                        {capacity !== null && (
                          <div className="text-caption text-muted-foreground">剩 {Math.max(0, capacity - (row?.total ?? 0))}</div>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-2">
        份數以最近 500 筆訂單計算；剩餘份數以店家設定的「每個時段份數上限」扣掉已訂份數，結帳時伺服器會再檢查一次。
      </p>
    </VendorPortalLayout>
  );
}

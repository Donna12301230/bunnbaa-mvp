import { useMemo, useState } from "react";
import { Link } from "wouter";
import { addDays, format, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import InfoTip from "@/components/InfoTip";
import { PENDING_STATUSES } from "@/lib/lockOutcome";
import { slotLabel, todayStr, vendorClosedReason, vendorWindows } from "@/lib/pickupSlots";
import { dateLocale, tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Lock, Vendor } from "@/types";

/** URL params for the slot detail page: pickup date + slot */
export function slotKey(date: string, window: string): string {
  return encodeURIComponent(`${date}__${window}`);
}

/**
 * Pickup slots: seven days × this store's pickup slots, like a heat map (fuller is darker); with a portion cap set, shows a "portions left" progress bar.
 * Closed days are grayed out as a whole column. Tap a cell for that slot's details. Slots, closed days and portion caps are changed in "Store settings".
 */
export default function SlotsPanel({ vendor, locks, loading }: { vendor: Vendor | null | undefined; locks: Lock[]; loading: boolean }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const today = todayStr();
  const weekStart = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 1 });
  const weekDates = Array.from({ length: 7 }, (_, i) => format(addDays(weekStart, i), "yyyy-MM-dd"));
  const configured = vendorWindows(vendor);
  // After a vendor changes pickup slots, orders on old slots are still listed (marked "disabled"); otherwise they wouldn't show in the grid
  const retired = [...new Set(locks
    .filter((l) => weekDates.includes(l.pickup_date) && l.status !== "no_show" && l.status !== "cancelled" && l.pickup_window && !configured.includes(l.pickup_window))
    .map((l) => l.pickup_window))];
  const windows = [...configured, ...retired].sort((a, b) => a.localeCompare(b));
  const capacity = vendor?.slot_capacity && vendor.slot_capacity > 0 ? vendor.slot_capacity : null;

  // date__window → { total, pending } (no-shows aren't counted toward booked portions)
  const counts = useMemo(() => {
    const map = new Map<string, { total: number; pending: number }>();
    for (const l of locks) {
      if (l.status === "no_show" || l.status === "cancelled") continue;
      const key = `${l.pickup_date}__${l.pickup_window}`;
      const row = map.get(key) ?? { total: 0, pending: 0 };
      row.total += 1;
      if (PENDING_STATUSES.has(l.status)) row.pending += 1;
      map.set(key, row);
    }
    return map;
  }, [locks]);
  const max = capacity ?? Math.max(1, ...weekDates.flatMap((d) => windows.map((w) => counts.get(`${d}__${w}`)?.total ?? 0)));
  const heat = (n: number) => {
    const r = n / max;
    if (n === 0) return "bg-card";
    if (r >= 1) return "bg-primary text-white";
    if (r >= 0.66) return "bg-brand/50";
    if (r >= 0.33) return "bg-brand/30";
    return "bg-secondary";
  };
  const weekTotal = weekDates.reduce((s, d) => s + windows.reduce((t, w) => t + (counts.get(`${d}__${w}`)?.total ?? 0), 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" aria-label={tr("上一週", "Previous week")} onClick={() => setWeekOffset((w) => w - 1)}><ChevronLeft /></Button>
        <span className="text-sm font-semibold">
          {format(weekStart, "M/d", { locale: dateLocale() })} – {format(addDays(weekStart, 6), "M/d", { locale: dateLocale() })}
        </span>
        <Button variant="outline" size="icon" aria-label={tr("下一週", "Next week")} onClick={() => setWeekOffset((w) => w + 1)}><ChevronRight /></Button>
        {weekOffset !== 0 && <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>{tr("本週", "This week")}</Button>}
        <span className="text-sm text-muted-foreground">{tr(`這週 ${weekTotal} 份`, `${weekTotal} this week`)}</span>
        <InfoTip>{tr("份數以最近 500 筆訂單計算。顏色越深越滿；有設「每個時段份數上限」時，格子下方的條是已訂／上限，結帳時伺服器會再檢查一次。", "Counts use the latest 500 orders. Darker = fuller; with a per-slot limit, the bar shows booked/limit.")}</InfoTip>
        <Button variant="outline" size="sm" className="ml-auto" asChild><Link href="/vendor-portal/settings"><Settings /> {tr("時段／公休／上限", "Times / closures / limits")}</Link></Button>
      </div>

      {loading || !vendor ? (
        <SkeletonBlocks height={280} />
      ) : (
        <div className="rounded-xl border-2 border-border bg-card overflow-x-auto">
          <div className="min-w-[720px] grid" style={{ gridTemplateColumns: `100px repeat(7, minmax(86px, 1fr))` }}>
            <div className="border-b border-border" />
            {weekDates.map((d) => (
              <div key={d} className={cn("border-b border-l border-border p-2 text-center text-xs font-semibold", d === today && "bg-foreground text-background")}>
                {d === today ? tr("今天", "Today") : format(new Date(`${d}T00:00:00`), "EEE", { locale: dateLocale() })}
                <div className="font-normal opacity-80">{format(new Date(`${d}T00:00:00`), "M/d")}</div>
              </div>
            ))}
            {windows.map((w) => (
              <div key={w} className="contents">
                <div className="border-b border-border p-2 text-xs font-mono font-semibold flex flex-col justify-center">
                  {slotLabel(w)}
                  {retired.includes(w) && <span className="font-sans font-normal text-[11px] text-warning-text" title={tr("這個時段已從店家設定移除，但還有訂單", "Removed from store settings but still has orders")}>{tr("已停用", "Retired")}</span>}
                </div>
                {weekDates.map((d) => {
                  const closed = vendorClosedReason(vendor, d);
                  const row = counts.get(`${d}__${w}`);
                  const n = row?.total ?? 0;
                  if (closed && !row) {
                    return <div key={d} className="border-b border-l border-border bg-[repeating-linear-gradient(45deg,#f5f5f4,#f5f5f4_6px,#e7e5e4_6px,#e7e5e4_12px)] p-2 text-xs text-muted-foreground flex items-center justify-center">{tr("公休", "Closed")}</div>;
                  }
                  return (
                    <Link key={d} href={`/vendor-portal/sessions/${slotKey(d, w)}/summary`} className={cn("border-b border-l border-border p-2 flex flex-col items-center justify-center gap-1 min-h-[4.5rem] hover:ring-2 hover:ring-inset hover:ring-foreground", heat(n))}>
                      <span className="text-2xl font-bold leading-none">{n}</span>
                      {row && row.pending > 0 && d <= today && <span className="text-[11px] font-semibold">{tr(`待取 ${row.pending}`, `${row.pending} waiting`)}</span>}
                      {capacity !== null && (
                        <span className="w-full h-1.5 rounded-full bg-black/10 overflow-hidden" aria-label={tr(`剩 ${Math.max(0, capacity - n)} 份`, `${Math.max(0, capacity - n)} left`)}>
                          <span className="block h-full bg-foreground/70" style={{ width: `${Math.min(100, (n / capacity) * 100)}%` }} />
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{tr("少", "Few")}</span>
        {["bg-secondary", "bg-brand/30", "bg-brand/50", "bg-primary"].map((c) => <span key={c} className={cn("w-5 h-3 rounded-sm", c)} />)}
        <span>{capacity ? tr("滿", "Full") : tr("多", "Many")}</span>
      </div>
    </div>
  );
}

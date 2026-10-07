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

/** 時段明細頁的網址參數：取餐日＋時段 */
export function slotKey(date: string, window: string): string {
  return encodeURIComponent(`${date}__${window}`);
}

/**
 * 訂餐時段：一週七天 × 這家店的取餐時段，像熱度圖——越滿顏色越深；有設份數上限就顯示「剩幾份」的進度條。
 * 公休整欄灰掉。點格子看該時段明細。時段、公休、份數上限在「店家設定」改。
 */
export default function SlotsPanel({ vendor, locks, loading }: { vendor: Vendor | null | undefined; locks: Lock[]; loading: boolean }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const today = todayStr();
  const weekStart = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 1 });
  const weekDates = Array.from({ length: 7 }, (_, i) => format(addDays(weekStart, i), "yyyy-MM-dd"));
  const windows = vendorWindows(vendor);
  const capacity = vendor?.slot_capacity && vendor.slot_capacity > 0 ? vendor.slot_capacity : null;

  // date__window → { total, pending }（未取餐的不算進已訂份數）
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
    if (r >= 1) return "bg-orange-500 text-white";
    if (r >= 0.66) return "bg-orange-300";
    if (r >= 0.33) return "bg-orange-200";
    return "bg-orange-100";
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
                <div className="border-b border-border p-2 text-xs font-mono font-semibold flex items-center">{slotLabel(w)}</div>
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
        {["bg-orange-100", "bg-orange-200", "bg-orange-300", "bg-orange-500"].map((c) => <span key={c} className={cn("w-5 h-3 rounded-sm", c)} />)}
        <span>{capacity ? tr("滿", "Full") : tr("多", "Many")}</span>
      </div>
    </div>
  );
}

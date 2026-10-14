import { useMemo, useState } from "react";
import { ArrowDownWideNarrow, ChevronDown, ChevronRight, ClipboardList, Search } from "lucide-react";
import LockOrderRow from "@/components/LockOrderRow";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { DONE_STATUSES, PENDING_STATUSES, pickupCode } from "@/lib/lockOutcome";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Lock } from "@/types";

// Order list: filter by status (colored buttons), search by pickup number or item name.
// Sort is switchable: pickup time (soonest first, grouped by pickup date) or order time (newest first, grouped by order date).
const filters = () => [
  { value: "pending", label: tr("待取餐", "To pick up"), dot: "bg-warning", match: (l: Lock) => PENDING_STATUSES.has(l.status) },
  { value: "done", label: tr("已完成", "Done"), dot: "bg-success-strong", match: (l: Lock) => DONE_STATUSES.has(l.status) },
  { value: "no_show", label: tr("未取餐／愛心餐", "No-show / charity"), dot: "bg-charity", match: (l: Lock) => l.status === "no_show" || l.status === "charity" },
  { value: "all", label: tr("全部", "All"), dot: "bg-muted-foreground/50", match: () => true },
] as const;

type SortMode = "pickup" | "ordered";
const SORT_KEY = "bb.vendorOrders.sort";

function createdMillis(lock: Lock): number {
  const ts = lock.created_at as { toMillis?: () => number } | null | undefined;
  return ts?.toMillis ? ts.toMillis() : 0;
}
/** Order date (Taipei, YYYY-MM-DD); legacy records without a timestamp are grouped together */
function orderedDate(lock: Lock): string {
  const ms = createdMillis(lock);
  return ms ? new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }) : "";
}

export default function OrdersListPanel({ locks, loading, truncated }: { locks: Lock[]; loading: boolean; truncated: boolean }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("pending");
  // Date groups: only the first day is expanded by default, the rest on click; everything expands while searching
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<SortMode>(() => {
    try { return localStorage.getItem(SORT_KEY) === "ordered" ? "ordered" : "pickup"; } catch { return "pickup"; }
  });
  function changeSort(mode: SortMode) {
    setSort(mode);
    setOpen({});
    try { localStorage.setItem(SORT_KEY, mode); } catch { /* can't save (e.g. private mode); ignore */ }
  }

  const searched = useMemo(() => {
    const q = search.trim().toUpperCase().replace(/\s+/g, "");
    const rows = q ? locks.filter((l) => pickupCode(l).includes(q) || l.item_name.toUpperCase().includes(q)) : locks;
    return [...rows].sort(sort === "ordered"
      ? (a, b) => createdMillis(b) - createdMillis(a)
      : (a, b) => `${a.pickup_date} ${a.pickup_window}`.localeCompare(`${b.pickup_date} ${b.pickup_window}`));
  }, [locks, search, sort]);
  const current = filters().find((f) => f.value === filter) ?? filters()[0];
  const rows = searched.filter(current.match);
  const byDate = useMemo(() => {
    const map = new Map<string, Lock[]>();
    for (const l of rows) {
      const key = sort === "ordered" ? orderedDate(l) : l.pickup_date;
      map.set(key, [...(map.get(key) ?? []), l]);
    }
    return [...map.entries()];
  }, [rows, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {filters().map((f) => (
          <button key={f.value} type="button" onClick={() => setFilter(f.value)} aria-pressed={filter === f.value}
            className={cn("inline-flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm", filter === f.value ? "border-foreground bg-card font-semibold" : "border-border bg-card/60 hover:bg-card")}>
            <span className={cn("w-2.5 h-2.5 rounded-full", f.dot)} />{f.label}
            <span className="text-lg font-bold leading-none">{searched.filter(f.match).length}</span>
          </button>
        ))}
        <div className="ml-auto inline-flex items-center gap-1 rounded-xl border-2 border-border bg-card/60 p-1 text-sm" role="radiogroup" aria-label={tr("排序方式", "Sort by")}>
          <ArrowDownWideNarrow className="ml-1.5 w-4 h-4 text-muted-foreground" aria-hidden="true" />
          {([["pickup", tr("取餐時間", "Pickup time")], ["ordered", tr("下單時間", "Order time")]] as const).map(([mode, label]) => (
            <button key={mode} type="button" role="radio" aria-checked={sort === mode} onClick={() => changeSort(mode)}
              className={cn("rounded-lg px-2.5 py-1", sort === mode ? "bg-foreground text-background font-semibold" : "hover:bg-accent")}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("取餐號或品名", "Code or item")} aria-label={tr("搜尋訂單", "Search orders")} className="pl-9" />
        </div>
      </div>
      {truncated && <p className="text-xs text-muted-foreground">{tr("只列最近 500 筆", "Latest 500 only")}</p>}

      {loading ? (
        <SkeletonBlocks count={4} height={88} className="space-y-3" />
      ) : rows.length === 0 ? (
        <EmptyState size="compact" icon={<ClipboardList size={32} />} title={tr("沒有符合的訂單", "No matching orders")} />
      ) : (
        <div className="space-y-5">
          {byDate.map(([date, list]) => (
            <section key={date} className="space-y-2">
              {(() => {
                const isOpen = open[date] ?? (!!search.trim() || date === byDate[0][0]);
                return (
                  <>
                    <button type="button" onClick={() => setOpen((o) => ({ ...o, [date]: !isOpen }))} aria-expanded={isOpen} className="w-full flex items-center gap-2 rounded-lg px-1 py-1 text-left font-semibold hover:bg-accent">
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      {sort === "ordered" && <span className="text-xs font-normal text-muted-foreground">{tr("下單", "Ordered")}</span>}
                      {date ? date.slice(5).replace("-", "/") : tr("時間不明", "Unknown")}
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal">{list.length} {tr("份", "")}</span>
                    </button>
                    {isOpen && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {list.map((l) => <LockOrderRow key={l.id} lock={l} showDate={sort === "ordered"} />)}
                      </div>
                    )}
                  </>
                );
              })()}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

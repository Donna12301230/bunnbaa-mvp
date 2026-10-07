import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ClipboardList, Search } from "lucide-react";
import LockOrderRow from "@/components/LockOrderRow";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { DONE_STATUSES, PENDING_STATUSES, pickupCode } from "@/lib/lockOutcome";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Lock } from "@/types";

// 訂單列表：依狀態篩選（色塊按鈕），可用取餐編號或品名搜尋；依取餐日期分組。
const filters = () => [
  { value: "pending", label: tr("待取餐", "To pick up"), dot: "bg-amber-400", match: (l: Lock) => PENDING_STATUSES.has(l.status) },
  { value: "done", label: tr("已完成", "Done"), dot: "bg-green-500", match: (l: Lock) => DONE_STATUSES.has(l.status) },
  { value: "no_show", label: tr("未取餐／愛心餐", "No-show / charity"), dot: "bg-pink-400", match: (l: Lock) => l.status === "no_show" || l.status === "charity" },
  { value: "all", label: tr("全部", "All"), dot: "bg-stone-400", match: () => true },
] as const;

export default function OrdersListPanel({ locks, loading, truncated }: { locks: Lock[]; loading: boolean; truncated: boolean }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<string>("pending");
  // 日期分組預設只展開第一天，其他點開才看；搜尋時全部展開
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const searched = useMemo(() => {
    const q = search.trim().toUpperCase().replace(/\s+/g, "");
    const rows = q ? locks.filter((l) => pickupCode(l).includes(q) || l.item_name.toUpperCase().includes(q)) : locks;
    return [...rows].sort((a, b) => `${a.pickup_date} ${a.pickup_window}`.localeCompare(`${b.pickup_date} ${b.pickup_window}`));
  }, [locks, search]);
  const current = filters().find((f) => f.value === filter) ?? filters()[0];
  const rows = searched.filter(current.match);
  const byDate = useMemo(() => {
    const map = new Map<string, Lock[]>();
    for (const l of rows) map.set(l.pickup_date, [...(map.get(l.pickup_date) ?? []), l]);
    return [...map.entries()];
  }, [rows]);

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
        <div className="relative ml-auto w-full sm:w-64">
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
                      {date.slice(5).replace("-", "/")}
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-normal">{list.length} {tr("份", "")}</span>
                    </button>
                    {isOpen && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {list.map((l) => <LockOrderRow key={l.id} lock={l} showDate={false} />)}
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

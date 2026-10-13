import { Fragment, useState } from "react";
import { amountText } from "@/lib/prep";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface CraftItem {
  id: string;
  name: string;
  /** Quantity needed (in ingredient units) */
  need: number;
  unit: string;
  /** Quantity on hand; undefined = not shown (on hand / needed) */
  have?: number;
  /** Minor materials such as seasonings and packaging, collapsed by default */
  minor?: boolean;
}

/**
 * Crafting grid: "B + C + D → A", each material showing (on hand / needed), red when short.
 * Shared by the menu's materials total, today's prep pick list, and purchasing shortages.
 */
export default function RecipeCraft({ items, target, onItemClick, haveNote, compact }: {
  items: CraftItem[];
  /** Crafting result; without one no arrow is drawn (e.g. pick list) */
  target?: { name: string; sub?: string };
  onItemClick?: (id: string) => void;
  /** Label for the on-hand quantity, e.g. "Theoretical stock" */
  haveNote?: string;
  compact?: boolean;
}) {
  const [showMinor, setShowMinor] = useState(false);
  const major = items.filter((i) => !i.minor);
  const minor = items.filter((i) => i.minor);
  const shown = showMinor ? [...major, ...minor] : major;
  const shortCount = items.filter((i) => i.have !== undefined && i.have + 1e-6 < i.need).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start gap-x-1.5 gap-y-3">
        {shown.map((item, idx) => {
          const short = item.have !== undefined && item.have + 1e-6 < item.need;
          return (
            <Fragment key={item.id}>
              {idx > 0 && target && <span className="self-center text-muted-foreground pt-1" aria-hidden="true">+</span>}
              <button
                type="button"
                disabled={!onItemClick}
                onClick={() => onItemClick?.(item.id)}
                className={cn("flex flex-col items-center text-center", onItemClick && "cursor-pointer")}
                title={short ? tr(`不夠，還缺 ${amountText(item.need - (item.have ?? 0), item.unit)}`, "Not enough") : undefined}
              >
                <span className={cn(
                  "rounded-md border-2 bg-card flex flex-col items-center justify-center px-1",
                  compact ? "w-[72px] h-[52px]" : "w-[84px] h-[60px]",
                  short ? "border-danger bg-danger-soft" : "border-foreground/70",
                  item.minor && "border-dashed",
                )}>
                  <span className="text-xs font-semibold leading-tight line-clamp-2">{item.name}</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">{amountText(item.need, item.unit)}</span>
                </span>
                {item.have !== undefined && (
                  <span className={cn("text-[11px] font-mono mt-0.5", short ? "text-danger-text font-semibold" : "text-muted-foreground")}>
                    ({amountText(item.have, item.unit)}/{amountText(item.need, item.unit)})
                  </span>
                )}
              </button>
            </Fragment>
          );
        })}
        {target && (
          <>
            <span className="self-center text-muted-foreground px-1 pt-1" aria-hidden="true">──▶</span>
            <span className={cn("rounded-md border-2 border-foreground bg-foreground text-background flex flex-col items-center justify-center px-2", compact ? "min-w-[72px] h-[52px]" : "min-w-[84px] h-[60px]")}>
              <span className="text-xs font-semibold leading-tight">{target.name}</span>
              {target.sub && <span className="text-[11px] opacity-80 leading-tight">{target.sub}</span>}
            </span>
          </>
        )}
        {items.length === 0 && <span className="text-xs text-muted-foreground">{tr("還沒有原物料可以算", "No ingredients to show yet")}</span>}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {minor.length > 0 && (
          <button type="button" className="underline" onClick={() => setShowMinor((v) => !v)}>
            {showMinor ? tr("收合調味、包材", "Hide seasonings & packaging") : tr(`＋調味、包材 ${minor.length} 項`, `+${minor.length} seasonings & packaging`)}
          </button>
        )}
        {items.some((i) => i.have !== undefined) && (
          <span>
            {tr("（現有／需要）", "(have/need)")}{haveNote ? `・${haveNote}` : ""}
            {shortCount > 0 && <span className="text-danger-text font-semibold">{tr(`・${shortCount} 項不夠`, ` · ${shortCount} short`)}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

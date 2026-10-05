import { Fragment, useState } from "react";
import { amountText } from "@/lib/prep";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface CraftItem {
  id: string;
  name: string;
  /** 需要量（原物料單位） */
  need: number;
  unit: string;
  /** 現有量；undefined＝不顯示（現有／需要） */
  have?: number;
  /** 調味、包材等次要材料，預設收合 */
  minor?: boolean;
}

/**
 * 合成格子（待修改.docx 第 4 列附圖）：「B + C + D → A」，每格材料下面寫（現有／需要），不夠的變紅。
 * 菜單的材料總和、今日備料的領料單、採購的缺料共用這個元件。
 */
export default function RecipeCraft({ items, target, onItemClick, haveNote, compact }: {
  items: CraftItem[];
  /** 合成結果；沒有就不畫箭頭（例如領料單） */
  target?: { name: string; sub?: string };
  onItemClick?: (id: string) => void;
  /** 現有量的說明，例：「理論庫存」 */
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
                  "rounded-md border-2 bg-white flex flex-col items-center justify-center px-1",
                  compact ? "w-[72px] h-[52px]" : "w-[84px] h-[60px]",
                  short ? "border-red-500 bg-red-50" : "border-foreground/70",
                  item.minor && "border-dashed",
                )}>
                  <span className="text-xs font-semibold leading-tight line-clamp-2">{item.name}</span>
                  <span className="text-[11px] text-muted-foreground leading-tight">{amountText(item.need, item.unit)}</span>
                </span>
                {item.have !== undefined && (
                  <span className={cn("text-[11px] font-mono mt-0.5", short ? "text-red-600 font-semibold" : "text-muted-foreground")}>
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
            {shortCount > 0 && <span className="text-red-600 font-semibold">{tr(`・${shortCount} 項不夠`, ` · ${shortCount} short`)}</span>}
          </span>
        )}
      </div>
    </div>
  );
}

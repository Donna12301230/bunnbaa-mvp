import { HelpCircle, Plus } from "lucide-react";
import { componentGroup, GROUP_CELL, type FoodGroup } from "@/lib/foodColors";
import { costIssue, itemDishes } from "@/lib/prep";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Component, Ingredient, MenuItem } from "@/types";

export interface BentoCell {
  key: string;
  name: string;
  /** 份量，例「200g」 */
  sub?: string;
  group: FoodGroup;
  /** 還沒有組成（沒接配方或配方沒原物料）：虛線、問號 */
  missing?: boolean;
  onClick?: () => void;
}

/** 一格的份量文字：半成品每份熟重，份數不是 1 時加「×2」 */
export function cellSub(comp: Component | undefined, portions = 1): string | undefined {
  if (!comp || !(comp.portion_grams > 0)) return portions !== 1 ? `×${portions}` : undefined;
  return `${Math.round(comp.portion_grams * portions)}g`;
}

/** 一道菜 → 一格；配方缺漏（未接、沒原物料、被刪）就畫成問號格 */
export function dishCell(key: string, name: string, componentId: string | null | undefined, componentsById: Record<string, Component>, ingredientsById: Record<string, Ingredient>, portions = 1, rice = false): BentoCell {
  const comp = componentId ? componentsById[componentId] : undefined;
  const issue = costIssue(componentId, componentsById, ingredientsById);
  return {
    key,
    name: name || comp?.name || "?",
    sub: cellSub(comp, portions),
    group: rice ? "rice" : componentGroup(comp, ingredientsById),
    missing: !!issue && issue.kind !== "no_price",
  };
}

/** 品項的預設組合（白飯、第一道主菜、固定附餐、各配菜的預設菜）→ 便當格子 */
export function itemCells(item: MenuItem, componentsById: Record<string, Component>, ingredientsById: Record<string, Ingredient>): BentoCell[] {
  const cells: BentoCell[] = [];
  const isBento = item.item_type ? item.item_type === "bento" : (item.slots?.length ?? 0) > 0;
  if (isBento) {
    if (item.rice_component_id) cells.push(dishCell("rice", tr("白飯", "Rice"), item.rice_component_id, componentsById, ingredientsById, 1, true));
    const main = item.mains?.[0] ?? item.main;
    if (main?.name) cells.push(dishCell("main", main.name, main.component_id, componentsById, ingredientsById));
    (item.fixed ?? []).forEach((f, i) => cells.push(dishCell(`fixed${i}`, f.name, f.component_id, componentsById, ingredientsById, f.portions ?? 1)));
    (item.slots ?? []).forEach((s, i) => s.default?.name && cells.push(dishCell(`slot${i}`, s.default.name, s.default.component_id, componentsById, ingredientsById)));
  } else {
    const dishes = itemDishes(item);
    dishes.forEach((d, i) => cells.push(dishCell(`part${i}`, d.name, d.component_id, componentsById, ingredientsById, item.fixed?.[i - (item.component_id ? 1 : 0)]?.portions ?? 1)));
  }
  return cells;
}

/**
 * 分格便當盒（簡化提案 §5.2）：每格是一道配菜，顏色是食材類別。第一格（通常是白飯）佔左邊兩列。
 * size="thumb" 是菜單卡片上的縮圖；size="edit" 可以點格子改、按「加一格」新增。
 */
export default function BentoBox({ cells, size = "thumb", onAdd, empty }: {
  cells: BentoCell[];
  size?: "thumb" | "edit";
  onAdd?: () => void;
  /** 完全沒有組成時的「空便當」 */
  empty?: boolean;
}) {
  const thumb = size === "thumb";
  const shown = empty || cells.length === 0
    ? [{ key: "q1", name: "?", group: "other" as FoodGroup, missing: true }, { key: "q2", name: "?", group: "other" as FoodGroup, missing: true }, { key: "q3", name: "?", group: "other" as FoodGroup, missing: true }]
    : cells;
  const tall = shown.length >= 3;
  return (
    <div
      className={cn(
        "grid gap-1 rounded-xl border-2 p-1",
        thumb ? "grid-cols-3 w-32 shrink-0 auto-rows-[2.25rem]" : "grid-cols-3 sm:grid-cols-4 auto-rows-[4rem]",
        empty || cells.every((c) => c.missing) ? "border-dashed border-stone-400 bg-stone-50" : "border-stone-700 bg-stone-700",
      )}
      role="group"
      aria-label={tr("便當組成", "Bento layout")}
    >
      {shown.map((c, i) => {
        const body = (
          <>
            {c.missing ? (
              <>
                <HelpCircle className={cn("text-stone-400", thumb ? "w-3.5 h-3.5" : "w-5 h-5")} aria-hidden="true" />
                {!thumb && c.name !== "?" && <span className="text-xs leading-tight line-clamp-1">{c.name}</span>}
              </>
            ) : (
              <>
                <span className={cn("font-semibold leading-tight line-clamp-2", thumb ? "text-[10px]" : "text-sm")}>{c.name}</span>
                {c.sub && !thumb && <span className="text-xs leading-tight opacity-75">{c.sub}</span>}
              </>
            )}
          </>
        );
        const cls = cn(
          "rounded-md border flex flex-col items-center justify-center text-center px-0.5 min-w-0 overflow-hidden",
          c.missing ? "border-dashed border-stone-400 bg-white text-stone-500" : GROUP_CELL[c.group],
          i === 0 && tall && "row-span-2",
        );
        return c.onClick ? (
          <button key={c.key} type="button" className={cn(cls, "hover:ring-2 hover:ring-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} onClick={c.onClick} aria-label={c.missing ? tr(`${c.name}：還沒有組成，點我補`, `${c.name}: no recipe yet`) : tr(`改 ${c.name}`, `Edit ${c.name}`)}>
            {body}
          </button>
        ) : (
          <div key={c.key} className={cls}>{body}</div>
        );
      })}
      {onAdd && (
        <button type="button" onClick={onAdd} className="rounded-md border border-dashed border-stone-400 bg-white text-stone-600 flex flex-col items-center justify-center text-xs hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Plus className="w-4 h-4" />
          {tr("加一格", "Add")}
        </button>
      )}
    </div>
  );
}

/** 成本／毛利色條（簡化提案 §5.2）。成本占售價越高越紅 */
export function MarginBar({ cost, price }: { cost: number; price: number }) {
  if (!(price > 0) || !(cost > 0)) return null;
  const costPct = Math.min(100, Math.round((cost / price) * 100));
  const low = costPct > 60;
  return (
    <div className="space-y-0.5" aria-label={tr(`成本 ${costPct}%，毛利 ${100 - costPct}%`, `Cost ${costPct}%, margin ${100 - costPct}%`)}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-green-200">
        <div className={cn("h-full", low ? "bg-red-500" : "bg-rose-400")} style={{ width: `${costPct}%` }} />
        <div className="h-full flex-1 bg-green-500" />
      </div>
      <div className="flex justify-between text-[11px]">
        <span className={low ? "text-red-700 font-semibold" : "text-rose-700"}>{tr("成本", "Cost")} {costPct}%</span>
        <span className="text-green-700 font-semibold">{tr("毛利", "Margin")} {100 - costPct}%</span>
      </div>
    </div>
  );
}

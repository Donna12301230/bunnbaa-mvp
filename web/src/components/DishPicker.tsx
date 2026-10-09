import { useRef, useState } from "react";
import { BookOpen, Check, Plus, Unlink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Component } from "@/types";

export interface DishValue {
  name: string;
  component_id: string | null;
}

/**
 * 菜色欄位：菜名和半成品合成一格（截圖：店家常只打菜名、半成品留「—」，備料就算不到）。
 * - 打字即搜尋既有半成品，選了同時決定菜名和配方
 * - 找不到就「建立『茄子』」（疊開配方視窗）或「只建名稱」（之後再補配方）
 * - 離開欄位時，菜名剛好等於某個半成品名稱就自動接上
 * 顯示給消費者的是輸入框裡的菜名；接的配方另外以小字標出，兩者可以不同（例：招牌雞腿／滷雞腿）。
 */
export default function DishPicker({ value, onChange, components, onCreate, placeholder, className }: {
  value: DishValue;
  onChange: (v: DishValue) => void;
  components: Component[];
  /** 建立半成品：withRecipe＝疊開配方視窗填原物料；false＝只存名稱 */
  onCreate: (name: string, withRecipe: boolean) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<number>();
  const q = value.name.trim();
  const linked = value.component_id ? components.find((c) => c.id === value.component_id) : undefined;
  const matches = (q ? components.filter((c) => c.name.includes(q) || q.includes(c.name)) : components).slice(0, 8);
  const exact = components.find((c) => c.name === q);

  function pick(c: Component) {
    onChange({ name: q && q !== linked?.name && !c.name.includes(q) ? value.name : c.name, component_id: c.id });
    setOpen(false);
  }

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <Input
        className={cn("h-9 pr-7", !value.component_id && q && "border-primary")}
        placeholder={placeholder ?? tr("菜名（打字找配方）", "Dish (type to find recipe)")}
        value={value.name}
        onFocus={() => { window.clearTimeout(blurTimer.current); setOpen(true); }}
        onChange={(e) => { onChange({ ...value, name: e.target.value }); setOpen(true); }}
        onBlur={() => {
          blurTimer.current = window.setTimeout(() => {
            setOpen(false);
            if (!value.component_id && exact) onChange({ name: value.name, component_id: exact.id });
          }, 150);
        }}
        onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
        aria-autocomplete="list"
      />
      <span className="absolute right-2 top-2.5" aria-hidden="true">
        {value.component_id ? <Check className="w-4 h-4 text-success-text" /> : <BookOpen className="w-4 h-4 text-muted-foreground/60" />}
      </span>
      {linked && linked.name !== value.name && <p className="text-[11px] text-muted-foreground truncate">{tr(`配方：${linked.name}`, `Recipe: ${linked.name}`)}</p>}
      {open && (
        <div
          className="absolute z-50 mt-1 w-full min-w-[220px] rounded-md border border-border bg-popover text-popover-foreground shadow-md py-1 text-sm max-h-72 overflow-y-auto"
          onMouseDown={(e) => e.preventDefault()}
          role="listbox"
        >
          {matches.map((c) => (
            <button key={c.id} type="button" role="option" aria-selected={c.id === value.component_id} className="w-full text-left px-2 py-1.5 hover:bg-accent flex items-center gap-2" onClick={() => pick(c)}>
              <span className="flex-1 truncate">{c.name}</span>
              <span className="text-[11px] text-muted-foreground shrink-0">{c.ingredients?.length ? tr("已有配方", "has recipe") : tr("待補配方", "no recipe yet")}</span>
              {c.id === value.component_id && <Check className="w-3.5 h-3.5 text-success-text" />}
            </button>
          ))}
          {matches.length === 0 && !q && <p className="px-2 py-1.5 text-xs text-muted-foreground">{tr("還沒有半成品，打菜名就能建立", "No components yet — type a name to create one")}</p>}
          {q && !exact && (
            <>
              <button type="button" className="w-full text-left px-2 py-1.5 hover:bg-accent flex items-center gap-2 font-medium" onClick={() => { setOpen(false); onCreate(q, true); }}>
                <Plus className="w-3.5 h-3.5" /> {tr(`建立「${q}」並填配方`, `Create "${q}" with recipe`)}
              </button>
              <button type="button" className="w-full text-left px-2 py-1.5 hover:bg-accent flex items-center gap-2 text-muted-foreground" onClick={() => { setOpen(false); onCreate(q, false); }}>
                <Plus className="w-3.5 h-3.5" /> {tr(`只建名稱「${q}」，之後再補配方`, `Create "${q}" now, recipe later`)}
              </button>
            </>
          )}
          {value.component_id && (
            <button type="button" className="w-full text-left px-2 py-1.5 hover:bg-accent flex items-center gap-2 text-muted-foreground border-t border-border" onClick={() => { onChange({ ...value, component_id: null }); setOpen(false); }}>
              <Unlink className="w-3.5 h-3.5" /> {tr("不接配方", "Unlink recipe")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

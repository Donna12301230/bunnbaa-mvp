import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { discountText, EARLY_BIRD_TIERS } from "@/lib/pricing";
import { priceDays, weekdayOf } from "@/lib/pickupSlots";
import type { Vendor } from "@/types";

const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Discount colors: 5% off light, 20% off primary (add another color when 30% off is added)
function tierClasses(discountPercent: number, selected: boolean) {
  if (selected) return "bg-ink text-[var(--text-on-inverse)] border-ink";
  if (discountPercent >= 20) return "bg-brand/15 text-foreground border-brand/60 hover:bg-brand/25";
  if (discountPercent > 0) return "bg-secondary text-foreground border-border hover:bg-secondary/70";
  return "bg-card text-foreground border-border";
}

interface Props {
  value: string;
  onChange: (date: string) => void;
  /** When given, grey out dates by this vendor's closed days and cut-off */
  vendor?: Vendor | null;
  /** When given, show each day's price (after early-bird discount) */
  basePrice?: number | null;
  className?: string;
  label?: string;
  /** Extra reasons a date can't be ordered (e.g. the item isn't served that day) */
  extraProblem?: (date: string) => string | null;
}

/**
 * Price date strip: the only way to pick a date anywhere on the site.
 * The discount buttons at the top ("5% off | 20% off") jump to the first day with that discount; below, 30 days from tomorrow run horizontally,
 * each showing that day's price, colored by discount, with closed days greyed out; tapping a date selects it.
 */
export default function PriceDateStrip({ value, onChange, vendor, basePrice, className, label, extraProblem }: Props) {
  const { t, lang } = useI18n();
  const days = useMemo(
    () => priceDays(vendor).map((d) => (d.problem || !extraProblem ? d : { ...d, problem: extraProblem(d.date) })),
    [vendor, extraProblem]
  );
  const scroller = useRef<HTMLDivElement>(null);
  const weekdays = lang === "en" ? WEEKDAYS_EN : WEEKDAYS_ZH;

  // Scroll the selected date into view
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-date="${value}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [value]);

  function jumpTo(discountPercent: number) {
    const first = days.find((d) => d.discountPercent === discountPercent && !d.problem);
    if (first) onChange(first.date);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs font-semibold text-muted-foreground">{label ?? t("取餐日期（越早訂越便宜）", "Pickup date (book early, pay less)")}</p>
        <div className="flex gap-1.5" role="group" aria-label={t("依折扣跳到日期", "Jump to a discount")}>
          {EARLY_BIRD_TIERS.map((tier) => (
            <button
              key={tier.minDays}
              type="button"
              onClick={() => jumpTo(tier.discountPercent)}
              className={cn(
                "text-xs font-bold px-3 py-1 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tierClasses(tier.discountPercent, false)
              )}
            >
              {discountText(tier.discountPercent)}
              <span className="font-normal text-muted-foreground ml-1">
                {tier.minDays === 0 ? t("明天", "tomorrow") : t(`提前 ${tier.minDays}–${tier.maxDays} 天`, `${tier.minDays}–${tier.maxDays} days`)}
              </span>
            </button>
          ))}
        </div>
      </div>
      <div
        ref={scroller}
        className="flex gap-2 overflow-x-auto snap-x pb-2 bb-thin-scroll"
        role="radiogroup"
        aria-label={t("取餐日期", "Pickup date")}
      >
        {days.map((d) => {
          const selected = d.date === value;
          const disabled = !!d.problem;
          const price = basePrice != null ? Math.round(basePrice * (1 - d.discountPercent / 100)) : null;
          return (
            <button
              key={d.date}
              type="button"
              data-date={d.date}
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              title={d.problem ?? undefined}
              onClick={() => onChange(d.date)}
              className={cn(
                "shrink-0 snap-start min-w-[76px] rounded-xl border px-2.5 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                disabled ? "bg-muted text-muted-foreground/60 border-border cursor-not-allowed" : tierClasses(d.discountPercent, selected)
              )}
            >
              <span className="block text-xs font-semibold">
                {d.date.slice(5).replace("-", "/")}{lang === "en" ? ` (${weekdays[weekdayOf(d.date)]})` : `（${weekdays[weekdayOf(d.date)]}）`}
              </span>
              <span className="block font-heading text-base font-semibold leading-tight">
                {disabled
                  ? /截單|closed at/.test(d.problem ?? "") ? t("已截單", "Closed") : t("休", "Off")
                  : price != null ? `$${price}` : discountText(d.discountPercent)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

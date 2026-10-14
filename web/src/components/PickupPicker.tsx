import { loc, tr } from "@/lib/i18n";
import { useEffect } from "react";
import { AlertTriangle, CalendarOff } from "lucide-react";
import PriceDateStrip from "@/components/PriceDateStrip";
import { useSlotConflicts } from "@/hooks/useSlotConflicts";
import { useSlotAvailability } from "@/hooks/useSlotAvailability";
import { slotLabel } from "@/lib/pickupSlots";
import type { MealPeriod, MenuItem, Vendor } from "@/types";

interface PickupPickerProps {
  date: string;
  window: string;
  onDateChange: (date: string) => void;
  onWindowChange: (window: string) => void;
  /** Signed-in user's uid; when given, warns "You already have an order in this slot" */
  uid?: string | null;
  /** When given, use this vendor's pickup slots / closed days / quantity caps; otherwise (no vendor chosen yet on the home page) use the default slots */
  vendor?: Vendor | null;
  /** Only list slots for the meal periods this item is served in */
  item?: Pick<MenuItem, "meal_periods"> | null;
  period?: MealPeriod | null;
  /** When given, show each day's price on the date strip */
  basePrice?: number | null;
  dateLabel?: string;
}

// Pickup date (price date strip) + slot picker. Shared by the item page and add-to-meal-plan.
// Slots that have started, are full, or fall on a closed day can't be picked; if the chosen slot becomes invalid, jump to that day's first available one.
export default function PickupPicker({ date, window, onDateChange, onWindowChange, uid, vendor, item, period, basePrice, dateLabel }: PickupPickerProps) {
  const conflicts = useSlotConflicts(uid, date, window);
  const { closedReason, slots } = useSlotAvailability(vendor, date, item, period);
  const selectedOpen = slots.some((s) => s.window === window && s.open);
  const firstOpen = slots.find((s) => s.open)?.window;

  useEffect(() => {
    if (!selectedOpen && firstOpen) onWindowChange(firstOpen);
  }, [selectedOpen, firstOpen, onWindowChange]);

  return (
    <div className="space-y-3">
      <PriceDateStrip value={date} onChange={onDateChange} vendor={vendor} basePrice={basePrice} label={dateLabel} />

      {closedReason ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-background p-3 text-sm text-muted-foreground">
          <CalendarOff className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{closedReason}{tr("，請改選其他日期。", ". Please choose another date.")}</span>
        </div>
      ) : (
        <div className="space-y-2" role="radiogroup" aria-label={tr("取餐時段", "Pickup time")}>
          {slots.map((slot) => {
            const selected = window === slot.window;
            const status = slot.started ? tr("已過", "Passed") : slot.remaining === 0 ? tr("已額滿", "Full") : slot.remaining !== null ? tr(`剩 ${slot.remaining} 份`, `${slot.remaining} left`) : null;
            return (
              <label
                key={slot.window}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-colors ${
                  !slot.open
                    ? "border-border bg-background opacity-50 cursor-not-allowed"
                    : selected
                      ? "border-brand bg-accent cursor-pointer"
                      : "border-border bg-background cursor-pointer"
                }`}
              >
                <input
                  type="radio"
                  name="pickupSlot"
                  checked={selected && slot.open}
                  disabled={!slot.open}
                  onChange={() => onWindowChange(slot.window)}
                  className="accent-primary w-4 h-4"
                />
                <span className="text-sm font-medium">{slotLabel(slot.window)}</span>
                {status && <span className="text-xs text-muted-foreground ml-auto">{status}</span>}
              </label>
            );
          })}
          {!firstOpen && <p className="text-xs text-muted-foreground">{tr("這天已經沒有可以預約的時段，請改選其他日期。", "No time slots left on this day. Please choose another date.")}</p>}
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning-soft p-3 text-xs text-warning-text">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {tr(
              `提醒：你在這個時段已經有 ${conflicts.length} 筆訂單（${conflicts.map((l) => l.item_name).join("、")}）。確定要再訂一份嗎？（例如幫朋友帶可以直接繼續）`,
              `Heads up: you already have ${conflicts.length} order(s) in this slot (${conflicts.map((l) => loc(l, "item_name")).join(", ")}). Order another one? (e.g. if it's for a friend, just continue)`
            )}
          </span>
        </div>
      )}
    </div>
  );
}

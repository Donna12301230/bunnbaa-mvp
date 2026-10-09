import { tr } from "@/lib/i18n";
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
  /** 登入者 uid；有的話會提醒「這個時段你已經有訂單」 */
  uid?: string | null;
  /** 有傳就照這家店的取餐時段／公休／份數上限；沒傳（首頁還沒選店）用預設時段 */
  vendor?: Vendor | null;
  /** 只列這個品項供應餐期的時段 */
  item?: Pick<MenuItem, "meal_periods"> | null;
  period?: MealPeriod | null;
  /** 有傳就在日期列標出每天價格 */
  basePrice?: number | null;
  dateLabel?: string;
}

// 取餐日期（價格日期列）＋時段選擇。品項頁、加入計畫共用。
// 已開始、額滿、店休的時段不能選；選到的時段失效時自動跳到當天第一個還能選的。
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
              `Heads up: you already have ${conflicts.length} order(s) in this slot (${conflicts.map((l) => l.item_name).join(", ")}). Order another one? (e.g. if it's for a friend, just continue)`
            )}
          </span>
        </div>
      )}
    </div>
  );
}

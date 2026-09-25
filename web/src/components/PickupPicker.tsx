import { useEffect } from "react";
import { AlertTriangle, CalendarOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSlotConflicts } from "@/hooks/useSlotConflicts";
import { useSlotAvailability } from "@/hooks/useSlotAvailability";
import { maxPickupDateStr, slotLabel, todayStr } from "@/lib/pickupSlots";
import type { Vendor } from "@/types";

interface PickupPickerProps {
  date: string;
  window: string;
  onDateChange: (date: string) => void;
  onWindowChange: (window: string) => void;
  /** 登入者 uid；有的話會提醒「這個時段你已經有訂單」 */
  uid?: string | null;
  /** 有傳就照這家店的取餐時段／公休／份數上限；沒傳（首頁還沒選店）用預設時段 */
  vendor?: Vendor | null;
}

// 取餐日期＋時段選擇。購物車結帳、首頁單點鎖定共用。
// 已開始、額滿、店休的時段不能選；選到的時段失效時自動跳到當天第一個還能選的。
export default function PickupPicker({ date, window, onDateChange, onWindowChange, uid, vendor }: PickupPickerProps) {
  const conflicts = useSlotConflicts(uid, date, window);
  const { closedReason, slots } = useSlotAvailability(vendor, date);
  const selectedOpen = slots.some((s) => s.window === window && s.open);
  const firstOpen = slots.find((s) => s.open)?.window;

  useEffect(() => {
    if (!selectedOpen && firstOpen) onWindowChange(firstOpen);
  }, [selectedOpen, firstOpen, onWindowChange]);

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="pickup-date" className="text-xs text-muted-foreground block mb-1">取餐日期</label>
        <Input
          id="pickup-date"
          type="date"
          value={date}
          min={todayStr()}
          max={maxPickupDateStr()}
          onChange={(e) => e.target.value && onDateChange(e.target.value)}
          className="h-10"
        />
      </div>

      {closedReason ? (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-gray-50 p-3 text-sm text-muted-foreground">
          <CalendarOff className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{closedReason}，請改選其他日期。</span>
        </div>
      ) : (
        <div className="space-y-2" role="radiogroup" aria-label="取餐時段">
          {slots.map((slot) => {
            const selected = window === slot.window;
            const status = slot.started ? "已過" : slot.remaining === 0 ? "已額滿" : slot.remaining !== null ? `剩 ${slot.remaining} 份` : null;
            return (
              <label
                key={slot.window}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-colors ${
                  !slot.open
                    ? "border-border bg-gray-50 opacity-50 cursor-not-allowed"
                    : selected
                      ? "border-orange-400 bg-orange-50 cursor-pointer"
                      : "border-border bg-gray-50 cursor-pointer"
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
          {!firstOpen && <p className="text-xs text-muted-foreground">這天已經沒有可以預約的時段，請改選其他日期。</p>}
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            提醒：你在這個時段已經有 {conflicts.length} 筆訂單（{conflicts.map((l) => l.item_name).join("、")}）。
            確定要再訂一份嗎？（例如幫朋友帶可以直接繼續）
          </span>
        </div>
      )}
    </div>
  );
}

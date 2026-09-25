import { AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSlotConflicts } from "@/hooks/useSlotConflicts";
import { PICKUP_SLOTS, isSlotStarted, maxPickupDateStr, todayStr } from "@/lib/pickupSlots";

interface PickupPickerProps {
  date: string;
  window: string;
  onDateChange: (date: string) => void;
  onWindowChange: (window: string) => void;
  /** 登入者 uid；有的話會提醒「這個時段你已經有訂單」 */
  uid?: string | null;
}

// 取餐日期＋時段選擇。購物車結帳、首頁單點鎖定共用，已開始的時段不能選。
export default function PickupPicker({ date, window, onDateChange, onWindowChange, uid }: PickupPickerProps) {
  const conflicts = useSlotConflicts(uid, date, window);

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
          onChange={(e) => {
            const next = e.target.value;
            if (!next) return;
            onDateChange(next);
            // 換到今天時，原本選的時段可能已經過了，自動跳到下一個還能訂的
            if (isSlotStarted(next, window)) {
              const open = PICKUP_SLOTS.find((s) => !isSlotStarted(next, s.window));
              if (open) onWindowChange(open.window);
            }
          }}
          className="h-10"
        />
      </div>
      <div className="space-y-2" role="radiogroup" aria-label="取餐時段">
        {PICKUP_SLOTS.map((slot) => {
          const started = isSlotStarted(date, slot.window);
          const selected = window === slot.window;
          return (
            <label
              key={slot.window}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-colors ${
                started
                  ? "border-border bg-gray-50 opacity-50 cursor-not-allowed"
                  : selected
                    ? "border-orange-400 bg-orange-50 cursor-pointer"
                    : "border-border bg-gray-50 cursor-pointer"
              }`}
            >
              <input
                type="radio"
                name="pickupSlot"
                checked={selected}
                disabled={started}
                onChange={() => onWindowChange(slot.window)}
                className="accent-orange-500 w-4 h-4"
              />
              <span className="text-sm font-medium">{slot.label}</span>
              {started && <span className="text-xs text-muted-foreground ml-auto">已過</span>}
            </label>
          );
        })}
      </div>
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

import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { bookingProblem, isSlotStarted, itemWindows } from "@/lib/pickupSlots";
import type { MealPeriod, MenuItem, Vendor } from "@/types";

export interface SlotAvailability {
  window: string;
  started: boolean;
  /** Portions left; null when the vendor has no cap */
  remaining: number | null;
  /** Selectable: not started, not full, and the store is open */
  open: boolean;
}

/**
 * Status of each pickup slot at one vendor on one day. Portion counts come from slot_counters (written only
 * by confirmLinePayPayment, see functions/src/index.js); the server checks again at checkout,
 * this just shows the diner first. Without a vendor (e.g. no store chosen yet on the home page), use the default slots and skip counts.
 * With item / period, only list slots in the meal periods the item is served (or the given period).
 */
export function useSlotAvailability(
  vendor: Vendor | null | undefined,
  pickupDate: string,
  item?: Pick<MenuItem, "meal_periods"> | null,
  period?: MealPeriod | null
) {
  const capacity = vendor?.slot_capacity && vendor.slot_capacity > 0 ? vendor.slot_capacity : null;

  const { data: booked = {} } = useQuery({
    queryKey: ["slotCounters", vendor?.id, pickupDate],
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, "slot_counters"), where("vendor_id", "==", vendor!.id), where("pickup_date", "==", pickupDate))
      );
      const counts: Record<string, number> = {};
      snap.docs.forEach((d) => { counts[d.data().pickup_window] = d.data().count ?? 0; });
      return counts;
    },
    enabled: !!vendor?.id && capacity !== null && !!pickupDate,
    staleTime: 15 * 1000,
  });

  // Non-business days, closed days, work-suspension days, past cut-off and beyond the booking range are all unbookable
  const closedReason = pickupDate ? bookingProblem(vendor, pickupDate) : null;
  const slots: SlotAvailability[] = itemWindows(vendor, item, period).map((window) => {
    const started = isSlotStarted(pickupDate, window);
    const remaining = capacity === null ? null : Math.max(0, capacity - (booked[window] ?? 0));
    return { window, started, remaining, open: !closedReason && !started && remaining !== 0 };
  });
  return { closedReason, slots };
}

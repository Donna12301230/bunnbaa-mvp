import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isSlotStarted, vendorClosedReason, vendorWindows } from "@/lib/pickupSlots";
import type { Vendor } from "@/types";

export interface SlotAvailability {
  window: string;
  started: boolean;
  /** 剩幾份；商家沒設上限時是 null */
  remaining: number | null;
  /** 可以選：沒開始、沒額滿、店有營業 */
  open: boolean;
}

/**
 * 某家店某一天每個取餐時段的狀態。份數來自 slot_counters（只有
 * confirmLinePayPayment 會寫，見 functions/src/index.js），伺服器結帳時會再擋一次，
 * 這裡只是讓消費者先看到。沒傳 vendor（例如首頁還沒選店）就用預設時段、不算份數。
 */
export function useSlotAvailability(vendor: Vendor | null | undefined, pickupDate: string) {
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

  const closedReason = vendorClosedReason(vendor, pickupDate);
  const slots: SlotAvailability[] = vendorWindows(vendor).map((window) => {
    const started = isSlotStarted(pickupDate, window);
    const remaining = capacity === null ? null : Math.max(0, capacity - (booked[window] ?? 0));
    return { window, started, remaining, open: !closedReason && !started && remaining !== 0 };
  });
  return { closedReason, slots };
}

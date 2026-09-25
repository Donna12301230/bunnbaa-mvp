import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { windowsOverlap } from "@/lib/pickupSlots";
import type { Lock } from "@/types";

/**
 * 同一天、時段重疊、而且還是「已鎖定」的自己的訂單——只拿來提醒，不擋下單
 * （2026-09-25 決定：可能是幫朋友多訂一份）。轉賣中／贈送中的不算，因為正在讓出去。
 * 只用 buyer_uid + pickup_date 兩個等值條件，不需要額外的複合索引。
 */
export function useSlotConflicts(uid: string | null | undefined, pickupDate: string, pickupWindow: string) {
  const { data: sameDayLocks = [] } = useQuery({
    queryKey: ["myLocksOnDate", uid, pickupDate],
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, "locks"), where("buyer_uid", "==", uid), where("pickup_date", "==", pickupDate))
      );
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Lock);
    },
    enabled: !!uid && !!pickupDate,
    staleTime: 30 * 1000,
  });
  return sameDayLocks.filter((l) => l.status === "locked" && windowsOverlap(l.pickup_window, pickupWindow));
}

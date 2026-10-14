import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { windowsOverlap } from "@/lib/pickupSlots";
import type { Lock } from "@/types";

/**
 * The user's own orders on the same day with overlapping slots that are still "locked"; used only as a reminder, ordering isn't blocked
 * (decided 2026-09-25: they may be ordering an extra one for a friend). Ones being resold / gifted don't count, since they are being given away.
 * Uses only the two equality filters buyer_uid + pickup_date, so no extra composite index is needed.
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

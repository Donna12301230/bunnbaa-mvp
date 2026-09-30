import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { mondayOf } from "@/lib/pickupSlots";

export interface SideWishCount {
  date: string;
  item_id: string;
  slot: number;
  candidate: number;
  count: number;
}

/**
 * 某家店某一週的候選菜許願計數（sideWishes，公開可讀、只有數字）。
 * 給品項頁顯示「地瓜葉 7/10」進度與「本週已滿」。
 */
export function useSideWishes(vendorId: string | undefined, pickupDate: string | undefined) {
  const week = pickupDate ? mondayOf(pickupDate) : "";
  const { data = [] } = useQuery({
    queryKey: ["sideWishes", vendorId, week],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "sideWishes"), where("vendor_id", "==", vendorId), where("week", "==", week)));
      return snap.docs.map((d) => d.data() as SideWishCount);
    },
    enabled: !!vendorId && !!week,
    staleTime: 30 * 1000,
  });
  const dayCount = (itemId: string, slot: number, candidate: number) =>
    data.filter((d) => d.date === pickupDate && d.item_id === itemId && d.slot === slot && d.candidate === candidate).reduce((s, d) => s + (d.count || 0), 0);
  const weekCount = (itemId: string, slot: number, candidate: number) =>
    data.filter((d) => d.item_id === itemId && d.slot === slot && d.candidate === candidate).reduce((s, d) => s + (d.count || 0), 0);
  return { dayCount, weekCount };
}

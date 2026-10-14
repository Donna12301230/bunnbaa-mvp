import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Lock } from "@/types";

/**
 * Locks only store the item_name at order time, without an image URL; this maps "vendor + item name"
 * back to the menu_items image. Includes unlisted items, since items on old orders may have been discontinued.
 */
export function useItemImages() {
  const { data: images } = useQuery({
    queryKey: ["itemImages"],
    queryFn: async () => {
      const snap = await getDocs(collection(db, "menu_items"));
      const map = new Map<string, string>();
      snap.docs.forEach((d) => {
        const { vendor_id, name, image } = d.data();
        if (image) map.set(`${vendor_id}|${name}`, image);
      });
      return map;
    },
    staleTime: 15 * 60 * 1000,
  });
  return (lock: Pick<Lock, "vendor_id" | "item_name">) => images?.get(`${lock.vendor_id}|${lock.item_name}`);
}

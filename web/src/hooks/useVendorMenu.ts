import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { MenuItem } from "@/types";

/** All of the vendor's items (including unlisted), sorted by category. Menu management, recipes (where used), prep estimates and the setup progress bar share this cache */
export function useVendorMenu(vendorId: string | undefined) {
  return useQuery({
    queryKey: ["vendorMenu", vendorId],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "menu_items"), where("vendor_id", "==", vendorId)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as MenuItem)
        .sort((a, b) => a.category.localeCompare(b.category));
    },
    enabled: !!vendorId,
  });
}

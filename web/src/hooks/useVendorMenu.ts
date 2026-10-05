import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { MenuItem } from "@/types";

/** 店家的全部品項（含下架），依分類排序。菜單管理、配方（用在哪些菜）、備料預估、設定進度條共用同一個快取 */
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

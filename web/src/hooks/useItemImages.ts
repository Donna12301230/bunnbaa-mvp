import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Lock } from "@/types";

/**
 * 鎖定（locks）只存下單當下的 item_name，沒有圖片網址；這裡用「商家＋品名」
 * 對回 menu_items 的圖。包含已下架的品項——舊訂單的品項可能已經停售。
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

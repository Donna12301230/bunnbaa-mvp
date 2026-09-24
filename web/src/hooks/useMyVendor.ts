import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import type { Vendor } from "@/types";

export const myVendorDocKey = (vendorId?: string) => ["myVendorDoc", vendorId] as const;

/** 登入廠商綁定（owner_uid）的真實 vendors/{id} 文件 */
export function useMyVendor() {
  const { user } = useAuth();
  const vendorId = user?.vendorId;
  return useQuery({
    queryKey: myVendorDocKey(vendorId),
    queryFn: async () => {
      const snap = await getDoc(doc(db, "vendors", vendorId!));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Vendor) : null;
    },
    enabled: !!vendorId,
  });
}

import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import type { Vendor } from "@/types";

export const myVendorDocKey = (vendorId?: string) => ["myVendorDoc", vendorId] as const;

/** The real vendors/{id} document bound to the signed-in vendor (owner_uid) */
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

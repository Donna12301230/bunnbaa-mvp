import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import type { Lock } from "@/types";

/**
 * The latest max locks for the signed-in vendor owner's store (live). Uses the existing vendor_id + created_at index;
 * date / slot / status filtering is done on the client. Shared by the vendor portal pages (overview, prep, orders, slots, reports).
 */
export function useVendorLocks(max = 500) {
  const vendorId = useAuth().user?.vendorId;
  const [locks, setLocks] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!vendorId) return;
    const q = query(collection(db, "locks"), where("vendor_id", "==", vendorId), orderBy("created_at", "desc"), limit(max));
    return onSnapshot(
      q,
      (snap) => {
        setLocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock));
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [vendorId, max]);

  return { locks, loading, vendorId, truncated: locks.length >= max };
}

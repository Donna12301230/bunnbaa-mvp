import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import type { Lock } from "@/types";

/**
 * 登入店主這家店最近 max 筆鎖定（即時）。用 vendor_id + created_at 既有索引，
 * 日期／時段／狀態篩選交給前端——商家後台各頁（總覽、備料、訂單、時段、報表）共用。
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

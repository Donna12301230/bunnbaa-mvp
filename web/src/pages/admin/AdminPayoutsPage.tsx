import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { Payout, Vendor } from "../../types";

/**
 * Read-only — payouts are only ever written by settleVendorPayouts
 * (Cloud Function), so there's nothing for the admin UI to write here.
 */
export default function AdminPayoutsPage() {
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [vendors, setVendors] = useState<Record<string, Vendor>>({});

  useEffect(() => {
    const q = query(collection(db, "payouts"), orderBy("created_at", "desc"), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      setPayouts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Payout));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "vendors"), (snap) => {
      const map: Record<string, Vendor> = {};
      snap.docs.forEach((d) => (map[d.id] = { id: d.id, ...(d.data() as any) } as Vendor));
      setVendors(map);
    });
    return () => unsub();
  }, []);

  const totalAmount = useMemo(() => payouts.reduce((sum, p) => sum + (p.amount || 0), 0), [payouts]);

  return (
    <div className="page">
      <div className="kicker">BunnBaa · 管理後台</div>
      <h1>撥款總覽</h1>

      <div className="card tinted">
        <div className="stat">NT${totalAmount}</div>
        <div className="muted">近 {payouts.length} 筆撥款紀錄加總 · 全額撥款商家，平台不抽成</div>
      </div>

      {payouts.length === 0 ? (
        <p className="faint">尚無撥款紀錄。</p>
      ) : (
        payouts.map((p) => (
          <div key={p.id} className="card">
            <div className="row">
              <div>
                <h2>{vendors[p.vendor_id]?.name ?? p.vendor_id}</h2>
                <div className="muted">{p.lock_count} 筆已履約訂單</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="stat">NT${p.amount}</div>
                <span className="badge">待人工對帳匯出</span>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { Lock, LockStatus, Vendor } from "../../types";

const STATUS_LABELS: Record<LockStatus, string> = {
  locked: "鎖定中",
  for_resale: "轉賣中",
  resold_and_fulfilled: "已轉賣完成取餐",
  fulfilled: "已完成取餐",
  no_show: "未取餐",
};

/**
 * Global cross-vendor view. Follows the same pattern as
 * ConsumerLockPage/VendorRedeemPage: fetch a recent page ordered by
 * created_at and filter vendor/status client-side, rather than adding a
 * new composite index for what's a handful of documents at pilot scale.
 */
export default function AdminLocksPage() {
  const [locks, setLocks] = useState<Lock[]>([]);
  const [vendors, setVendors] = useState<Record<string, Vendor>>({});
  const [statusFilter, setStatusFilter] = useState<LockStatus | "all">("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");
  const [actingId, setActingId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, "locks"), orderBy("created_at", "desc"), limit(300));
    const unsub = onSnapshot(q, (snap) => {
      setLocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock));
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

  const filtered = useMemo(
    () =>
      locks.filter(
        (l) =>
          (statusFilter === "all" || l.status === statusFilter) &&
          (vendorFilter === "all" || l.vendor_id === vendorFilter)
      ),
    [locks, statusFilter, vendorFilter]
  );

  async function overrideStatus(lockId: string, status: LockStatus) {
    let no_show_note: string | undefined;
    if (status === "no_show") {
      no_show_note = window.prompt("未取餐備註（給校準報告分析用，可留空）") ?? undefined;
    }
    setActingId(lockId);
    try {
      const update: Record<string, unknown> = { status };
      if (no_show_note) update.no_show_note = no_show_note;
      await updateDoc(doc(db, "locks", lockId), update);
    } catch (err) {
      alert("操作失敗：" + (err as Error).message);
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="page">
      <div className="kicker">BunnBaa · 管理後台</div>
      <h1>訂單總覽</h1>

      <div className="card">
        <div className="row">
          <div className="field" style={{ marginBottom: 0, flex: 1 }}>
            <label>狀態篩選</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as LockStatus | "all")}>
              <option value="all">全部狀態</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, flex: 1 }}>
            <label>商家篩選</label>
            <select value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)}>
              <option value="all">全部商家</option>
              {Object.values(vendors).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="faint">沒有符合條件的訂單。</p>
      ) : (
        filtered.map((lock) => (
          <div key={lock.id} className="card">
            <div className="row">
              <div>
                <h2>{lock.item_name}</h2>
                <div className="muted">
                  {vendors[lock.vendor_id]?.name ?? lock.vendor_id} · {lock.pickup_window} · NT${lock.locked_price}
                </div>
                <div className="faint">#{lock.id.slice(-8).toUpperCase()}</div>
              </div>
              <span className="badge">{STATUS_LABELS[lock.status]}</span>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              {lock.status !== "fulfilled" && (
                <button
                  className="secondary"
                  disabled={actingId === lock.id}
                  onClick={() => overrideStatus(lock.id, "fulfilled")}
                >
                  標記已完成取餐
                </button>
              )}
              {lock.status !== "resold_and_fulfilled" && (
                <button
                  className="secondary"
                  disabled={actingId === lock.id}
                  onClick={() => overrideStatus(lock.id, "resold_and_fulfilled")}
                >
                  標記轉賣完成取餐
                </button>
              )}
              {lock.status !== "no_show" && (
                <button
                  className="secondary"
                  disabled={actingId === lock.id}
                  onClick={() => overrideStatus(lock.id, "no_show")}
                >
                  標記未取餐
                </button>
              )}
              {lock.status !== "locked" && (
                <button
                  className="secondary"
                  disabled={actingId === lock.id}
                  onClick={() => overrideStatus(lock.id, "locked")}
                >
                  退回鎖定中
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

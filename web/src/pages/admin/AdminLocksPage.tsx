import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import type { Lock, LockStatus, Vendor } from "@/types";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClipboardList } from "lucide-react";

const STATUS_LABELS: Record<LockStatus, string> = {
  locked: "鎖定中",
  for_resale: "轉賣中",
  for_gift: "贈送中",
  resold_and_fulfilled: "已轉賣完成取餐",
  fulfilled: "已完成取餐",
  no_show: "未取餐",
};

/**
 * Real Firestore data (the `/lock` legacy-ui pre-order flow's `locks`
 * collection) — global cross-vendor view. Follows the same pattern as
 * ConsumerLockPage/VendorRedeemPage: fetch a recent page ordered by
 * created_at and filter vendor/status client-side, rather than adding a
 * new composite index for what's a handful of documents at pilot scale.
 */
function LocksContent() {
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

  async function overrideStatus(lock: Lock, status: LockStatus) {
    let no_show_note: string | undefined;
    if (status === "no_show") {
      no_show_note = window.prompt("未取餐備註（給校準報告分析用，可留空）") ?? undefined;
    }
    setActingId(lock.id);
    try {
      const update: Record<string, unknown> = { status };
      if (no_show_note) update.no_show_note = no_show_note;

      // Override + audit record commit together so an override can't exist
      // without its trail (ISO 27001 A.8.15). Log is append-only per firestore.rules.
      const batch = writeBatch(db);
      batch.update(doc(db, "locks", lock.id), update);
      batch.set(doc(collection(db, "admin_audit_logs")), {
        admin_email: auth.currentUser?.email ?? null,
        action: "override_lock_status",
        lock_id: lock.id,
        vendor_id: lock.vendor_id,
        from_status: lock.status,
        to_status: status,
        note: no_show_note ?? null,
        at: serverTimestamp(),
      });
      await batch.commit();
    } catch (err) {
      alert("操作失敗：" + (err as Error).message);
    } finally {
      setActingId(null);
    }
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as LockStatus | "all")}
          className="border border-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">全部狀態</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={vendorFilter}
          onChange={(e) => setVendorFilter(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">全部商家</option>
          {Object.values(vendors).map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>沒有符合條件的訂單</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((lock) => (
            <Card key={lock.id} className="p-4">
              <div className="flex items-start justify-between mb-1">
                <div>
                  <h3 className="font-semibold text-sm">{lock.item_name}</h3>
                  <p className="text-xs text-muted-foreground">
                    {vendors[lock.vendor_id]?.name ?? lock.vendor_id} · {lock.pickup_window} · NT${lock.locked_price}
                  </p>
                  <p className="text-xs text-muted-foreground">#{lock.id.slice(-8).toUpperCase()}</p>
                </div>
                <Badge className="bg-orange-100 text-orange-800 border-0 shrink-0">
                  {STATUS_LABELS[lock.status]}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                {lock.status !== "fulfilled" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actingId === lock.id}
                    onClick={() => overrideStatus(lock, "fulfilled")}>
                    標記已完成取餐
                  </Button>
                )}
                {lock.status !== "resold_and_fulfilled" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actingId === lock.id}
                    onClick={() => overrideStatus(lock, "resold_and_fulfilled")}>
                    標記轉賣完成取餐
                  </Button>
                )}
                {lock.status !== "no_show" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actingId === lock.id}
                    onClick={() => overrideStatus(lock, "no_show")}>
                    標記未取餐
                  </Button>
                )}
                {lock.status !== "locked" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actingId === lock.id}
                    onClick={() => overrideStatus(lock, "locked")}>
                    退回鎖定中
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default function AdminLocksPage() {
  return (
    <AdminLayout>
      <h2 className="text-lg font-bold mb-3">訂單總覽</h2>
      <RequireRealAdmin>
        <LocksContent />
      </RequireRealAdmin>
    </AdminLayout>
  );
}

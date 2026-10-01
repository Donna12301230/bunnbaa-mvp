import { tr } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, writeBatch } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import type { Lock, LockStatus, Vendor } from "@/types";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList } from "lucide-react";
import { toast } from "@/hooks/use-toast";

// 用函式包起來，每次 render 依目前語言組標籤
const statusLabels = (): Record<LockStatus, string> => ({
  locked: tr("鎖定中", "Locked"),
  for_resale: tr("轉賣中", "For resale"),
  for_gift: tr("贈送中", "Being gifted"),
  resold_and_fulfilled: tr("已轉賣完成取餐", "Picked up by new owner"),
  fulfilled: tr("已完成取餐", "Picked up"),
  no_show: tr("未取餐（舊制）", "No-show (legacy)"),
  charity: tr("已轉愛心餐", "Charity meal"),
  cancelling: tr("退款中", "Refunding"),
  cancelled: tr("已取消退款", "Cancelled"),
});

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
      no_show_note = window.prompt(tr("未取餐備註（給校準報告分析用，可留空）", "No-show note (for the calibration report, optional)")) ?? undefined;
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
      toast({ variant: "destructive", title: tr("操作失敗", "Action failed"), description: (err as Error).message });
    } finally {
      setActingId(null);
    }
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as LockStatus | "all")}>
          <SelectTrigger className="sm:w-48" aria-label={tr("篩選狀態", "Filter by status")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr("全部狀態", "All statuses")}</SelectItem>
            {Object.entries(statusLabels()).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={vendorFilter} onValueChange={setVendorFilter}>
          <SelectTrigger className="sm:w-48" aria-label={tr("篩選商家", "Filter by vendor")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr("全部商家", "All vendors")}</SelectItem>
            {Object.values(vendors).map((v) => (
              <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>{tr("沒有符合條件的訂單", "No matching orders")}</p>
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
                  {statusLabels()[lock.status]}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-2 mt-3">
                {lock.status !== "fulfilled" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actingId === lock.id}
                    onClick={() => overrideStatus(lock, "fulfilled")}>
                    {tr("標記已完成取餐", "Mark picked up")}
                  </Button>
                )}
                {lock.status !== "resold_and_fulfilled" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actingId === lock.id}
                    onClick={() => overrideStatus(lock, "resold_and_fulfilled")}>
                    {tr("標記轉賣完成取餐", "Mark picked up by new owner")}
                  </Button>
                )}
                {lock.status !== "no_show" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actingId === lock.id}
                    onClick={() => overrideStatus(lock, "no_show")}>
                    {tr("標記未取餐", "Mark no-show")}
                  </Button>
                )}
                {lock.status !== "locked" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actingId === lock.id}
                    onClick={() => overrideStatus(lock, "locked")}>
                    {tr("退回鎖定中", "Revert to locked")}
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
      <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-3">{tr("訂單總覽", "All orders")}</h1>
      <RequireRealAdmin>
        <LocksContent />
      </RequireRealAdmin>
    </AdminLayout>
  );
}

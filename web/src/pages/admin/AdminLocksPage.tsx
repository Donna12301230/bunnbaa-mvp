import { tr } from "@/lib/i18n";
import { lockStatus } from "@/lib/lockOutcome";
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
import { usePrompt } from "@/components/ConfirmDialog";
import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";

// 狀態文字：全站共用 lib/lockOutcome.ts，管理頁用比較精確的說法（例：未取餐（舊制））
const ALL_STATUSES: LockStatus[] = ["locked", "for_resale", "for_gift", "fulfilled", "resold_and_fulfilled", "no_show", "charity", "cancelling", "cancelled"];
const statusLabels = () => Object.fromEntries(ALL_STATUSES.map((st) => [st, lockStatus(st, true).label])) as Record<LockStatus, string>;

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
  const prompt = usePrompt();

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

  /** 店家未如期出餐（或其他平台確認的狀況）：全額退成平台點數給付款人（functions/src/wallet.js refundLockAsPoints） */
  async function refundAsPoints(lock: Lock) {
    const note = await prompt({
      title: tr(`「${lock.item_name}」全額退成點數？`, `Refund ${lock.item_name} in full as points?`),
      description: tr(`NT$${lock.paid_amount ?? lock.locked_price} 會退成平台點數給付款人，訂單改為已取消、不撥款給店家。確認店家確實沒有出餐再按。`, `NT$${lock.paid_amount ?? lock.locked_price} goes back to the payer as points; the order is cancelled and not paid out to the vendor.`),
      inputLabel: tr("原因（例：店家當天沒開）", "Reason (e.g. the vendor was closed)"),
      confirmLabel: tr("全額退成點數", "Refund as points"),
      destructive: true,
    });
    if (note === null) return;
    setActingId(lock.id);
    try {
      const res = await httpsCallable<{ lock_id: string; note: string }, { refunded_points: number }>(functions, "refundLockAsPoints")({ lock_id: lock.id, note });
      toast({ title: tr(`已退 ${res.data.refunded_points} 點給付款人`, `${res.data.refunded_points} points refunded to the payer`) });
    } catch (err) {
      toast({ variant: "destructive", title: tr("退款失敗", "Refund failed"), description: (err as Error).message });
    } finally {
      setActingId(null);
    }
  }

  async function overrideStatus(lock: Lock, status: LockStatus) {
    let no_show_note: string | undefined;
    if (status === "no_show") {
      const note = await prompt({
        title: tr("標記未取餐", "Mark as no-show"),
        inputLabel: tr("未取餐備註（給校準報告分析用，可留空）", "No-show note (for the calibration report, optional)"),
        confirmLabel: tr("標記未取餐", "Mark no-show"),
      });
      if (note === null) return;
      no_show_note = note.trim() || undefined;
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
          <SelectTrigger className="sm:w-48" aria-label={tr("篩選店家", "Filter by vendor")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{tr("全部店家", "All vendors")}</SelectItem>
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
                <Badge className={`${lockStatus(lock.status, true).className} border-0 shrink-0`}>
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
                    {tr("標記受讓人已取餐", "Mark picked up by new owner")}
                  </Button>
                )}
                {lock.status !== "no_show" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actingId === lock.id}
                    onClick={() => overrideStatus(lock, "no_show")}>
                    {tr("標記未取餐", "Mark no-show")}
                  </Button>
                )}
                {lock.status !== "locked" && lock.status !== "cancelled" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={actingId === lock.id}
                    onClick={() => overrideStatus(lock, "locked")}>
                    {tr("退回已鎖定", "Revert to locked")}
                  </Button>
                )}
                {lock.status !== "cancelled" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs text-danger-text border-danger/40" disabled={actingId === lock.id}
                    onClick={() => refundAsPoints(lock)}>
                    {tr("店家未出餐：全額退點數", "Vendor didn't serve: refund as points")}
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

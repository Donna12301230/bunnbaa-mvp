import { loc, tr } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Payout, Vendor } from "@/types";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/ds";
import PortalPageHeader from "@/components/PortalPageHeader";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";

/**
 * Read-only — payouts are only ever written by settleVendorPayouts
 * (Cloud Function), so there's nothing for the admin UI to write here.
 */
function PayoutsContent() {
  const [payoutList, setPayouts] = useState<Payout[] | null>(null);
  const payouts = useMemo(() => payoutList ?? [], [payoutList]);
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
  // Changed to per-serving commission on 2026-10-05; earlier payout records have no commission_amount (paid out in full back then)
  const totalCommission = useMemo(() => payouts.reduce((sum, p) => sum + (p.commission_amount || 0), 0), [payouts]);

  return (
    <>
      {payoutList === null ? <SkeletonBlocks count={3} height={72} className="space-y-3" /> : <>
      <Card className="p-5 mb-4 bg-accent border-brand/40">
        <div className="text-2xl font-bold text-accent-foreground">NT${totalAmount}</div>
        <p className="text-sm text-muted-foreground mt-1">
          {tr(`近 ${payouts.length} 筆撥款紀錄加總（已扣平台抽成 NT$${totalCommission}）`, `Total of the latest ${payouts.length} payouts (after NT$${totalCommission} platform commission)`)}
        </p>
      </Card>

      {payouts.length === 0 ? (
        <EmptyState icon={<Wallet size={32} />} title={tr("尚無撥款紀錄", "No payouts yet")} description={tr("店家完成取餐核銷後，撥款會出現在這裡。", "Payouts appear here after vendors redeem pickups.")} />
      ) : (
        <div className="space-y-3">
          {payouts.map((p) => (
            <Card key={p.id} className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">{loc(vendors[p.vendor_id], "name") || p.vendor_id}</h3>
                <p className="text-xs text-muted-foreground">{tr(`${p.lock_count} 筆已履約訂單`, `${p.lock_count} fulfilled orders`)}</p>
              </div>
              <div className="text-right">
                <div className="font-bold text-accent-foreground">NT${p.amount}</div>
                <Badge className="bg-muted text-muted-foreground border-0 mt-1">{tr("待人工對帳匯出", "Awaiting manual export")}</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
      </>}
    </>
  );
}

export default function AdminPayoutsPage() {
  return (
    <AdminLayout>
      <PortalPageHeader icon={Wallet} title={tr("撥款總覽", "Payouts")} />
      <RequireRealAdmin>
        <PayoutsContent />
      </RequireRealAdmin>
    </AdminLayout>
  );
}

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

/**
 * Read-only — payouts are only ever written by settleVendorPayouts
 * (Cloud Function), so there's nothing for the admin UI to write here.
 */
function PayoutsContent() {
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
    <>
      <Card className="p-5 mb-4 bg-orange-50 border-orange-100">
        <div className="text-2xl font-bold text-orange-600">NT${totalAmount}</div>
        <p className="text-sm text-muted-foreground mt-1">
          近 {payouts.length} 筆撥款紀錄加總 · 全額撥款商家，平台不抽成
        </p>
      </Card>

      {payouts.length === 0 ? (
        <EmptyState icon={<Wallet size={32} />} title="尚無撥款紀錄" description="商家完成取餐核銷後，撥款會出現在這裡。" />
      ) : (
        <div className="space-y-3">
          {payouts.map((p) => (
            <Card key={p.id} className="p-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">{vendors[p.vendor_id]?.name ?? p.vendor_id}</h3>
                <p className="text-xs text-muted-foreground">{p.lock_count} 筆已履約訂單</p>
              </div>
              <div className="text-right">
                <div className="font-bold text-orange-600">NT${p.amount}</div>
                <Badge className="bg-gray-100 text-gray-600 border-0 mt-1">待人工對帳匯出</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

export default function AdminPayoutsPage() {
  return (
    <AdminLayout>
      <h2 className="text-lg font-bold mb-3">撥款總覽</h2>
      <RequireRealAdmin>
        <PayoutsContent />
      </RequireRealAdmin>
    </AdminLayout>
  );
}

import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { ADMIN_EMAILS } from "@/lib/adminAuth";
import { db } from "@/lib/firebase";
import type { Vendor } from "@/types";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// 認證商家徽章：vendors collection 原本只有 reliability_tone（履約穩定度，系統
// 自動算），沒有「認證商家」欄位——這是平台審核後手動認證的標記，所以放在管理員
// 才能寫的 vendors（firestore.rules 已經是 allow write: if isAdmin()，不用
// 另外改規則），不是商家自己能勾選的。
function VendorVerificationCard() {
  const { toast } = useToast();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "vendors"), (snap) => {
      setVendors(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Vendor));
    });
    return () => unsub();
  }, []);

  async function toggleVerified(vendor: Vendor) {
    setBusyId(vendor.id);
    try {
      await updateDoc(doc(db, "vendors", vendor.id), { verified: !vendor.verified });
    } catch (err) {
      toast({ title: "更新失敗", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-5">
      <h3 className="font-semibold mb-2">認證商家</h3>
      <p className="text-sm text-muted-foreground mb-3">平台審核後手動認證，跟系統自動算的「履約穩定度」是兩件事。</p>
      {vendors.length === 0 ? (
        <p className="text-sm text-muted-foreground">目前沒有商家資料。</p>
      ) : (
        <div className="space-y-2">
          {vendors.map((vendor) => (
            <div key={vendor.id} className="flex items-center justify-between gap-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{vendor.name}</span>
                {vendor.verified && <Badge className="bg-orange-100 text-orange-700 border-0">已認證</Badge>}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === vendor.id}
                onClick={() => toggleVerified(vendor)}
              >
                {vendor.verified ? "取消認證" : "設為認證商家"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SettingsContent() {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold mb-2">目前管理員</h3>
        {ADMIN_EMAILS.map((email) => (
          <p key={email} className="text-sm text-muted-foreground">{email}</p>
        ))}
      </Card>

      <VendorVerificationCard />

      <Card className="p-5">
        <h3 className="font-semibold mb-2">權限管理方式（MVP 過渡做法）</h3>
        <p className="text-sm text-muted-foreground mb-2">
          目前還沒有 Cloud Functions custom claims（卡在 Blaze 升級），管理員名單是寫死在{" "}
          <code className="bg-orange-50 text-orange-700 px-1 rounded">firestore.rules</code> 的{" "}
          <code className="bg-orange-50 text-orange-700 px-1 rounded">isAdmin()</code> 跟{" "}
          <code className="bg-orange-50 text-orange-700 px-1 rounded">web/src/lib/adminAuth.ts</code> 跟{" "}
          <code className="bg-orange-50 text-orange-700 px-1 rounded">functions/src/index.js</code> 的{" "}
          <code className="bg-orange-50 text-orange-700 px-1 rounded">ADMIN_EMAILS</code> 三處。要新增/移除管理員：
        </p>
        <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1 mb-2">
          <li>同時修改這三個檔案裡的 email 清單</li>
          <li>執行 <code className="bg-orange-50 text-orange-700 px-1 rounded">firebase deploy --only firestore:rules,functions</code> 讓權限變更生效（Functions 需 Blaze，未升級前只部署規則）</li>
          <li>重新部署前端（Hosting）讓這頁顯示的清單同步</li>
        </ol>
        <p className="text-xs text-muted-foreground italic">
          之後 Blaze 升級解除、Cloud Functions 能部署後，可以改成 custom claims + 這頁直接增刪管理員，不用再手動改三個檔案重新部署。
        </p>
      </Card>
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <AdminLayout>
      <h2 className="text-lg font-bold mb-3">系統設定</h2>
      <RequireRealAdmin>
        <SettingsContent />
      </RequireRealAdmin>
    </AdminLayout>
  );
}

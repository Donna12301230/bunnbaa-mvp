import { tr } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { ADMIN_EMAILS } from "@/lib/adminAuth";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import type { Vendor } from "@/types";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { EmptyState } from "@/components/ds";
import { Settings, Store } from "lucide-react";
import PortalPageHeader from "@/components/PortalPageHeader";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";

// 認證商家徽章：vendors collection 原本只有 reliability_tone（履約穩定度，系統
// 自動算），沒有「認證商家」欄位——這是平台審核後手動認證的標記，所以放在管理員
// 才能寫的 vendors（firestore.rules 已經是 allow write: if isAdmin()，不用
// 另外改規則），不是商家自己能勾選的。
function VendorVerificationCard() {
  const { toast } = useToast();
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
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
      toast({ title: tr("更新失敗", "Update failed"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-5">
      <h3 className="font-semibold mb-2">{tr("認證店家", "Verified vendors")}</h3>
      <p className="text-sm text-muted-foreground mb-3">{tr("平台審核後手動認證，跟系統自動算的「履約穩定度」是兩件事。", "Set manually after platform review — separate from the automatically calculated reliability.")}</p>
      {vendors === null ? (
        <SkeletonBlocks count={3} height={36} className="space-y-2" />
      ) : vendors.length === 0 ? (
        <EmptyState size="compact" icon={<Store size={32} />} title={tr("目前沒有店家資料", "No vendors yet")} />
      ) : (
        <div className="space-y-2">
          {vendors.map((vendor) => (
            <div key={vendor.id} className="flex items-center justify-between gap-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{vendor.name}</span>
                {vendor.verified && <Badge className="bg-secondary text-accent-foreground border-0">{tr("已認證", "Verified")}</Badge>}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === vendor.id}
                onClick={() => toggleVerified(vendor)}
              >
                {vendor.verified ? tr("取消認證", "Remove verification") : tr("設為認證店家", "Mark as verified")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// 店家、菜單、計畫方案新增或修改時，Functions 會自動用 Gemini 翻成英文（*_en 欄位）；
// 這個功能上線前就存在的資料要按一次補翻，既有訂單的品名也會一起補上英文。
function TranslationBackfillCard() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  async function run() {
    setRunning(true);
    try {
      // 伺服器最多跑 9 分鐘，前端別在預設的 70 秒就放棄
      const fn = httpsCallable(functions, "translateAllContent", { timeout: 540_000 });
      const res = await fn({});
      const c = res.data as { vendors: number; menu_items: number; meal_plans: number; reviews: number; draws: number; locks: number; failed: number };
      toast({
        title: tr("英文翻譯已更新", "English translations updated"),
        description: tr(
          `店家 ${c.vendors}、菜單 ${c.menu_items}、方案 ${c.meal_plans}、評價 ${c.reviews}、抽獎 ${c.draws}、訂單 ${c.locks}${c.failed ? `，失敗 ${c.failed}（可再按一次重試）` : ""}`,
          `Vendors ${c.vendors}, menu items ${c.menu_items}, plans ${c.meal_plans}, reviews ${c.reviews}, draws ${c.draws}, orders ${c.locks}${c.failed ? `, ${c.failed} failed (run again to retry)` : ""}`
        ),
      });
    } catch (err) {
      toast({ title: tr("翻譯失敗", "Translation failed"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }
  return (
    <Card className="p-5">
      <h3 className="font-semibold mb-2">{tr("英文版內容", "English content")}</h3>
      <p className="text-sm text-muted-foreground mb-3">
        {tr(
          "店家、菜單、計畫方案新增或修改時會自動翻成英文。這個功能上線前的既有資料，按一次下面的按鈕補翻（已翻過且內容沒變的會略過）。",
          "Vendors, menu items and meal plans are translated to English automatically when added or edited. Run this once to translate existing data (unchanged, already-translated items are skipped)."
        )}
      </p>
      <Button size="sm" onClick={run} disabled={running}>
        {running ? tr("翻譯中…（可能要幾分鐘）", "Translating… (may take a few minutes)") : tr("補翻既有資料", "Translate existing data")}
      </Button>
    </Card>
  );
}

function SettingsContent() {
  return (
    <div className="space-y-4">
      <TranslationBackfillCard />
      <Card className="p-5">
        <h3 className="font-semibold mb-2">{tr("目前管理員", "Current admins")}</h3>
        {ADMIN_EMAILS.map((email) => (
          <p key={email} className="text-sm text-muted-foreground">{email}</p>
        ))}
      </Card>

      <VendorVerificationCard />

      <Card className="p-5">
        <h3 className="font-semibold mb-2">{tr("權限管理方式（MVP 過渡做法）", "How admin access works (MVP interim)")}</h3>
        <p className="text-sm text-muted-foreground mb-2">
          {tr("管理員名單目前寫死在三處：", "The admin list is currently hard-coded in three places: ")}
          <code className="bg-accent text-accent-foreground px-1 rounded">firestore.rules</code> <code className="bg-accent text-accent-foreground px-1 rounded">isAdmin()</code>,{" "}
          <code className="bg-accent text-accent-foreground px-1 rounded">web/src/lib/adminAuth.ts</code>,{" "}
          <code className="bg-accent text-accent-foreground px-1 rounded">functions/src/index.js</code> <code className="bg-accent text-accent-foreground px-1 rounded">ADMIN_EMAILS</code>.
          {tr("要新增／移除管理員：", " To add or remove an admin:")}
        </p>
        <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1 mb-2">
          <li>{tr("同時修改這三個檔案裡的 email 清單", "Update the email list in all three files")}</li>
          <li>{tr("執行", "Run")} <code className="bg-accent text-accent-foreground px-1 rounded">firebase deploy --only firestore:rules,functions</code> {tr("讓權限變更生效", "to apply the change")}</li>
          <li>{tr("重新部署前端（Hosting）讓這頁顯示的清單同步", "Redeploy the front end (Hosting) so this page shows the new list")}</li>
        </ol>
        <p className="text-xs text-muted-foreground italic">
          {tr("之後可以改成 custom claims，在這頁直接增刪管理員，不用再手動改三個檔案重新部署。", "Later this can move to custom claims so admins are managed here without editing files and redeploying.")}
        </p>
      </Card>
    </div>
  );
}

export default function AdminSettingsPage() {
  return (
    <AdminLayout>
      <PortalPageHeader icon={Settings} title={tr("系統設定", "Settings")} />
      <RequireRealAdmin>
        <SettingsContent />
      </RequireRealAdmin>
    </AdminLayout>
  );
}

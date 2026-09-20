import { ADMIN_EMAILS } from "@/lib/adminAuth";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import { Card } from "@/components/ui/card";

function SettingsContent() {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold mb-2">目前管理員</h3>
        {ADMIN_EMAILS.map((email) => (
          <p key={email} className="text-sm text-muted-foreground">{email}</p>
        ))}
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-2">權限管理方式（MVP 過渡做法）</h3>
        <p className="text-sm text-muted-foreground mb-2">
          目前還沒有 Cloud Functions custom claims（卡在 Blaze 升級），管理員名單是寫死在{" "}
          <code className="bg-orange-50 text-orange-700 px-1 rounded">firestore.rules</code> 的{" "}
          <code className="bg-orange-50 text-orange-700 px-1 rounded">isAdmin()</code> 跟{" "}
          <code className="bg-orange-50 text-orange-700 px-1 rounded">web/src/lib/adminAuth.ts</code> 的{" "}
          <code className="bg-orange-50 text-orange-700 px-1 rounded">ADMIN_EMAILS</code> 兩處。要新增/移除管理員：
        </p>
        <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1 mb-2">
          <li>同時修改這兩個檔案裡的 email 清單</li>
          <li>執行 <code className="bg-orange-50 text-orange-700 px-1 rounded">firebase deploy --only firestore:rules</code> 讓權限變更生效</li>
          <li>重新部署前端（Hosting）讓這頁顯示的清單同步</li>
        </ol>
        <p className="text-xs text-muted-foreground italic">
          之後 Blaze 升級解除、Cloud Functions 能部署後，可以改成 custom claims + 這頁直接增刪管理員，不用再手動改兩個檔案重新部署。
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

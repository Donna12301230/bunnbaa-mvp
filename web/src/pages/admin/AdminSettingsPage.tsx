import { ADMIN_EMAILS } from "../../lib/adminAuth";

export default function AdminSettingsPage() {
  return (
    <div className="page">
      <div className="kicker">BunnBaa · 管理後台</div>
      <h1>系統設定</h1>

      <div className="card">
        <h2>目前管理員</h2>
        {ADMIN_EMAILS.map((email) => (
          <div key={email} className="muted">
            {email}
          </div>
        ))}
      </div>

      <div className="card">
        <h2>權限管理方式（MVP 過渡做法）</h2>
        <p className="muted">
          目前還沒有 Cloud Functions custom claims（卡在 Blaze 升級），管理員名單是寫死在
          <code> firestore.rules</code> 的 <code>isAdmin()</code> 跟 <code>web/src/lib/adminAuth.ts</code> 的{" "}
          <code>ADMIN_EMAILS</code> 兩處。要新增/移除管理員：
        </p>
        <ol className="muted">
          <li>同時修改這兩個檔案裡的 email 清單</li>
          <li>
            執行 <code>firebase deploy --only firestore:rules</code> 讓權限變更生效
          </li>
          <li>重新部署前端（Hosting）讓設定頁顯示的清單同步</li>
        </ol>
        <p className="disclaimer">
          之後 Blaze 升級解除、Cloud Functions 能部署後，可以改成 custom claims + 這頁直接增刪管理員，不用再手動改兩個檔案重新部署。
        </p>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { ExternalLink, LineChart } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import PortalPageHeader from "@/components/PortalPageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { tr } from "@/lib/i18n";

const PROJECT = "bunnbaa-mvp-5474";
const DATASET = "bunnbaa_analytics";
// bigquery/sql/02_dashboard.sql 的 view，第一個由連結自動接上，其餘在 Looker Studio「新增資料」加入
const VIEWS = [
  ["dash_daily_ops", "每日營運"],
  ["dash_forecast_vs_actual", "預測 vs 實際"],
  ["dash_forecast_next", "未來 7 天預估"],
  ["dash_segments", "客群分布"],
] as const;
const EMBED_PREFIX = "https://lookerstudio.google.com/embed/";

/**
 * Looker Studio Linking API：開一份空白報表並接好第一個 BigQuery 資料來源。
 * 沒有範本報表時官方文件只保證「不帶別名」的單一資料來源，所以其餘 view 在報表裡手動加入。
 */
function createReportUrl() {
  const [table, name] = VIEWS[0];
  const p = new URLSearchParams({
    "c.mode": "edit",
    "r.reportName": "BunnBaa 平台儀表板",
    "ds.connector": "bigQuery",
    "ds.type": "TABLE",
    "ds.projectId": PROJECT,
    "ds.datasetId": DATASET,
    "ds.tableId": table,
    "ds.datasourceName": `BunnBaa ${name}`,
  });
  return `https://lookerstudio.google.com/reporting/create?${p}`;
}

/**
 * 平台數據儀表板（doc/GoogleCloud改動建議.md P1）：嵌入 Looker Studio 報表。
 * 嵌入網址存在 platformConfig/analytics.looker_embed_url；報表本身要在 Looker Studio 開「允許嵌入」，
 * 看的人也要有報表的檢視權限（資料用報表擁有者的憑證讀 BigQuery）。
 */
function AnalyticsContent() {
  const { toast } = useToast();
  const [embedUrl, setEmbedUrl] = useState<string | null | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => onSnapshot(doc(db, "platformConfig", "analytics"), (s) => {
    const url = (s.data()?.looker_embed_url as string | undefined) ?? null;
    setEmbedUrl(url);
    setDraft(url ?? "");
  }, () => setEmbedUrl(null)), []);

  async function save() {
    const url = draft.trim();
    if (url && !url.startsWith(EMBED_PREFIX)) {
      toast({ title: tr(`嵌入網址要以 ${EMBED_PREFIX} 開頭`, `The embed URL must start with ${EMBED_PREFIX}`), variant: "destructive" });
      return;
    }
    await setDoc(doc(db, "platformConfig", "analytics"), { looker_embed_url: url || null }, { merge: true });
    setEditing(false);
    toast({ title: tr("已儲存", "Saved") });
  }

  if (embedUrl === undefined) return null;

  const setup = (
    <Card className="border-2">
      <CardContent className="p-4 space-y-3 text-sm">
        <p className="font-semibold">{tr("設定 Looker Studio 報表", "Set up the Looker Studio report")}</p>
        <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
          <li>{tr("按下面的按鈕，Looker Studio 會開一份新報表，已接好「每日營運」（BigQuery）。", "Open a new report with the daily-ops BigQuery view connected.")}</li>
          <li>{tr(`再用「新增資料 → BigQuery → ${PROJECT} → ${DATASET}」加入：${VIEWS.slice(1).map(([t, n]) => `${n}（${t}）`).join("、")}。`, `Then add the other views via Add data → BigQuery: ${VIEWS.slice(1).map(([t]) => t).join(", ")}.`)}</li>
          <li>{tr("排好圖表：每日份數與救回份數（折線）、預測 vs 實際（折線＋區間）、客群分布（長條）。", "Add the charts.")}</li>
          <li>{tr("檔案 → 嵌入報表 → 啟用嵌入，複製「嵌入網址」貼到下面。", "File → Embed report → enable embedding, then paste the embed URL below.")}</li>
        </ol>
        <a href={createReportUrl()} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline">
          {tr("在 Looker Studio 建立報表", "Create the report in Looker Studio")}<ExternalLink className="w-4 h-4" />
        </a>
        <div className="flex gap-2">
          <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`${EMBED_PREFIX}reporting/…`} className="text-sm" />
          <Button onClick={save}>{tr("儲存", "Save")}</Button>
        </div>
      </CardContent>
    </Card>
  );

  if (!embedUrl || editing) return setup;

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button type="button" className="text-sm text-primary underline" onClick={() => setEditing(true)}>{tr("更換報表", "Change report")}</button>
      </div>
      <iframe
        title={tr("平台數據儀表板", "Platform dashboard")}
        src={embedUrl}
        className="w-full rounded-xl border-2 bg-card"
        style={{ height: "max(70vh, 600px)" }}
        sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        allowFullScreen
      />
    </div>
  );
}

export default function AdminAnalyticsPage() {
  return (
    <AdminLayout>
      <PortalPageHeader icon={LineChart} title={tr("數據儀表板", "Analytics dashboard")} />
      <RequireRealAdmin><AnalyticsContent /></RequireRealAdmin>
    </AdminLayout>
  );
}

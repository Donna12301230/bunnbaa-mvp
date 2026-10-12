import { useEffect, useState } from "react";
import { deleteField, doc, setDoc } from "firebase/firestore";
import { AreaChart, ExternalLink } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import PortalPageHeader from "@/components/PortalPageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { queryClient } from "@/lib/queryClient";
import { tr } from "@/lib/i18n";
import { LOOKER_EMBED_PREFIX, analyticsConfigKey, isLookerEmbedUrl, useAnalyticsConfig } from "@/lib/analytics";

const PROJECT = "bunnbaa-mvp-5474";
const DATASET = "bunnbaa_analytics";
// Views from bigquery/sql/02_dashboard.sql; the first is connected automatically by the link, the rest are added via "Add data" in Looker Studio
const VIEWS = [
  ["dash_daily_ops", "每日營運"],
  ["dash_forecast_vs_actual", "預測 vs 實際"],
  ["dash_forecast_next", "未來 7 天預估"],
  ["dash_segments", "客群分布"],
] as const;

/**
 * Looker Studio Linking API: opens a blank report with the first BigQuery data source connected.
 * Without a template report, the official docs only guarantee a single data source "without an alias", so the other views are added manually in the report.
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
 * Platform dashboard: embeds a Looker Studio report (data source is BigQuery bunnbaa_analytics, see doc/GoogleCloud改動建議.md).
 * Once the report is built in Looker Studio, paste the URL from "File → Embed report" here and save; the URL is stored in platformConfig/analytics.
 * Viewing permissions for the report itself are controlled by Looker Studio; this just frames it inside the admin console.
 */
function AnalyticsContent() {
  const { toast } = useToast();
  const { data: config, isLoading } = useAnalyticsConfig();
  // looker_embed_url is the field name used by another version before the merge; reuse it if present, and rewrite it as lookerStudioEmbedUrl on save
  const saved = config?.lookerStudioEmbedUrl || config?.looker_embed_url || "";
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setDraft(saved); }, [saved]);

  const url = draft.trim();
  const valid = url === "" || isLookerEmbedUrl(url);

  async function save() {
    if (!valid) return;
    setBusy(true);
    try {
      await setDoc(doc(db, "platformConfig", "analytics"), { lookerStudioEmbedUrl: url, looker_embed_url: deleteField(), updated_at: new Date() }, { merge: true });
      await queryClient.invalidateQueries({ queryKey: analyticsConfigKey });
      setEditing(false);
      toast({ title: url ? tr("已儲存儀表板網址", "Dashboard link saved") : tr("已移除儀表板", "Dashboard removed") });
    } catch (err) {
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <SkeletonBlocks count={1} height={320} />;

  const form = (
    <div className="max-w-2xl space-y-2">
      <ol className="list-decimal pl-5 space-y-1 text-sm text-muted-foreground">
        <li>
          {tr("按這個連結，Looker Studio 會開一份新報表，已接好「每日營運」（BigQuery）：", "Open a new report with the daily-ops BigQuery view connected: ")}
          <a href={createReportUrl()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline">
            {tr("在 Looker Studio 建立報表", "Create the report in Looker Studio")}<ExternalLink className="w-4 h-4" />
          </a>
        </li>
        <li>{tr(`再用「新增資料 → BigQuery → ${PROJECT} → ${DATASET}」加入：${VIEWS.slice(1).map(([t, n]) => `${n}（${t}）`).join("、")}。`, `Then add the other views via Add data → BigQuery: ${VIEWS.slice(1).map(([t]) => t).join(", ")}.`)}</li>
        <li>{tr("排好圖表：每日份數與救回份數（折線）、預測 vs 實際（折線＋區間）、客群分布（長條）。", "Add the charts: daily and saved meals (line), forecast vs. actual (line + band), segments (bar).")}</li>
        <li>{tr("檔案 → 嵌入報表 → 啟用嵌入，複製「嵌入網址」貼到下面。", "File → Embed report → enable embedding, then paste the embed URL below.")}</li>
      </ol>
      <Label htmlFor="looker-url">{tr("Looker Studio 嵌入網址", "Looker Studio embed URL")}</Label>
      <div className="flex flex-wrap gap-2">
        <Input id="looker-url" className="flex-1 min-w-[16rem]" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`${LOOKER_EMBED_PREFIX}reporting/…`} />
        <Button onClick={save} disabled={busy || !valid || url === saved}>{busy ? tr("儲存中…", "Saving…") : tr("儲存", "Save")}</Button>
        {saved && <Button variant="outline" onClick={() => { setDraft(saved); setEditing(false); }} disabled={busy}>{tr("取消", "Cancel")}</Button>}
      </div>
      {!valid && <p className="text-xs text-danger-text">{tr(`網址要以 ${LOOKER_EMBED_PREFIX} 開頭`, `The URL must start with ${LOOKER_EMBED_PREFIX}`)}</p>}
      <p className="text-xs text-muted-foreground">
        {tr("在 Looker Studio 開啟報表 →「檔案」→「嵌入報表」→ 勾選「啟用嵌入」，複製「嵌入網址」貼到這裡。報表要先分享給會看這一頁的管理員帳號。", "In Looker Studio open the report → File → Embed report → Enable embedding, then paste the embed URL here. Share the report with the admin accounts that will view this page.")}
      </p>
    </div>
  );

  if (!saved) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={<AreaChart size={32} />}
          title={tr("還沒有接上儀表板", "No dashboard connected yet")}
          description={tr("BigQuery 同步與 Looker Studio 報表建好後，把嵌入網址貼在下面，這一頁就會顯示每日訂單量、預測與實際、轉讓救回份數等平台數據。", "Once BigQuery sync and the Looker Studio report are ready, paste the embed URL below to show daily orders, forecast vs. actual, meals saved by transfers and more.")}
        />
        {form}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <a href={saved.replace("/embed/", "/")} target="_blank" rel="noopener noreferrer"><ExternalLink /> {tr("在 Looker Studio 開啟", "Open in Looker Studio")}</a>
        </Button>
        {!editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{tr("更換網址", "Change link")}</Button>}
      </div>
      {editing && form}
      {/* Limit the height of the 4:3 report on wide screens; on mobile it needs at least 480px for the content to be visible */}
      <iframe
        title={tr("平台儀表板", "Platform dashboard")}
        src={saved}
        className="w-full rounded-xl border border-border bg-card"
        style={{ height: "min(78vh, 900px)", minHeight: 480 }}
        loading="lazy"
        allowFullScreen
        sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}

export default function AdminAnalyticsPage() {
  return (
    <AdminLayout>
      <PortalPageHeader icon={AreaChart} title={tr("平台儀表板", "Platform dashboard")} description={tr("BigQuery 的平台數據，以 Looker Studio 呈現", "Platform data from BigQuery, shown with Looker Studio")} />
      <RequireRealAdmin>
        <AnalyticsContent />
      </RequireRealAdmin>
    </AdminLayout>
  );
}

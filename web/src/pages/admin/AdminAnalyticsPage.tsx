import { useEffect, useState } from "react";
import { doc, setDoc } from "firebase/firestore";
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

/**
 * 平台儀表板：嵌入 Looker Studio 報表（資料來源是 BigQuery 的 bunnbaa_analytics，見 doc/GoogleCloud改動建議.md）。
 * 報表在 Looker Studio 建好後，把「檔案 → 嵌入報表」給的網址貼進來存檔即可；網址存在 platformConfig/analytics。
 * 報表本身的觀看權限由 Looker Studio 控制，這裡只是把它框進後台。
 */
function AnalyticsContent() {
  const { toast } = useToast();
  const { data: config, isLoading } = useAnalyticsConfig();
  const saved = config?.lookerStudioEmbedUrl ?? "";
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
      await setDoc(doc(db, "platformConfig", "analytics"), { lookerStudioEmbedUrl: url, updated_at: new Date() }, { merge: true });
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
      {/* 4:3 的報表在寬螢幕上限制高度，手機上至少 480px 才看得到內容 */}
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

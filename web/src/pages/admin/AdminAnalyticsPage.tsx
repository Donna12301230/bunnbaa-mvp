import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { deleteField, doc, setDoc } from "firebase/firestore";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AreaChart, ExternalLink } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import PortalPageHeader from "@/components/PortalPageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { useToast } from "@/hooks/use-toast";
import { httpsCallable } from "@/lib/callable";
import { db, functions } from "@/lib/firebase";
import { queryClient } from "@/lib/queryClient";
import { loc, tr } from "@/lib/i18n";
import { formatNT } from "@/lib/format";
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

/** Rows returned by Functions getPlatformDashboard (one per view in 02_dashboard.sql) */
interface DailyRow { day: string; locks: number; fulfilled: number; rescued_by_resale: number; charity_meals: number; no_show: number; meals_saved: number; revenue: number }
interface BacktestRow { day: string; forecast: number; lower_bound: number; upper_bound: number; actual: number; wape: number | null }
interface NextRow { day: string; forecast: number; lower_bound: number; upper_bound: number }
interface SegmentRow {
  segment_id: number; label: string | null; label_en: string | null; description: string | null; description_en: string | null;
  members: number; frequency: number; avg_price: number; avg_discount: number; resale_rate: number; no_show_rate: number;
}
interface DashboardData { daily: DailyRow[]; backtest: BacktestRow[]; next: NextRow[]; segments: SegmentRow[]; generated_at: string }

const AXIS_TICK = { fontSize: 12, fill: "var(--muted-foreground)" };
const dayLabel = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const lineDot = (color: string) => ({ r: 3, strokeWidth: 2, stroke: "var(--card)", fill: color });

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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {children}
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

function DailyChart({ rows }: { rows: DailyRow[] }) {
  const data = rows.map((r) => ({ ...r, label: dayLabel(r.day) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -6, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} minTickGap={24} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(_, p) => p?.[0]?.payload?.day ?? ""} />
        <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="locks" name={tr("預訂份數", "Meals pre-ordered")} stroke="var(--chart-revenue)" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="meals_saved" name={tr("救回份數", "Meals rescued")} stroke="var(--chart-profit)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function BacktestChart({ rows }: { rows: BacktestRow[] }) {
  const data = rows.map((r) => ({ ...r, label: dayLabel(r.day) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -6, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(_, p) => p?.[0]?.payload?.day ?? ""} />
        <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="actual" name={tr("實際", "Actual")} stroke="var(--chart-cost)" strokeWidth={2} dot={lineDot("var(--chart-cost)")} />
        <Line type="monotone" dataKey="forecast" name={tr("前一天的預測", "Forecast (day before)")} stroke="var(--chart-revenue)" strokeWidth={2} strokeDasharray="5 4" dot={lineDot("var(--chart-revenue)")} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function NextChart({ rows }: { rows: NextRow[] }) {
  // The prediction interval can dip below zero; portions can't
  const data = rows.map((r) => ({ ...r, lower_bound: Math.max(0, r.lower_bound), label: dayLabel(r.day) }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -6, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(_, p) => p?.[0]?.payload?.day ?? ""} />
        <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="upper_bound" name={tr("區間上限", "Upper bound")} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="2 4" dot={false} />
        <Line type="monotone" dataKey="forecast" name={tr("預估份數", "Forecast meals")} stroke="var(--chart-revenue)" strokeWidth={2} dot={lineDot("var(--chart-revenue)")} />
        <Line type="monotone" dataKey="lower_bound" name={tr("區間下限", "Lower bound")} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="2 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function SegmentTable({ rows }: { rows: SegmentRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr className="text-left">
            <th className="py-2 pr-3 font-medium">{tr("客群（Gemini 命名）", "Segment (named by Gemini)")}</th>
            <th className="py-2 px-2 text-right font-medium">{tr("人數", "Members")}</th>
            <th className="py-2 px-2 text-right font-medium">{tr("每人份數", "Meals each")}</th>
            <th className="py-2 px-2 text-right font-medium">{tr("平均單價", "Avg price")}</th>
            <th className="py-2 px-2 text-right font-medium">{tr("轉讓率", "Resale rate")}</th>
            <th className="py-2 pl-2 text-right font-medium">{tr("未取率", "No-show rate")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.segment_id} className="border-t border-border align-top">
              <td className="py-2 pr-3">
                <p className="font-medium text-foreground">{loc(s, "label") || tr(`客群 ${s.segment_id}`, `Segment ${s.segment_id}`)}</p>
                <p className="text-xs text-muted-foreground">{loc(s, "description")}</p>
              </td>
              <td className="py-2 px-2 text-right tabular-nums">{s.members}</td>
              <td className="py-2 px-2 text-right tabular-nums">{s.frequency}</td>
              <td className="py-2 px-2 text-right tabular-nums">{formatNT(s.avg_price)}</td>
              <td className="py-2 px-2 text-right tabular-nums">{pct(s.resale_rate)}</td>
              <td className="py-2 pl-2 text-right tabular-nums">{pct(s.no_show_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Platform dashboard drawn by the site: Functions getPlatformDashboard queries the BigQuery dash_* views */
function PlatformDashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["platformDashboard"],
    queryFn: async () => (await httpsCallable(functions, "getPlatformDashboard")({})).data as DashboardData,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <SkeletonBlocks count={3} height={240} />;
  if (error) return <p className="text-sm text-danger-text">{tr("讀取失敗：", "Couldn't load: ")}{(error as Error).message}</p>;
  if (!data || data.daily.length === 0) {
    return <EmptyState icon={<AreaChart size={32} />} title={tr("BigQuery 還沒有資料", "No BigQuery data yet")} description={tr("Firestore → BigQuery 同步與 bigquery/sql/02_dashboard.sql 建好後，這裡就會顯示平台數據。", "Once the Firestore → BigQuery sync and bigquery/sql/02_dashboard.sql are set up, platform data shows up here.")} />;
  }

  const sum = (k: keyof DailyRow) => data.daily.reduce((s, r) => s + (r[k] as number), 0);
  const locks = sum("locks");
  const saved = sum("meals_saved");
  const actual = data.backtest.reduce((s, r) => s + r.actual, 0);
  const wape = actual > 0 ? data.backtest.reduce((s, r) => s + Math.abs(r.actual - r.forecast), 0) / actual : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={tr("預訂份數", "Meals pre-ordered")} value={locks.toLocaleString()} hint={tr("近 90 天", "Last 90 days")} />
        <Stat label={tr("救回份數", "Meals rescued")} value={saved.toLocaleString()} hint={locks > 0 ? tr(`占 ${pct(saved / locks)}（轉讓＋愛心餐）`, `${pct(saved / locks)} via resale + charity`) : undefined} />
        <Stat label={tr("愛心餐", "Charity meals")} value={sum("charity_meals").toLocaleString()} />
        <Stat label={tr("營收", "Revenue")} value={formatNT(sum("revenue"))} />
      </div>
      <ChartCard title={tr("每日預訂與救回份數", "Daily pre-orders and meals rescued")} note={tr("只算真實訂單（不含模擬的背景需求），取消的不算。", "Real orders only (no simulated background demand); cancellations excluded.")}>
        <DailyChart rows={data.daily} />
      </ChartCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={tr("需求預測 vs 實際", "Demand forecast vs. actual")}
          note={tr(
            `BigQuery AI.FORECAST（TimesFM）前一天產生的全平台預測。${wape != null ? `近 ${data.backtest.length} 天 WAPE ${pct(wape)}。` : ""}實際含模擬的背景需求，和預測的輸入同一個基準。`,
            `Platform-wide forecast made the day before by BigQuery AI.FORECAST (TimesFM).${wape != null ? ` WAPE over the last ${data.backtest.length} days: ${pct(wape)}.` : ""} Actuals include simulated background demand, the same basis the forecast uses.`,
          )}
        >
          {data.backtest.length > 0 ? <BacktestChart rows={data.backtest} /> : <p className="text-sm text-muted-foreground">{tr("還沒有可比對的預測", "No forecasts to compare yet")}</p>}
        </ChartCard>
        <ChartCard title={tr("未來需求預估", "Upcoming demand forecast")} note={tr("最近一次預測的全平台份數與預測區間；只供參考，不是備料指示。", "Latest platform-wide forecast with its prediction interval; for reference only, not a prep instruction.")}>
          {data.next.length > 0 ? <NextChart rows={data.next} /> : <p className="text-sm text-muted-foreground">{tr("還沒有預測", "No forecast yet")}</p>}
        </ChartCard>
      </div>
      <ChartCard title={tr("會員客群", "Customer segments")} note={tr("BigQuery ML k-means 依近 90 天行為分群，群名與描述由 Gemini 產生；商家只看得到群名與人數。", "BigQuery ML k-means on the last 90 days of behavior; names and descriptions written by Gemini. Vendors only see segment names and counts.")}>
        {data.segments.length > 0 ? <SegmentTable rows={data.segments} /> : <p className="text-sm text-muted-foreground">{tr("還沒有分群結果", "No segments yet")}</p>}
      </ChartCard>
    </div>
  );
}

/**
 * The same views also back a Looker Studio report: a link to open it, plus setup for the report link (stored in platformConfig/analytics).
 * Report viewing permissions are controlled by Looker Studio.
 */
function LookerSection() {
  const { toast } = useToast();
  const { data: config, isLoading } = useAnalyticsConfig();
  // looker_embed_url is the field name used by another version before the merge; reuse it if present, and rewrite it as lookerStudioEmbedUrl on save
  const saved = config?.lookerStudioEmbedUrl || config?.looker_embed_url || "";
  const [draft, setDraft] = useState("");
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
      toast({ title: url ? tr("已儲存報表網址", "Report link saved") : tr("已移除報表網址", "Report link removed") });
    } catch (err) {
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return null;

  return (
    <div className="space-y-3">
      {saved && (
        <Button asChild variant="outline" size="sm">
          <a href={saved.replace("/embed/", "/")} target="_blank" rel="noopener noreferrer"><ExternalLink /> {tr("在 Looker Studio 開啟完整報表", "Open the full report in Looker Studio")}</a>
        </Button>
      )}
      <details className="max-w-2xl text-sm">
        <summary className="cursor-pointer text-muted-foreground">{tr("Looker Studio 報表設定", "Looker Studio report settings")}</summary>
        <div className="mt-2 space-y-2">
          <ol className="list-decimal pl-5 space-y-1 text-muted-foreground">
            <li>
              {tr("按這個連結，Looker Studio 會開一份新報表，已接好「每日營運」（BigQuery）：", "Open a new report with the daily-ops BigQuery view connected: ")}
              <a href={createReportUrl()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline">
                {tr("在 Looker Studio 建立報表", "Create the report in Looker Studio")}<ExternalLink className="w-4 h-4" />
              </a>
            </li>
            <li>{tr(`再用「新增資料 → BigQuery → ${PROJECT} → ${DATASET}」加入：${VIEWS.slice(1).map(([t, n]) => `${n}（${t}）`).join("、")}。`, `Then add the other views via Add data → BigQuery: ${VIEWS.slice(1).map(([t]) => t).join(", ")}.`)}</li>
            <li>{tr("檔案 → 嵌入報表 → 啟用嵌入，複製「嵌入網址」貼到下面。", "File → Embed report → enable embedding, then paste the embed URL below.")}</li>
          </ol>
          <Label htmlFor="looker-url">{tr("Looker Studio 嵌入網址", "Looker Studio embed URL")}</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="looker-url" className="flex-1 min-w-[16rem]" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`${LOOKER_EMBED_PREFIX}reporting/…`} />
            <Button onClick={save} disabled={busy || !valid || url === saved}>{busy ? tr("儲存中…", "Saving…") : tr("儲存", "Save")}</Button>
          </div>
          {!valid && <p className="text-xs text-danger-text">{tr(`網址要以 ${LOOKER_EMBED_PREFIX} 開頭`, `The URL must start with ${LOOKER_EMBED_PREFIX}`)}</p>}
        </div>
      </details>
    </div>
  );
}

export default function AdminAnalyticsPage() {
  return (
    <AdminLayout>
      <PortalPageHeader icon={AreaChart} title={tr("平台儀表板", "Platform dashboard")} description={tr("BigQuery 的平台數據：每日營運、需求預測、會員客群", "Platform data from BigQuery: daily operations, demand forecasts, customer segments")} />
      <RequireRealAdmin>
        <div className="space-y-6">
          <PlatformDashboard />
          <LookerSection />
        </div>
      </RequireRealAdmin>
    </AdminLayout>
  );
}

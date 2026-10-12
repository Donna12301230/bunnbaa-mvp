import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp } from "lucide-react";
import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import { tr } from "@/lib/i18n";
import { formatNT, formatPickupDate } from "@/lib/format";
import { EmptyState } from "@/components/ds";
import { useAiDraftsInUse } from "@/components/AiDraftWarning";

interface DayRow {
  date: string;
  revenue: number;
  material_cost: number;
  qty: number;
  /** Labor + fees + platform commission + daily share of fixed costs (older Functions don't return this field) */
  other_cost?: number;
  net_profit?: number;
}

const AXIS_TICK = { fontSize: 12, fill: "var(--muted-foreground)" };
const label = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: DayRow }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const margin = d.revenue - d.material_cost;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm space-y-0.5">
      <p className="font-semibold text-foreground">{formatPickupDate(d.date)}{tr("・", " · ")}{tr(`${d.qty} 份`, `${d.qty} meals`)}</p>
      <p className="flex items-center gap-1.5 text-foreground"><span className="w-2.5 h-0.5 rounded bg-[var(--chart-revenue)]" aria-hidden="true" />{tr("收入", "Revenue")} {formatNT(d.revenue)}</p>
      <p className="flex items-center gap-1.5 text-foreground"><span className="w-2.5 h-0.5 rounded bg-[var(--chart-cost)]" aria-hidden="true" />{tr("材料成本", "Material cost")} {formatNT(d.material_cost)}</p>
      <p className="text-muted-foreground">{tr("毛利", "Gross margin")} {formatNT(margin)}</p>
      {d.net_profit != null && (
        <>
          <p className="text-muted-foreground">{tr("人工、手續費、抽成、固定成本", "Labor, fees, commission, fixed")} {formatNT(d.other_cost ?? 0)}</p>
          <p className="flex items-center gap-1.5 font-semibold text-foreground"><span className="w-2.5 h-0.5 rounded bg-[var(--chart-profit)]" aria-hidden="true" />{tr("淨利", "Net profit")} {formatNT(d.net_profit)}</p>
        </>
      )}
    </div>
  );
}

/**
 * Order report "Daily revenue (last 15 days)" (1002 spec §9.3; per 待修改.docx: switched to a line chart):
 * revenue, material cost and net profit as three lines on one NT$ axis; the gap between revenue and material cost is gross profit. Material cost is recipe × latest unit price;
 * net profit further subtracts labor, fees, platform commission and the daily share of fixed costs, all computed by Functions getDailyRevenueSeries (recipes are trade secrets, so only computed on the backend).
 */
export default function RevenueCostChart({ vendorId }: { vendorId: string | null | undefined }) {
  const aiDrafts = useAiDraftsInUse(vendorId ?? undefined);
  const { data, isLoading, error } = useQuery({
    queryKey: ["dailyRevenueSeries", vendorId],
    queryFn: async () => {
      const res = await httpsCallable(functions, "getDailyRevenueSeries")({ vendor_id: vendorId });
      return (res.data as { days: DayRow[] }).days;
    },
    enabled: !!vendorId,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div className="h-[240px] rounded-xl bg-muted animate-pulse" />;
  if (error) return <p className="text-sm text-danger-text">{tr("讀取失敗：", "Couldn't load: ")}{(error as Error).message}</p>;
  const rows = (data || []).map((d) => ({ ...d, label: label(d.date) }));
  if (rows.every((d) => d.revenue === 0)) {
    return <EmptyState size="compact" icon={<TrendingUp size={32} />} title={tr("這段期間沒有營收紀錄", "No revenue in this period")} />;
  }
  const totalRevenue = rows.reduce((s, d) => s + d.revenue, 0);
  const totalCost = rows.reduce((s, d) => s + d.material_cost, 0);
  const hasNet = rows.some((d) => d.net_profit != null);
  const totalNet = rows.reduce((s, d) => s + (d.net_profit ?? 0), 0);

  return (
    <div className="space-y-3">
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={rows} margin={{ top: 8, right: 12, left: -6, bottom: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={52} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} />
          <Legend verticalAlign="top" align="right" height={28} iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--foreground)" }} />
          <Line type="monotone" dataKey="revenue" name={tr("收入", "Revenue")} stroke="var(--chart-revenue)" strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--chart-revenue)" }} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} />
          {/* Net profit can be negative: NT$0 baseline */}
          {hasNet && <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.5} />}
          <Line type="monotone" dataKey="material_cost" name={tr("材料成本", "Material cost")} stroke="var(--chart-cost)" strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--chart-cost)" }} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} />
          {hasNet && (
            <Line type="monotone" dataKey="net_profit" name={tr("淨利", "Net profit")} stroke="var(--chart-profit)" strokeWidth={2.5}
              dot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--chart-profit)" }} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} />
          )}
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground">
        {tr(`15 天收入 NT$${totalRevenue.toLocaleString()}、材料成本 NT$${totalCost.toLocaleString()}，毛利 NT$${(totalRevenue - totalCost).toLocaleString()}`,
          `15-day revenue NT$${totalRevenue.toLocaleString()}, materials NT$${totalCost.toLocaleString()}, gross margin NT$${(totalRevenue - totalCost).toLocaleString()}`)}
        {hasNet && tr(`，淨利 NT$${totalNet.toLocaleString()}`, `, net profit NT$${totalNet.toLocaleString()}`)}
        {tr("（材料成本依最新單價估算；淨利再扣備料人工、LINE Pay 手續費、平台抽成，以及正職薪資與固定成本按天平均分攤，成本參數在「店家設定」）",
          " (materials at latest unit prices; net profit also deducts prep labor, LINE Pay fees, platform commission, and salaries/fixed costs spread evenly per day — set them in Settings)")}
      </p>
      {aiDrafts.length > 0 && (
        <p className="text-xs text-accent-foreground">
          {tr(`注意：${aiDrafts.length} 道半成品的份量還是 AI 估計（${aiDrafts.slice(0, 3).map((d) => d.component.name).join("、")}${aiDrafts.length > 3 ? "…" : ""}），材料成本與淨利會跟著不準，確認配方後就會更新。`,
            `Note: ${aiDrafts.length} recipe(s) still use AI-estimated portions, so material cost and net profit may be off until you confirm them.`)}
        </p>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">{tr("以表格檢視", "View as table")}</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-muted-foreground"><tr><th className="py-1">{tr("日期", "Date")}</th><th>{tr("份數", "Meals")}</th><th>{tr("收入", "Revenue")}</th><th>{tr("材料成本", "Materials")}</th><th>{tr("毛利", "Margin")}</th>{hasNet && <th>{tr("淨利", "Net")}</th>}</tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.date} className="border-t border-border"><td className="py-1">{d.date}</td><td>{d.qty}</td><td>{d.revenue}</td><td>{d.material_cost}</td><td>{d.revenue - d.material_cost}</td>{hasNet && <td>{d.net_profit ?? ""}</td>}</tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

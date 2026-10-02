import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TrendingUp } from "lucide-react";
import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import { tr } from "@/lib/i18n";
import { EmptyState } from "@/components/ds";

interface DayRow {
  date: string;
  revenue: number;
  material_cost: number;
  qty: number;
}

const AXIS_TICK = { fontSize: 12, fill: "var(--muted-foreground)" };
const label = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: DayRow }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const margin = d.revenue - d.material_cost;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm space-y-0.5">
      <p className="font-semibold text-foreground">{d.date}・{tr(`${d.qty} 份`, `${d.qty} meals`)}</p>
      <p className="flex items-center gap-1.5 text-foreground"><span className="w-2.5 h-0.5 rounded bg-[var(--chart-revenue)]" aria-hidden="true" />{tr("收入", "Revenue")} NT$ {d.revenue.toLocaleString()}</p>
      <p className="flex items-center gap-1.5 text-foreground"><span className="w-2.5 h-0.5 rounded bg-[var(--chart-cost)]" aria-hidden="true" />{tr("材料成本", "Material cost")} NT$ {d.material_cost.toLocaleString()}</p>
      <p className="text-muted-foreground">{tr("毛利", "Gross margin")} NT$ {margin.toLocaleString()}</p>
    </div>
  );
}

/**
 * 訂單統計報表「每日收入（最近 15 天）」（1002 規格 §9.3、待修改：改折線表）：
 * 收入與材料成本兩條線同一個 NT$ 軸，兩線之間就是每日毛利。材料成本依配方×最新單價，由
 * Functions getDailyRevenueSeries 算（配方是營業機密，只在後端算）。
 */
export default function RevenueCostChart({ vendorId }: { vendorId: string | null | undefined }) {
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
  if (error) return <p className="text-sm text-red-600">{tr("讀取失敗：", "Couldn't load: ")}{(error as Error).message}</p>;
  const rows = (data || []).map((d) => ({ ...d, label: label(d.date) }));
  if (rows.every((d) => d.revenue === 0)) {
    return <EmptyState size="compact" icon={<TrendingUp size={32} />} title={tr("這段期間沒有營收紀錄", "No revenue in this period")} />;
  }
  const totalRevenue = rows.reduce((s, d) => s + d.revenue, 0);
  const totalCost = rows.reduce((s, d) => s + d.material_cost, 0);

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
          <Line type="monotone" dataKey="material_cost" name={tr("材料成本", "Material cost")} stroke="var(--chart-cost)" strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--chart-cost)" }} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-xs text-muted-foreground">
        {tr(`15 天收入 NT$ ${totalRevenue.toLocaleString()}、材料成本 NT$ ${totalCost.toLocaleString()}，毛利 NT$ ${(totalRevenue - totalCost).toLocaleString()}（兩線之間即每日毛利；材料成本依最新單價估算）`,
          `15-day revenue NT$ ${totalRevenue.toLocaleString()}, materials NT$ ${totalCost.toLocaleString()}, gross margin NT$ ${(totalRevenue - totalCost).toLocaleString()}`)}
      </p>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">{tr("以表格檢視", "View as table")}</summary>
        <table className="mt-2 w-full text-left">
          <thead className="text-muted-foreground"><tr><th className="py-1">{tr("日期", "Date")}</th><th>{tr("份數", "Meals")}</th><th>{tr("收入", "Revenue")}</th><th>{tr("材料成本", "Materials")}</th><th>{tr("毛利", "Margin")}</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.date} className="border-t border-border"><td className="py-1">{d.date}</td><td>{d.qty}</td><td>{d.revenue}</td><td>{d.material_cost}</td><td>{d.revenue - d.material_cost}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

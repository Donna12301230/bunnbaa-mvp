import { LineChart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import InfoTip from "@/components/InfoTip";
import { useDemandForecast } from "@/lib/analytics";
import { addDaysStr, todayStr, weekdayOf } from "@/lib/pickupSlots";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const round = (n: number) => Math.max(0, Math.round(n));

/**
 * Demand forecast (BigQuery AI.FORECAST, written daily by the backend to vendors/{id}/forecast):
 * the big number is the next day with a forecast, with bars for the next 7 days beside it. Same principle as the "estimated pickup range": for reference only, not a prep instruction.
 * With no forecast data yet, only a one-line note is shown so it doesn't take up space.
 */
export default function ForecastCard({ vendorId }: { vendorId: string | undefined }) {
  const { data: forecast = [], isLoading } = useDemandForecast(vendorId);
  if (isLoading) return null;

  if (forecast.length === 0) {
    return (
      <p className="flex items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        <LineChart className="w-4 h-4 shrink-0" aria-hidden="true" />
        {tr("需求預測還沒有資料。累積幾週訂單後，這裡會每天更新未來 7 天的預估份數。", "No demand forecast yet. After a few weeks of orders, the next 7 days will show here, updated daily.")}
      </p>
    );
  }

  const today = todayStr();
  const tomorrow = addDaysStr(today, 1);
  // The big number prefers tomorrow; today is already past cut-off, and if tomorrow has no forecast (e.g. a closed day) use the nearest day
  const head = forecast.find((f) => f.date === tomorrow) ?? forecast.find((f) => f.date > today) ?? forecast[0];
  const dayName = (date: string) => (date === today ? tr("今天", "Today") : date === tomorrow ? tr("明天", "Tomorrow") : tr(`${date.slice(5).replace("-", "/")}（${WEEKDAYS_ZH[weekdayOf(date)]}）`, `${WEEKDAYS_EN[weekdayOf(date)]} ${date.slice(5).replace("-", "/")}`));
  const max = Math.max(1, ...forecast.map((f) => f.upper ?? f.predicted));
  const hasRange = head.lower != null && head.upper != null && round(head.upper) > round(head.lower);

  return (
    <Card className="border-2">
      <CardContent className="p-4 flex flex-wrap items-end gap-x-8 gap-y-4">
        <div className="min-w-[11rem]">
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <LineChart className="w-4 h-4 text-accent-foreground" aria-hidden="true" />
            {tr(`${dayName(head.date)}預估`, `Forecast for ${dayName(head.date)}`)}
            <InfoTip>{tr("依過去的訂單紀錄，用 BigQuery AI 預測每天會有幾份訂單，每天更新。只是參考，實際備料請以截單後的訂單為準。", "Predicted from past orders with BigQuery AI and refreshed daily. For reference only — prep from the confirmed orders after cutoff.")}</InfoTip>
          </p>
          <p className="font-heading text-4xl font-semibold leading-tight tabular-nums">
            {round(head.predicted)}
            <span className="ml-1 text-base font-normal text-muted-foreground">{tr("份", "meals")}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {hasRange ? tr(`可能落在 ${round(head.lower!)}–${round(head.upper!)} 份・`, `Likely ${round(head.lower!)}–${round(head.upper!)} · `) : ""}
            {tr("僅供參考，不是備料指令", "reference only, not a prep instruction")}
          </p>
        </div>
        <ol className="flex flex-1 items-end gap-2 min-w-[14rem] h-28" aria-label={tr("未來 7 天預估份數", "Forecast for the next 7 days")}>
          {forecast.map((f) => (
            <li key={f.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${dayName(f.date)}：${round(f.predicted)}`}>
              <span className="text-xs font-semibold tabular-nums">{round(f.predicted)}</span>
              <span className={cn("w-full max-w-[2.5rem] rounded-t-md", f.date === head.date ? "bg-primary" : "bg-secondary")} style={{ height: `${Math.max(4, (f.predicted / max) * 70)}%` }} />
              <span className="text-[11px] text-muted-foreground">{f.date === today ? tr("今", "Today") : tr(WEEKDAYS_ZH[weekdayOf(f.date)], WEEKDAYS_EN[weekdayOf(f.date)])}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

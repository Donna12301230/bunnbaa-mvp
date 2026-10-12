import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { CalendarClock } from "lucide-react";
import { db } from "@/lib/firebase";
import { addDaysStr, todayStr } from "@/lib/pickupSlots";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import InfoTip from "@/components/InfoTip";

interface DayForecast {
  day: string; // YYYY-MM-DD
  forecast: number;
  lower: number;
  upper: number;
  model?: string;
}

const WEEKDAYS_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekdayLabel(day: string) {
  const w = new Date(`${day}T00:00:00`).getDay();
  return tr(WEEKDAYS_ZH[w], WEEKDAYS_EN[w]);
}

/**
 * Demand forecast (written daily at 05:00 by functions/src/demandForecast.js using BigQuery AI.FORECAST to vendors/{id}/forecast).
 * For reference only, not a prep instruction; the whole card is hidden when there is no forecast yet (BigQuery not set up or too little data).
 */
export default function DemandForecastCard({ vendorId }: { vendorId: string | undefined }) {
  const [days, setDays] = useState<DayForecast[]>([]);

  useEffect(() => {
    if (!vendorId) return;
    const q = query(collection(db, "vendors", vendorId, "forecast"), where("day", ">=", todayStr()), orderBy("day"), limit(7));
    return onSnapshot(q, (snap) => setDays(snap.docs.map((d) => d.data() as DayForecast)), () => setDays([]));
  }, [vendorId]);

  if (days.length === 0) return null;
  const tomorrow = addDaysStr(todayStr(), 1);
  const head = days.find((d) => d.day === tomorrow) ?? days[0];
  const max = Math.max(...days.map((d) => d.upper || d.forecast), 1);

  return (
    <Card className="border-2">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-accent-foreground" />
          <p className="font-semibold">{tr("未來 7 天預估份數", "Next 7 days forecast")}</p>
          <InfoTip>{tr("依過去 90 天的訂單，用 BigQuery 的時間序列模型（TimesFM）預估，每天早上更新。僅供參考，不是備料建議。", "Estimated from the last 90 days of orders with BigQuery's time-series model (TimesFM), updated every morning. For reference only.")}</InfoTip>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{head.day === tomorrow ? tr("明天", "Tomorrow") : head.day.slice(5)}</p>
          <p className="text-4xl font-bold tabular-nums">{head.forecast}<span className="ml-1 text-base font-normal text-muted-foreground">{tr("份（參考）", "meals (estimate)")}</span></p>
          <p className="text-xs text-muted-foreground">{tr(`大約 ${head.lower}–${head.upper} 份`, `Roughly ${head.lower}–${head.upper}`)}</p>
        </div>
        <div className="grid grid-cols-7 gap-1 items-end h-24" aria-label={tr("每日預估份數", "Daily forecast")}>
          {days.map((d) => (
            <div key={d.day} className="flex flex-col items-center justify-end h-full gap-1">
              <span className="text-[11px] tabular-nums">{d.forecast}</span>
              <div className={cn("w-full max-w-[2rem] rounded-t", d.day === head.day ? "bg-primary" : "bg-brand/50")} style={{ height: `${Math.max(4, (d.forecast / max) * 60)}px` }} />
              <span className="text-[11px] text-muted-foreground">{weekdayLabel(d.day)}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

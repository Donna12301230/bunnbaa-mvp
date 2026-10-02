import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { AlertTriangle, Calculator, RefreshCw, Settings2, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { useToast } from "@/hooks/use-toast";
import { tr } from "@/lib/i18n";
import { MEAL_PERIODS, mealPeriodLabel, todayStr } from "@/lib/pickupSlots";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";
import { myVendorDocKey } from "@/hooks/useMyVendor";
import type { MealPeriod, Vendor } from "@/types";

interface Forecast {
  month: string;
  confirmed_revenue: number;
  forecast_revenue: number;
  revenue: number;
  confirmed_qty: number;
  forecast_qty: number;
  material_cost: number;
  labor_cost: number;
  labor_hours: number;
  hourly_wage: number;
  payment_fee: number;
  payment_fee_rate: number;
  maintenance_fee: number;
  staff_salary: number;
  other_fixed_costs: number;
  net_profit: number;
  owner_hours: number;
  owner_hourly: number | null;
  break_even_qty: number | null;
  by_meal_period: Record<MealPeriod, { revenue: number; qty: number; material_cost: number }>;
  top_needs: { ingredient_id: string; name: string; unit: string; amount: number; cost: number }[];
  item_margins: { menu_item_id: string; name: string; price: number; discounted_price: number; material_cost: number; margin: number; warn: boolean }[];
  minimum_wage: { hourly: number; monthly: number; effectiveFrom: string | null };
  generated_at?: { toMillis?: () => number };
}

const nt = (n: number | null | undefined) => `NT$ ${Math.round(n ?? 0).toLocaleString()}`;

function Row({ label, value, minus, strong }: { label: string; value: number; minus?: boolean; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3 py-1", strong && "font-semibold border-t border-border pt-2 mt-1")}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums">{minus && value > 0 ? "−" : ""}{nt(value)}</dd>
    </div>
  );
}

/**
 * 店家後台首頁第一張卡「本月收益看板」（1002 規格 §9.3）：本月要備多少材料、扣掉人工後能淨賺多少。
 * 數字由 Functions buildRevenueForecast（每天 21:00）／refreshRevenueForecast 算，存 vendors/{id}/revenueForecast/{月}；
 * 預估數字僅供參考，月底以實際數字結算。
 */
export default function RevenueDashboardCard({ vendor }: { vendor: Vendor | null | undefined }) {
  const { toast } = useToast();
  const month = todayStr().slice(0, 7);
  const [data, setData] = useState<Forecast | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<MealPeriod | "all">("all");
  const [costsOpen, setCostsOpen] = useState(false);
  const autoRefreshed = useRef(false);

  useEffect(() => {
    if (!vendor?.id) return;
    const unsub = onSnapshot(
      doc(db, "vendors", vendor.id, "revenueForecast", month),
      (snap) => {
        setData(snap.exists() ? (snap.data() as Forecast) : null);
        setLoaded(true);
      },
      () => setLoaded(true)
    );
    return () => unsub();
  }, [vendor?.id, month]);

  async function refresh() {
    if (!vendor?.id) return;
    setBusy(true);
    try {
      await httpsCallable(functions, "refreshRevenueForecast")({ vendor_id: vendor.id, month });
    } catch (err) {
      toast({ variant: "destructive", title: tr("計算失敗", "Couldn't calculate"), description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  // 本月還沒有資料（新店家、排程還沒跑）就自動算一次
  useEffect(() => {
    if (loaded && !data && vendor?.id && !autoRefreshed.current) {
      autoRefreshed.current = true;
      void refresh();
    }
  }, [loaded, data, vendor?.id]);

  const byPeriod = period !== "all" && data ? data.by_meal_period?.[period] : null;
  const warnItems = (data?.item_margins || []).filter((m) => m.warn);

  return (
    <Card className="mb-8 border-ink">
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 flex-wrap">
        <div>
          <CardTitle className="text-lg flex items-center gap-2"><Wallet className="w-5 h-5 text-primary" /> {tr(`本月收益看板（${Number(month.slice(5))} 月）`, `This month's earnings (${month})`)}</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">{tr("預估數字僅供參考，月底以實際數字結算。", "Estimates are for reference; the month settles on actual numbers.")}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setCostsOpen(true)}><Settings2 /> {tr("成本設定", "Costs")}</Button>
          <Button size="sm" variant="outline" onClick={refresh} disabled={busy}><RefreshCw className={cn(busy && "animate-spin")} /> {tr("重新計算", "Recalculate")}</Button>
        </div>
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="h-40 rounded-xl bg-muted animate-pulse" aria-label={tr("計算中", "Calculating")} />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-accent border border-ink p-4">
                  <p className="text-xs text-muted-foreground">{tr("預估淨利", "Est. net profit")}</p>
                  <p className={cn("font-heading text-4xl font-semibold tabular-nums", data.net_profit < 0 && "text-red-600")}>{nt(data.net_profit)}</p>
                </div>
                <div className="rounded-2xl border border-border p-4">
                  <p className="text-xs text-muted-foreground">{tr("老闆實際時薪", "Your real hourly")}</p>
                  <p className="font-heading text-4xl font-semibold tabular-nums">{data.owner_hourly != null ? nt(data.owner_hourly) : "—"}</p>
                  <p className="text-micro text-muted-foreground">{data.owner_hours > 0 ? tr(`淨利 ÷ 本月 ${data.owner_hours} 小時（老闆時間不列成本）`, `Net ÷ ${data.owner_hours} h`) : tr("到成本設定填每天工時", "Set your daily hours in Costs")}</p>
                </div>
              </div>
              <p className="text-sm rounded-xl bg-secondary px-3 py-2">
                <Calculator className="inline w-4 h-4 mr-1 text-primary" />
                {data.break_even_qty == null
                  ? tr("目前每份沒有正貢獻，請檢查售價與材料成本。", "Each meal doesn't cover its costs yet — check prices and materials.")
                  : data.break_even_qty === 0
                    ? tr("本月已打平固定成本 🎉", "Fixed costs are covered this month 🎉")
                    : tr(`本月還要賣 ${data.break_even_qty} 份才打平固定成本`, `Sell ${data.break_even_qty} more meals to cover fixed costs`)}
              </p>
              <dl className="text-sm">
                <Row label={tr(`本月營收（已確定 ${data.confirmed_qty} 份）`, `Revenue (confirmed, ${data.confirmed_qty})`)} value={data.confirmed_revenue} />
                <Row label={tr(`＋預估（未下單日期 ${data.forecast_qty} 份）`, `+ forecast (${data.forecast_qty})`)} value={data.forecast_revenue} />
                <Row label={tr("預計材料成本", "Materials")} value={data.material_cost} minus />
                <Row label={tr(`備料人工（${data.labor_hours} 小時 × ${data.hourly_wage}）`, `Prep labor (${data.labor_hours} h × ${data.hourly_wage})`)} value={data.labor_cost} minus />
                <Row label={tr(`LINE Pay 手續費（${(data.payment_fee_rate * 100).toFixed(2)}%）`, `LINE Pay fee (${(data.payment_fee_rate * 100).toFixed(2)}%)`)} value={data.payment_fee} minus />
                <Row label={data.maintenance_fee === 0 ? tr("平台維護費（首月免費）", "Platform fee (first month free)") : tr("平台維護費（含稅）", "Platform fee (incl. tax)")} value={data.maintenance_fee} minus />
                {data.staff_salary > 0 && <Row label={tr("員工固定薪資", "Staff salaries")} value={data.staff_salary} minus />}
                {data.other_fixed_costs > 0 && <Row label={tr("其他固定成本", "Other fixed costs")} value={data.other_fixed_costs} minus />}
                <Row label={tr("預估淨利", "Est. net profit")} value={data.net_profit} strong />
              </dl>
              <p className="text-micro text-muted-foreground">{tr("回饋池不另扣：折價券已反映在實付金額。", "Reward pool isn't deducted separately — coupons are already in the paid amounts.")}</p>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex gap-1.5 mb-2" role="tablist" aria-label={tr("依餐期", "By meal")}>
                  {(["all", ...MEAL_PERIODS] as const).map((p) => (
                    <button key={p} type="button" role="tab" aria-selected={period === p} onClick={() => setPeriod(p)}
                      className={cn("text-xs font-semibold px-3 py-1 rounded-full border", period === p ? "bg-ink text-[var(--text-on-inverse)] border-ink" : "border-border")}>
                      {p === "all" ? tr("全部", "All") : mealPeriodLabel(p)}
                    </button>
                  ))}
                </div>
                {byPeriod ? (
                  <p className="text-sm">{tr(`${mealPeriodLabel(period as MealPeriod)}：已確定 ${byPeriod.qty} 份、營收 ${nt(byPeriod.revenue)}、材料 ${nt(byPeriod.material_cost)}`, `${byPeriod.qty} meals, revenue ${nt(byPeriod.revenue)}, materials ${nt(byPeriod.material_cost)}`)}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">{tr("切換早／中／晚看各餐期的已確定營收與材料。", "Switch meals to see each one's confirmed revenue and materials.")}</p>
                )}
              </div>
              <div>
                <p className="text-sm font-semibold mb-1">{tr("本月預計備料（前 10 項）", "This month's prep (top 10)")}</p>
                <ul className="text-sm divide-y divide-border">
                  {data.top_needs.length === 0 && <li className="py-1 text-muted-foreground">{tr("還沒有配方資料", "No recipe data yet")}</li>}
                  {data.top_needs.map((n) => (
                    <li key={n.ingredient_id} className="flex justify-between py-1"><span>{n.name}</span><span className="text-muted-foreground tabular-nums">{n.amount.toLocaleString()} {n.unit}・{nt(n.cost)}</span></li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-sm font-semibold mb-1">{tr("每份毛利（8 折後售價 − 材料成本）", "Margin per meal (20% off price − materials)")}</p>
                {warnItems.length > 0 && (
                  <p className="text-xs text-red-600 flex gap-1 mb-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{tr(`${warnItems.length} 項毛利低於材料成本 30%`, `${warnItems.length} item(s) earn less than 30% of material cost`)}</p>
                )}
                <ul className="text-sm divide-y divide-border max-h-48 overflow-y-auto bb-thin-scroll">
                  {data.item_margins.map((m) => (
                    <li key={`${m.menu_item_id}-${m.name}`} className={cn("flex justify-between gap-2 py-1", m.warn && "text-red-600 font-semibold")}>
                      <span className="truncate">{m.name}</span>
                      <span className="tabular-nums shrink-0">${m.discounted_price} − ${m.material_cost} = ${m.margin}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
      </CardContent>
      <CostSettingsDialog open={costsOpen} onClose={() => setCostsOpen(false)} vendor={vendor} minimumWage={data?.minimum_wage} onSaved={refresh} />
    </Card>
  );
}

function CostSettingsDialog({ open, onClose, vendor, minimumWage, onSaved }: {
  open: boolean;
  onClose: () => void;
  vendor: Vendor | null | undefined;
  minimumWage?: { hourly: number; monthly: number; effectiveFrom: string | null };
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [hourly, setHourly] = useState("");
  const [salaries, setSalaries] = useState("");
  const [fixed, setFixed] = useState("");
  const [ownerHours, setOwnerHours] = useState("");
  const [feeRate, setFeeRate] = useState("");
  const [busy, setBusy] = useState(false);
  const minHourly = minimumWage?.hourly ?? 196;
  const minMonthly = minimumWage?.monthly ?? 29500;

  useEffect(() => {
    if (!open) return;
    setHourly(String(vendor?.hourly_wage ?? minHourly));
    setSalaries((vendor?.staff_salaries ?? []).join(", "));
    setFixed(String(vendor?.fixed_costs ?? ""));
    setOwnerHours(String(vendor?.owner_hours_per_day ?? ""));
    setFeeRate(vendor?.linepay_fee_rate != null ? String(Math.round(vendor.linepay_fee_rate * 10000) / 100) : "2.75");
  }, [open]);

  const salaryList = salaries.split(/[,，\s]+/).map((s) => Number(s)).filter((n) => n > 0);
  const hourlyLow = Number(hourly) < minHourly;
  const salaryLow = salaryList.some((s) => s < minMonthly);

  async function save() {
    if (!vendor?.id) return;
    setBusy(true);
    try {
      await httpsCallable(functions, "updateVendorCosts")({
        vendor_id: vendor.id,
        hourly_wage: Number(hourly),
        staff_salaries: salaryList,
        fixed_costs: fixed === "" ? 0 : Number(fixed),
        owner_hours_per_day: ownerHours === "" ? 0 : Number(ownerHours),
        linepay_fee_rate: Number(feeRate) / 100,
      });
      toast({ title: tr("已儲存成本設定", "Costs saved") });
      queryClient.invalidateQueries({ queryKey: myVendorDocKey(vendor.id) });
      onClose();
      onSaved();
    } catch (err) {
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("成本設定", "Cost settings")}</DialogTitle>
          <DialogDescription>
            {tr(`基本工資由平台自動更新（目前時薪 ${minHourly}、月薪 ${minMonthly}${minimumWage?.effectiveFrom ? `，${minimumWage.effectiveFrom} 生效` : ""}），只能調高，調漲時會自動上調並通知。`,
              `Minimum wage is updated automatically (now ${minHourly}/h, ${minMonthly}/month). You can only set higher.`)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">
            {tr("備料人工時薪（元）", "Prep labor hourly wage")}
            <Input type="number" min={minHourly} value={hourly} onChange={(e) => setHourly(e.target.value)} />
            {hourlyLow && <span className="text-xs text-red-600">{tr(`不得低於基本工資 ${minHourly} 元`, `Must be at least ${minHourly}`)}</span>}
          </label>
          <label className="block text-sm">
            {tr("正職員工月薪（選填，多位用逗號分開）", "Staff monthly salaries (optional, comma-separated)")}
            <Input value={salaries} onChange={(e) => setSalaries(e.target.value)} placeholder="30000, 32000" />
            {salaryLow && <span className="text-xs text-red-600">{tr(`每位都不得低於基本工資月薪 ${minMonthly} 元`, `Each must be at least ${minMonthly}`)}</span>}
          </label>
          <label className="block text-sm">
            {tr("其他固定成本／月（房租、水電，選填）", "Other fixed costs / month (optional)")}
            <Input type="number" min={0} value={fixed} onChange={(e) => setFixed(e.target.value)} />
          </label>
          <label className="block text-sm">
            {tr("老闆每天工時（算老闆實際時薪）", "Your hours per day")}
            <Input type="number" min={0} max={24} value={ownerHours} onChange={(e) => setOwnerHours(e.target.value)} />
          </label>
          <label className="block text-sm">
            {tr("LINE Pay 合約費率（%）", "LINE Pay fee rate (%)")}
            <Input type="number" min={0} max={10} step="0.01" value={feeRate} onChange={(e) => setFeeRate(e.target.value)} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{tr("取消", "Cancel")}</Button>
          <Button onClick={save} disabled={busy || hourlyLow || salaryLow}>{busy ? tr("儲存中…", "Saving…") : tr("儲存", "Save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

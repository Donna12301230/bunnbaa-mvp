import { useState } from "react";
import { CheckCircle2, Clock, Gift, HeartHandshake, Minus, Plus, ScanLine } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ds";
import InfoTip from "@/components/InfoTip";
import { useToast } from "@/hooks/use-toast";
import { functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { todayStr } from "@/lib/pickupSlots";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CharityMeal } from "@/types";

export const CHARITY_STATUS: Record<string, { zh: string; en: string; dot: string; tile: string }> = {
  available: { zh: "等人領", en: "Open", dot: "bg-pink-400", tile: "border-pink-300 bg-pink-50" },
  reserved: { zh: "有人預約", en: "Reserved", dot: "bg-amber-400", tile: "border-amber-300 bg-amber-50" },
  claimed: { zh: "預約已領", en: "Claimed", dot: "bg-green-500", tile: "border-green-300 bg-green-50 opacity-70" },
  given: { zh: "現場送出", en: "Given", dot: "bg-green-500", tile: "border-green-300 bg-green-50 opacity-70" },
  wasted: { zh: "報廢", en: "Wasted", dot: "bg-stone-400", tile: "border-stone-300 bg-stone-100 opacity-60" },
};
const millis = (ts: unknown) => (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

/**
 * 愛心餐（規格 §7）：取餐時段結束 30 分後未取餐的便當自動轉入，也包含消費者主動捐出的。
 * 預約者到場出示 QR，在「取餐」分頁掃；未預約的現場先到先領（點卡片「送出」）。
 * 截止（時段結束後 2 小時）後用 − ＋ 填現場送出份數，其餘記為報廢；報廢數用於修正下週預測。
 * 店家看不到預約者的個人資料。
 */
export default function CharityPanel({ meals, result, onGoScan }: {
  meals: CharityMeal[];
  result: { total: number; given_onsite: number; wasted: number; reserved_claimed: number } | null;
  onGoScan: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const counts: Record<string, number> = {};
  meals.forEach((m) => (counts[m.status] = (counts[m.status] ?? 0) + 1));
  const [given, setGiven] = useState<number | null>(null);
  const givenValue = given ?? counts.given ?? 0;
  const deadline = meals[0] ? millis(meals[0].deadline) : 0;
  const closed = deadline > 0 && Date.now() > deadline;
  const minsLeft = deadline > 0 ? Math.max(0, Math.round((deadline - Date.now()) / 60000)) : null;

  async function giveOnsite(id: string) {
    setBusy(id);
    try {
      await httpsCallable(functions, "giveCharityOnsite")({ meal_id: id });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    setBusy("submit");
    try {
      const res = await httpsCallable(functions, "submitCharityResult")({ date: todayStr(), given: givenValue });
      toast({ title: tr(`已記錄，報廢 ${(res.data as { wasted: number }).wasted} 份`, `Saved — ${(res.data as { wasted: number }).wasted} wasted`) });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (meals.length === 0) {
    return <EmptyState icon={<HeartHandshake size={32} />} title={tr("今天沒有愛心餐", "No charity meals today")} description={tr("取餐時段結束 30 分鐘後，沒人來拿的便當會出現在這裡。", "Unclaimed meals appear here 30 minutes after pickup ends.")} />;
  }

  const order = ["available", "reserved", "claimed", "given", "wasted"];
  const sorted = [...meals].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <HeartHandshake className="w-4 h-4 text-pink-500" />
        {tr("沒人來拿的便當，今天送給需要的人", "Unclaimed meals, given away today")}
        <InfoTip>{tr("未取餐不退款，照常計入營業額。預約的人到場出示 QR，在「取餐」分頁掃；沒預約的先到先領，每人一份由店家判斷。看不到預約者個資。", "No-shows still count as revenue. Reserved pickups are scanned in the Pickup tab; walk-ins are first come, first served.")}</InfoTip>
        {minsLeft !== null && <span className={cn("ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 font-semibold", closed ? "bg-stone-200 text-stone-700" : "bg-pink-100 text-pink-800")}><Clock className="w-4 h-4" />{closed ? tr("已截止", "Closed") : tr(`還有 ${minsLeft} 分鐘截止`, `${minsLeft} min left`)}</span>}
      </div>

      {/* 去向色條 */}
      <Card className="border-2">
        <CardContent className="p-4 space-y-2">
          <div className="flex h-7 overflow-hidden rounded-lg" role="img" aria-label={order.map((k) => `${tr(CHARITY_STATUS[k].zh, CHARITY_STATUS[k].en)} ${counts[k] ?? 0}`).join("，")}>
            {order.filter((k) => counts[k]).map((k) => (
              <div key={k} className={cn("h-full flex items-center justify-center text-xs font-bold text-white", CHARITY_STATUS[k].dot)} style={{ width: `${(counts[k] / meals.length) * 100}%` }}>{counts[k]}</div>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {order.map((k) => <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("w-3 h-3 rounded-sm", CHARITY_STATUS[k].dot)} />{tr(CHARITY_STATUS[k].zh, CHARITY_STATUS[k].en)} <b>{counts[k] ?? 0}</b></span>)}
          </div>
          {(counts.reserved ?? 0) > 0 && <Button size="sm" variant="outline" onClick={onGoScan}><ScanLine /> {tr(`有 ${counts.reserved} 份預約，去掃 QR`, `${counts.reserved} reserved — scan QR`)}</Button>}
        </CardContent>
      </Card>

      {/* 每份一張卡：等人領的點「送出」 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {sorted.map((m) => {
          const s = CHARITY_STATUS[m.status];
          const canGive = m.status === "available" && !closed;
          return (
            <div key={m.id} className={cn("rounded-xl border-2 p-3 flex flex-col gap-1", s?.tile)}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xl font-extrabold tracking-widest">{m.pickup_code ?? "—"}</span>
                <span className="text-[11px] text-muted-foreground">{m.source === "donated" ? tr("客人捐的", "donated") : tr("沒來拿", "no-show")}</span>
              </div>
              <p className="text-sm font-semibold leading-tight line-clamp-1">{m.item_name}</p>
              <p className="text-xs text-muted-foreground line-clamp-1">{m.sides.join("・")}</p>
              {canGive ? (
                <Button size="sm" className="mt-1" disabled={busy === m.id} onClick={() => giveOnsite(m.id)}><Gift /> {tr("現場送出", "Give")}</Button>
              ) : (
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold">{(m.status === "claimed" || m.status === "given") && <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />}{tr(s?.zh ?? m.status, s?.en ?? m.status)}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* 截止後結算 */}
      <Card className={cn("border-2", closed && !result && "border-pink-300")}>
        <CardContent className="p-4 space-y-3">
          <p className="font-semibold">{tr("收攤：今天現場一共送出幾份？", "Closing: how many did you give on site?")}</p>
          {result ? (
            <div className="grid grid-cols-3 gap-2 text-center">
              {[[tr("預約領走", "Reserved"), result.reserved_claimed, "bg-green-50"], [tr("現場送出", "Given"), result.given_onsite, "bg-green-50"], [tr("報廢", "Wasted"), result.wasted, "bg-stone-100"]].map(([l, n, c]) => (
                <div key={String(l)} className={cn("rounded-xl p-3", String(c))}><p className="text-2xl font-bold">{n}</p><p className="text-xs text-muted-foreground">{l}</p></div>
              ))}
              <p className="col-span-3 text-xs text-muted-foreground">{tr("報廢數會用來修正下週預測。", "Waste is used to correct next week's forecast.")}</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center rounded-full border-2 border-border bg-card">
                  <button type="button" className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-accent disabled:opacity-40" onClick={() => setGiven(Math.max(0, givenValue - 1))} disabled={givenValue <= 0} aria-label={tr("少一份", "One less")}><Minus className="w-4 h-4" /></button>
                  <span className="w-12 text-center text-2xl font-bold" aria-live="polite">{givenValue}</span>
                  <button type="button" className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-accent" onClick={() => setGiven(givenValue + 1)} aria-label={tr("多一份", "One more")}><Plus className="w-4 h-4" /></button>
                </span>
                <span className="text-sm text-muted-foreground">{tr(`其餘 ${Math.max(0, meals.length - (counts.claimed ?? 0) - givenValue)} 份記為報廢`, `${Math.max(0, meals.length - (counts.claimed ?? 0) - givenValue)} recorded as waste`)}</span>
                <Button className="ml-auto" onClick={submit} disabled={!closed || busy === "submit"}>{tr("記下來", "Save")}</Button>
              </div>
              {!closed && <p className="text-xs text-muted-foreground">{tr(`截止（${deadline ? new Date(deadline).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : "—"}）後才能記。已經按過「現場送出」的會自動算進來。`, "Available after closing. Meals marked Given are counted.")}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { HeartHandshake } from "lucide-react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ds";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { todayStr } from "@/lib/pickupSlots";
import { tr } from "@/lib/i18n";
import type { CharityMeal } from "@/types";

const STATUS: Record<string, { zh: string; en: string; cls: string }> = {
  available: { zh: "開放中", en: "Open", cls: "bg-pink-100 text-pink-700" },
  reserved: { zh: "已預約", en: "Reserved", cls: "bg-amber-100 text-amber-800" },
  claimed: { zh: "預約已領取", en: "Claimed", cls: "bg-green-100 text-green-700" },
  given: { zh: "現場送出", en: "Given on site", cls: "bg-green-100 text-green-700" },
  wasted: { zh: "報廢", en: "Wasted", cls: "bg-gray-100 text-gray-600" },
};
const millis = (ts: unknown) => (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

/**
 * 店家端愛心餐（規格 §7）：取餐時段結束 30 分後未取餐的便當自動轉入，也包含消費者主動捐出的。
 * 預約者到場出示 QR，在「取餐掃碼」掃描；未預約的現場先到先領（按「現場送出」）。
 * 截止（時段結束後 2 小時）後輸入現場送出份數，其餘記為報廢；報廢數用於修正下週預測。
 * 店家看不到預約者的個人資料。
 */
export default function VendorPortalCharity() {
  const vendorId = useAuth().user?.vendorId;
  const { toast } = useToast();
  const today = todayStr();
  const [meals, setMeals] = useState<CharityMeal[]>([]);
  const [result, setResult] = useState<{ total: number; given_onsite: number; wasted: number; reserved_claimed: number } | null>(null);
  const [given, setGiven] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!vendorId) return;
    const u1 = onSnapshot(query(collection(db, "charityMeals"), where("vendor_id", "==", vendorId), where("date", "==", today)), (s) => setMeals(s.docs.map((d) => ({ id: d.id, ...d.data() }) as CharityMeal)));
    const u2 = onSnapshot(doc(db, "vendors", vendorId, "prepPlans", today), (s) => setResult(s.exists() ? s.data().charity_result ?? null : null), () => setResult(null));
    return () => {
      u1();
      u2();
    };
  }, [vendorId, today]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    meals.forEach((m) => (c[m.status] = (c[m.status] ?? 0) + 1));
    return c;
  }, [meals]);
  const deadline = meals[0] ? millis(meals[0].deadline) : 0;
  const closed = deadline > 0 && Date.now() > deadline;

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
      const res = await httpsCallable(functions, "submitCharityResult")({ date: today, given: Number(given) });
      const r = res.data as { wasted: number };
      toast({ title: tr(`已記錄，報廢 ${r.wasted} 份`, `Saved — ${r.wasted} wasted`) });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-1 flex items-center gap-2"><HeartHandshake className="w-5 h-5 text-pink-500" /> {tr("愛心餐", "Charity meals")}</h2>
      <p className="text-sm text-muted-foreground mb-4">{tr("未取餐不退款但照常計入營業額；轉為愛心餐後當天現場領取。預約者請到「取餐掃碼」掃 QR；未預約的份數先到先領，每人一份由店家判斷。", "No-shows still count as revenue. Reserved pickups are scanned in Pickup scan; walk-ins are first come, first served.")}</p>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        {Object.entries(STATUS).map(([k, v]) => (
          <Card key={k}><CardContent className="p-3 text-center"><p className="text-xs text-muted-foreground">{tr(v.zh, v.en)}</p><p className="text-xl font-bold">{counts[k] ?? 0}</p></CardContent></Card>
        ))}
      </div>

      {meals.length === 0 ? (
        <EmptyState icon={<HeartHandshake size={32} />} title={tr("今天沒有愛心餐", "No charity meals today")} description={tr("取餐時段結束 30 分鐘後，未取餐的便當會出現在這裡。", "Unclaimed meals appear here 30 minutes after pickup ends.")} />
      ) : (
        <div className="grid md:grid-cols-2 gap-2 mb-6">
          {meals.map((m) => (
            <div key={m.id} className="border rounded-lg p-3 bg-white flex items-center gap-3">
              <span className="font-mono text-lg font-bold w-14">{m.pickup_code}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{m.item_name}</p>
                <p className="text-xs text-muted-foreground truncate">{m.sides.join("・")}・{m.source === "donated" ? tr("主動捐出", "donated") : tr("未取餐", "no-show")}</p>
              </div>
              <Badge variant="muted" className={STATUS[m.status]?.cls}>{tr(STATUS[m.status]?.zh ?? m.status, STATUS[m.status]?.en ?? m.status)}</Badge>
              {m.status === "available" && !closed && (
                <Button size="sm" variant="outline" disabled={busy === m.id} onClick={() => giveOnsite(m.id)}>{tr("現場送出", "Give")}</Button>
              )}
            </div>
          ))}
        </div>
      )}

      {meals.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{tr("截止後：輸入現場送出份數", "After closing: enter meals given on site")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {result ? (
              <p className="text-sm">{tr(`已記錄：共 ${result.total} 份，預約領取 ${result.reserved_claimed}、現場送出 ${result.given_onsite}、報廢 ${result.wasted}。報廢數會用來修正下週預測。`, `Recorded: ${result.total} total, ${result.reserved_claimed} reserved, ${result.given_onsite} given, ${result.wasted} wasted.`)}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{closed ? tr("愛心餐已截止，請輸入現場總共送出幾份（含上面按過「現場送出」的），其餘記為報廢。", "Closed — enter the total given on site; the rest is recorded as waste.") : tr(`截止時間 ${deadline ? new Date(deadline).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : "—"}，截止後再填。`, "Fill this in after closing.")}</p>
            )}
            <div className="flex gap-2">
              <Input className="w-28" type="number" min={0} value={given} onChange={(e) => setGiven(e.target.value)} placeholder={String(counts.given ?? 0)} />
              <Button onClick={submit} disabled={busy === "submit" || given === ""}>{tr("送出", "Submit")}</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </VendorPortalLayout>
  );
}

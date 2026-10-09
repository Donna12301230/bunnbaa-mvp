import { useEffect, useState } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, setDoc, updateDoc } from "firebase/firestore";
import { CloudLightning, ShieldAlert, RefreshCw } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { tr } from "@/lib/i18n";

interface DisasterEvent { id: string; type: string; counties?: string[]; towns?: string[]; dates?: string[]; source: string; summary?: string; processed?: boolean; result?: { vendors: number; cancelled: number; failed: number; notified: number } }
interface Anomaly { id: string; type: string; user_id: string; vendor_id: string | null; detail: string; date: string; status: string }

const TYPE_LABEL: Record<string, string> = { work_suspension: "停班停課", typhoon_warning: "颱風警報", price_spike: "菜價暴漲" };
const ANOMALY_LABEL: Record<string, string> = { refunds: "7 天內取消 ≥ 3 筆", ticket_share: "單一使用者抽獎券占比 > 20%", device: "同一裝置 > 2 帳號領券" };

/** 天災事件（§11）：自動抓 NCDR（彙整氣象署、人事總處）；資料來源失效時管理者手動建立。 */
function DisasterContent() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [events, setEvents] = useState<DisasterEvent[]>([]);
  const [form, setForm] = useState({ type: "work_suspension", counties: "", dates: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => onSnapshot(query(collection(db, "disasterEvents"), orderBy("created_at", "desc"), limit(50)), (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...d.data() }) as DisasterEvent))), []);

  async function create() {
    const counties = form.counties.split(/[,，、\s]+/).map((x) => x.trim().replace(/台/g, "臺")).filter(Boolean);
    const dates = form.dates.split(/[,，、\s]+/).map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
    if (dates.length === 0) return toast({ variant: "destructive", title: tr("請輸入日期 YYYY-MM-DD", "Enter dates as YYYY-MM-DD") });
    const label = TYPE_LABEL[form.type];
    if (form.type === "work_suspension" && !(await confirm({ title: `建立停班停課事件？`, description: `${counties.join("、") || "全部縣市"} ${dates.join("、")} 的訂單會自動取消並全額退款，無法復原。`, confirmLabel: "建立並退款", destructive: true }))) return;
    const id = `manual_${Date.now()}`;
    await setDoc(doc(db, "disasterEvents", id), {
      type: form.type, counties, whole_counties: counties, towns: [], dates, source: "manual", summary: `${label}（管理員手動建立）`, processed: false, created_at: new Date(),
    });
    toast({ title: tr("已建立，後端處理中", "Created — processing") });
  }

  async function call(name: string, data: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await httpsCallable(functions, name)(data);
      toast({ title: tr("完成", "Done"), description: JSON.stringify(res.data) });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{tr("手動建立天災事件（資料來源失效時的備援）", "Create an event manually")}</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 items-end">
          <select className="h-10 rounded-md border px-2 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <Input className="w-48" placeholder={tr("縣市（空白＝全部）", "Counties (blank = all)")} value={form.counties} onChange={(e) => setForm({ ...form, counties: e.target.value })} />
          <Input className="w-56" placeholder="2026-10-01, 2026-10-02" value={form.dates} onChange={(e) => setForm({ ...form, dates: e.target.value })} />
          <Button onClick={create}>{tr("建立", "Create")}</Button>
          <Button variant="outline" onClick={() => call("triggerDisasterPollNow", {})} disabled={busy}><RefreshCw /> {tr("立即抓取 NCDR", "Poll NCDR now")}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{tr("事件紀錄", "Events")}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {events.length === 0 && <p className="text-muted-foreground">{tr("目前沒有事件。", "No events.")}</p>}
          {events.map((e) => (
            <div key={e.id} className="border-b pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="muted">{TYPE_LABEL[e.type] ?? e.type}</Badge>
                <span>{(e.counties ?? []).join("、") || tr("全部縣市", "All")}{e.towns?.length ? `（${e.towns.join("、")}）` : ""}</span>
                <span className="text-muted-foreground">{(e.dates ?? []).join("、")}</span>
                <span className="text-xs text-muted-foreground">{e.source}</span>
                {e.processed ? <Badge variant="muted" className="bg-green-100 text-green-700">{tr("已處理", "Processed")}</Badge> : <Badge variant="muted" className="bg-amber-100 text-amber-800">{tr("待處理／有失敗", "Pending")}</Badge>}
                {!e.processed && <Button size="sm" variant="outline" disabled={busy} onClick={() => call("reprocessDisasterEvent", { event_id: e.id })}>{tr("重新處理", "Reprocess")}</Button>}
              </div>
              {e.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.summary}</p>}
              {e.result && <p className="text-xs mt-1">{tr(`影響 ${e.result.vendors} 家店、取消退款 ${e.result.cancelled} 筆、失敗 ${e.result.failed}、通知 ${e.result.notified}`, JSON.stringify(e.result))}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** 異常偵測（§9.5）：標記並通知平台與店家，不自動處分。 */
function AnomalyContent() {
  const [items, setItems] = useState<Anomaly[]>([]);
  useEffect(() => onSnapshot(query(collection(db, "anomalies"), orderBy("created_at", "desc"), limit(100)), (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Anomaly))), []);
  return (
    <Card>
      <CardContent className="p-4 space-y-2 text-sm">
        {items.length === 0 && <p className="text-muted-foreground">{tr("目前沒有異常標記。", "No anomalies.")}</p>}
        {items.map((a) => (
          <div key={a.id} className="flex items-center gap-2 border-b pb-2 flex-wrap">
            <Badge variant="muted">{ANOMALY_LABEL[a.type] ?? a.type}</Badge>
            <span className="flex-1">{a.detail}</span>
            <span className="text-xs text-muted-foreground">{a.date}・{a.vendor_id ?? "—"}・{a.user_id.slice(0, 10)}</span>
            {a.status === "open" ? (
              <Button size="sm" variant="outline" onClick={() => updateDoc(doc(db, "anomalies", a.id), { status: "reviewed" })}>{tr("已審核", "Mark reviewed")}</Button>
            ) : <Badge variant="muted">{tr("已審核", "Reviewed")}</Badge>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function AdminDisastersPage() {
  return (
    <AdminLayout>
      <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-3 flex items-center gap-2"><CloudLightning className="w-5 h-5" /> {tr("天災事件", "Disaster events")}</h1>
      <RequireRealAdmin><DisasterContent /></RequireRealAdmin>
    </AdminLayout>
  );
}

export function AdminAnomaliesPage() {
  return (
    <AdminLayout>
      <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><ShieldAlert className="w-5 h-5" /> {tr("異常審核", "Anomalies")}</h2>
      <RequireRealAdmin><AnomalyContent /></RequireRealAdmin>
    </AdminLayout>
  );
}

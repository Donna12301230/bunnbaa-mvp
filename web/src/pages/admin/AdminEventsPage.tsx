import { useEffect, useState } from "react";
import { selectClass } from "@/lib/fieldStyles";
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
import { paren } from "@/lib/format";
import PortalPageHeader from "@/components/PortalPageHeader";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";

interface DisasterEvent { id: string; type: string; counties?: string[]; towns?: string[]; dates?: string[]; source: string; summary?: string; processed?: boolean; result?: { vendors: number; cancelled: number; failed: number; notified: number } }
interface Anomaly { id: string; type: string; user_id: string; vendor_id: string | null; detail: string; date: string; status: string }

// Display labels: tr() is called at render time so they follow language switches
const TYPE_LABEL: Record<string, { zh: string; en: string }> = {
  work_suspension: { zh: "停班停課", en: "Work/school suspension" },
  typhoon_warning: { zh: "颱風警報", en: "Typhoon warning" },
  price_spike: { zh: "菜價暴漲", en: "Produce price spike" },
};
const ANOMALY_LABEL: Record<string, { zh: string; en: string }> = {
  refunds: { zh: "7 天內取消 ≥ 3 筆", en: "≥ 3 cancellations within 7 days" },
  ticket_share: { zh: "單一使用者抽獎券占比 > 20%", en: "One user holds > 20% of raffle tickets" },
  device: { zh: "同一裝置 > 2 帳號領券", en: "> 2 accounts claiming coupons on one device" },
};
const typeLabel = (t: string) => (TYPE_LABEL[t] ? tr(TYPE_LABEL[t].zh, TYPE_LABEL[t].en) : t);
// Manually created events store a fixed Chinese summary; the English UI rebuilds it from the type (NCDR summaries stay as fetched)
const MANUAL_SUFFIX = "（管理員手動建立）";
const summaryText = (e: DisasterEvent) =>
  e.source === "manual" && e.summary?.endsWith(MANUAL_SUFFIX) ? tr(e.summary, `${typeLabel(e.type)} (created manually by an admin)`) : e.summary;
const anomalyLabel = (t: string) => (ANOMALY_LABEL[t] ? tr(ANOMALY_LABEL[t].zh, ANOMALY_LABEL[t].en) : t);

/** Disaster events: fetched automatically from NCDR (aggregating the Central Weather Administration and DGPA); admins create them manually when the source fails. */
function DisasterContent() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [eventList, setEvents] = useState<DisasterEvent[] | null>(null);
  const events = eventList ?? [];
  const [form, setForm] = useState({ type: "work_suspension", counties: "", dates: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => onSnapshot(query(collection(db, "disasterEvents"), orderBy("created_at", "desc"), limit(50)), (s) => setEvents(s.docs.map((d) => ({ id: d.id, ...d.data() }) as DisasterEvent))), []);

  async function create() {
    const counties = form.counties.split(/[,，、\s]+/).map((x) => x.trim().replace(/台/g, "臺")).filter(Boolean);
    const dates = form.dates.split(/[,，、\s]+/).map((x) => x.trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
    if (dates.length === 0) return toast({ variant: "destructive", title: tr("請輸入日期 YYYY-MM-DD", "Enter dates as YYYY-MM-DD") });
    // summary is stored in the database, always in Chinese
    const label = TYPE_LABEL[form.type]?.zh ?? form.type;
    if (form.type === "work_suspension" && !(await confirm({
      title: tr("建立停班停課事件？", "Create a work/school suspension event?"),
      description: tr(
        `${counties.join("、") || "全部縣市"} ${dates.join("、")} 的訂單會自動取消並全額退款，無法復原。`,
        `Orders in ${counties.join(", ") || "all counties"} on ${dates.join(", ")} will be cancelled and fully refunded. This can't be undone.`
      ),
      confirmLabel: tr("建立並退款", "Create and refund"),
      destructive: true,
    }))) return;
    const id = `manual_${Date.now()}`;
    await setDoc(doc(db, "disasterEvents", id), {
      type: form.type, counties, whole_counties: counties, towns: [], dates, source: "manual", summary: `${label}${MANUAL_SUFFIX}`, processed: false, created_at: new Date(),
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
          <select className={selectClass()} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            {Object.keys(TYPE_LABEL).map((k) => <option key={k} value={k}>{typeLabel(k)}</option>)}
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
          {eventList === null && <SkeletonBlocks count={3} height={48} className="space-y-2" />}
          {eventList?.length === 0 && <EmptyState size="compact" icon={<CloudLightning size={32} />} title={tr("目前沒有事件", "No events")} />}
          {events.map((e) => (
            <div key={e.id} className="border-b pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="muted">{typeLabel(e.type)}</Badge>
                <span>{(e.counties ?? []).join(tr("、", ", ")) || tr("全部縣市", "All counties")}{e.towns?.length ? paren(e.towns.join(tr("、", ", "))) : ""}</span>
                <span className="text-muted-foreground">{(e.dates ?? []).join(tr("、", ", "))}</span>
                <span className="text-xs text-muted-foreground">{e.source}</span>
                {e.processed ? <Badge variant="muted" className="bg-success-soft text-success-text">{tr("已處理", "Processed")}</Badge> : <Badge variant="muted" className="bg-warning-soft text-warning-text">{tr("待處理／有失敗", "Pending")}</Badge>}
                {!e.processed && <Button size="sm" variant="outline" disabled={busy} onClick={() => call("reprocessDisasterEvent", { event_id: e.id })}>{tr("重新處理", "Reprocess")}</Button>}
              </div>
              {e.summary && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{summaryText(e)}</p>}
              {e.result && <p className="text-xs mt-1">{tr(`影響 ${e.result.vendors} 家店、取消退款 ${e.result.cancelled} 筆、失敗 ${e.result.failed}、通知 ${e.result.notified}`, `${e.result.vendors} vendors affected, ${e.result.cancelled} cancelled & refunded, ${e.result.failed} failed, ${e.result.notified} notified`)}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Anomaly detection: flags and notifies the platform and vendor; no automatic penalties. */
function AnomalyContent() {
  const [itemList, setItems] = useState<Anomaly[] | null>(null);
  const items = itemList ?? [];
  const { toast } = useToast();
  useEffect(() => onSnapshot(query(collection(db, "anomalies"), orderBy("created_at", "desc"), limit(100)), (s) => setItems(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Anomaly)), (err) => {
    // A denied read would otherwise leave the skeleton up forever
    setItems([]);
    toast({ variant: "destructive", title: tr("讀不到異常標記", "Couldn't load anomalies"), description: err.message });
  }), []);
  return (
    <Card>
      <CardContent className="p-4 space-y-2 text-sm">
        {itemList === null && <SkeletonBlocks count={3} height={40} className="space-y-2" />}
        {itemList?.length === 0 && <EmptyState size="compact" icon={<ShieldAlert size={32} />} title={tr("目前沒有異常標記", "No anomalies")} />}
        {items.map((a) => (
          <div key={a.id} className="flex items-center gap-2 border-b pb-2 flex-wrap">
            <Badge variant="muted">{anomalyLabel(a.type)}</Badge>
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
      <PortalPageHeader icon={CloudLightning} title={tr("天災事件", "Disaster events")} />
      <RequireRealAdmin><DisasterContent /></RequireRealAdmin>
    </AdminLayout>
  );
}

export function AdminAnomaliesPage() {
  return (
    <AdminLayout>
      <PortalPageHeader icon={ShieldAlert} title={tr("異常審核", "Anomalies")} />
      <RequireRealAdmin><AnomalyContent /></RequireRealAdmin>
    </AdminLayout>
  );
}

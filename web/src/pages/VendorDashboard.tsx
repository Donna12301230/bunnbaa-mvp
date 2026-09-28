import { tr, loc } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "@/lib/callable";
import { db, functions } from "../lib/firebase";
import type { AccuracyReport, Payout } from "../types";
import { useAuth } from "@/hooks/useAuth";

/**
 * Spec ref: tech doc v6 §4.1 (calibration report), §4.1a (what-if follow-up).
 *
 * Shows the most recent Gemini-generated accuracy report for this vendor,
 * and lets the vendor ask a free-text what-if question against the same
 * history the scheduled report used.
 */
export default function VendorDashboard() {
  // 店主看自己綁定的商家；管理員沒有綁定商家，改用下拉選單挑要看哪一家
  const { user, isAdmin } = useAuth();
  const [vendorOptions, setVendorOptions] = useState<{ id: string; name: string }[]>([]);
  const [pickedVendorId, setPickedVendorId] = useState<string>();
  const VENDOR_ID = user?.vendorId ?? (isAdmin ? pickedVendorId ?? vendorOptions[0]?.id : undefined);
  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [question, setQuestion] = useState("");
  const [scenarioAnswer, setScenarioAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    getDocs(collection(db, "vendors")).then((snap) => {
      setVendorOptions(snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) ?? d.id })));
    });
  }, [isAdmin]);

  useEffect(() => {
    // 換商家時先清掉上一家的報告，避免新商家沒有報告時還顯示舊的
    setReport(null);
    setScenarioAnswer(null);
    if (!VENDOR_ID) return;
    // Single equality (no orderBy) so this doesn't need its own composite
    // index — firestore.indexes.json only declares vendor_id+created_at for
    // locks/payouts. At pilot scale (one report/day for one vendor) sorting
    // client-side for the latest is cheap.
    const q = query(collection(db, "accuracy_reports"), where("vendor_id", "==", VENDOR_ID), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) return;
      const docs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as AccuracyReport & { generated_at?: { toMillis?: () => number } });
      docs.sort((a, b) => (b.generated_at?.toMillis?.() ?? 0) - (a.generated_at?.toMillis?.() ?? 0));
      setReport(docs[0]);
    });
    return () => unsub();
  }, [VENDOR_ID]);

  useEffect(() => {
    if (!VENDOR_ID) return;
    const q = query(
      collection(db, "payouts"),
      where("vendor_id", "==", VENDOR_ID),
      orderBy("created_at", "desc"),
      limit(5)
    );
    const unsub = onSnapshot(q, (snap) => {
      setPayouts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    });
    return () => unsub();
  }, [VENDOR_ID]);

  async function handleSettleNow() {
    setSettling(true);
    try {
      const fn = httpsCallable(functions, "triggerSettlementNow");
      await fn({ vendor_id: VENDOR_ID });
    } finally {
      setSettling(false);
    }
  }

  async function handleTriggerNow() {
    setTriggering(true);
    try {
      const fn = httpsCallable(functions, "triggerCalibrationNow");
      await fn({ vendor_id: VENDOR_ID });
      // onSnapshot above will pick up the new report automatically
    } finally {
      setTriggering(false);
    }
  }

  async function handleAsk() {
    if (!question.trim()) return;
    setAsking(true);
    setScenarioAnswer(null);
    try {
      const fn = httpsCallable(functions, "askCalibrationScenario");
      const res: any = await fn({ vendor_id: VENDOR_ID, question });
      setScenarioAnswer(res.data.scenario_answer);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="page">
      <div className="kicker">BunnBaa · {tr("商家後台", "Vendor portal")}</div>
      <h1>{tr("預測校準報告", "Forecast calibration report")}</h1>

      {isAdmin && !user?.vendorId && vendorOptions.length > 0 && (
        <div className="card">
          <label className="muted" htmlFor="vendor-scope">{tr("檢視商家（管理員）", "Vendor (admin view)")}</label>{" "}
          <select id="vendor-scope" value={VENDOR_ID} onChange={(e) => setPickedVendorId(e.target.value)}>
            {vendorOptions.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
      )}

      {!VENDOR_ID && !isAdmin && (
        <div className="card">
          <p className="muted">{tr("這個帳號還沒綁定商家，請先到平台申請成為合作店家。", "This account isn't linked to a vendor yet. Apply to become a partner vendor first.")}</p>
        </div>
      )}

      {VENDOR_ID && !report && (
        <div className="card">
          <p className="muted">{tr("尚無報告。累積幾天的取餐紀錄後，點下方按鈕產生第一份報告。", "No report yet. Once there are a few days of pickups, generate the first report below.")}</p>
          <button onClick={handleTriggerNow} disabled={triggering}>
            {triggering ? tr("產生中…", "Generating…") : tr("立即產生報告", "Generate report")}
          </button>
        </div>
      )}

      {report && (
        <>
          <div className="card tinted">
            <div className="row">
              <div>
                <div className="stat">{Math.round(report.accuracy_rate * 100)}%</div>
                <div className="muted">{tr("目前預測準確率 · 誤差區間", "Current forecast accuracy · error range")} {report.error_range}</div>
              </div>
              <button className="secondary" onClick={handleTriggerNow} disabled={triggering}>
                {triggering ? tr("更新中…", "Updating…") : tr("重新計算", "Recalculate")}
              </button>
            </div>
          </div>

          <div className="card">
            <h2>{tr("說明", "Explanation")}</h2>
            <p className="muted">{loc(report, "explanation")}</p>
          </div>

          <div className="card">
            <h2>{tr("落差模式", "Gap patterns")}</h2>
            <p className="muted">{loc(report, "pattern_note")}</p>
          </div>

          <div className="card">
            <h2>{tr("追問情境", "Ask a what-if")}</h2>
            <p className="faint">{tr("例如：「如果這次我把鎖定量目標調高 10%，履約缺口大概會怎麼變化？」", "e.g. \"If I raise my locking target by 10%, how would the fulfilment gap change?\"")}</p>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={tr("輸入你的問題…", "Type your question…")}
              />
              <button onClick={handleAsk} disabled={asking || !question.trim()}>
                {asking ? tr("思考中…", "Thinking…") : tr("詢問", "Ask")}
              </button>
            </div>
            {scenarioAnswer && <p className="muted" style={{ marginTop: 12 }}>{scenarioAnswer}</p>}
          </div>

          <div className="disclaimer">{report.disclaimer}</div>
        </>
      )}

      <h1 style={{ marginTop: 32 }}>{tr("撥款", "Payouts")}</h1>
      <div className="card">
        <div className="row">
          <p className="muted" style={{ margin: 0 }}>
            {tr("平台代收後全額撥款，不抽成。目前還沒接 LINE Pay／綠界撥款 API，先以對帳單匯出的方式結算。", "The platform collects payment and pays out in full with no commission. Payout APIs aren't connected yet, so settlements are exported as statements.")}
          </p>
          <button className="secondary" onClick={handleSettleNow} disabled={settling}>
            {settling ? tr("結算中…", "Settling…") : tr("立即結算", "Settle now")}
          </button>
        </div>
      </div>

      {payouts.length === 0 ? (
        <p className="faint">{tr("尚無撥款紀錄。", "No payouts yet.")}</p>
      ) : (
        payouts.map((p) => (
          <div key={p.id} className="card">
            <div className="row">
              <div>
                <div className="stat">NT${p.amount}</div>
                <div className="muted">{tr(`${p.lock_count} 筆已履約訂單`, `${p.lock_count} fulfilled orders`)}</div>
              </div>
              <span className="badge">{tr("待人工對帳匯出", "Awaiting manual export")}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

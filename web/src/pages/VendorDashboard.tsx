import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../lib/firebase";
import type { AccuracyReport } from "../types";

const VENDOR_ID = "cafe-renheya-demo";

/**
 * Spec ref: tech doc v6 §4.1 (calibration report), §4.1a (what-if follow-up).
 *
 * Shows the most recent Gemini-generated accuracy report for this vendor,
 * and lets the vendor ask a free-text what-if question against the same
 * history the scheduled report used.
 */
export default function VendorDashboard() {
  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [question, setQuestion] = useState("");
  const [scenarioAnswer, setScenarioAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, "accuracy_reports"),
      where("vendor_id", "==", VENDOR_ID),
      orderBy("generated_at", "desc"),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const d = snap.docs[0];
        setReport({ id: d.id, ...(d.data() as any) });
      }
    });
    return () => unsub();
  }, []);

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
      <div className="kicker">BunnBaa · 商家後台</div>
      <h1>預測校準報告</h1>

      {!report && (
        <div className="card">
          <p className="muted">尚無報告。先執行 scripts/seed.js 產生情境資料，再點下方按鈕產生第一份報告。</p>
          <button onClick={handleTriggerNow} disabled={triggering}>
            {triggering ? "產生中…" : "立即產生報告"}
          </button>
        </div>
      )}

      {report && (
        <>
          <div className="card tinted">
            <div className="row">
              <div>
                <div className="stat">{Math.round(report.accuracy_rate * 100)}%</div>
                <div className="muted">目前預測準確率 · 誤差區間 {report.error_range}</div>
              </div>
              <button className="secondary" onClick={handleTriggerNow} disabled={triggering}>
                {triggering ? "更新中…" : "重新計算"}
              </button>
            </div>
          </div>

          <div className="card">
            <h2>說明</h2>
            <p className="muted">{report.explanation}</p>
          </div>

          <div className="card">
            <h2>落差模式</h2>
            <p className="muted">{report.pattern_note}</p>
          </div>

          <div className="card">
            <h2>追問情境</h2>
            <p className="faint">例如：「如果這次我把鎖定量目標調高 10%，履約缺口大概會怎麼變化？」</p>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="輸入你的問題…"
              />
              <button onClick={handleAsk} disabled={asking || !question.trim()}>
                {asking ? "思考中…" : "詢問"}
              </button>
            </div>
            {scenarioAnswer && <p className="muted" style={{ marginTop: 10 }}>{scenarioAnswer}</p>}
          </div>

          <div className="disclaimer">{report.disclaimer}</div>
        </>
      )}
    </div>
  );
}

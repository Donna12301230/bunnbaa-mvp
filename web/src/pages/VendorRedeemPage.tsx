import { useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { db, functions } from "../lib/firebase";
import type { Lock } from "../types";

const VENDOR_ID = "cafe-renheya-demo";

const noShowSchema = z.object({
  note: z.string().min(2, "請簡短描述狀況（至少 2 個字），這會餵給校準報告的落差模式分析"),
});
type NoShowForm = z.infer<typeof noShowSchema>;

/**
 * Spec ref: README「尚未實作」清單 — 商家後台標記 no-show／備註的介面。
 * Ported from the old Parse prototype's vendor/scan.tsx pattern: match by
 * the last 8 chars of the lock id rather than a live camera QR scan (the
 * old app never actually wired up its html5-qrcode dependency either).
 * Outcome writes go through `markLockOutcome` because firestore.rules
 * blocks direct client writes to lock status transitions.
 */
export default function VendorRedeemPage() {
  const [code, setCode] = useState("");
  const [foundLock, setFoundLock] = useState<Lock | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showNoShowForm, setShowNoShowForm] = useState(false);

  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors },
  } = useForm<NoShowForm>({ resolver: zodResolver(noShowSchema) });

  async function handleSearch() {
    const input = code.trim().toUpperCase();
    if (!input) return;

    setSearchError("");
    setFoundLock(null);
    setShowNoShowForm(false);
    setSearching(true);
    try {
      // 撈最近 200 筆這個商家的鎖定紀錄，用末 8 碼比對——跟舊 Parse 版本的
      // scan.tsx 一樣的作法，避免需要額外的複合索引。
      const q = query(
        collection(db, "locks"),
        where("vendor_id", "==", VENDOR_ID),
        orderBy("created_at", "desc"),
        limit(200)
      );
      const snap = await getDocs(q);
      const match = snap.docs.find((d) => d.id.slice(-8).toUpperCase() === input.slice(-8));

      if (!match) {
        setSearchError("找不到符合的取餐編號，請確認是否輸入正確。");
        return;
      }
      if (match.data().status !== "locked" && match.data().status !== "for_resale") {
        setSearchError(`這筆已經是「${match.data().status}」狀態了，無法再次核對。`);
        return;
      }
      setFoundLock({ id: match.id, ...(match.data() as any) });
    } catch {
      setSearchError("查詢失敗，請重試。");
    } finally {
      setSearching(false);
    }
  }

  async function markOutcome(outcome: "fulfilled" | "resold_and_fulfilled" | "no_show", note?: string) {
    if (!foundLock) return;
    setSubmitting(true);
    try {
      const fn = httpsCallable(functions, "markLockOutcome");
      await fn({ lock_id: foundLock.id, outcome, note });
      setFoundLock({ ...foundLock, status: outcome, no_show_note: note ?? foundLock.no_show_note });
      setShowNoShowForm(false);
    } catch (err) {
      alert("操作失敗：" + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function onNoShowSubmit(data: NoShowForm) {
    markOutcome("no_show", data.note);
    resetForm();
  }

  function reset() {
    setCode("");
    setFoundLock(null);
    setSearchError("");
    setShowNoShowForm(false);
  }

  const alreadyDone = foundLock && ["fulfilled", "no_show", "resold_and_fulfilled"].includes(foundLock.status);

  return (
    <div className="page">
      <div className="kicker">BunnBaa · 商家後台</div>
      <h1>核對取餐</h1>

      <div className="card">
        <div className="field">
          <label>取餐編號（末 8 碼）</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              placeholder="例如：AB3F9K2M"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              maxLength={10}
              style={{ fontFamily: "monospace", letterSpacing: "0.08em" }}
            />
            <button onClick={handleSearch} disabled={!code.trim() || searching}>
              {searching ? "查詢中…" : "查詢"}
            </button>
          </div>
        </div>
        {searchError && <div className="field-error">{searchError}</div>}
      </div>

      {foundLock && (
        <div className="card">
          <div className="row">
            <div>
              <h2>{foundLock.item_name}</h2>
              <div className="muted">
                {foundLock.pickup_window} 取餐 · NT${foundLock.locked_price}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <span className="badge">#{foundLock.id.slice(-8).toUpperCase()}</span>
              {foundLock.status === "for_resale" && <span className="badge">轉賣中</span>}
            </div>
          </div>

          {alreadyDone ? (
            <>
              <p className="muted" style={{ marginTop: 12 }}>
                狀態：
                {foundLock.status === "fulfilled"
                  ? "已完成取餐"
                  : foundLock.status === "resold_and_fulfilled"
                  ? "已由轉賣對象完成取餐"
                  : foundLock.status === "no_show"
                  ? "已登記未取餐"
                  : foundLock.status}
              </p>
              <button className="secondary" onClick={reset}>
                查詢下一筆
              </button>
            </>
          ) : (
            <div style={{ marginTop: 12 }}>
              {!showNoShowForm ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    disabled={submitting}
                    onClick={() => markOutcome(foundLock.status === "for_resale" ? "resold_and_fulfilled" : "fulfilled")}
                  >
                    {submitting ? "處理中…" : "確認取餐"}
                  </button>
                  <button className="secondary" disabled={submitting} onClick={() => setShowNoShowForm(true)}>
                    登記未取餐
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit(onNoShowSubmit)}>
                  <div className="field">
                    <label>未取餐備註（給校準報告分析落差模式用）</label>
                    <input type="text" placeholder="例如：客人臨時取消，說今天下雨不方便出門" {...register("note")} />
                    {errors.note && <div className="field-error">{errors.note.message}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="submit" disabled={submitting}>
                      {submitting ? "送出中…" : "送出登記"}
                    </button>
                    <button type="button" className="secondary" onClick={() => setShowNoShowForm(false)}>
                      取消
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

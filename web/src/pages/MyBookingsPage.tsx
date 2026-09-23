import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, query, Timestamp, updateDoc, where } from "firebase/firestore";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { QRCodeSVG } from "qrcode.react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { QrCode, Gift, Repeat, Copy } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { useToast } from "@/hooks/use-toast";
import { auth, db } from "@/lib/firebase";
import type { Lock } from "@/types";

// 對應 UI草圖 MyBookings.dc.html「我的商品」（2026-09-21 改名「我的餐點」，只給
// 一般使用者看；廠商端這個 nav 分頁換成接受端的核對取餐，見 MarketplaceHeader.tsx）。
//
// 2026-09-22 接上真實 Firestore（前次盤點發現整頁完全是寫死 mock，比想像中大的
// 工程，這次做完）：
//   - 依 buyer_uid 查真實 locks（單一 equality，不加 orderBy，避免要求新複合
//     索引，同 MyLocksPage/TransferMarketPage 的慣例），依 pickup_date /
//     pickup_window 即時分組——真實資料筆數不固定，改成「每天一區塊」的清單，
//     不是原本假資料那種固定 7×3 週曆格
//   - 「使用」：只顯示 QR／取餐編號（真正核銷是商家端 markLockOutcome，消費者
//     這邊不能自己按「完成核銷」，原本 mock 的 confirmUse 是假的）
//   - 「贈送」：沒有「指名」欄位——真實機制是把 lock 轉成 for_gift 再把連結
//     私下傳給朋友，同 ConsumerLockPage.tsx 的 handleGift()
//   - 「交易」：轉成 for_resale + resale_deadline，同 handleResell()，上架後
//     會出現在 /marketplace；沒有價格輸入欄位——轉賣價由雙方私下議定，平台
//     不經手（同 TransferMarketPage.tsx 的設計）
//   - 「留下回饋」：沿用既有 Lock.consumer_feedback 欄位，one-shot，同
//     handleSubmitFeedback()
//   - 「取消轉讓／取消贈送」：2026-09-22 補上 firestore.rules 規則後可以把
//     for_resale/for_gift 改回 locked，同 TransferMarketPage「我的轉讓」
//   - 「計畫型」（訂閱制多日方案）完全沒有真實資料模型（Firestore 沒有 plan
//     collection），這次不補假資料，只顯示單點型的真實紀錄

const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  locked: { label: "已鎖定", className: "bg-orange-100 text-orange-700" },
  for_resale: { label: "轉賣中", className: "bg-amber-100 text-amber-800" },
  for_gift: { label: "贈送中", className: "bg-blue-100 text-blue-700" },
  fulfilled: { label: "已取餐", className: "bg-green-100 text-green-700" },
  resold_and_fulfilled: { label: "已由轉賣對象取餐", className: "bg-green-100 text-green-700" },
  no_show: { label: "已登記未取餐", className: "bg-red-100 text-red-700" },
};

const FEEDBACK_ELIGIBLE = new Set(["fulfilled", "resold_and_fulfilled", "no_show"]);

function formatDateLabel(dateStr: string): string {
  try {
    return format(new Date(`${dateStr}T00:00:00`), "M/d（EEE）", { locale: zhTW });
  } catch {
    return dateStr;
  }
}

// Mirrors ConsumerLockPage.tsx's pickupWindowEnd — used as the resale_deadline
// after which anyone may free-claim (see firestore.rules).
function pickupWindowEnd(pickupDate: string, pickupWindow: string): Date | null {
  const endTime = pickupWindow.split("-")[1]?.trim() ?? pickupWindow.split("–")[1]?.trim();
  if (!endTime) return null;
  return new Date(`${pickupDate}T${endTime}:00+08:00`);
}

function formatCountdown(deadline: Date, now: number): string {
  const diffMin = Math.round((deadline.getTime() - now) / 60000);
  if (diffMin <= 0) return "已逾期";
  if (diffMin < 60) return `${diffMin} 分後截止`;
  return `${Math.floor(diffMin / 60)} 小時 ${diffMin % 60} 分後截止`;
}

// Local-date (not UTC) helpers for the calendar grid — pickup_date strings
// are plain "YYYY-MM-DD" with no timezone, so toISOString() here would risk
// an off-by-one day depending on the viewer's timezone.
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfWeek(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}
function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export default function MyBookingsPage() {
  const { toast } = useToast();
  const [uid, setUid] = useState<string | null>(null);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState<Record<string, boolean>>({});
  const [feedbackOpen, setFeedbackOpen] = useState<Record<string, boolean>>({});
  const [feedbackDraft, setFeedbackDraft] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
    const unsub = onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, "locks"), where("buyer_uid", "==", uid), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [uid]);

  // 轉賣逾時倒數是前端算的，固定重算才會即時更新顯示。
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  const locksByDate = useMemo(() => {
    const byDate = new Map<string, Lock[]>();
    for (const lock of locks) {
      const bucket = byDate.get(lock.pickup_date) ?? [];
      bucket.push(lock);
      byDate.set(lock.pickup_date, bucket);
    }
    for (const bucket of byDate.values()) bucket.sort((a, b) => a.pickup_window.localeCompare(b.pickup_window));
    return byDate;
  }, [locks]);

  // Calendar grid, back by popular demand after 2026-09-22's switch to a flat
  // date-grouped list (see file header comment) — but sized to the real data
  // instead of the original mock's fixed 7×3, so it doesn't run out of room:
  // defaults to the current 3-week window, and grows (in whole weeks) to fit
  // any lock whose pickup_date falls outside that range.
  const calendarWeeks = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let start = startOfWeek(today);
    let end = addDays(start, 20);

    for (const dateStr of locksByDate.keys()) {
      const d = new Date(`${dateStr}T00:00:00`);
      if (d < start) start = startOfWeek(d);
      if (d > end) end = d;
    }
    end = addDays(startOfWeek(end), 6);

    const days: Date[] = [];
    for (let cur = start; cur <= end; cur = addDays(cur, 1)) days.push(cur);
    const weeks: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
    return weeks;
  }, [locksByDate]);

  const expandedLock = expandedId ? (locks.find((l) => l.id === expandedId) ?? null) : null;

  async function handleGift(lock: Lock) {
    setBusyId(lock.id);
    try {
      await updateDoc(doc(db, "locks", lock.id), { status: "for_gift" });
      toast({ title: "已轉為贈送模式", description: "把下面出現的連結私下傳給朋友即可。" });
    } catch (err) {
      toast({ title: "贈送失敗", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleResell(lock: Lock) {
    setBusyId(lock.id);
    try {
      const deadline = pickupWindowEnd(lock.pickup_date, lock.pickup_window);
      await updateDoc(doc(db, "locks", lock.id), {
        status: "for_resale",
        ...(deadline ? { resale_deadline: Timestamp.fromDate(deadline) } : {}),
      });
      toast({ title: "已上架轉讓市集" });
    } catch (err) {
      toast({ title: "上架失敗", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancelTransfer(lock: Lock) {
    setBusyId(lock.id);
    try {
      await updateDoc(doc(db, "locks", lock.id), { status: "locked" });
      toast({ title: lock.status === "for_gift" ? "已取消贈送" : "已取消轉讓" });
    } catch (err) {
      toast({ title: "取消失敗", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleSubmitFeedback(lock: Lock) {
    const text = (feedbackDraft[lock.id] || "").trim();
    if (!text) return;
    setBusyId(lock.id);
    try {
      await updateDoc(doc(db, "locks", lock.id), { consumer_feedback: text });
      setFeedbackOpen((prev) => ({ ...prev, [lock.id]: false }));
    } catch (err) {
      toast({ title: "送出回饋失敗", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  function giftLinkFor(lockId: string): string {
    return `${window.location.origin}${window.location.pathname}?gift=${lockId}#/lock`;
  }

  async function copyLink(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "已複製連結" });
    } catch {
      toast({ title: "複製失敗，請手動選取連結", variant: "destructive" });
    }
  }

  function renderLockCard(lock: Lock) {
    const statusInfo = STATUS_STYLE[lock.status] ?? { label: lock.status, className: "bg-gray-100 text-gray-700" };
    const isBusy = busyId === lock.id;
    const deadline = lock.status === "for_resale" ? pickupWindowEnd(lock.pickup_date, lock.pickup_window) : null;
    const canFeedback = FEEDBACK_ELIGIBLE.has(lock.status);
    const hasFeedback = !!lock.consumer_feedback;

    return (
      <article className="bg-white border border-border rounded-xl p-4 flex flex-col gap-2 max-w-sm">
                      <span className={`self-start text-xs font-bold px-2 py-0.5 rounded-full ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                      <h3 className="font-semibold leading-snug">{lock.item_name}</h3>
                      <p className="text-sm text-muted-foreground">
                        {formatDateLabel(lock.pickup_date)}・{lock.pickup_window} 取餐・${lock.locked_price}
                      </p>

                      {lock.status === "locked" && (
                        <div className="flex flex-col gap-2 pt-1">
                          {qrOpen[lock.id] ? (
                            <div className="flex flex-col items-center gap-1.5 text-center py-2">
                              <QRCodeSVG value={JSON.stringify({ lockId: lock.id, vendorId: lock.vendor_id })} size={120} level="M" />
                              <span className="text-sm font-bold">取餐編號 {lock.id.slice(-8).toUpperCase()}</span>
                              <span className="text-xs text-muted-foreground">請於取餐時向店員出示</span>
                              <button
                                onClick={() => setQrOpen((prev) => ({ ...prev, [lock.id]: false }))}
                                className="text-xs font-semibold text-muted-foreground underline"
                              >
                                收起
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setQrOpen((prev) => ({ ...prev, [lock.id]: true }))}
                              className="flex items-center justify-center gap-1.5 text-xs font-bold rounded-md bg-orange-500 text-white py-2"
                            >
                              <QrCode className="w-3.5 h-3.5" /> 使用（顯示取餐碼）
                            </button>
                          )}
                          <div className="flex gap-2">
                            <button
                              disabled={isBusy}
                              onClick={() => handleGift(lock)}
                              className="flex-1 flex items-center justify-center gap-1 text-xs font-semibold rounded-md border border-border py-2"
                            >
                              <Gift className="w-3.5 h-3.5" /> 贈送
                            </button>
                            <button
                              disabled={isBusy}
                              onClick={() => handleResell(lock)}
                              className="flex-1 flex items-center justify-center gap-1 text-xs font-semibold rounded-md border border-border py-2"
                            >
                              <Repeat className="w-3.5 h-3.5" /> 交易
                            </button>
                          </div>
                        </div>
                      )}

                      {lock.status === "for_gift" && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <p className="text-xs text-muted-foreground">把這組連結私下傳給朋友，對方打開就能收下：</p>
                          <div className="flex items-center gap-1.5">
                            <input readOnly value={giftLinkFor(lock.id)} className="flex-1 text-xs border border-border rounded-md px-2 py-1.5 truncate" />
                            <button onClick={() => copyLink(giftLinkFor(lock.id))} className="shrink-0 p-1.5 rounded-md border border-border">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <button
                            disabled={isBusy}
                            onClick={() => handleCancelTransfer(lock)}
                            className="text-xs font-semibold rounded-md border border-red-300 text-red-600 py-1.5"
                          >
                            取消贈送
                          </button>
                        </div>
                      )}

                      {lock.status === "for_resale" && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <p className="text-xs text-muted-foreground">
                            {deadline ? formatCountdown(deadline, now) : "等待有人接手"}・已上架到轉讓市集
                          </p>
                          <button
                            disabled={isBusy}
                            onClick={() => handleCancelTransfer(lock)}
                            className="text-xs font-semibold rounded-md border border-red-300 text-red-600 py-1.5"
                          >
                            取消轉讓
                          </button>
                        </div>
                      )}

                      {canFeedback && (
                        hasFeedback ? (
                          <p className="text-xs text-muted-foreground pt-1">已回饋：「{lock.consumer_feedback}」</p>
                        ) : feedbackOpen[lock.id] ? (
                          <div className="flex flex-col gap-1.5 pt-1">
                            <input
                              value={feedbackDraft[lock.id] || ""}
                              onChange={(e) => setFeedbackDraft((prev) => ({ ...prev, [lock.id]: e.target.value }))}
                              placeholder="這餐的心得…（送出後無法修改）"
                              maxLength={280}
                              className="text-xs border border-border rounded-md px-2 py-1.5"
                            />
                            <button
                              disabled={isBusy || !(feedbackDraft[lock.id] || "").trim()}
                              onClick={() => handleSubmitFeedback(lock)}
                              className="text-xs font-bold rounded-md bg-orange-500 text-white py-2"
                            >
                              送出回饋
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setFeedbackOpen((prev) => ({ ...prev, [lock.id]: true }))}
                            className="text-xs font-semibold rounded-md border border-border py-2 pt-1"
                          >
                            留下回饋
                          </button>
                        )
                      )}
      </article>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader active="bookings" />

      <section className="px-4 md:px-6 py-6 max-w-[1400px] mx-auto">
        <h1 className="text-2xl font-bold mb-1">我的餐點</h1>
        <p className="text-sm text-muted-foreground">週曆上點一筆訂單看詳情、使用取餐碼或轉讓／贈送。</p>
      </section>

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 pb-10 space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">載入中…</p>
        ) : locks.length === 0 ? (
          <p className="text-sm text-muted-foreground">目前沒有任何鎖定紀錄。到「預購鎖定」鎖一份餐點看看。</p>
        ) : (
          <>
            <div className="space-y-1">
              <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-bold text-muted-foreground">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label}>{label}</div>
                ))}
              </div>
              {calendarWeeks.map((week, wi) => (
                <div key={wi} className="grid grid-cols-7 gap-1.5">
                  {week.map((day) => {
                    const dateStr = toLocalDateStr(day);
                    const dayLocks = locksByDate.get(dateStr) ?? [];
                    const isToday = dateStr === toLocalDateStr(new Date());
                    return (
                      <div
                        key={dateStr}
                        className={`min-h-[92px] rounded-lg border p-1.5 flex flex-col gap-1 ${
                          isToday ? "border-orange-400 bg-orange-50/50" : "border-border bg-white"
                        }`}
                      >
                        <span className="text-[11px] font-semibold text-muted-foreground">{day.getDate()}</span>
                        {dayLocks.map((lock) => {
                          const statusInfo = STATUS_STYLE[lock.status] ?? { label: lock.status, className: "bg-gray-100 text-gray-700" };
                          return (
                            <button
                              key={lock.id}
                              onClick={() => setExpandedId((prev) => (prev === lock.id ? null : lock.id))}
                              className={`text-left text-[11px] leading-tight rounded px-1.5 py-1 truncate ${statusInfo.className} ${
                                expandedId === lock.id ? "ring-2 ring-orange-500" : ""
                              }`}
                              title={lock.item_name}
                            >
                              {lock.item_name}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {expandedLock && <div>{renderLockCard(expandedLock)}</div>}
          </>
        )}
      </div>
    </div>
  );
}

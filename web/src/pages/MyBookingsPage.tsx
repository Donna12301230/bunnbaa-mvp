import { useEffect, useMemo, useState } from "react";
import { collection, doc, limit, onSnapshot, query, Timestamp, updateDoc, where } from "firebase/firestore";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { QRCodeSVG } from "qrcode.react";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { QrCode, Gift, Repeat, Copy, ClipboardList } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { auth, db } from "@/lib/firebase";
import type { Lock } from "@/types";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { Link } from "wouter";

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
      <article className="bg-card border border-border rounded-lg shadow-sm p-4 flex flex-col gap-2 max-w-sm">
                      <Badge variant="muted" className={`self-start ${statusInfo.className}`}>
                        {statusInfo.label}
                      </Badge>
                      <h3 className="text-h3 leading-snug">{lock.item_name}</h3>
                      <p className="text-body-sm text-muted-foreground">
                        {formatDateLabel(lock.pickup_date)}・{lock.pickup_window} 取餐・${lock.locked_price}
                      </p>

                      {lock.status === "locked" && (
                        <div className="flex flex-col gap-2 pt-1">
                          {qrOpen[lock.id] ? (
                            <div className="flex flex-col items-center gap-1.5 text-center py-2">
                              <QRCodeSVG value={JSON.stringify({ lockId: lock.id, vendorId: lock.vendor_id })} size={120} level="M" />
                              <span className="text-body-sm font-bold">取餐編號 {lock.id.slice(-8).toUpperCase()}</span>
                              <span className="text-caption text-muted-foreground">請於取餐時向店員出示</span>
                              <Button variant="link" size="sm" onClick={() => setQrOpen((prev) => ({ ...prev, [lock.id]: false }))}>
                                收起
                              </Button>
                            </div>
                          ) : (
                            <Button size="sm" onClick={() => setQrOpen((prev) => ({ ...prev, [lock.id]: true }))}>
                              <QrCode /> 使用（顯示取餐碼）
                            </Button>
                          )}
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="flex-1" disabled={isBusy} onClick={() => handleGift(lock)}>
                              <Gift /> 贈送
                            </Button>
                            <Button variant="outline" size="sm" className="flex-1" disabled={isBusy} onClick={() => handleResell(lock)}>
                              <Repeat /> 交易
                            </Button>
                          </div>
                        </div>
                      )}

                      {lock.status === "for_gift" && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <p className="text-caption text-muted-foreground">把這組連結私下傳給朋友，對方打開就能收下：</p>
                          <div className="flex items-center gap-1.5">
                            <Input readOnly value={giftLinkFor(lock.id)} aria-label="贈送連結" className="flex-1 truncate" />
                            <Button variant="outline" size="icon" className="shrink-0" aria-label="複製連結" onClick={() => copyLink(giftLinkFor(lock.id))}>
                              <Copy />
                            </Button>
                          </div>
                          <Button variant="outline" size="sm" className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-600" disabled={isBusy} onClick={() => handleCancelTransfer(lock)}>
                            取消贈送
                          </Button>
                        </div>
                      )}

                      {lock.status === "for_resale" && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <p className="text-caption text-muted-foreground">
                            {deadline ? formatCountdown(deadline, now) : "等待有人接手"}・已上架到轉讓市集
                          </p>
                          <Button variant="outline" size="sm" className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-600" disabled={isBusy} onClick={() => handleCancelTransfer(lock)}>
                            取消轉讓
                          </Button>
                        </div>
                      )}

                      {canFeedback && (
                        hasFeedback ? (
                          <p className="text-caption text-muted-foreground pt-1">已回饋：「{lock.consumer_feedback}」</p>
                        ) : feedbackOpen[lock.id] ? (
                          <div className="flex flex-col gap-1.5 pt-1">
                            <Input
                              value={feedbackDraft[lock.id] || ""}
                              onChange={(e) => setFeedbackDraft((prev) => ({ ...prev, [lock.id]: e.target.value }))}
                              placeholder="這餐的心得…（送出後無法修改）"
                              aria-label="用餐回饋"
                              maxLength={280}
                            />
                            <Button size="sm" disabled={isBusy || !(feedbackDraft[lock.id] || "").trim()} onClick={() => handleSubmitFeedback(lock)}>
                              送出回饋
                            </Button>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => setFeedbackOpen((prev) => ({ ...prev, [lock.id]: true }))}>
                            留下回饋
                          </Button>
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
          <SkeletonBlocks count={3} height={160} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" />
        ) : locks.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={32} />}
            title="還沒有預約紀錄"
            description="到「預購餐點」鎖一份餐點，隔天就不用排隊。"
            action={<Button asChild><Link href="/home">去預約餐點</Link></Button>}
          />
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
                        <span className="text-micro font-semibold text-muted-foreground">{day.getDate()}</span>
                        {dayLocks.map((lock) => {
                          const statusInfo = STATUS_STYLE[lock.status] ?? { label: lock.status, className: "bg-gray-100 text-gray-700" };
                          return (
                            <button
                              key={lock.id}
                              onClick={() => setExpandedId((prev) => (prev === lock.id ? null : lock.id))}
                              aria-expanded={expandedId === lock.id}
                              className={`text-left text-micro leading-tight rounded-sm px-1.5 py-1 truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${statusInfo.className} ${
                                expandedId === lock.id ? "ring-2 ring-primary" : ""
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

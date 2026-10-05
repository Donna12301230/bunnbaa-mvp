import { useEffect, useMemo, useState } from "react";
import { collection, doc, documentId, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from "firebase/firestore";
import { useAuth } from "@/hooks/useAuth";
import { useItemImages } from "@/hooks/useItemImages";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { QrCode, Gift, Repeat, Copy, ClipboardList, Maximize2, Star, HeartHandshake, XCircle, Users, Pencil, List, CalendarRange } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { getLang, tr, loc } from "@/lib/i18n";
import { enUS } from "date-fns/locale";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import PageHero from "@/components/PageHero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import PickupQr from "@/components/PickupQr";
import EditWishesDialog from "@/components/EditWishesDialog";
import { useConfirm } from "@/components/ConfirmDialog";
import { extraSideText, riceLabel, slotText } from "@/lib/bento";
import { isPastCutoff, todayStr } from "@/lib/pickupSlots";
import type { Lock } from "@/types";
import { EmptyState, Tag } from "@/components/ds";
import TransferMarketPage from "@/pages/TransferMarketPage";
import CharityMealsSection from "@/components/CharityMealsSection";
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

// 消費者視角的狀態文字（跟商家端 LOCK_STATUS_STYLE 用詞不同），render 時依語言組
const statusStyle = (status: string): { label: string; className: string } => {
  const map: Record<string, { label: string; className: string }> = {
    locked: { label: tr("已鎖定", "Locked"), className: "bg-orange-100 text-orange-700" },
    for_resale: { label: tr("轉賣中", "For resale"), className: "bg-amber-100 text-amber-800" },
    for_gift: { label: tr("贈送中", "Being gifted"), className: "bg-blue-100 text-blue-700" },
    fulfilled: { label: tr("已取餐", "Picked up"), className: "bg-green-100 text-green-700" },
    resold_and_fulfilled: { label: tr("已由轉賣對象取餐", "Picked up by new owner"), className: "bg-green-100 text-green-700" },
    no_show: { label: tr("已登記未取餐", "No-show"), className: "bg-red-100 text-red-700" },
    charity: { label: tr("已轉為愛心餐", "Charity meal"), className: "bg-pink-100 text-pink-700" },
    cancelling: { label: tr("退款中", "Refunding"), className: "bg-gray-100 text-gray-700" },
    cancelled: { label: tr("已取消・已退款", "Cancelled · refunded"), className: "bg-gray-100 text-gray-700" },
  };
  return map[status] ?? { label: status, className: "bg-gray-100 text-gray-700" };
};

const ACTIVE_STATUSES = new Set(["locked", "for_resale", "for_gift"]);
const FEEDBACK_ELIGIBLE = new Set(["fulfilled", "resold_and_fulfilled", "no_show", "charity"]);
// 有實際拿到餐的才能評分（reviews，公開）；no_show 只能留私下回饋給商家校準
const REVIEW_ELIGIBLE = new Set(["fulfilled", "resold_and_fulfilled"]);

function formatDateLabel(dateStr: string): string {
  try {
    return getLang() === "en"
      ? format(new Date(`${dateStr}T00:00:00`), "EEE, M/d", { locale: enUS })
      : format(new Date(`${dateStr}T00:00:00`), "M/d（EEE）", { locale: zhTW });
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
  if (diffMin <= 0) return tr("已逾期", "Expired");
  if (diffMin < 60) return tr(`${diffMin} 分後截止`, `Ends in ${diffMin} min`);
  return tr(`${Math.floor(diffMin / 60)} 小時 ${diffMin % 60} 分後截止`, `Ends in ${Math.floor(diffMin / 60)} h ${diffMin % 60} min`);
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

const weekdayLabels = () =>
  getLang() === "en" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["日", "一", "二", "三", "四", "五", "六"];

export default function MyBookingsPage() {
  const { toast } = useToast();
  const { user, isLoading: authLoading } = useAuth();
  const uid = user?.id ?? null;
  const imageOf = useItemImages();
  const [locks, setLocks] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState<Record<string, boolean>>({});
  const [zoomedLock, setZoomedLock] = useState<Lock | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState<Record<string, boolean>>({});
  const [feedbackDraft, setFeedbackDraft] = useState<Record<string, string>>({});
  const [ratingDraft, setRatingDraft] = useState<Record<string, number>>({});
  const [publicComment, setPublicComment] = useState<Record<string, boolean>>({});
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Lock | null>(null);
  // ?tab=market｜charity（通知、首頁連結帶進來）；讀完就清掉，之後重新整理停在使用者點的分頁
  const [pageTab, setPageTab] = useState<"meals" | "market" | "charity">(() => {
    const m = /tab=(market|charity)/.exec(`${window.location.search}${window.location.hash}`);
    if (window.location.search) history.replaceState(history.state, "", window.location.pathname + window.location.hash);
    return (m?.[1] as "market" | "charity" | undefined) ?? "meals";
  });
  function switchTab(tab: "meals" | "market" | "charity") {
    setPageTab(tab);
  }
  // 多數人期待「我的訂單」先看到清單，不是先找日期；月曆改成次要、可切換的檢視
  const [view, setView] = useState<"list" | "calendar">("list");
  const confirm = useConfirm();

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

  // 哪些已取餐的鎖定已經評過分（reviews 的 doc id＝lock id），documentId in 一次最多 30 筆
  const reviewableIds = useMemo(
    () => locks.filter((l) => REVIEW_ELIGIBLE.has(l.status)).map((l) => l.id).sort().join(","),
    [locks]
  );
  useEffect(() => {
    const ids = reviewableIds ? reviewableIds.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const found = new Set<string>();
      for (let i = 0; i < ids.length; i += 30) {
        const snap = await getDocs(query(collection(db, "reviews"), where(documentId(), "in", ids.slice(i, i + 30))));
        snap.docs.forEach((d) => found.add(d.id));
      }
      if (!cancelled) setReviewedIds(found);
    })().catch((err) => console.error("讀取評分紀錄失敗", err));
    return () => {
      cancelled = true;
    };
  }, [reviewableIds]);

  // 轉賣逾時倒數是前端算的，固定重算才會即時更新顯示。
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // 列表預設排序：還能操作的（鎖定中／轉讓中／贈送中）依取餐日由近到遠排最前面；
  // 已經結束的（取餐完成／取消／愛心餐等）依取餐日由新到舊排在後面。
  const sortedLocks = useMemo(() => {
    const active = locks
      .filter((l) => ACTIVE_STATUSES.has(l.status))
      .sort((a, b) => a.pickup_date.localeCompare(b.pickup_date) || a.pickup_window.localeCompare(b.pickup_window));
    const past = locks
      .filter((l) => !ACTIVE_STATUSES.has(l.status))
      .sort((a, b) => b.pickup_date.localeCompare(a.pickup_date) || b.pickup_window.localeCompare(a.pickup_window));
    return [...active, ...past];
  }, [locks]);

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
      toast({ title: tr("已轉為贈送模式", "Ready to gift"), description: tr("把下面出現的連結私下傳給朋友即可。", "Send the link below to your friend.") });
    } catch (err) {
      toast({ title: tr("贈送失敗", "Couldn't gift it"), description: (err as Error).message, variant: "destructive" });
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
      toast({ title: tr("已上架轉讓市集", "Listed on the transfer market") });
    } catch (err) {
      toast({ title: tr("上架失敗", "Couldn't list it"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancelTransfer(lock: Lock) {
    setBusyId(lock.id);
    try {
      await updateDoc(doc(db, "locks", lock.id), { status: "locked" });
      toast({ title: lock.status === "for_gift" ? tr("已取消贈送", "Gift cancelled") : tr("已取消轉讓", "Transfer cancelled") });
    } catch (err) {
      toast({ title: tr("取消失敗", "Couldn't cancel"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  // 心得（consumer_feedback，只給商家校準用）跟星等（reviews，公開）一起送；
  // 勾選「公開心得」才會把心得文字一起寫進 reviews。
  async function handleSubmitFeedback(lock: Lock) {
    const text = (feedbackDraft[lock.id] || "").trim();
    const rating = ratingDraft[lock.id];
    const canReview = REVIEW_ELIGIBLE.has(lock.status) && !reviewedIds.has(lock.id);
    if (!text && !(canReview && rating)) return;
    setBusyId(lock.id);
    try {
      if (text && !lock.consumer_feedback) {
        await updateDoc(doc(db, "locks", lock.id), { consumer_feedback: text });
      }
      if (canReview && rating) {
        await setDoc(doc(db, "reviews", lock.id), {
          vendor_id: lock.vendor_id,
          meal_plan_id: lock.meal_plan_id ?? null,
          item_name: lock.item_name,
          rating,
          comment: publicComment[lock.id] && !lock.consumer_feedback ? text.slice(0, 280) : "",
          reviewer_label: user?.department ? `${user.department} 同學`.slice(0, 30) : "BunnBaa 同學",
          created_at: serverTimestamp(),
        });
        setReviewedIds((prev) => new Set(prev).add(lock.id));
        queryClient.invalidateQueries({ queryKey: ["reviews"] });
      }
      setFeedbackOpen((prev) => ({ ...prev, [lock.id]: false }));
    } catch (err) {
      toast({ title: tr("送出回饋失敗", "Couldn't send feedback"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  function giftLinkFor(lockId: string): string {
    return `${window.location.origin}${window.location.pathname}#/gift/${lockId}`;
  }

  function proxyLinkFor(lock: Lock): string {
    return `${window.location.origin}${window.location.pathname}#/pickup/${lock.id}/${lock.share_token ?? ""}`;
  }

  async function callLock(lock: Lock, name: "cancelLock" | "donateLock", done: string) {
    setBusyId(lock.id);
    try {
      await httpsCallable(functions, name)({ lock_id: lock.id });
      toast({ title: done });
    } catch (err) {
      toast({ title: tr("操作失敗", "Something went wrong"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(lock: Lock) {
    const ok = await confirm({
      title: tr("取消這份並退款？", "Cancel and refund this meal?"),
      description: tr(`將退回 NT$${lock.locked_price}（原付款方式）${lock.coupon_id ? "，折價券退回並保留原到期日" : ""}。`, `NT$${lock.locked_price} will be refunded${lock.coupon_id ? " and your coupon returned" : ""}.`),
      confirmLabel: tr("取消並退款", "Cancel & refund"),
      destructive: true,
    });
    if (ok) await callLock(lock, "cancelLock", tr("已取消，退款處理中", "Cancelled — refund on its way"));
  }

  async function handleDonate(lock: Lock) {
    const ok = await confirm({
      title: tr("捐為愛心餐？", "Donate as a charity meal?"),
      description: tr("這份便當會立即開放給需要的人領取，不退款，照常發放抽獎券，並計入你的愛心紀錄。", "It'll be open for someone in need right away. No refund; reward tickets are still issued."),
      confirmLabel: tr("捐出", "Donate"),
    });
    if (ok) await callLock(lock, "donateLock", tr("謝謝你的愛心", "Thank you for your kindness"));
  }

  async function copyLink(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: tr("已複製連結", "Link copied") });
    } catch {
      toast({ title: tr("複製失敗，請手動選取連結", "Couldn't copy — please select the link manually"), variant: "destructive" });
    }
  }

  function renderLockCard(lock: Lock) {
    const statusInfo = statusStyle(lock.status);
    const isBusy = busyId === lock.id;
    const deadline = lock.status === "for_resale" ? pickupWindowEnd(lock.pickup_date, lock.pickup_window) : null;
    const canFeedback = FEEDBACK_ELIGIBLE.has(lock.status);
    const hasFeedback = !!lock.consumer_feedback;
    const canReview = REVIEW_ELIGIBLE.has(lock.status) && !reviewedIds.has(lock.id);

    return (
      <article key={lock.id} className="bg-card border border-ink rounded-[1.75rem] p-5 flex flex-col gap-2.5 max-w-md overflow-hidden">
                      {imageOf(lock) && (
                        <img src={imageOf(lock)} alt="" loading="lazy" className="-mx-5 -mt-5 mb-2 aspect-[16/9] w-[calc(100%+2.5rem)] max-w-none object-cover border-b border-ink" />
                      )}
                      <Badge variant="muted" className={`self-start ${statusInfo.className}`}>
                        {statusInfo.label}
                      </Badge>
                      <h3 className="text-h3 leading-snug">{loc(lock, "item_name")}</h3>
                      <p className="text-body-sm text-muted-foreground">
                        {formatDateLabel(lock.pickup_date)}・{lock.pickup_window} {tr("取餐", "pickup")}・${lock.locked_price}
                        {lock.pickup_code && <span>・{tr("取餐號", "Code")} <strong className="text-foreground">{lock.pickup_code}</strong></span>}
                      </p>
                      {(lock.slots?.length ?? 0) > 0 && (
                        <ul className="text-caption text-muted-foreground space-y-0.5">
                          {lock.main_dish && <li>• {tr("主菜：", "Main: ")}{lock.main_dish}</li>}
                          {lock.slots!.map((slot, i) => <li key={i}>• {slotText(slot)}</li>)}
                          {extraSideText(lock.extra_side) && <li>• {extraSideText(lock.extra_side)}</li>}
                          {riceLabel(lock.rice) && <li>• {riceLabel(lock.rice)}</li>}
                        </ul>
                      )}
                      {(lock.coupon_discount ?? 0) > 0 && (
                        <p className="text-caption text-green-700">{tr(`已用折價券折抵 ${lock.coupon_discount} 元`, `Coupon: −NT$${lock.coupon_discount}`)}</p>
                      )}
                      {lock.status === "charity" && (
                        <p className="text-caption text-pink-700">
                          {lock.charity_source === "donated"
                            ? tr("謝謝你的愛心，這份已開放給需要的人領取。", "Thank you — it's open for someone in need.")
                            : tr("這份沒有領到，已轉為愛心餐。抽獎券照常發放；下次來不了可以先按「捐為愛心餐」。", "Not picked up, so it became a charity meal. Tickets were still issued.")}
                        </p>
                      )}

                      {["locked", "for_resale", "for_gift"].includes(lock.status) && (() => {
                        const beforeCutoff = !isPastCutoff(lock.pickup_date);
                        const isPayer = (lock.payer_uid ?? lock.buyer_uid) === uid;
                        const pickupDay = lock.pickup_date === todayStr();
                        const windowOpen = (pickupWindowEnd(lock.pickup_date, lock.pickup_window)?.getTime() ?? 0) > now;
                        return (
                          <div className="flex flex-col gap-2 pt-1">
                            {beforeCutoff ? (
                              <p className="text-caption text-muted-foreground">{tr("取餐前一天截單前可免費取消，或修改取餐時段、主菜、配菜、飯量。", "Until the cutoff the day before you can cancel for free, or change the pickup time, main, sides or rice.")}</p>
                            ) : (
                              <p className="text-caption text-muted-foreground">{tr("已截單，不能退款；可以轉讓、贈送或捐為愛心餐。", "Past cutoff — no refunds, but you can transfer, gift or donate it.")}</p>
                            )}
                            {lock.status === "locked" && beforeCutoff && (
                              <div className="flex gap-2">
                                <Button variant="outline" size="sm" className="flex-1" disabled={isBusy} onClick={() => setEditing(lock)}>
                                  <Pencil /> {lock.plan_id ? tr("改時段", "Change time") : tr("修改", "Change")}
                                </Button>
                                {isPayer && (
                                  <Button variant="outline" size="sm" className="flex-1 border-red-300 text-red-600 hover:bg-red-50" disabled={isBusy} onClick={() => handleCancel(lock)}>
                                    <XCircle /> {tr("取消退款", "Cancel")}
                                  </Button>
                                )}
                              </div>
                            )}
                            {lock.status !== "for_gift" && (qrOpen[lock.id] ? (
                              <div>
                                <PickupQr lockId={lock.id} size={140} />
                                <div className="flex justify-center gap-2">
                                  <Button variant="link" size="sm" onClick={() => setZoomedLock(lock)}><Maximize2 /> {tr("放大", "Enlarge")}</Button>
                                  <Button variant="link" size="sm" onClick={() => setQrOpen((prev) => ({ ...prev, [lock.id]: false }))}>{tr("收起", "Hide")}</Button>
                                </div>
                              </div>
                            ) : (
                              <Button size="sm" onClick={() => setQrOpen((prev) => ({ ...prev, [lock.id]: true }))}>
                                <QrCode /> {tr("使用（顯示取餐碼）", "Use (show pickup code)")}
                              </Button>
                            ))}
                            {lock.share_token && lock.status === "locked" && (
                              <Button variant="outline" size="sm" onClick={() => copyLink(proxyLinkFor(lock))}>
                                <Users /> {tr("複製代領連結", "Copy proxy pickup link")}
                              </Button>
                            )}
                            {pickupDay && windowOpen && lock.status !== "for_gift" && (
                              <Button variant="outline" size="sm" className="border-pink-300 text-pink-700 hover:bg-pink-50" disabled={isBusy} onClick={() => handleDonate(lock)}>
                                <HeartHandshake /> {tr("來不了？捐為愛心餐", "Can't make it? Donate it")}
                              </Button>
                            )}
                          </div>
                        );
                      })()}

                      {lock.status === "locked" && (
                        <div className="flex flex-col gap-2 pt-1">
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="flex-1" disabled={isBusy} onClick={() => handleGift(lock)}>
                              <Gift /> {tr("贈送", "Gift")}
                            </Button>
                            <Button variant="outline" size="sm" className="flex-1" disabled={isBusy} onClick={() => handleResell(lock)}>
                              <Repeat /> {tr("轉讓", "Transfer")}
                            </Button>
                          </div>
                        </div>
                      )}

                      {lock.status === "for_gift" && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <p className="text-caption text-muted-foreground">{tr("把這組連結私下傳給朋友，對方打開就能收下：", "Send this link to a friend — they can accept it by opening it:")}</p>
                          <div className="flex items-center gap-1.5">
                            <Input readOnly value={giftLinkFor(lock.id)} aria-label={tr("贈送連結", "Gift link")} className="flex-1 truncate" />
                            <Button variant="outline" size="icon" className="shrink-0" aria-label={tr("複製連結", "Copy link")} onClick={() => copyLink(giftLinkFor(lock.id))}>
                              <Copy />
                            </Button>
                          </div>
                          <Button variant="outline" size="sm" className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-600" disabled={isBusy} onClick={() => handleCancelTransfer(lock)}>
                            {tr("取消贈送", "Cancel gift")}
                          </Button>
                        </div>
                      )}

                      {lock.status === "for_resale" && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <p className="text-caption text-muted-foreground">
                            {deadline ? formatCountdown(deadline, now) : tr("等待有人接手", "Waiting for someone to take it")}{tr("・已上架到轉讓市集", " · listed on the transfer market")}
                          </p>
                          <Button variant="outline" size="sm" className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-600" disabled={isBusy} onClick={() => handleCancelTransfer(lock)}>
                            {tr("取消轉讓", "Cancel transfer")}
                          </Button>
                        </div>
                      )}

                      {canFeedback && (
                        <>
                          {hasFeedback && (
                            <p className="text-caption text-muted-foreground pt-1">{tr("已回饋：", "Your feedback: ")}「{lock.consumer_feedback}」</p>
                          )}
                          {reviewedIds.has(lock.id) && (
                            <p className="text-caption text-muted-foreground">{tr("已評分，謝謝！", "Thanks for rating!")}</p>
                          )}
                          {(!hasFeedback || canReview) && (
                            feedbackOpen[lock.id] ? (
                              <div className="flex flex-col gap-1.5 pt-1">
                                {canReview && (
                                  <div className="flex items-center gap-1" role="radiogroup" aria-label={tr("評分", "Rating")}>
                                    {[1, 2, 3, 4, 5].map((n) => (
                                      <button
                                        key={n}
                                        type="button"
                                        role="radio"
                                        aria-checked={ratingDraft[lock.id] === n}
                                        aria-label={tr(`${n} 星`, `${n} star${n > 1 ? "s" : ""}`)}
                                        onClick={() => setRatingDraft((prev) => ({ ...prev, [lock.id]: n }))}
                                        className="p-0.5 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      >
                                        <Star className={`w-5 h-5 ${n <= (ratingDraft[lock.id] ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                                      </button>
                                    ))}
                                  </div>
                                )}
                                {!hasFeedback && (
                                  <Input
                                    value={feedbackDraft[lock.id] || ""}
                                    onChange={(e) => setFeedbackDraft((prev) => ({ ...prev, [lock.id]: e.target.value }))}
                                    placeholder={tr("這餐的心得…（送出後無法修改）", "How was it? (can't be edited later)")}
                                    aria-label={tr("用餐回饋", "Meal feedback")}
                                    maxLength={280}
                                  />
                                )}
                                {canReview && !hasFeedback && (
                                  <label className="flex items-center gap-1.5 text-caption text-muted-foreground">
                                    <input
                                      type="checkbox"
                                      checked={!!publicComment[lock.id]}
                                      onChange={(e) => setPublicComment((prev) => ({ ...prev, [lock.id]: e.target.checked }))}
                                    />
                                    {tr("心得也公開顯示在評價區（只顯示系所，不顯示姓名）", "Also show my comment publicly in reviews (department only, no name)")}
                                  </label>
                                )}
                                <Button
                                  size="sm"
                                  disabled={isBusy || !((feedbackDraft[lock.id] || "").trim() || (canReview && ratingDraft[lock.id]))}
                                  onClick={() => handleSubmitFeedback(lock)}
                                >
                                  {tr("送出", "Submit")}
                                </Button>
                              </div>
                            ) : (
                              <Button variant="outline" size="sm" onClick={() => setFeedbackOpen((prev) => ({ ...prev, [lock.id]: true }))}>
                                {canReview ? (hasFeedback ? tr("給這餐評分", "Rate this meal") : tr("評分／留下回饋", "Rate / leave feedback")) : tr("留下回饋", "Leave feedback")}
                              </Button>
                            )
                          )}
                        </>
                      )}
      </article>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader active="bookings" />

      <PageHero eyebrow={tr("我的預約", "Your bookings")} title={tr("我的餐點", "My meals")} description={tr("查看訂單詳情、出示取餐碼、截單前修改或取消，或轉讓／贈送／捐為愛心餐。", "See order details, show your pickup code, change or cancel before cutoff, or transfer / gift / donate a meal.")} />

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-8 space-y-6">
        {/* 頁上方分頁：我的餐點｜轉讓市集｜附近愛心餐（§4.5：「轉讓・愛心餐」併入我的餐點） */}
        <div className="flex gap-2 flex-wrap" role="tablist" aria-label={tr("我的餐點分頁", "My meals tabs")}>
          <Tag selected={pageTab === "meals"} onClick={() => switchTab("meals")}>{tr("我的餐點", "My meals")}</Tag>
          <Tag selected={pageTab === "market"} onClick={() => switchTab("market")}>{tr("轉讓市集", "Transfer market")}</Tag>
          <Tag selected={pageTab === "charity"} onClick={() => switchTab("charity")}>{tr("附近愛心餐", "Charity meals nearby")}</Tag>
        </div>

        {pageTab === "market" ? (
          <TransferMarketPage embedded />
        ) : pageTab === "charity" ? (
          <CharityMealsSection />
        ) : !authLoading && !uid ? (
          <EmptyState
            icon={<ClipboardList size={32} />}
            title={tr("請先登入", "Please sign in")}
            description={tr("登入後就能看到你預購的餐點。", "Sign in to see the meals you've pre-ordered.")}
            action={<Button asChild><Link href="/login">{tr("前往登入", "Sign in")}</Link></Button>}
          />
        ) : loading ? (
          <SkeletonBlocks count={3} height={160} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" />
        ) : locks.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={32} />}
            title={tr("還沒有預約紀錄", "No bookings yet")}
            description={tr("到「預購餐點」鎖一份餐點，隔天就不用排隊。", "Lock in a meal under Pre-order and skip tomorrow's queue.")}
            action={<Button asChild><Link href="/home">{tr("去預約餐點", "Pre-order a meal")}</Link></Button>}
          />
        ) : (
          <>
            {/* 檢視切換：預設列表（多數人找訂單想看清單，不是先想「我哪天訂的」）；
                月曆當作次要、找特定日期時才需要的檢視方式。 */}
            <div className="inline-flex rounded-full border border-ink p-1 bg-card">
              <button
                type="button"
                onClick={() => setView("list")}
                className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="w-4 h-4" aria-hidden="true" /> {tr("列表", "List")}
              </button>
              <button
                type="button"
                onClick={() => setView("calendar")}
                className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  view === "calendar" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <CalendarRange className="w-4 h-4" aria-hidden="true" /> {tr("月曆", "Calendar")}
              </button>
            </div>

            {view === "list" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sortedLocks.map((lock) => renderLockCard(lock))}
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <div className="grid grid-cols-7 gap-1.5 text-center text-xs font-bold tracking-[0.12em] uppercase text-muted-foreground pb-2">
                    {weekdayLabels().map((label) => (
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
                            className={`min-h-[104px] rounded-2xl border p-2 flex flex-col gap-1 ${
                              isToday ? "border-ink bg-secondary/60" : "border-border bg-card"
                            }`}
                          >
                            <span className={`font-heading text-sm font-semibold ${isToday ? "text-foreground" : "text-muted-foreground"}`}>{day.getDate()}{isToday && <span className="sr-only">{tr("（今天）", " (today)")}</span>}</span>
                            {dayLocks.map((lock) => {
                              const statusInfo = statusStyle(lock.status);
                              return (
                                <button
                                  key={lock.id}
                                  onClick={() => setExpandedId((prev) => (prev === lock.id ? null : lock.id))}
                                  aria-expanded={expandedId === lock.id}
                                  className={`text-left text-micro leading-tight rounded-sm px-1.5 py-1 truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${statusInfo.className} ${
                                    expandedId === lock.id ? "ring-2 ring-primary" : ""
                                  }`}
                                  title={loc(lock, "item_name")}
                                >
                                  {loc(lock, "item_name")}
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
          </>
        )}
      </div>

      <Dialog open={!!zoomedLock} onOpenChange={(open) => !open && setZoomedLock(null)}>
        <DialogContent className="max-w-xs flex flex-col items-center gap-3 py-8">
          <DialogTitle className="text-center">{tr("取餐核銷碼", "Pickup code")}</DialogTitle>
          {zoomedLock && (
            <>
              <PickupQr lockId={zoomedLock.id} size={260} />
            </>
          )}
        </DialogContent>
      </Dialog>
      <EditWishesDialog lock={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

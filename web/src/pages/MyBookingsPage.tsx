import { useEffect, useMemo, useState } from "react";
import { formatNT, formatPickupDate } from "@/lib/format";
import { rememberReturnPath } from "@/lib/returnPath";
import { collection, deleteField, doc, documentId, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from "firebase/firestore";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import PickupQr from "@/components/PickupQr";
import EditWishesDialog from "@/components/EditWishesDialog";
import { useConfirm } from "@/components/ConfirmDialog";
import { customOptionTexts, extraSideText, riceLabel, slotText } from "@/lib/bento";
import { isPastCutoff, MEAL_PERIODS, mealPeriodLabel, mealPeriodOf, todayStr } from "@/lib/pickupSlots";
import { defaultResalePrice, refundOnTakeover, resaleCap, resalePrice } from "@/lib/transfers";
import { cancelCouponAmount, cancelDeadlineAt } from "@/lib/pricing";
import { usePlatformConfig } from "@/lib/platformConfig";
import type { Lock, MealPeriod } from "@/types";
import { EmptyState, Tabs, Tag } from "@/components/ds";
import TransferMarketPage from "@/pages/TransferMarketPage";
import CharityMealsSection from "@/components/CharityMealsSection";
import FreeTransfersSection from "@/components/FreeTransfersSection";
import ProxyPickupPanel, { formatProxyCode } from "@/components/ProxyPickupPanel";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { Link } from "wouter";
import { lockStatus } from "@/lib/lockOutcome";
import { policy } from "@/lib/policy";

// Matches the "My items" screen in the UI mockup MyBookings.dc.html (renamed "My meals" on 2026-09-21, shown only
// to regular users; on the vendor side this nav tab becomes the receiving-side pickup check, see MarketplaceHeader.tsx).
//
// 2026-09-22: wired to real Firestore (the previous audit found the whole page was hard-coded mock data, a bigger
// job than expected; done this time):
//   - Query real locks by buyer_uid (single equality, no orderBy, to avoid needing a new composite
//     index, same convention as MyLocksPage/TransferMarketPage), grouped live by pickup_date /
//     pickup_window. Real data has no fixed row count, so it's a "one block per day" list,
//     not the fixed 7×3 weekly calendar grid of the old mock data
//   - "Use": only shows the QR / pickup number (actual redemption is the vendor-side markLockOutcome; diners
//     can't press "Complete redemption" themselves; the old mock confirmUse was fake)
//   - "Gift": there's no "recipient" field; the real mechanism turns the lock into for_gift and the link is
//     sent privately to a friend, same as handleGift() in ConsumerLockPage.tsx
//   - "Trade": turns it into for_resale + resale_deadline, same as handleResell(); once listed it
//     appears on /marketplace. No price input field: the resale price is agreed privately and the platform
//     isn't involved (same design as TransferMarketPage.tsx)
//   - "Leave feedback": reuses the existing Lock.consumer_feedback field, one-shot, same as
//     handleSubmitFeedback()
//   - "Cancel resale / cancel gift": after the firestore.rules change on 2026-09-22 these can turn
//     for_resale/for_gift back into locked, same as "My resales" in TransferMarketPage
//   - "Meal plan" (multi-day subscription plans) has no real data model at all (Firestore has no plan
//     collection); no mock data is added this time, only real single-order records are shown

// Status text and colors: shared site-wide via lib/lockOutcome.ts (unified 2026-10-09)
const statusStyle = (status: string) => lockStatus(status);

const ACTIVE_STATUSES = new Set(["locked", "for_resale", "for_gift"]);
const FEEDBACK_ELIGIBLE = new Set(["fulfilled", "resold_and_fulfilled", "no_show", "charity"]);
// Only meals actually picked up can be rated (reviews, public); no_show can only leave private feedback for vendor calibration
const REVIEW_ELIGIBLE = new Set(["fulfilled", "resold_and_fulfilled"]);

const formatDateLabel = (dateStr: string) => formatPickupDate(dateStr); // Same date format site-wide (lib/format.ts)
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

// Calendar cells are narrow: meal period as one letter (B/L/D), with a color bar on the left; parentheses show the pickup start time
const PERIOD_SHORT: Record<MealPeriod, () => string> = {
  breakfast: () => tr("早", "B"),
  lunch: () => tr("午", "L"),
  dinner: () => tr("晚", "D"),
};
const PERIOD_BORDER: Record<MealPeriod, string> = {
  breakfast: "border-l-amber-400",
  lunch: "border-l-orange-600",
  dinner: "border-l-indigo-500",
};
const windowStart = (window: string) => window.split(/[-–]/)[0].trim();
const periodOfLock = (lock: Lock): MealPeriod => lock.meal_period ?? mealPeriodOf(lock.pickup_window);

const weekdayLabels = () =>
  getLang() === "en" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["日", "一", "二", "三", "四", "五", "六"];

type PageTab = "meals" | "market" | "charity" | "proxy";

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
  const [proxyCodes, setProxyCodes] = useState<Record<string, string>>({});
  // ?tab=market|charity|proxy (passed in from notifications, the home page and proxy pickup links); cleared after reading so a refresh stays on the tab the user clicked.
  // Proxy pickup link /?tab=proxy&code=XXXXXXXX#/my-bookings (hash-route query lives in the real ?search, as wouter does too): prefill the proxy pickup code
  const [proxyInitial] = useState(() => /[?&]code=([A-Za-z0-9-]+)/.exec(`${window.location.search}${window.location.hash}`)?.[1]);
  const [pageTab, setPageTab] = useState<PageTab>(() => {
    const m = /tab=(market|charity|proxy)/.exec(`${window.location.search}${window.location.hash}`);
    return (m?.[1] as PageTab | undefined) ?? "meals";
  });
  // Clear the query in an effect: useState initializers run twice in StrictMode, so clearing there means the second run can't read it
  useEffect(() => {
    if (window.location.search) history.replaceState(history.state, "", window.location.pathname + window.location.hash);
  }, []);
  function switchTab(tab: PageTab) {
    setPageTab(tab);
  }
  // Most people expect "My orders" to open on a list, not a date picker; the calendar is a secondary, switchable view
  const [view, setView] = useState<"list" | "calendar">("list");
  const confirm = useConfirm();
  const { data: config } = usePlatformConfig();
  const cancelHours = config?.cancelHoursBefore ?? 48;
  const cancelRate = config?.cancelCouponRate ?? 0.3;
  const couponDays = config?.couponValidDays ?? 30;
  // Before listing for resale, let the seller enter a resale price (0 to the original price)
  const [reselling, setReselling] = useState<Lock | null>(null);
  const [resaleDraft, setResaleDraft] = useState("");

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

  // Which picked-up locks have already been rated (reviews doc id = lock id); documentId in allows at most 30 per query
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
    })().catch((err) => console.error("Failed to read ratings", err));
    return () => {
      cancelled = true;
    };
  }, [reviewableIds]);

  // The resale timeout countdown is computed client-side, so it must be recomputed regularly to update the display live.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // Default list order: still-actionable items (locked / for resale / for gift) first, by pickup date nearest first;
  // finished items (picked up / cancelled / charity meal, etc.) after them, by pickup date newest first.
  const sortedLocks = useMemo(() => {
    // An order whose pickup day has passed but was never settled is no longer actionable: list it with the finished ones
    const today = todayStr();
    const isActive = (l: Lock) => ACTIVE_STATUSES.has(l.status) && l.pickup_date >= today;
    const active = locks
      .filter(isActive)
      .sort((a, b) => a.pickup_date.localeCompare(b.pickup_date) || a.pickup_window.localeCompare(b.pickup_window));
    const past = locks
      .filter((l) => !isActive(l))
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

  function openResell(lock: Lock) {
    setResaleDraft(String(defaultResalePrice(lock)));
    setReselling(lock);
  }

  async function handleResell(lock: Lock, price: number) {
    setBusyId(lock.id);
    try {
      const deadline = pickupWindowEnd(lock.pickup_date, lock.pickup_window);
      await updateDoc(doc(db, "locks", lock.id), {
        status: "for_resale",
        resale_price: price,
        ...(deadline ? { resale_deadline: Timestamp.fromDate(deadline) } : {}),
      });
      setReselling(null);
      toast({ title: price === 0 ? tr("已放到「附近愛心餐」免費領取", "Listed as a free meal under Charity meals nearby") : tr("已上架轉讓市集", "Listed on the transfer market") });
    } catch (err) {
      toast({ title: tr("上架失敗", "Couldn't list it"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancelTransfer(lock: Lock) {
    setBusyId(lock.id);
    try {
      await updateDoc(doc(db, "locks", lock.id), { status: "locked", ...(lock.resale_price != null ? { resale_price: deleteField() } : {}) });
      toast({ title: lock.status === "for_gift" ? tr("已取消贈送", "Gift cancelled") : tr("已取消轉讓", "Transfer cancelled") });
    } catch (err) {
      toast({ title: tr("取消失敗", "Couldn't cancel"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  // Feedback (consumer_feedback, for vendor calibration only) is sent together with the stars (reviews, public);
  // only when "Make feedback public" is checked is the feedback text also written to reviews.
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

  // Proxy pickup: the server generates (or returns) an 8-character proxy pickup code. The link opens straight on the "Proxy pickup" tab with the code prefilled, no sign-in needed
  function proxyMessageFor(lock: Lock, code: string): string {
    const link = `${window.location.origin}${window.location.pathname}?tab=proxy&code=${code}#/my-bookings`;
    return tr(
      `幫我代領便當：${lock.item_name}（${formatPickupDate(lock.pickup_date)} ${lock.pickup_window}）。打開 ${link} ，或到飯飽「我的餐點 → 代領取餐」輸入代領碼 ${formatProxyCode(code)}，把 QR Code 給店員掃就好。`,
      `Could you pick up my meal? ${lock.item_name_en || lock.item_name} (${formatPickupDate(lock.pickup_date)} ${lock.pickup_window}). Open ${link} or enter proxy code ${formatProxyCode(code)} under My meals → Pick up for a friend on BunnBaa, then show the QR code to the staff.`
    );
  }

  async function showProxyCode(lock: Lock) {
    setBusyId(lock.id);
    try {
      const res = await httpsCallable<{ lock_id: string }, { code: string }>(functions, "getProxyPickupCode")({ lock_id: lock.id });
      setProxyCodes((prev) => ({ ...prev, [lock.id]: res.data.code }));
    } catch (err) {
      toast({ title: tr("代領碼產生失敗", "Couldn't create a proxy code"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function callLock(lock: Lock, name: "cancelLock" | "donateLock", done: string) {
    setBusyId(lock.id);
    try {
      const res = await httpsCallable<{ lock_id: string }, { coupon?: { discount: number } | null }>(functions, name)({ lock_id: lock.id });
      const coupon = name === "cancelLock" ? res.data?.coupon : null;
      toast({
        title: done,
        ...(coupon ? { description: tr(`已發一張折 ${coupon.discount} 元的折價券，${couponDays} 天內有效，可在「成長獎勵」查看。`, `A NT$${coupon.discount} coupon was issued, valid for ${couponDays} days.`) } : {}),
      });
    } catch (err) {
      toast({ title: tr("操作失敗", "Something went wrong"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(lock: Lock) {
    const coupon = cancelCouponAmount(lock, cancelRate);
    const pct = Math.round(cancelRate * 100);
    const ok = await confirm({
      title: tr("取消這份餐點？", "Cancel this meal?"),
      description: tr(
        `取消不退現金${coupon > 0 ? `，改發一張這家店的折價券：折 ${coupon} 元（原價的 ${pct}%），${couponDays} 天內有效` : ""}。${lock.coupon_id ? "下單時用的折價券會退回並保留原到期日。" : ""}想拿回較多金額可以改用「轉讓」。`,
        `No cash refund${coupon > 0 ? ` — you'll get a NT$${coupon} coupon for this vendor (${pct}% of the list price), valid for ${couponDays} days` : ""}.${lock.coupon_id ? " The coupon you used is returned." : ""} To recover more, transfer it instead.`),
      confirmLabel: coupon > 0 ? tr("取消並換折價券", "Cancel for a coupon") : tr("確定取消", "Cancel meal"),
      // This dialog asks whether to "cancel the meal", so the dismiss button can't also be labeled "Cancel"
      cancelLabel: tr("保留餐點", "Keep the meal"),
      destructive: true,
    });
    if (ok) await callLock(lock, "cancelLock", tr("已取消", "Cancelled"));
  }

  async function handleDonate(lock: Lock) {
    const ok = await confirm({
      title: tr("捐為愛心餐？", "Donate as a charity meal?"),
      description: tr("這份便當會立即開放給需要的人領取，不退款，照常發放抽獎券，並計入你的愛心紀錄。", "It'll be open for someone in need right away. No refund; draw tickets are still issued, and it counts toward your giving record."),
      confirmLabel: tr("捐出", "Donate"),
    });
    if (ok) await callLock(lock, "donateLock", tr("謝謝你的愛心", "Thank you for your kindness"));
  }

  async function copyLink(text: string) {
    await copyText(text, tr("已複製連結", "Link copied"));
  }

  async function copyText(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: done });
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
      <article key={lock.id} className="bg-card border border-ink rounded-card p-5 flex flex-col gap-2.5 max-w-md overflow-hidden">
                      {imageOf(lock) && (
                        <img src={imageOf(lock)} alt="" loading="lazy" className="-mx-5 -mt-5 mb-2 aspect-[16/9] w-[calc(100%+2.5rem)] max-w-none object-cover border-b border-ink" />
                      )}
                      <Badge variant="muted" className={`self-start ${statusInfo.className}`}>
                        {statusInfo.label}
                      </Badge>
                      <h3 className="text-h3 leading-snug">{loc(lock, "item_name")}</h3>
                      <p className="text-body-sm text-muted-foreground">
                        {formatDateLabel(lock.pickup_date)}{tr("・", " · ")}{mealPeriodLabel(periodOfLock(lock))}{tr(`（${lock.pickup_window}）取餐`, ` (${lock.pickup_window}) pickup`)}{tr("・", " · ")}{formatNT(lock.locked_price)}
                        {lock.pickup_code && <span>・{tr("取餐號", "Pickup no.")} <strong className="text-foreground">{lock.pickup_code}</strong></span>}
                      </p>
                      {(lock.slots?.length ?? 0) > 0 && (
                        <ul className="text-caption text-muted-foreground space-y-0.5">
                          {lock.main_dish && <li>• {tr("主菜：", "Main: ")}{lock.main_dish}</li>}
                          {lock.slots!.map((slot, i) => <li key={i}>• {slotText(slot)}</li>)}
                          {extraSideText(lock.extra_side) && <li>• {extraSideText(lock.extra_side)}</li>}
                          {customOptionTexts(lock.custom_options).map((text, i) => <li key={`c${i}`}>• {text}</li>)}
                          {riceLabel(lock.rice) && <li>• {riceLabel(lock.rice)}</li>}
                        </ul>
                      )}
                      {(lock.coupon_discount ?? 0) > 0 && (
                        <p className="text-caption text-success-text">{tr(`已用折價券折抵 ${lock.coupon_discount} 元`, `Coupon: −NT$${lock.coupon_discount}`)}</p>
                      )}
                      {lock.status === "cancelled" && ((lock.refund_coupon_amount ?? 0) > 0 || (lock.refunded_amount ?? 0) > 0) && (
                        <p className="text-caption text-muted-foreground">
                          {(lock.refund_coupon_amount ?? 0) > 0
                            ? tr(`已發一張折 ${lock.refund_coupon_amount} 元的折價券，可在「成長獎勵」查看。`, `A NT$${lock.refund_coupon_amount} coupon was issued — see it under Rewards.`)
                            : lock.refunded_as === "points"
                              ? <>{tr(`已全額退成 ${lock.refunded_amount} 點平台點數，`, `${lock.refunded_amount} points were refunded to your balance — `)}<Link href="/profile?tab=points" className="underline underline-offset-2">{tr("查看點數", "see your points")}</Link></>
                              : tr(`已退款 NT$${lock.refunded_amount}（原付款方式）。`, `NT$${lock.refunded_amount} refunded to your original payment.`)}
                        </p>
                      )}
                      {lock.status === "charity" && (
                        <p className="text-caption text-charity">
                          {lock.charity_source === "donated"
                            ? tr("謝謝你的愛心，這份已開放給需要的人領取。", "Thank you — it's open for someone in need.")
                            : tr("這份沒有領到，已轉為愛心餐。抽獎券照常發放；下次來不了可以先按「捐為愛心餐」。", "Not picked up, so it became a charity meal. Draw tickets were still issued — next time, tap Donate before the window ends.")}
                        </p>
                      )}

                      {["locked", "for_resale", "for_gift"].includes(lock.status) && (() => {
                        const beforeCutoff = !isPastCutoff(lock.pickup_date);
                        const canCancel = now <= cancelDeadlineAt(lock.pickup_date, lock.pickup_window, cancelHours).getTime();
                        const pct = Math.round(cancelRate * 100);
                        const isPayer = (lock.payer_uid ?? lock.buyer_uid) === uid;
                        const pickupDay = lock.pickup_date === todayStr();
                        const windowOpen = (pickupWindowEnd(lock.pickup_date, lock.pickup_window)?.getTime() ?? 0) > now;
                        return (
                          <div className="flex flex-col gap-2 pt-1">
                            {beforeCutoff ? (
                              <p className="text-caption text-muted-foreground">
                                {tr("取餐前一天截單前可修改取餐時段、主菜、配菜、飯量。", "Until the cutoff the day before you can change the pickup time, main, sides or rice.")}
                                {canCancel
                                  ? tr(`取餐 ${cancelHours} 小時前可取消，換成原價 ${pct}% 的折價券。`, ` Up to ${cancelHours} hours before pickup you can cancel for a coupon worth ${pct}% of the list price.`)
                                  : tr(`已進入取餐前 ${cancelHours} 小時，不能取消；可以轉讓、贈送或捐為愛心餐。`, ` It's within ${cancelHours} hours of pickup, so it can't be cancelled — transfer, gift or donate it instead.`)}
                              </p>
                            ) : (
                              <p className="text-caption text-muted-foreground">{tr("已截單，不能取消或修改；可以轉讓、贈送或捐為愛心餐。", "Past cutoff — no changes or cancellation, but you can transfer, gift or donate it.")}</p>
                            )}
                            {lock.status === "locked" && beforeCutoff && (
                              <div className="flex gap-2">
                                <Button variant="outline" size="sm" className="flex-1" disabled={isBusy} onClick={() => setEditing(lock)}>
                                  <Pencil /> {lock.plan_id ? tr("改時段", "Change time") : tr("修改", "Change")}
                                </Button>
                                {isPayer && canCancel && (
                                  <Button variant="outline" size="sm" className="flex-1 border-danger/40 text-danger-text hover:bg-danger-soft" disabled={isBusy} onClick={() => handleCancel(lock)}>
                                    <XCircle /> {tr("取消換券", "Cancel for a coupon")}
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
                            {lock.status === "locked" && (proxyCodes[lock.id] ? (
                              <div className="rounded-xl border border-border bg-secondary/40 p-3 space-y-2">
                                <p className="text-caption text-muted-foreground">{tr("把代領碼告訴朋友，請他到「我的餐點 → 代領取餐」輸入（不用登入）：", "Give your friend this code — they enter it under My meals → Pick up for a friend (no sign-in needed):")}</p>
                                <p className="font-mono text-2xl font-bold tracking-[0.2em] text-center select-all">{formatProxyCode(proxyCodes[lock.id])}</p>
                                <div className="flex gap-2">
                                  <Button variant="outline" size="sm" className="flex-1" onClick={() => copyText(proxyMessageFor(lock, proxyCodes[lock.id]), tr("已複製代領訊息", "Message copied"))}>
                                    <Copy /> {tr("複製訊息傳給朋友", "Copy message")}
                                  </Button>
                                  <Button variant="link" size="sm" onClick={() => setProxyCodes(({ [lock.id]: _, ...rest }) => rest)}>{tr("收起", "Hide")}</Button>
                                </div>
                              </div>
                            ) : (
                              <Button variant="outline" size="sm" disabled={isBusy} onClick={() => showProxyCode(lock)}>
                                <Users /> {tr("請朋友代領", "Ask a friend to pick up")}
                              </Button>
                            ))}
                            {pickupDay && windowOpen && lock.status !== "for_gift" && (
                              <Button variant="outline" size="sm" className="border-charity/40 text-charity hover:bg-charity-soft" disabled={isBusy} onClick={() => handleDonate(lock)}>
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
                            <Button variant="outline" size="sm" className="flex-1" disabled={isBusy} onClick={() => openResell(lock)}>
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
                          <Button variant="outline" size="sm" className="border-danger/40 text-danger-text hover:bg-danger-soft hover:text-danger-text" disabled={isBusy} onClick={() => handleCancelTransfer(lock)}>
                            {tr("取消贈送", "Cancel gift")}
                          </Button>
                        </div>
                      )}

                      {lock.status === "for_resale" && (
                        <div className="flex flex-col gap-1.5 pt-1">
                          <p className="text-caption text-muted-foreground">
                            {deadline ? formatCountdown(deadline, now) : tr("等待有人接手", "Waiting for someone to take it")}{resalePrice(lock) === 0 ? tr("・已放到「附近愛心餐」免費領取", " · free under Charity meals nearby") : tr("・已上架到轉讓市集", " · listed on the transfer market")}
                          </p>
                          <p className="text-caption text-muted-foreground">
                            {(lock.payer_uid ?? lock.buyer_uid) === lock.buyer_uid && refundOnTakeover(lock) > 0
                              ? tr(`轉讓價 NT$${resalePrice(lock)}；有人付款接手後，會退 ${refundOnTakeover(lock)} 點平台點數給你（可折抵或退回 LINE Pay）。逾時沒人接手會移到「附近愛心餐」開放免費領取、不退款。`,
                                `Listed at NT$${resalePrice(lock)}. Once someone pays, ${refundOnTakeover(lock)} points come back to you (use them or send them back to LINE Pay). If nobody takes it in time it becomes free to claim, with no refund.`)
                              : tr(`轉讓價 NT$${resalePrice(lock)}。`, `Listed at NT$${resalePrice(lock)}.`)}
                          </p>
                          <Button variant="outline" size="sm" className="border-danger/40 text-danger-text hover:bg-danger-soft hover:text-danger-text" disabled={isBusy} onClick={() => handleCancelTransfer(lock)}>
                            {tr("取消轉讓", "Cancel transfer")}
                          </Button>
                        </div>
                      )}

                      {canFeedback && (
                        <>
                          {hasFeedback && (
                            <p className="text-caption text-muted-foreground pt-1">{tr(`已回饋：「${lock.consumer_feedback}」`, `Your feedback: "${lock.consumer_feedback}"`)}</p>
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
                                        <Star className={`w-5 h-5 ${n <= (ratingDraft[lock.id] ?? 0) ? "fill-warning text-warning" : "text-muted-foreground"}`} />
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

      <PageHero eyebrow={tr("訂單與取餐", "Orders & pickup")} title={tr("我的餐點", "My meals")} description={tr(`查看訂單詳情、出示取餐碼、截單前修改、${policy.cancelShort()}，或轉讓／贈送／請朋友代領／捐為愛心餐。`, `See order details, show your pickup code, change before cutoff, ${policy.cancelShort()}, or transfer / gift / send a friend / donate a meal.`)} />

      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-8 space-y-6">
        {/* Tabs at the top: My meals | Resale market | Nearby charity meals */}
        <div className="overflow-x-auto bb-thin-scroll">
          <Tabs
            aria-label={tr("我的餐點分頁", "My meals tabs")}
            value={pageTab}
            onValueChange={(v) => switchTab(v as PageTab)}
            items={[
              { value: "meals", label: tr("我的餐點", "My meals") },
              { value: "market", label: tr("轉讓市集", "Transfer market") },
              { value: "charity", label: tr("附近愛心餐", "Charity meals nearby") },
              { value: "proxy", label: tr("代領取餐", "Pick up for a friend") },
            ]}
          />
        </div>

        {pageTab === "market" ? (
          <TransferMarketPage onShowFree={() => switchTab("charity")} />
        ) : pageTab === "proxy" ? (
          <ProxyPickupPanel initial={proxyInitial} />
        ) : pageTab === "charity" ? (
          <div className="space-y-8">
            <FreeTransfersSection />
            <CharityMealsSection />
          </div>
        ) : !authLoading && !uid ? (
          <EmptyState
            icon={<ClipboardList size={32} />}
            title={tr("請先登入", "Please sign in")}
            description={tr("登入後就能看到你預購的餐點。", "Sign in to see the meals you've pre-ordered.")}
            action={<Button asChild><Link href="/login" onClick={() => rememberReturnPath()}>{tr("前往登入", "Sign in")}</Link></Button>}
          />
        ) : loading ? (
          <SkeletonBlocks count={3} height={160} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" />
        ) : locks.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={32} />}
            title={tr("還沒有預購紀錄", "No bookings yet")}
            description={tr("到「預購餐點」鎖一份餐點，隔天就不用排隊。", "Lock in a meal under Pre-order and skip tomorrow's queue.")}
            action={<Button asChild><Link href="/home">{tr("去預購餐點", "Pre-order a meal")}</Link></Button>}
          />
        ) : (
          <>
            {/* View toggle: list by default (most people looking for an order want a list, not "which day did I order"); the
                calendar is a secondary view, only needed when looking for a specific date. */}
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
                  <div className="flex flex-wrap gap-3 pb-2 text-xs text-muted-foreground">
                    {MEAL_PERIODS.map((p) => (
                      <span key={p} className="inline-flex items-center gap-1.5">
                        <span className={`h-3 border-l-[3px] ${PERIOD_BORDER[p]}`} aria-hidden="true" />
                        {PERIOD_SHORT[p]()}{tr("＝", " = ")}{mealPeriodLabel(p)}
                      </span>
                    ))}
                    <span>{tr("括號內是取餐時間", "Pickup time in brackets")}</span>
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
                            {/* Split by breakfast / lunch / dinner, each labeled with its pickup time like "L (12:00)" (2026-10-09) */}
                            {MEAL_PERIODS.map((period) => dayLocks.filter((l) => periodOfLock(l) === period)).map((periodLocks) => periodLocks.map((lock) => {
                              const statusInfo = statusStyle(lock.status);
                              const period = periodOfLock(lock);
                              const when = `${PERIOD_SHORT[period]()}${tr(`（${windowStart(lock.pickup_window)}）`, ` (${windowStart(lock.pickup_window)})`)}`;
                              return (
                                <button
                                  key={lock.id}
                                  onClick={() => setExpandedId((prev) => (prev === lock.id ? null : lock.id))}
                                  aria-expanded={expandedId === lock.id}
                                  className={`text-left text-micro leading-tight rounded-sm border-l-[3px] px-1.5 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${PERIOD_BORDER[period]} ${statusInfo.className} ${
                                    expandedId === lock.id ? "ring-2 ring-primary" : ""
                                  }`}
                                  title={`${mealPeriodLabel(period)} ${lock.pickup_window} ${loc(lock, "item_name")}`}
                                >
                                  <span className="block font-bold whitespace-nowrap">{when}</span>
                                  <span className="block truncate">{loc(lock, "item_name")}</span>
                                </button>
                              );
                            }))}
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
          <DialogTitle className="text-center">{tr("取餐碼", "Pickup code")}</DialogTitle>
          {zoomedLock && (
            <>
              <PickupQr lockId={zoomedLock.id} size={260} />
            </>
          )}
        </DialogContent>
      </Dialog>
      <EditWishesDialog lock={editing} onClose={() => setEditing(null)} />
      <Dialog open={!!reselling} onOpenChange={(open) => !open && setReselling(null)}>
        <DialogContent className="max-w-sm">
          {reselling && (() => {
            const cap = resaleCap(reselling);
            const price = Number(resaleDraft);
            const valid = resaleDraft.trim() !== "" && Number.isInteger(price) && price >= 0 && price <= cap;
            const isPayer = (reselling.payer_uid ?? reselling.buyer_uid) === reselling.buyer_uid;
            const back = valid ? refundOnTakeover(reselling, price) : 0;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{tr("上架轉讓", "List for transfer")}</DialogTitle>
                  <DialogDescription>{loc(reselling, "item_name")}・{formatDateLabel(reselling.pickup_date)} {reselling.pickup_window}</DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  {/* One-tap common amounts, or type any amount from 0 to the original price */}
                  <div className="flex flex-wrap gap-2" role="group" aria-label={tr("常用轉讓價", "Quick prices")}>
                    {[
                      { label: tr(`原價 NT$${cap}`, `Full NT$${cap}`), v: cap },
                      { label: tr(`早鳥價 NT$${defaultResalePrice(reselling)}`, `Early-bird NT$${defaultResalePrice(reselling)}`), v: defaultResalePrice(reselling) },
                      { label: tr(`半價 NT$${Math.round(cap / 2)}`, `Half NT$${Math.round(cap / 2)}`), v: Math.round(cap / 2) },
                      { label: tr("免費 $0", "Free $0"), v: 0 },
                    ].filter((o, i, all) => all.findIndex((x) => x.v === o.v) === i).map((o) => (
                      <Tag key={o.v} selected={valid && price === o.v} onClick={() => setResaleDraft(String(o.v))}>{o.label}</Tag>
                    ))}
                  </div>
                  <Label htmlFor="resale-price">{tr(`或自訂金額（NT$0 ～ ${cap}，不能高於原價）`, `Or enter a price (NT$0 – ${cap}, no higher than the list price)`)}</Label>
                  <Input id="resale-price" type="number" inputMode="numeric" min={0} max={cap} step={1} value={resaleDraft} onChange={(e) => setResaleDraft(e.target.value)} />
                  {valid && price === 0 && (
                    <p className="text-caption text-charity">{tr("$0 的餐點不會放在轉讓市集，會出現在「附近愛心餐」分頁，讓需要的人免費領取（先到先得）。", "$0 meals aren't shown in the transfer market — they appear under Charity meals nearby for anyone to claim, first come, first served.")}</p>
                  )}
                  {!valid ? (
                    <p className="text-caption text-danger-text">{tr(`請填 0 ～ ${cap} 的整數`, `Enter a whole number from 0 to ${cap}`)}</p>
                  ) : isPayer && back > 0 ? (
                    <p className="text-caption text-muted-foreground">
                      {tr(`有人付款接手後，會退 ${back} 點平台點數給你（可結帳折抵或到會員中心退回 LINE Pay）。`, `Once someone pays, ${back} points come back to you (use them at checkout or send them back to LINE Pay).`)}
                      {price > back && tr("退回的點數不會超過你實付的金額，多的部分歸店家。", " You can't get back more than you paid; the rest goes to the vendor.")}
                    </p>
                  ) : isPayer ? (
                    <p className="text-caption text-muted-foreground">{tr("被接手後沒有款項會退給你。", "Nothing will be refunded to you.")}</p>
                  ) : (
                    <p className="text-caption text-muted-foreground">{tr("這份不是你付款的，被接手後款項不會退給你。", "You didn't pay for this meal, so nothing is refunded to you.")}</p>
                  )}
                  <p className="text-caption text-muted-foreground">{tr("取餐時段結束還沒人接手，會移到「附近愛心餐」開放免費領取、不退款。", "If nobody takes it by the end of the pickup window it moves to Charity meals nearby, free to claim, with no refund.")}</p>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setReselling(null)}>{tr("先不要", "Not now")}</Button>
                  <Button disabled={!valid || busyId === reselling.id} onClick={() => handleResell(reselling, price)}>{valid && price === 0 ? tr("免費送出", "Give it away") : tr("上架", "List it")}</Button>
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

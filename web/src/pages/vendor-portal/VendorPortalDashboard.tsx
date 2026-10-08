import { useEffect, useMemo, useState, type ReactNode } from "react";
import { collection, doc, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { ChefHat, ChevronRight, ClipboardList, ScanLine, ShoppingBasket, UtensilsCrossed } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import RevenueDashboardCard from "@/components/RevenueDashboardCard";
import { useRecipeGaps } from "@/components/RecipeGapCard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { useAuth } from "@/hooks/useAuth";
import { useMyVendor } from "@/hooks/useMyVendor";
import { dateLocale, tr } from "@/lib/i18n";
import { db } from "@/lib/firebase";
import { addDaysStr, mondayOf, todayStr } from "@/lib/pickupSlots";
import { cn } from "@/lib/utils";
import type { Lock } from "@/types";

// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/dashboard.tsx.
// 2026-09-28 改讀真實資料：統計跟今日時段都從這家店的 locks 算（vendor_id + created_at 索引、最近 200 筆）。
// 2026-10-06 圖像化（簡化提案 §4）：今天的取餐進度圈、各時段進度條、接下來 7 天長條圖、四張捷徑卡（帶即時狀態）。

const PENDING_STATUSES = new Set(["locked", "for_resale", "for_gift"]);
const DONE_STATUSES = new Set(["fulfilled", "resold_and_fulfilled"]);
const WD = ["日", "一", "二", "三", "四", "五", "六"];

/** 進度圈：已取／全部 */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? done / total : 0;
  return (
    <svg viewBox="0 0 128 128" className="w-36 h-36 shrink-0" role="img" aria-label={tr(`已取 ${done} / ${total} 份`, `${done} of ${total} picked up`)}>
      <circle cx="64" cy="64" r={r} fill="none" strokeWidth="14" className="stroke-stone-200" />
      <circle cx="64" cy="64" r={r} fill="none" strokeWidth="14" strokeLinecap="round" className="stroke-green-500 transition-all" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 64 64)" />
      <text x="64" y="62" textAnchor="middle" className="fill-foreground" style={{ fontSize: 30, fontWeight: 700 }}>{done}</text>
      <text x="64" y="84" textAnchor="middle" className="fill-muted-foreground" style={{ fontSize: 13 }}>/ {total} {tr("份", "")}</text>
    </svg>
  );
}

/** 捷徑卡：大圖示＋一個狀態數字，點了就去那一頁 */
function Shortcut({ href, icon, title, children, tone }: { href: string; icon: ReactNode; title: string; children: ReactNode; tone?: "warn" | "ok" }) {
  return (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className={cn("h-full border-2 transition-colors hover:bg-accent", tone === "warn" && "border-amber-300", tone === "ok" && "border-green-300")}>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="w-11 h-11 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center">{icon}</span>
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold">{title}</p>
          <div>{children}</div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function VendorPortalDashboard() {
  const VENDOR_ID = useAuth().user?.vendorId;
  const { data: myVendor } = useMyVendor();
  const [locks, setLocks] = useState<Lock[]>([]);
  const [loadingLocks, setLoadingLocks] = useState(true);
  const [plan, setPlan] = useState<{ done?: Record<string, boolean>; components?: unknown[]; labels?: { item: string }[] } | null>(null);
  const gaps = useRecipeGaps();
  const today = todayStr();

  useEffect(() => {
    if (!VENDOR_ID) return;
    const q = query(collection(db, "locks"), where("vendor_id", "==", VENDOR_ID), orderBy("created_at", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock));
        setLoadingLocks(false);
      },
      () => setLoadingLocks(false)
    );
    return () => unsub();
  }, [VENDOR_ID]);

  // 今天的備料進度（截單後才有）
  useEffect(() => {
    if (!VENDOR_ID) return;
    return onSnapshot(doc(db, "vendors", VENDOR_ID, "prepPlans", today), (s) => setPlan(s.exists() && s.data().locked_at ? s.data() : null), () => setPlan(null));
  }, [VENDOR_ID, today]);

  const todayLocks = useMemo(() => locks.filter((l) => l.pickup_date === today && l.status !== "no_show"), [locks, today]);
  const todayPending = todayLocks.filter((l) => PENDING_STATUSES.has(l.status)).length;
  const todayDone = todayLocks.filter((l) => DONE_STATUSES.has(l.status)).length;
  const todayTotal = todayPending + todayDone;

  // 今日取餐時段：依 pickup_window 分組
  const todayWindows = useMemo(() => {
    const byWindow = new Map<string, { total: number; done: number }>();
    for (const l of todayLocks) {
      if (!PENDING_STATUSES.has(l.status) && !DONE_STATUSES.has(l.status)) continue;
      const row = byWindow.get(l.pickup_window) ?? { total: 0, done: 0 };
      row.total += 1;
      if (DONE_STATUSES.has(l.status)) row.done += 1;
      byWindow.set(l.pickup_window, row);
    }
    return [...byWindow.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [todayLocks]);

  // 接下來 7 天（含今天）的訂單份數
  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => addDaysStr(today, i));
    const counts = new Map(days.map((d) => [d, 0]));
    for (const l of locks) {
      if (counts.has(l.pickup_date) && (PENDING_STATUSES.has(l.status) || DONE_STATUSES.has(l.status))) counts.set(l.pickup_date, (counts.get(l.pickup_date) ?? 0) + 1);
    }
    return days.map((d) => ({ date: d, n: counts.get(d) ?? 0 }));
  }, [locks, today]);
  const weekMax = Math.max(1, ...week.map((d) => d.n));
  const weekTotal = week.reduce((s, d) => s + d.n, 0);

  // 備料進度：有配方用半成品數，沒有就用品項數（跟今日備料頁同一套）
  const prepTotal = plan ? (plan.components?.length || new Set((plan.labels ?? []).map((l) => l.item)).size) : 0;
  const prepDone = plan ? Object.values(plan.done ?? {}).filter(Boolean).length : 0;

  // 叫貨截止：這週六 12:00，過了就看下週六
  let deadline = new Date(`${addDaysStr(mondayOf(today), 5)}T12:00:00`);
  if (deadline.getTime() < Date.now()) deadline = new Date(deadline.getTime() + 7 * 86_400_000);
  const daysLeft = Math.floor((deadline.getTime() - Date.now()) / 86_400_000);

  return (
    <VendorPortalLayout>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h1 className="font-heading text-3xl md:text-4xl font-semibold">{myVendor?.name ?? tr("總覽", "Overview")}</h1>
        <p className="text-sm text-muted-foreground">{format(new Date(), tr("M 月 d 日 EEEE", "EEEE, MMM d"), { locale: dateLocale() })}</p>
      </div>

      {loadingLocks ? (
        <SkeletonBlocks count={2} height={180} className="grid md:grid-cols-3 gap-4 mb-6" />
      ) : (
        <div className="grid gap-4 md:grid-cols-3 mb-4">
          {/* 今天：取餐進度圈＋各時段進度條 */}
          <Card className="md:col-span-2 border-2">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="font-semibold">{tr("今天取餐", "Today's pickups")}</p>
                <Button size="sm" asChild><Link href="/lock/vendor/redeem"><ScanLine /> {tr("取餐掃碼", "Scan")}</Link></Button>
              </div>
              {todayTotal === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground space-y-2">
                  <p>{tr("今天沒有取餐訂單", "No pickups today")}</p>
                  <Button size="sm" variant="outline" asChild><Link href="/vendor-portal/settings">{tr("設定取餐時段", "Set pickup times")}</Link></Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-6">
                  <Ring done={todayDone} total={todayTotal} />
                  <div className="flex-1 min-w-[14rem] space-y-3">
                    <div className="flex gap-4 text-sm">
                      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500" />{tr("已取", "Picked up")} <b className="text-lg">{todayDone}</b></span>
                      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-amber-400" />{tr("待取", "Waiting")} <b className="text-lg">{todayPending}</b></span>
                    </div>
                    {todayWindows.map(([w, row]) => (
                      <div key={w} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-mono font-semibold">{w}</span>
                          <span className="text-muted-foreground">{row.done} / {row.total}</span>
                        </div>
                        <div className="flex h-3 overflow-hidden rounded-full bg-amber-400" role="img" aria-label={tr(`${w} 已取 ${row.done} / ${row.total}`, `${w}: ${row.done} of ${row.total}`)}>
                          <div className="h-full bg-green-500 transition-all" style={{ width: `${(row.done / row.total) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 接下來 7 天的訂單 */}
          <Card className="border-2">
            <CardContent className="p-5 h-full flex flex-col">
              <p className="font-semibold">{tr("接下來 7 天", "Next 7 days")}</p>
              <p className="text-3xl font-bold leading-tight">{weekTotal}<span className="text-base font-normal text-muted-foreground"> {tr("份已訂", " booked")}</span></p>
              <div className="mt-auto pt-3 flex items-end gap-1.5 h-32" role="img" aria-label={week.map((d) => `${d.date.slice(5)} ${d.n}`).join("，")}>
                {week.map((d, i) => {
                  const wd = new Date(`${d.date}T00:00:00`).getDay();
                  return (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <span className="text-[11px] font-semibold">{d.n || ""}</span>
                      <div className="w-full flex flex-col justify-end h-20 rounded-sm bg-stone-100 overflow-hidden">
                        <div className={cn("w-full", i === 0 ? "bg-orange-500" : "bg-orange-300")} style={{ height: `${(d.n / weekMax) * 100}%` }} />
                      </div>
                      <span className={cn("text-[11px] leading-none", i === 0 ? "font-bold" : "text-muted-foreground")}>{i === 0 ? tr("今", "Today") : tr(WD[wd], ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][wd])}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 捷徑卡：每張只有一個狀態 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <Shortcut href="/vendor-portal/prep" icon={<ChefHat className="w-6 h-6" />} title={tr("今日備料", "Today's prep")} tone={plan && prepTotal > 0 && prepDone === prepTotal ? "ok" : undefined}>
          {plan ? (
            <>
              <p className="text-2xl font-bold leading-none">{prepDone}<span className="text-sm font-normal text-muted-foreground"> / {prepTotal}</span></p>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-200"><div className="h-full bg-green-500" style={{ width: `${prepTotal ? (prepDone / prepTotal) * 100 : 0}%` }} /></div>
            </>
          ) : <p className="text-sm text-muted-foreground">{todayTotal > 0 ? tr(`${todayTotal} 份，截單後開始`, `${todayTotal} meals`) : tr("今天沒有要做的", "Nothing today")}</p>}
        </Shortcut>
        <Shortcut href="/vendor-portal/purchasing" icon={<ShoppingBasket className="w-6 h-6" />} title={tr("採購叫貨", "Purchasing")} tone={daysLeft < 1 ? "warn" : undefined}>
          <p className="text-2xl font-bold leading-none">{daysLeft < 1 ? tr("今天", "Today") : tr(`${daysLeft} 天`, `${daysLeft} d`)}</p>
          <p className="text-xs text-muted-foreground mt-1">{tr(`週六 ${deadline.getMonth() + 1}/${deadline.getDate()} 12:00 截止`, `Due Sat ${deadline.getMonth() + 1}/${deadline.getDate()} 12:00`)}</p>
        </Shortcut>
        <Shortcut href="/vendor-portal/menu" icon={<UtensilsCrossed className="w-6 h-6" />} title={tr("菜單", "Menu")} tone={gaps.stats && gaps.stats.gapItems.length > 0 ? "warn" : undefined}>
          {gaps.stats ? (
            <>
              <p className="text-2xl font-bold leading-none">{gaps.stats.ready.length}<span className="text-sm font-normal text-muted-foreground"> / {gaps.listed.length} {tr("道算得出成本", "with cost")}</span></p>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-200"><div className="h-full bg-green-500" style={{ width: `${gaps.listed.length ? (gaps.stats.ready.length / gaps.listed.length) * 100 : 0}%` }} /></div>
            </>
          ) : <p className="text-sm text-muted-foreground">—</p>}
        </Shortcut>
        <Shortcut href="/vendor-portal/orders" icon={<ClipboardList className="w-6 h-6" />} title={tr("訂單", "Orders")}>
          <p className="text-2xl font-bold leading-none">{todayTotal}<span className="text-sm font-normal text-muted-foreground"> {tr("份今天", " today")}</span></p>
          <p className="text-xs text-muted-foreground mt-1">{tr(`7 天共 ${weekTotal} 份`, `${weekTotal} in 7 days`)}</p>
        </Shortcut>
      </div>

      {/* 本月收益看板（§9.3） */}
      <RevenueDashboardCard vendor={myVendor} />
    </VendorPortalLayout>
  );
}

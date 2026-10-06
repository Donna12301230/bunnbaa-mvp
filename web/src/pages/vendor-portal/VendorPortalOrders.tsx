import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { CalendarDays, ClipboardList, HeartHandshake, ScanLine } from "lucide-react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import PickupPanel from "@/components/orders/PickupPanel";
import OrdersListPanel from "@/components/orders/OrdersListPanel";
import SlotsPanel from "@/components/orders/SlotsPanel";
import CharityPanel from "@/components/orders/CharityPanel";
import { useAuth } from "@/hooks/useAuth";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useVendorLocks } from "@/hooks/useVendorLocks";
import { db } from "@/lib/firebase";
import { PENDING_STATUSES } from "@/lib/lockOutcome";
import { todayStr } from "@/lib/pickupSlots";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CharityMeal, Lock } from "@/types";

export type OrdersTab = "pickup" | "charity" | "orders" | "slots";

/**
 * 訂單取餐（2026-10-06 整合）：原本的「訂單管理」「取餐掃碼」「訂餐時段」「愛心餐」合成一頁四個大分頁。
 * 愛心餐就是今天沒來拿的便當，預約者也在取餐分頁掃 QR，所以跟取餐放在一起。
 * 舊路徑都保留：/vendor-portal/orders、/lock/vendor/redeem（取餐）、/vendor-portal/charity（愛心餐）、/vendor-portal/sessions（時段）。
 * 訂單列表、時段用最近 500 筆（vendor_id + created_at 索引）；取餐用今天的訂單（pickup_date 查詢，不受 500 筆限制）。
 */
export function OrdersHub({ initial = "pickup" }: { initial?: OrdersTab }) {
  const vendorId = useAuth().user?.vendorId;
  const { data: vendor } = useMyVendor();
  const [tab, setTab] = useState<OrdersTab>(initial);
  const { locks, loading, truncated } = useVendorLocks(500);
  const [todayLocks, setTodayLocks] = useState<Lock[]>([]);
  const [loadingToday, setLoadingToday] = useState(true);
  const today = todayStr();

  useEffect(() => {
    if (!vendorId) return;
    return onSnapshot(query(collection(db, "locks"), where("vendor_id", "==", vendorId), where("pickup_date", "==", today)), (snap) => {
      setTodayLocks(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Lock).sort((a, b) => (a.pickup_code ?? "").localeCompare(b.pickup_code ?? "")));
      setLoadingToday(false);
    }, () => setLoadingToday(false));
  }, [vendorId, today]);

  // 今天的愛心餐與收攤結算
  const [charity, setCharity] = useState<CharityMeal[]>([]);
  const [charityResult, setCharityResult] = useState<{ total: number; given_onsite: number; wasted: number; reserved_claimed: number } | null>(null);
  useEffect(() => {
    if (!vendorId) return;
    const u1 = onSnapshot(query(collection(db, "charityMeals"), where("vendor_id", "==", vendorId), where("date", "==", today)), (s) => setCharity(s.docs.map((d) => ({ id: d.id, ...d.data() }) as CharityMeal)), () => setCharity([]));
    const u2 = onSnapshot(doc(db, "vendors", vendorId, "prepPlans", today), (s) => setCharityResult(s.exists() ? s.data().charity_result ?? null : null), () => setCharityResult(null));
    return () => { u1(); u2(); };
  }, [vendorId, today]);
  const charityOpen = charity.filter((m) => m.status === "available" || m.status === "reserved").length;

  const waitingToday = todayLocks.filter((l) => PENDING_STATUSES.has(l.status)).length;
  const pendingAll = useMemo(() => locks.filter((l) => PENDING_STATUSES.has(l.status)).length, [locks]);
  const upcoming = useMemo(() => locks.filter((l) => l.pickup_date >= today && l.status !== "cancelled" && l.status !== "no_show").length, [locks, today]);

  const tabs = [
    { key: "pickup" as const, icon: ScanLine, label: tr("取餐", "Pickup"), n: waitingToday, sub: tr("今天待取", "waiting today") },
    { key: "charity" as const, icon: HeartHandshake, label: tr("愛心餐", "Charity"), n: charityOpen, sub: tr("份等人領", "waiting") },
    { key: "orders" as const, icon: ClipboardList, label: tr("訂單", "Orders"), n: pendingAll, sub: tr("待取餐", "to pick up") },
    { key: "slots" as const, icon: CalendarDays, label: tr("時段", "Slots"), n: upcoming, sub: tr("份已訂", "booked ahead") },
  ];

  return (
    <VendorPortalLayout>
      <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-4">{tr("訂單取餐", "Orders & pickup")}</h1>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === t.key ? "border-foreground bg-card shadow-sm" : "border-border bg-card/60 hover:bg-card")}>
            <span className="flex items-center gap-1.5 font-semibold"><t.icon className="w-5 h-5 text-orange-500" />{t.label}</span>
            <span className="mt-1 block text-2xl font-bold leading-none">{t.n}</span>
            <span className="text-xs text-muted-foreground">{t.sub}</span>
          </button>
        ))}
      </div>
      {tab === "pickup" && <PickupPanel todayLocks={todayLocks} loading={loadingToday} />}
      {tab === "charity" && <CharityPanel meals={charity} result={charityResult} onGoScan={() => setTab("pickup")} />}
      {tab === "orders" && <OrdersListPanel locks={locks} loading={loading} truncated={truncated} />}
      {tab === "slots" && <SlotsPanel vendor={vendor} locks={locks} loading={loading} />}
    </VendorPortalLayout>
  );
}

export default function VendorPortalOrders() {
  return <OrdersHub initial="pickup" />;
}

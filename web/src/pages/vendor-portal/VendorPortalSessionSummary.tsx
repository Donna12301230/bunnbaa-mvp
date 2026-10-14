import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { format } from "date-fns";
import { dateLocale, tr, loc, planBaseName } from "@/lib/i18n";
import { ArrowLeft, Banknote, CheckCircle2, ClipboardList, Clock, ShoppingBag } from "lucide-react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import LockOrderRow from "@/components/LockOrderRow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import PortalPageHeader from "@/components/PortalPageHeader";
import { useVendorLocks } from "@/hooks/useVendorLocks";
import { DONE_STATUSES, PENDING_STATUSES, revenueOf } from "@/lib/lockOutcome";
import { slotLabel } from "@/lib/pickupSlots";

// Slot details: switched to real locks on 2026-09-28. The URL param is "pickupDate__slot" (see
// slotKey in VendorPortalSessions); lists the prep summary and every order for this slot,
// and lets the vendor confirm pickup / record a no-show directly.
function parseSlot(raw: string | undefined): { date: string; window: string } | null {
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Already a decoded string
  }
  const [date, window] = decoded.split("__");
  return date && window ? { date, window } : null;
}

export default function VendorPortalSessionSummary() {
  const slot = parseSlot(useParams<{ sessionId: string }>().sessionId);
  const { locks, loading } = useVendorLocks(500);

  const slotLocks = useMemo(
    () => (slot ? locks.filter((l) => l.pickup_date === slot.date && l.pickup_window === slot.window) : []),
    [locks, slot?.date, slot?.window]
  );
  const active = slotLocks.filter((l) => l.status !== "no_show");
  const pending = slotLocks.filter((l) => PENDING_STATUSES.has(l.status)).length;
  const done = slotLocks.filter((l) => DONE_STATUSES.has(l.status)).length;
  const revenue = slotLocks.reduce((sum, l) => sum + revenueOf(l), 0); // Same basis as payouts (refunds to platform points excluded)

  // Prep summary: meal-plan item names such as "Plan A · Day 1/5" are merged into one dish
  const items = useMemo(() => {
    const byName = new Map<string, number>();
    for (const l of active) {
      const name = planBaseName(loc(l, "item_name"));
      byName.set(name, (byName.get(name) ?? 0) + 1);
    }
    return [...byName.entries()].sort((a, b) => b[1] - a[1]);
  }, [active]);

  const back = (
    <Link href="/vendor-portal/sessions">
      <Button variant="ghost" size="sm" className="mb-3"><ArrowLeft className="w-4 h-4 mr-1" /> {tr("回訂餐時段", "Back to slots")}</Button>
    </Link>
  );

  if (!slot) {
    return (
      <VendorPortalLayout>
        {back}
        <EmptyState icon={<ClipboardList size={32} />} title={tr("找不到這個時段", "Slot not found")} />
      </VendorPortalLayout>
    );
  }

  return (
    <VendorPortalLayout>
      {back}
      <PortalPageHeader icon={Clock} title={`${format(new Date(`${slot.date}T00:00:00`), "M/d (EEE)", { locale: dateLocale() })} ${slotLabel(slot.window)}`} />

      {loading ? (
        <SkeletonBlocks count={3} height={96} className="space-y-3" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="pt-4 pb-3 text-center">
              <ShoppingBag className="w-4 h-4 mx-auto mb-1 text-accent-foreground" />
              <div className="text-2xl font-bold">{active.length}</div>
              <div className="text-xs text-muted-foreground">{tr("訂購份數", "Meals ordered")}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 text-center">
              <Clock className="w-4 h-4 mx-auto mb-1 text-accent-foreground" />
              <div className="text-2xl font-bold text-accent-foreground">{pending}</div>
              <div className="text-xs text-muted-foreground">{tr("待取餐", "To pick up")}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 text-center">
              <CheckCircle2 className="w-4 h-4 mx-auto mb-1 text-accent-foreground" />
              <div className="text-2xl font-bold text-success-text">{done}</div>
              <div className="text-xs text-muted-foreground">{tr("已取餐", "Picked up")}</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 text-center">
              <Banknote className="w-4 h-4 mx-auto mb-1 text-accent-foreground" />
              <div className="text-2xl font-bold">{revenue.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">{tr("預付金額 (NT$)", "Prepaid (NT$)")}</div>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{tr("備料彙總", "Prep summary")}</CardTitle></CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <EmptyState size="compact" icon={<ShoppingBag size={32} />} title={tr("這個時段還沒有訂單", "No orders for this slot yet")} />
              ) : (
                <ul className="divide-y divide-border">
                  {items.map(([name, qty]) => (
                    <li key={name} className="flex justify-between py-1.5 text-sm">
                      <span>{name}</span><span className="font-semibold">× {qty}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {slotLocks.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {slotLocks.map((l) => <LockOrderRow key={l.id} lock={l} showDate={false} />)}
            </div>
          )}
        </div>
      )}
    </VendorPortalLayout>
  );
}

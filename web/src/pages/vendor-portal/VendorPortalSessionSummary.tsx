import { useMemo } from "react";
import { Link, useParams } from "wouter";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { ArrowLeft, Banknote, CheckCircle2, ClipboardList, Clock, ShoppingBag } from "lucide-react";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import LockOrderRow from "@/components/LockOrderRow";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { useVendorLocks } from "@/hooks/useVendorLocks";
import { DONE_STATUSES, PENDING_STATUSES } from "@/lib/lockOutcome";
import { slotLabel } from "@/lib/pickupSlots";

// 時段明細：2026-09-28 改用真實 locks。網址參數是「取餐日__時段」（見
// VendorPortalSessions 的 slotKey），列出這個時段的備料彙總與每筆訂單，
// 可以直接確認取餐／登記未取餐。
function parseSlot(raw: string | undefined): { date: string; window: string } | null {
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // 已經是解碼過的字串
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
  const revenue = slotLocks.reduce((sum, l) => sum + (l.locked_price || 0), 0);

  // 備料彙總：計畫型品名「A方案・第1/5天」合併成同一道
  const items = useMemo(() => {
    const byName = new Map<string, number>();
    for (const l of active) {
      const name = l.item_name.split("・第")[0];
      byName.set(name, (byName.get(name) ?? 0) + 1);
    }
    return [...byName.entries()].sort((a, b) => b[1] - a[1]);
  }, [active]);

  const back = (
    <Link href="/vendor-portal/sessions">
      <Button variant="ghost" size="sm" className="mb-3"><ArrowLeft className="w-4 h-4 mr-1" /> 回訂餐時段</Button>
    </Link>
  );

  if (!slot) {
    return (
      <VendorPortalLayout>
        {back}
        <EmptyState icon={<ClipboardList size={32} />} title="找不到這個時段" />
      </VendorPortalLayout>
    );
  }

  return (
    <VendorPortalLayout>
      {back}
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Clock className="w-5 h-5 text-orange-500" />
        {format(new Date(`${slot.date}T00:00:00`), "M/d (EEE)", { locale: zhTW })} {slotLabel(slot.window)}
      </h2>

      {loading ? (
        <SkeletonBlocks count={3} height={96} className="space-y-3" />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card><CardContent className="pt-4 pb-3 text-center">
              <ShoppingBag className="w-4 h-4 mx-auto mb-1 text-orange-500" />
              <div className="text-2xl font-bold">{active.length}</div>
              <div className="text-xs text-muted-foreground">訂購份數</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 text-center">
              <Clock className="w-4 h-4 mx-auto mb-1 text-orange-500" />
              <div className="text-2xl font-bold text-orange-600">{pending}</div>
              <div className="text-xs text-muted-foreground">待取餐</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 text-center">
              <CheckCircle2 className="w-4 h-4 mx-auto mb-1 text-orange-500" />
              <div className="text-2xl font-bold text-green-600">{done}</div>
              <div className="text-xs text-muted-foreground">已取餐</div>
            </CardContent></Card>
            <Card><CardContent className="pt-4 pb-3 text-center">
              <Banknote className="w-4 h-4 mx-auto mb-1 text-orange-500" />
              <div className="text-2xl font-bold">{revenue.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">預付金額 (NT$)</div>
            </CardContent></Card>
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">備料彙總</CardTitle></CardHeader>
            <CardContent>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">這個時段還沒有訂單。</p>
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

import { tr, loc } from "@/lib/i18n";
import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { format } from "date-fns";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChefHat } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import type { Lock } from "@/types";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";

// 對應 UI草圖 VendorDashboard.dc.html「備料」分頁——之前的雛型沒有這個視角：
// 依取餐時段聚合「今天要備多少份」，方便商家一次看完整天備料量，不用一筆筆訂單
// 自己加總。
//
// 跟 VendorRedeemPage.tsx「取餐總覽」共用同一套 vendor_id + created_at 索引
// （避免另外要求新的複合索引），今日份數用 pickup_date 在前端過濾+分組。
// 已解決/取消的狀態不算今日還要備的份數
const EXCLUDED_STATUSES = new Set(["fulfilled", "resold_and_fulfilled", "no_show"]);

interface PrepSlot {
  label: string;
  items: { name: string; qty: number }[];
}

export default function VendorPortalPrep() {
  // 商家後台只讓 role=vendor 進來，vendorId 是登入店主綁定的商家
  const VENDOR_ID = useAuth().user?.vendorId;
  const [locks, setLocks] = useState<Lock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!VENDOR_ID) return;
    const q = query(
      collection(db, "locks"),
      where("vendor_id", "==", VENDOR_ID),
      orderBy("created_at", "desc"),
      limit(200)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setLocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock));
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsub();
  }, [VENDOR_ID]);

  const prepSlots = useMemo<PrepSlot[]>(() => {
    const todayStr = format(new Date(), "yyyy-MM-dd");
    const todaysActive = locks.filter(
      (l) => l.pickup_date === todayStr && !EXCLUDED_STATUSES.has(l.status)
    );

    const bySlot = new Map<string, Map<string, number>>();
    for (const lock of todaysActive) {
      const items = bySlot.get(lock.pickup_window) ?? new Map<string, number>();
      const name = loc(lock, "item_name");
        items.set(name, (items.get(name) ?? 0) + 1);
      bySlot.set(lock.pickup_window, items);
    }

    return Array.from(bySlot.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, items]) => ({
        label,
        items: Array.from(items.entries()).map(([name, qty]) => ({ name, qty })),
      }));
  }, [locks]);

  const totalCount = prepSlots.reduce(
    (sum, slot) => sum + slot.items.reduce((a, it) => a + it.qty, 0),
    0
  );

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-1 flex items-center gap-2">
        <ChefHat className="w-5 h-5 text-orange-500" /> {tr("今日備料", "Today's prep")}
      </h2>
      <p className="text-sm text-muted-foreground mb-5">{tr("依取餐時段聚合的今日備料份數，出餐前對一次就好。", "Today's meal counts grouped by pickup time — check once before service.")}</p>

      <Card className="mb-4">
        <CardContent className="pt-5 pb-4 flex items-baseline gap-2">
          <span className="text-sm text-muted-foreground">{tr("今日總備料份數", "Total meals to prep today")}</span>
          <span className="text-2xl font-bold text-orange-600">{totalCount} {tr("份", "meals")}</span>
        </CardContent>
      </Card>

      {loading ? (
        <SkeletonBlocks count={3} height={160} className="grid grid-cols-1 md:grid-cols-3 gap-4" />
      ) : prepSlots.length === 0 ? (
        <EmptyState icon={<ChefHat size={32} />} title={tr("今日尚無待備料的訂單", "Nothing to prep today")} description={tr("有顧客鎖定餐點後，會依取餐時段出現在這裡。", "Once customers lock meals, they'll show up here by pickup time.")} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {prepSlots.map(slot => (
            <Card key={slot.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{slot.label}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {slot.items.map(it => (
                  <div key={it.name} className="flex items-center justify-between text-sm">
                    <span className="truncate">{it.name}</span>
                    <span className="font-semibold text-muted-foreground shrink-0 ml-2">× {it.qty}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </VendorPortalLayout>
  );
}

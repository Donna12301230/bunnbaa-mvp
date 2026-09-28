import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardList, UtensilsCrossed, TrendingUp, CheckCircle2, CalendarDays, ChevronRight, Clock } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useMyVendor } from "@/hooks/useMyVendor";
import { Link } from "wouter";
import { format } from "date-fns";
import { dateLocale, tr } from "@/lib/i18n";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { db } from "@/lib/firebase";
import { todayStr } from "@/lib/pickupSlots";
import type { Lock } from "@/types";

// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/dashboard.tsx.
// 2026-09-28 改讀真實資料：統計跟今日時段都從這家店的 locks 算（跟 VendorPortalPrep／
// VendorRedeemPage 共用 vendor_id + created_at 索引、最近 200 筆），菜單數讀 menu_items。
// 原本 Parse 版的「預約單／現場單／訂餐場次」屬於 TODO §7 待決策的揪團預購，這裡不顯示。

const PENDING_STATUSES = new Set(["locked", "for_resale", "for_gift"]);
const DONE_STATUSES = new Set(["fulfilled", "resold_and_fulfilled"]);

export default function VendorPortalDashboard() {
  const VENDOR_ID = useAuth().user?.vendorId;
  const { data: myVendor } = useMyVendor();
  const [locks, setLocks] = useState<Lock[]>([]);
  const [loadingLocks, setLoadingLocks] = useState(true);

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
        setLoadingLocks(false);
      },
      () => setLoadingLocks(false)
    );
    return () => unsub();
  }, [VENDOR_ID]);

  const { data: menuCount = 0, isLoading: loadingMenu } = useQuery({
    queryKey: ["vendorMenu", VENDOR_ID, "count"],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "menu_items"), where("vendor_id", "==", VENDOR_ID)));
      return snap.size;
    },
    enabled: !!VENDOR_ID,
    staleTime: 2 * 60 * 1000,
  });

  const today = todayStr();
  const todayLocks = useMemo(() => locks.filter((l) => l.pickup_date === today), [locks, today]);
  const todayPending = todayLocks.filter((l) => PENDING_STATUSES.has(l.status)).length;
  const todayDone = todayLocks.filter((l) => DONE_STATUSES.has(l.status)).length;

  // 今日取餐時段：依 pickup_window 分組，列出總份數與還沒取的份數
  const todayWindows = useMemo(() => {
    const byWindow = new Map<string, { total: number; pending: number }>();
    for (const l of todayLocks) {
      if (l.status === "no_show") continue;
      const row = byWindow.get(l.pickup_window) ?? { total: 0, pending: 0 };
      row.total += 1;
      if (PENDING_STATUSES.has(l.status)) row.pending += 1;
      byWindow.set(l.pickup_window, row);
    }
    return [...byWindow.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [todayLocks]);

  const isLoading = loadingLocks || loadingMenu;

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-4">
        {myVendor?.name ? `${myVendor.name} — ${tr("總覽", "Overview")}` : tr("廠商總覽", "Vendor overview")}
      </h2>

      {/* 統計卡片 */}
      {isLoading ? (
        <SkeletonBlocks count={4} height={96} className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" />
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <ClipboardList className="w-3.5 h-3.5" /> {tr("今日待取餐", "Awaiting pickup today")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">{todayPending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> {tr("今日已取餐", "Picked up today")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{todayDone}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5" /> {tr("近期訂單數", "Recent orders")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{locks.length}{locks.length >= 200 ? "+" : ""}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs text-muted-foreground flex items-center gap-1">
                <UtensilsCrossed className="w-3.5 h-3.5" /> {tr("菜單項目", "Menu items")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{menuCount}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 今日取餐時段 */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-orange-500" />
            {tr("今日取餐時段", "Today's pickups")}（{format(new Date(), "M/d (EEE)", { locale: dateLocale() })}）
          </CardTitle>
          <Link href="/lock/vendor/redeem">
            <Button variant="ghost" size="sm" className="text-xs h-7">
              {tr("核對取餐", "Redeem")} <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {todayWindows.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              <CalendarDays className="w-8 h-8 mx-auto mb-2 opacity-30" />
              {tr("今日沒有取餐訂單", "No pickups today")}
              <div className="mt-2">
                <Link href="/vendor-portal/settings">
                  <Button size="sm" variant="outline" className="text-xs">{tr("設定取餐時段", "Set pickup times")}</Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {todayWindows.map(([window, row]) => (
                <Link key={window} href="/vendor-portal/prep">
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border hover:bg-muted/50 cursor-pointer transition-colors">
                    <div className="flex items-center gap-1.5 text-sm font-semibold">
                      <Clock className="w-3.5 h-3.5 text-orange-500" />
                      {window}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-orange-600">{row.total} {tr("份", "meals")}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        row.pending > 0 ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                      }`}>
                        {row.pending > 0 ? tr(`待取 ${row.pending}`, `${row.pending} to pick up`) : tr("已全部取餐", "All picked up")}
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </VendorPortalLayout>
  );
}

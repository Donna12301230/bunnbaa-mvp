import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { mockGetMyVendor, mockOrderSessions, mockSyncOrderSessions, mockToggleSessionStatus, mockUpdateVendor } from "@/lib/mockData";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Button } from "@/components/ui/button";
import {
  CalendarDays, ChevronLeft, ChevronRight,
  Clock, MapPin, BarChart2, ToggleLeft, ToggleRight, X,
} from "lucide-react";
import { format, addDays, startOfWeek } from "date-fns";
import { zhTW } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { Tooltip } from "@/components/ds";

const DEADLINE_OFFSET = 30; // 訂餐截止 = 打烊前 30 分鐘

function calcDeadline(closeTime: string): string {
  const [h, m] = closeTime.split(":").map(Number);
  const total = ((h * 60 + m - DEADLINE_OFFSET) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/sessions.tsx.
// TODO(firebase): reads/writes mockData.ts's mockOrderSessions/mockVendors
// instead of Parse.Query("OrderSession")/saveVendorSettings — swap for
// Firestore once the backend is wired up.
export default function VendorPortalSessions() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [weekOffset, setWeekOffset] = useState(0);

  // 本週七天
  const weekStart  = startOfWeek(addDays(new Date(), weekOffset * 7), { weekStartsOn: 1 });
  const weekDates  = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekStartStr = format(weekDates[0], "yyyy-MM-dd");
  const weekEndStr   = format(weekDates[6], "yyyy-MM-dd");

  // ── 廠商資料 ────────────────────────────────────────────────────────────────
  const { data: vendor } = useQuery({
    queryKey: ["myVendor", user?.id],
    queryFn: async () => mockGetMyVendor(),
    enabled: !!user,
  });

  const businessHours = vendor?.businessHours ?? [];
  const holidays = vendor?.holidays ?? [];

  // ── 本週 OrderSession ────────────────────────────────────────────────────────
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ["vendorSessions", vendor?.id, weekStartStr],
    queryFn: async () => {
      if (!vendor) return [];
      return mockOrderSessions.filter(s => {
        const dateStr = s.sessionDate.toISOString().slice(0, 10);
        return s.vendorId === vendor.id && dateStr >= weekStartStr && dateStr <= weekEndStr;
      }).sort((a, b) => a.sessionDate.getTime() - b.sessionDate.getTime());
    },
    enabled: !!vendor,
  });

  // ── 自動建立 OrderSession（依 businessHours，略過公休日）────────────────────
  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!vendor) return 0;
      return mockSyncOrderSessions(vendor, weekDates);
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ["vendorSessions", vendor?.id, weekStartStr] });
      if (n > 0) toast({ title: `已建立 ${n} 個時段` });
    },
  });

  useEffect(() => {
    if (vendor && !isLoading) syncMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?.id, weekStartStr, isLoading]);

  // ── 開關時段 ─────────────────────────────────────────────────────────────────
  const toggleMutation = useMutation({
    mutationFn: async ({ id }: { id: string; current: string }) => mockToggleSessionStatus(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vendorSessions", vendor?.id, weekStartStr] });
      queryClient.invalidateQueries({ queryKey: ["openSessions"] });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "更新失敗", description: err.message }),
  });

  // ── 公休日管理 ───────────────────────────────────────────────────────────────
  const addHoliday = useMutation({
    mutationFn: async (dateStr: string) => {
      if (!vendor) return;
      mockUpdateVendor(vendor.id, { holidays: [...holidays.filter(h => h !== dateStr), dateStr].sort() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myVendor", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["vendorSessions", vendor?.id, weekStartStr] });
      toast({ title: "已設為公休日" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "設定失敗", description: err.message }),
  });

  const removeHoliday = useMutation({
    mutationFn: async (dateStr: string) => {
      if (!vendor) return;
      mockUpdateVendor(vendor.id, { holidays: holidays.filter(h => h !== dateStr) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myVendor", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["vendorSessions", vendor?.id, weekStartStr] });
      toast({ title: "已移除公休日" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "設定失敗", description: err.message }),
  });

  const now   = new Date();
  const today = format(now, "yyyy-MM-dd");

  return (
    <VendorPortalLayout>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-orange-500" /> 訂餐時段
        </h2>
        <div className="flex items-center gap-1.5">
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setWeekOffset(w => w - 1)}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium min-w-[8rem] text-center">
            {format(weekDates[0], "M/d")} – {format(weekDates[6], "M/d (EEE)", { locale: zhTW })}
          </span>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setWeekOffset(w => w + 1)}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          {weekOffset !== 0 && (
            <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => setWeekOffset(0)}>
              本週
            </Button>
          )}
        </div>
      </div>

      {/* ── 尚未設定營業時段 ── */}
      {businessHours.length === 0 && (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>尚未設定營業時段</p>
          <p className="mt-1">
            請先至
            <Button variant="link" className="ml-1 h-auto p-0 align-baseline" onClick={() => navigate("/vendor-portal/settings")}>
              店家設定
            </Button>
            設定營業時間
          </p>
        </div>
      )}

      {/* ── 週曆 ── */}
      {businessHours.length > 0 && (
        <div className="space-y-2">
          {weekDates.map(date => {
            const dateStr  = format(date, "yyyy-MM-dd");
            const isToday  = dateStr === today;
            const isHoliday = holidays.includes(dateStr);
            const bh       = businessHours.find(h => h.weekday === date.getDay());
            const isBizDay = !isHoliday && (bh?.open ?? false);
            const deadlineStr  = isBizDay ? calcDeadline(bh!.closeTime) : "";
            const deadlineDate = isBizDay ? new Date(`${dateStr}T${deadlineStr}:00`) : null;
            const isPast  = deadlineDate ? deadlineDate < now : false;
            const session = sessions.find(s => format(s.sessionDate, "yyyy-MM-dd") === dateStr);
            const status  = session?.status;

            return (
              <div
                key={dateStr}
                className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-colors ${
                  isToday ? "border-orange-300 bg-orange-50/50" : "border-border bg-white"
                } ${!isBizDay ? "opacity-60" : ""}`}
              >
                {/* 日期 */}
                <div className="w-12 text-center flex-shrink-0">
                  <div className="text-xs text-muted-foreground">{format(date, "EEE", { locale: zhTW })}</div>
                  <div className={`text-lg font-bold leading-tight ${isToday ? "text-orange-500" : ""}`}>
                    {format(date, "d")}
                  </div>
                  {isToday && <div className="text-xs text-orange-400">今天</div>}
                </div>

                {/* 狀態說明 */}
                <div className="flex-1 min-w-0">
                  {isHoliday ? (
                    /* 公休日 */
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-500">公休日</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-600"
                        onClick={() => removeHoliday.mutate(dateStr)}
                      >
                        <X /> 移除
                      </Button>
                    </div>
                  ) : !isBizDay ? (
                    /* 非營業日 */
                    <span className="text-sm text-muted-foreground">休息</span>
                  ) : (
                    /* 營業日 */
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1 text-sm">
                          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                          {bh!.openTime} ─ {bh!.closeTime}
                        </span>
                        {isPast ? (
                          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">已截止</span>
                        ) : status === "open" ? (
                          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">開放訂餐</span>
                        ) : status === "closed" ? (
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">已關閉</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-3">
                        <span>截止 {deadlineStr}</span>
                        {session?.pickupLocation && (
                          <span className="flex items-center gap-0.5">
                            <MapPin className="w-3 h-3" />
                            {session.pickupLocation}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* 操作 */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isBizDay && !isToday && !isPast && (
                    <Tooltip content="標為公休日">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-xs text-muted-foreground hover:text-orange-600"
                        onClick={() => addHoliday.mutate(dateStr)}
                      >
                        公休
                      </Button>
                    </Tooltip>
                  )}
                  {session && (
                    <>
                      <Button
                        size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => navigate(`/vendor-portal/sessions/${session.id}/summary`)}
                      >
                        <BarChart2 className="w-3.5 h-3.5 mr-1" /> 統整
                      </Button>
                      {status !== "completed" && !isPast && (
                        <Button
                          size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => toggleMutation.mutate({ id: session.id, current: status! })}
                          title={status === "open" ? "暫停訂餐" : "重新開放"}
                        >
                          {status === "open"
                            ? <ToggleRight className="w-4 h-4 text-green-600" />
                            : <ToggleLeft  className="w-4 h-4 text-gray-400" />
                          }
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </VendorPortalLayout>
  );
}

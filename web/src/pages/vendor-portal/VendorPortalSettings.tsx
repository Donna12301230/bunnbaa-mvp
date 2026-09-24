import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { mockGetMyVendor, mockSaveVendorSettings, mockRequestCancelSubscription, mockReactivateSubscription } from "@/lib/mockData";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import {
  Settings, QrCode, Plus, Trash2, Download,
  CalendarDays, CreditCard, AlertTriangle,
  Clock, X, CalendarOff, Copy, LoaderCircle } from "lucide-react";
import { ImageUploadField } from "@/components/ImageUploadField";
import { QRCodeCanvas } from "qrcode.react";
import { format, parseISO } from "date-fns";
import { zhTW } from "date-fns/locale";
import type { BusinessHour } from "@/types";

const ORDER_DEADLINE_OFFSET = 30;
const DAY_NAMES = ["日", "一", "二", "三", "四", "五", "六"];

function minsToTime(mins: number): string {
  const h = Math.floor(((mins % 1440) + 1440) % 1440 / 60);
  const m = ((mins % 1440) + 1440) % 1440 % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function deadlineOf(closeTime: string): string {
  const [h, m] = closeTime.split(":").map(Number);
  return minsToTime(h * 60 + m - ORDER_DEADLINE_OFFSET);
}
function fmtHoliday(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "M月d日（EEE）", { locale: zhTW });
  } catch {
    return dateStr;
  }
}

const DEFAULT_BH: BusinessHour[] = [0, 1, 2, 3, 4, 5, 6].map(d => ({
  weekday: d,
  open: d >= 1 && d <= 5,
  openTime: "08:00",
  closeTime: "17:00",
}));

// ── SubscriptionCancelButton ────────────────────────────────────────────────
function SubscriptionCancelButton({ vendorId }: { vendorId: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const mut = useMutation({
    mutationFn: () => mockRequestCancelSubscription(vendorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myVendor"] });
      toast({ title: "已申請取消訂閱", description: "帳號將於到期日後暫停，資料持續保留。" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });
  return (
    <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 text-xs"
      disabled={mut.isPending}
      onClick={async () => {
        if (await confirm({ title: "要申請取消訂閱嗎？", description: "帳號將於到期日後暫停，您的資料仍會保留。", confirmLabel: "確定取消訂閱", destructive: true })) mut.mutate();
      }}>
      {mut.isPending ? "處理中..." : "申請取消訂閱"}
    </Button>
  );
}

function SubscriptionReactivateButton({ vendorId }: { vendorId: string }) {
  const { toast } = useToast();
  const mut = useMutation({
    mutationFn: () => mockReactivateSubscription(vendorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myVendor"] });
      toast({ title: "訂閱已恢復", description: "歡迎回來！帳號已恢復正常使用。" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });
  return (
    <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white text-xs"
      disabled={mut.isPending} onClick={() => mut.mutate()}>
      {mut.isPending ? "處理中..." : "重新訂閱（NT$1,999/月）"}
    </Button>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/settings.tsx.
// TODO(firebase): reads/writes mockData.ts's mockVendors via
// mockGetMyVendor/mockSaveVendorSettings/mockRequestCancelSubscription/
// mockReactivateSubscription instead of Parse.Query("Vendor")/
// saveVendorSettings()/Parse.Cloud.run(...) — swap for Firestore once the
// backend is wired up.
export default function VendorPortalSettings() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [businessHours, setBusinessHours] = useState<BusinessHour[]>(DEFAULT_BH);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState("");
  const [newTable, setNewTable] = useState("");

  const { data: myVendor, isLoading } = useQuery({
    queryKey: ["myVendor", user?.id],
    queryFn: async () => mockGetMyVendor(),
    enabled: !!user,
  });

  useEffect(() => {
    if (!myVendor) return;
    setName(myVendor.name ?? "");
    setDescription(myVendor.description ?? "");
    setAddress(myVendor.address ?? "");
    setPhone(myVendor.phone ?? "");
    setCoverImage(myVendor.coverImage ?? "");
    setHolidays(myVendor.holidays ?? []);
    const bh = myVendor.businessHours;
    if (bh && bh.length > 0) {
      setBusinessHours(bh);
    } else {
      const ow = myVendor.orderWeekdays ?? [];
      if (ow.length > 0) setBusinessHours(DEFAULT_BH.map(h => ({ ...h, open: ow.includes(h.weekday) })));
    }
  }, [myVendor]);

  const tables: string[] = myVendor?.tables ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!myVendor) throw new Error("找不到店家資料");
      return mockSaveVendorSettings(myVendor.id, {
        name, description, address, phone,
        coverImage: coverImage || undefined,
        businessHours, holidays,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myVendor", user?.id] });
      toast({ title: "儲存成功" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "儲存失敗", description: err.message }),
  });

  const addTableMutation = useMutation({
    mutationFn: async (tableName: string) => {
      if (!myVendor) throw new Error("找不到店家資料");
      if (tables.includes(tableName)) throw new Error("桌位名稱已存在");
      return mockSaveVendorSettings(myVendor.id, { tables: [...tables, tableName] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myVendor", user?.id] });
      setNewTable("");
      toast({ title: "桌位已新增" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "新增失敗", description: err.message }),
  });

  const removeTableMutation = useMutation({
    mutationFn: (tableName: string) => {
      if (!myVendor) throw new Error("找不到店家資料");
      return mockSaveVendorSettings(myVendor.id, { tables: tables.filter(t => t !== tableName) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myVendor", user?.id] });
      toast({ title: "桌位已刪除" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "刪除失敗", description: err.message }),
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function setBH(weekday: number, patch: Partial<BusinessHour>) {
    setBusinessHours(prev => prev.map(h => h.weekday === weekday ? { ...h, ...patch } : h));
  }

  // 將第一個開放日的時間套用至所有開放日
  function syncAllOpenTimes() {
    const first = businessHours.find(h => h.open);
    if (!first) return;
    setBusinessHours(prev => prev.map(h => h.open ? { ...h, openTime: first.openTime, closeTime: first.closeTime } : h));
    toast({ title: `已套用 ${first.openTime}─${first.closeTime} 至所有開放日` });
  }

  function getMenuUrl(tableName: string) {
    return `${window.location.origin}/menu/${myVendor?.id}?table=${encodeURIComponent(tableName)}`;
  }

  function downloadQR(tableName: string) {
    const canvas = document.getElementById(`qr-${tableName}`) as HTMLCanvasElement | null;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = `qr-${myVendor?.name ?? "table"}-${tableName}.png`;
    a.click();
  }

  if (isLoading) return (
    <VendorPortalLayout>
      <div className="flex justify-center py-20">
        <div role="status" className="flex flex-col items-center gap-2 text-muted-foreground">
          <LoaderCircle className="w-6 h-6 animate-spin text-orange-400 motion-reduce:animate-none" aria-hidden="true" />
          <span className="sr-only">載入中</span>
        </div>
      </div>
    </VendorPortalLayout>
  );

  const openDaysCount = businessHours.filter(h => h.open).length;

  return (
    <VendorPortalLayout>
      <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
        <Settings className="w-5 h-5 text-orange-500" /> 店家設定
      </h2>

      <div className="max-w-lg space-y-5">

        {/* ── 基本資料 ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">基本資料</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>店家名稱 <span className="text-red-500">*</span></Label>
              <Input value={name} onChange={e => setName(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label>店家簡介</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>地址</Label>
                <Input value={address} onChange={e => setAddress(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>聯絡電話</Label>
                <Input value={phone} onChange={e => setPhone(e.target.value)} className="mt-1" />
              </div>
            </div>
            <ImageUploadField label="店家封面圖" value={coverImage} onChange={setCoverImage} />
          </CardContent>
        </Card>

        {/* ── 營業時段 ── */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" /> 營業時段
              </CardTitle>
              {openDaysCount > 1 && (
                <button
                  type="button"
                  onClick={syncAllOpenTimes}
                  className="flex items-center gap-1 text-xs text-orange-500 hover:text-orange-600"
                  title="將第一個開放日的時間套用至所有開放日"
                >
                  <Copy className="w-3 h-3" /> 同步所有開放日
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {businessHours.map(h => (
              <div key={h.weekday} className="flex items-center gap-2 py-1">
                {/* 星期按鈕 */}
                <button
                  type="button"
                  onClick={() => setBH(h.weekday, { open: !h.open })}
                  className={`w-9 h-9 rounded-full text-sm font-medium border transition-colors flex-shrink-0 ${
                    h.open
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-white text-muted-foreground border-border hover:border-orange-300"
                  }`}
                >
                  {DAY_NAMES[h.weekday]}
                </button>

                {h.open ? (
                  <div className="flex-1 flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="time" value={h.openTime}
                        onChange={e => setBH(h.weekday, { openTime: e.target.value })}
                        className="border rounded px-2 py-1 text-sm w-[6.2rem] focus:outline-none focus:ring-1 focus:ring-orange-400"
                      />
                      <span className="text-muted-foreground text-xs">─</span>
                      <input
                        type="time" value={h.closeTime}
                        onChange={e => setBH(h.weekday, { closeTime: e.target.value })}
                        className="border rounded px-2 py-1 text-sm w-[6.2rem] focus:outline-none focus:ring-1 focus:ring-orange-400"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground pl-0.5">
                      訂餐截止 {deadlineOf(h.closeTime)}
                    </p>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">休息</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── 公休日 ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarOff className="w-4 h-4 text-orange-500" /> 公休日
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              國定假日、臨時休息等特定日期，優先於每週營業時段。
            </p>
            <div className="flex gap-2">
              <input
                type="date" value={newHoliday}
                onChange={e => setNewHoliday(e.target.value)}
                className="border rounded px-2 py-1.5 text-sm flex-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
              <Button
                type="button" size="sm" variant="outline"
                disabled={!newHoliday || holidays.includes(newHoliday)}
                onClick={() => {
                  if (newHoliday && !holidays.includes(newHoliday)) {
                    setHolidays(prev => [...prev, newHoliday].sort());
                    setNewHoliday("");
                  }
                }}
              >
                <Plus className="w-3.5 h-3.5 mr-1" /> 新增
              </Button>
            </div>
            {holidays.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {holidays.map(d => (
                  <div key={d} className="flex items-center gap-1 bg-orange-50 border border-orange-100 rounded-full px-2.5 py-1 text-sm">
                    <CalendarDays className="w-3 h-3 text-orange-400 flex-shrink-0" />
                    <span className="text-orange-800">{fmtHoliday(d)}</span>
                    <button
                      type="button"
                      onClick={() => setHolidays(prev => prev.filter(h => h !== d))}
                      className="text-orange-300 hover:text-red-500 transition-colors ml-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">尚未設定公休日</p>
            )}
          </CardContent>
        </Card>

        {/* ── 儲存按鈕 ── */}
        <Button
          className="w-full bg-orange-500 hover:bg-orange-600 text-white"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !name.trim()}
        >
          {saveMutation.isPending ? "儲存中..." : "儲存設定"}
        </Button>

        {/* ── 訂閱狀態 ── */}
        {myVendor && (() => {
          const subStatus = myVendor.subscriptionStatus ?? "trial";
          const endDate = myVendor.subscriptionEndDate;
          const now = new Date();
          const isCancelledActive = subStatus === "cancelled" && endDate && endDate > now;
          const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
            trial:     { label: "首月免費試用中", variant: "default" },
            active:    { label: "訂閱中",        variant: "default" },
            cancelled: { label: isCancelledActive ? "已申請取消（到期前仍可使用）" : "已取消", variant: "outline" },
            expired:   { label: "已到期／暫停",  variant: "destructive" },
          };
          const cfg = statusConfig[subStatus] ?? statusConfig.trial;
          return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-amber-500" /> 訂閱狀態
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">目前狀態</span>
                  <Badge variant={cfg.variant}>{cfg.label}</Badge>
                </div>
                {endDate && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {subStatus === "trial" ? "試用到期日" : subStatus === "cancelled" ? "帳號暫停日" : "下次續約日"}
                    </span>
                    <span className="font-medium">{endDate.toLocaleDateString("zh-TW")}</span>
                  </div>
                )}
                {(subStatus === "trial" || subStatus === "active") && (
                  <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-100 rounded p-2">
                    {subStatus === "trial"
                      ? "試用期結束後將自動進入每月 NT$1,999 的訂閱方案。"
                      : "每月自動續約，費用 NT$1,999。"}
                  </p>
                )}
                {isCancelledActive && (
                  <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>您已申請取消訂閱，帳號將於到期日後暫停。資料完整保留，重新訂閱即可恢復。</span>
                  </div>
                )}
                {(subStatus === "expired" || (subStatus === "cancelled" && endDate && endDate <= now)) && (
                  <div className="flex items-start gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>帳號已暫停。您的所有資料均已保留，重新訂閱即可恢復使用。</span>
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  {(subStatus === "trial" || subStatus === "active") && <SubscriptionCancelButton vendorId={myVendor.id} />}
                  {(subStatus === "expired" || subStatus === "cancelled") && <SubscriptionReactivateButton vendorId={myVendor.id} />}
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* ── 桌位 QR Code ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <QrCode className="w-4 h-4 text-orange-500" /> 桌位 QR Code 管理
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="桌位名稱（如：A1、戶外1）"
                value={newTable}
                onChange={e => setNewTable(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newTable.trim()) addTableMutation.mutate(newTable.trim()); }}
              />
              <Button
                className="bg-orange-500 hover:bg-orange-600 text-white flex-shrink-0"
                onClick={() => { if (newTable.trim()) addTableMutation.mutate(newTable.trim()); }}
                disabled={addTableMutation.isPending || !newTable.trim()}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {tables.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">尚未建立桌位</p>
            ) : (
              <div className="space-y-4">
                {tables.map(tableName => (
                  <div key={tableName} className="border rounded-xl p-4 flex flex-col items-center gap-3">
                    <div className="flex items-center justify-between w-full">
                      <span className="font-semibold text-sm">桌號：{tableName}</span>
                      <Button
                        size="sm" variant="ghost"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => removeTableMutation.mutate(tableName)}
                        disabled={removeTableMutation.isPending}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                    <QRCodeCanvas id={`qr-${tableName}`} value={getMenuUrl(tableName)} size={160} level="M" includeMargin />
                    <p className="text-xs text-muted-foreground text-center break-all px-2">{getMenuUrl(tableName)}</p>
                    <Button size="sm" variant="outline" className="w-full" onClick={() => downloadQR(tableName)}>
                      <Download className="w-4 h-4 mr-1" /> 下載 QR Code
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </VendorPortalLayout>
  );
}

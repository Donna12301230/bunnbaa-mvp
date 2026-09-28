import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { mockGetMyVendor, mockSaveVendorSettings } from "@/lib/mockData";
import { useMyVendor, myVendorDocKey } from "@/hooks/useMyVendor";
import { getSubscriptionState, requestCancelSubscription, undoCancelSubscription, PLATFORM_CONTACT_EMAIL } from "@/lib/subscription";
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
  Clock, X, CalendarOff, Copy, LoaderCircle, Timer, Users } from "lucide-react";
import { ImageUploadField } from "@/components/ImageUploadField";
import { QRCodeCanvas } from "qrcode.react";
import { format, parseISO } from "date-fns";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_PICKUP_WINDOWS, MAX_HOLIDAYS, MAX_PICKUP_WINDOWS, isValidWindow, slotLabel, windowsOverlap } from "@/lib/pickupSlots";
import { zhTW } from "date-fns/locale";
import type { BusinessHour, Vendor } from "@/types";
import { Tooltip } from "@/components/ds";

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

// 沒設定過的商家，消費端是「每天營業」，這裡的預設要一致
const DEFAULT_BH: BusinessHour[] = [0, 1, 2, 3, 4, 5, 6].map(d => ({
  weekday: d,
  open: true,
  openTime: "08:00",
  closeTime: "17:00",
}));

function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  return minsToTime(h * 60 + m + mins);
}

/** 取餐時段清單有問題就回傳錯誤訊息。 */
function pickupWindowsProblem(windows: string[]): string | null {
  if (windows.length === 0) return "至少要有一個取餐時段";
  if (windows.length > MAX_PICKUP_WINDOWS) return `取餐時段最多 ${MAX_PICKUP_WINDOWS} 個`;
  const bad = windows.find(w => !isValidWindow(w));
  if (bad) return `取餐時段「${slotLabel(bad)}」的結束時間要晚於開始時間`;
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      if (windowsOverlap(windows[i], windows[j])) return `取餐時段「${slotLabel(windows[i])}」跟「${slotLabel(windows[j])}」重疊了`;
    }
  }
  return null;
}

// ── Subscription buttons（真實 vendors/{id}，轉換限制見 firestore.rules）──────────
function SubscriptionCancelButton({ vendor }: { vendor: Vendor }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const mut = useMutation({
    mutationFn: () => requestCancelSubscription(vendor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myVendorDocKey(vendor.id) });
      toast({ title: "已申請取消訂閱", description: "帳號將於到期日後暫停，資料持續保留。" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });
  return (
    <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 text-xs"
      disabled={mut.isPending}
      onClick={async () => {
        if (await confirm({ title: "要申請取消訂閱嗎？", description: "帳號將於到期日後暫停，您的資料仍會保留；到期前都可以恢復。", confirmLabel: "確定取消訂閱", destructive: true })) mut.mutate();
      }}>
      {mut.isPending ? "處理中..." : "申請取消訂閱"}
    </Button>
  );
}

function SubscriptionUndoCancelButton({ vendor }: { vendor: Vendor }) {
  const { toast } = useToast();
  const mut = useMutation({
    mutationFn: () => undoCancelSubscription(vendor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myVendorDocKey(vendor.id) });
      toast({ title: "已恢復訂閱", description: "取消申請已撤回，帳號會照常續約。" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "操作失敗", description: err.message }),
  });
  return (
    <Button size="sm" className="text-xs" disabled={mut.isPending} onClick={() => mut.mutate()}>
      {mut.isPending ? "處理中..." : "撤回取消、繼續訂閱"}
    </Button>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/settings.tsx.
// 2026-09-25：簡介／地址／電話／營業日／公休日／取餐時段／份數上限改讀寫真實
// vendors/{id}（firestore.rules 限定店主只能改這幾個欄位，店名只有管理員能改），
// 消費端取餐時段選擇跟結帳驗證都照這裡的設定（lib/pickupSlots.ts、functions/src/pricing.js）。
// 封面圖 2026-09-28 改存 vendors/{id}.cover_image。
// TODO(firebase): 桌位（現場點餐 QR）仍讀寫 mockData.ts——屬於 TODO §7 待決策的現場點餐，
// QR 連到的 /menu/:id 目前也沒有這個頁面。
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
  const [pickupWindows, setPickupWindows] = useState<string[]>(DEFAULT_PICKUP_WINDOWS);
  const [slotCapacity, setSlotCapacity] = useState("");
  const [newTable, setNewTable] = useState("");

  const { data: myVendor, isLoading } = useQuery({
    queryKey: ["myVendor", user?.id],
    queryFn: async () => mockGetMyVendor(),
    enabled: !!user,
  });

  const tables: string[] = myVendor?.tables ?? [];
  const { data: realVendor, isLoading: realVendorLoading } = useMyVendor();

  useEffect(() => {
    if (!realVendor) return;
    setName(realVendor.name ?? "");
    setDescription(realVendor.description ?? "");
    setAddress(realVendor.address ?? "");
    setPhone(realVendor.phone ?? "");
    setCoverImage(realVendor.cover_image ?? "");
    setHolidays(realVendor.holidays ?? []);
    const bh = realVendor.business_hours;
    setBusinessHours(bh && bh.length === 7 ? bh : DEFAULT_BH);
    setPickupWindows(realVendor.pickup_windows?.length ? realVendor.pickup_windows : DEFAULT_PICKUP_WINDOWS);
    setSlotCapacity(realVendor.slot_capacity ? String(realVendor.slot_capacity) : "");
  }, [realVendor]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!realVendor) throw new Error("這個帳號還沒綁定商家，請聯絡平台");
      const windowsProblem = pickupWindowsProblem(pickupWindows);
      if (windowsProblem) throw new Error(windowsProblem);
      const capacityText = slotCapacity.trim();
      const capacity = capacityText === "" ? 0 : Number(capacityText);
      if (!Number.isInteger(capacity) || capacity < 0 || capacity > 10000) {
        throw new Error("份數上限請填 0～10000 的整數（空白或 0 代表不限）");
      }
      if (holidays.length > MAX_HOLIDAYS) throw new Error(`公休日最多 ${MAX_HOLIDAYS} 天`);
      await updateDoc(doc(db, "vendors", realVendor.id), {
        description: description.trim(),
        address: address.trim(),
        phone: phone.trim(),
        business_hours: businessHours,
        holidays,
        pickup_windows: [...pickupWindows].sort(),
        slot_capacity: capacity,
        cover_image: coverImage,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myVendorDocKey(realVendor?.id) });
      queryClient.invalidateQueries({ queryKey: ["myVendor", user?.id] });
      toast({ title: "儲存成功", description: "消費者下單時會照新的取餐時段與份數上限。" });
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

  function setWindowPart(index: number, part: 0 | 1, value: string) {
    setPickupWindows(prev => prev.map((w, i) => {
      if (i !== index) return w;
      const pieces = w.split("-");
      pieces[part] = value;
      return pieces.join("-");
    }));
  }

  function addPickupWindow() {
    const last = [...pickupWindows].sort().at(-1);
    const start = last ? last.split("-")[1] : "12:00";
    setPickupWindows(prev => [...prev, `${start}-${addMinutes(start, 30)}`]);
  }

  if (isLoading || realVendorLoading) return (
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
              <Label>店家名稱</Label>
              <Input value={name} readOnly disabled className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">店名變更請聯絡平台（避免冒用其他店家名稱）。</p>
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
                <Tooltip content="將第一個開放日的時間套用至所有開放日">
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-orange-600" onClick={syncAllOpenTimes}>
                    <Copy /> 同步所有開放日
                  </Button>
                </Tooltip>
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
                  aria-pressed={h.open}
                  aria-label={`星期${DAY_NAMES[h.weekday]}${h.open ? "營業" : "公休"}`}
                  className={`w-9 h-9 rounded-full text-sm font-medium border transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
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
                      <Input
                        type="time" value={h.openTime}
                        onChange={e => setBH(h.weekday, { openTime: e.target.value })}
                        className="h-10 w-[6.8rem] px-2"
                      />
                      <span className="text-muted-foreground text-xs">─</span>
                      <Input
                        type="time" value={h.closeTime}
                        onChange={e => setBH(h.weekday, { closeTime: e.target.value })}
                        className="h-10 w-[6.8rem] px-2"
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
              <Input
                type="date" value={newHoliday}
                onChange={e => setNewHoliday(e.target.value)}
                className="h-10 flex-1"
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-0.5 h-6 w-6 rounded-full text-orange-700 hover:bg-red-50 hover:text-red-600 [&_svg]:size-3.5"
                      aria-label={`移除公休日 ${fmtHoliday(d)}`}
                      onClick={() => setHolidays(prev => prev.filter(h => h !== d))}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">尚未設定公休日</p>
            )}
          </CardContent>
        </Card>

        {/* ── 取餐時段 ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Timer className="w-4 h-4 text-orange-500" /> 取餐時段
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              消費者預購時只能選這些時段；上面設定為休息的星期、公休日當天不開放預購。
            </p>
            {[...pickupWindows.keys()].map(i => {
              const [start, end] = pickupWindows[i].split("-");
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <Input type="time" value={start} aria-label={`第 ${i + 1} 個時段開始`}
                    onChange={e => setWindowPart(i, 0, e.target.value)} className="h-10 w-[6.8rem] px-2" />
                  <span className="text-muted-foreground text-xs">─</span>
                  <Input type="time" value={end} aria-label={`第 ${i + 1} 個時段結束`}
                    onChange={e => setWindowPart(i, 1, e.target.value)} className="h-10 w-[6.8rem] px-2" />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-600"
                    aria-label={`刪除第 ${i + 1} 個時段`} disabled={pickupWindows.length <= 1}
                    onClick={() => setPickupWindows(prev => prev.filter((_, j) => j !== i))}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              );
            })}
            {pickupWindowsProblem(pickupWindows) && (
              <p className="text-xs text-red-600">{pickupWindowsProblem(pickupWindows)}</p>
            )}
            <Button type="button" size="sm" variant="outline" onClick={addPickupWindow}
              disabled={pickupWindows.length >= MAX_PICKUP_WINDOWS}>
              <Plus className="w-3.5 h-3.5 mr-1" /> 新增時段
            </Button>
          </CardContent>
        </Card>

        {/* ── 份數上限 ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-orange-500" /> 每個時段份數上限
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <Input type="number" inputMode="numeric" min={0} max={10000} step={1}
                value={slotCapacity} onChange={e => setSlotCapacity(e.target.value)}
                placeholder="不限" className="h-10 w-32" aria-label="每個時段份數上限" />
              <span className="text-sm text-muted-foreground">份／每個取餐時段</span>
            </div>
            <p className="text-xs text-muted-foreground">
              同一天同一時段所有餐點合計的上限，額滿後消費者就選不到這個時段。空白或 0 代表不限。
            </p>
          </CardContent>
        </Card>

        {/* ── 儲存按鈕 ── */}
        {!realVendor && (
          <p className="text-sm text-muted-foreground">這個帳號還沒綁定商家，無法儲存設定。</p>
        )}
        <Button
          className="w-full"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !realVendor}
        >
          {saveMutation.isPending ? "儲存中..." : "儲存設定"}
        </Button>

        {/* ── 訂閱狀態 ── */}
        {realVendor && (() => {
          const sub = getSubscriptionState(realVendor);
          const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
            trial:     { label: "首月免費試用中", variant: "default" },
            active:    { label: "訂閱中",        variant: "default" },
            cancelled: { label: "已申請取消（到期前仍可使用）", variant: "outline" },
            expired:   { label: "已到期／暫停",  variant: "destructive" },
          };
          const cfg = statusConfig[sub.status] ?? statusConfig.active;
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
                  <Badge variant={cfg.variant}>{sub.unset ? "尚未設定" : cfg.label}</Badge>
                </div>
                {sub.endDate && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {sub.status === "trial" ? "試用到期日" : sub.status === "cancelled" ? "帳號暫停日" : sub.status === "expired" ? "到期日" : "下次續約日"}
                    </span>
                    <span className="font-medium">{sub.endDate.toLocaleDateString("zh-TW")}</span>
                  </div>
                )}
                {sub.unset && (
                  <p className="text-xs text-muted-foreground bg-gray-50 border rounded p-2">
                    平台尚未為這個店家設定訂閱方案，目前可正常使用，之後由平台通知續約。
                  </p>
                )}
                {!sub.unset && (sub.status === "trial" || sub.status === "active") && (
                  <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-100 rounded p-2">
                    {sub.status === "trial"
                      ? "試用期結束後進入每月 NT$1,999 的訂閱方案，平台會在到期前聯絡您付款。"
                      : "每月 NT$1,999，平台確認收款後延長到下一期。"}
                  </p>
                )}
                {sub.canUndoCancel && (
                  <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>您已申請取消訂閱，帳號將於暫停日後停用。資料完整保留，暫停日前都可以撤回。</span>
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  {sub.canCancel && <SubscriptionCancelButton vendor={realVendor} />}
                  {sub.canUndoCancel && <SubscriptionUndoCancelButton vendor={realVendor} />}
                  <Button asChild size="sm" variant="ghost" className="text-xs">
                    <a href={`mailto:${PLATFORM_CONTACT_EMAIL}?subject=${encodeURIComponent(`訂閱：${realVendor.name}`)}`}>聯絡平台</a>
                  </Button>
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
                className="flex-shrink-0"
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

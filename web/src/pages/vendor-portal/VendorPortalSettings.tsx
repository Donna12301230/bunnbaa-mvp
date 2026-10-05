import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useMyVendor, myVendorDocKey } from "@/hooks/useMyVendor";
import { getSubscriptionState, requestCancelSubscription, trialNotStarted, undoCancelSubscription, PLATFORM_CONTACT_EMAIL } from "@/lib/subscription";
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
import {
  Settings, Plus,
  CalendarDays, CreditCard, AlertTriangle,
  Clock, X, CalendarOff, Copy, LoaderCircle, Timer, Users } from "lucide-react";
import { ImageUploadField } from "@/components/ImageUploadField";
import { format, parseISO } from "date-fns";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_PICKUP_WINDOWS, MAX_HOLIDAYS, MAX_PICKUP_RANGE_MINUTES, MAX_PICKUP_WINDOWS, isValidWindow, mealPeriodLabel, mealPeriodOf, pickupRangeMinutes, slotLabel, windowsOverlap } from "@/lib/pickupSlots";
import { DEFAULT_PLATFORM_CONFIG } from "@/lib/platformConfig";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { currentPosition } from "@/lib/geo";
import type { MenuItem } from "@/types";
import { dateLocale, getLang, tr } from "@/lib/i18n";
import type { BusinessHour, Vendor } from "@/types";
import { Tooltip } from "@/components/ds";

const ORDER_DEADLINE_OFFSET = 30;
const dayNames = () =>
  getLang() === "en" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] : ["日", "一", "二", "三", "四", "五", "六"];

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
    return format(parseISO(dateStr), getLang() === "en" ? "EEE, MMM d" : "M月d日（EEE）", { locale: dateLocale() });
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
  if (windows.length === 0) return tr("至少要有一個取餐時段", "Add at least one pickup time");
  if (windows.length > MAX_PICKUP_WINDOWS) return tr(`取餐時段最多 ${MAX_PICKUP_WINDOWS} 個`, `At most ${MAX_PICKUP_WINDOWS} pickup times`);
  const bad = windows.find(w => !isValidWindow(w));
  if (bad) return tr(`取餐時段「${slotLabel(bad)}」的結束時間要晚於開始時間`, `Pickup time ${slotLabel(bad)} must end after it starts`);
  for (let i = 0; i < windows.length; i++) {
    for (let j = i + 1; j < windows.length; j++) {
      if (windowsOverlap(windows[i], windows[j])) return tr(`取餐時段「${slotLabel(windows[i])}」跟「${slotLabel(windows[j])}」重疊了`, `Pickup times ${slotLabel(windows[i])} and ${slotLabel(windows[j])} overlap`);
    }
  }
  // 1002 規格 §2：每個餐期一段取餐時段，每段不超過 2 小時（早餐、午餐、晚餐各自算）
  if (pickupRangeMinutes(windows) > MAX_PICKUP_RANGE_MINUTES) return tr("每個餐期的取餐時段（最早到最晚）不可超過 2 小時", "Each meal's pickup window can't exceed 2 hours");
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
      toast({ title: tr("已申請取消訂閱", "Cancellation requested"), description: tr("帳號將於到期日後暫停，資料持續保留。", "Your account will be suspended after the end date; your data is kept.") });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("操作失敗", "Action failed"), description: err.message }),
  });
  return (
    <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50 text-xs"
      disabled={mut.isPending}
      onClick={async () => {
        if (await confirm({ title: tr("要申請取消訂閱嗎？", "Cancel your subscription?"), description: tr("帳號將於到期日後暫停，您的資料仍會保留；到期前都可以恢復。", "Your account will be suspended after the end date. Your data is kept, and you can undo this before then."), confirmLabel: tr("確定取消訂閱", "Cancel subscription"), destructive: true })) mut.mutate();
      }}>
      {mut.isPending ? tr("處理中...", "Working...") : tr("申請取消訂閱", "Cancel subscription")}
    </Button>
  );
}

function SubscriptionUndoCancelButton({ vendor }: { vendor: Vendor }) {
  const { toast } = useToast();
  const mut = useMutation({
    mutationFn: () => undoCancelSubscription(vendor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myVendorDocKey(vendor.id) });
      toast({ title: tr("已恢復訂閱", "Subscription restored"), description: tr("取消申請已撤回，帳號會照常續約。", "Your cancellation was withdrawn; the account will renew as usual.") });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("操作失敗", "Action failed"), description: err.message }),
  });
  return (
    <Button size="sm" className="text-xs" disabled={mut.isPending} onClick={() => mut.mutate()}>
      {mut.isPending ? tr("處理中...", "Working...") : tr("撤回取消、繼續訂閱", "Undo cancellation")}
    </Button>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────
// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/settings.tsx.
// 2026-09-25：簡介／地址／電話／營業日／公休日／取餐時段／份數上限改讀寫真實
// vendors/{id}（firestore.rules 限定店主只能改這幾個欄位，店名只有管理員能改），
// 消費端取餐時段選擇跟結帳驗證都照這裡的設定（lib/pickupSlots.ts、functions/src/pricing.js）。
// 封面圖 2026-09-28 改存 vendors/{id}.cover_image。原本 Parse 雛型的「桌位 QR（現場點餐）」
// 同日拿掉：TODO §7 決定不做現場點餐，QR 連到的 /menu/:id 也從來沒有這個頁面。
export default function VendorPortalSettings() {
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [businessHours, setBusinessHours] = useState<BusinessHour[]>(DEFAULT_BH);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [newHoliday, setNewHoliday] = useState("");
  const [pickupWindows, setPickupWindows] = useState<string[]>(DEFAULT_PICKUP_WINDOWS);
  const [slotCapacity, setSlotCapacity] = useState("");
  // 第一階段規格 §2「店家可調」
  const [cutoffTime, setCutoffTime] = useState(DEFAULT_PLATFORM_CONFIG.cutoffTime);
  const [safetyRate, setSafetyRate] = useState(String(DEFAULT_PLATFORM_CONFIG.safetyStockRate * 100));
  const [minQty, setMinQty] = useState(String(DEFAULT_PLATFORM_CONFIG.candidateMinQty));
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [forecast, setForecast] = useState<Record<string, string>>({});

  const { data: realVendor, isLoading: realVendorLoading } = useMyVendor();
  const { data: menuItems = [] } = useQuery({
    queryKey: ["vendorMenu", realVendor?.id],
    queryFn: async () => (await getDocs(query(collection(db, "menu_items"), where("vendor_id", "==", realVendor!.id)))).docs.map((d) => ({ id: d.id, ...d.data() }) as MenuItem),
    enabled: !!realVendor?.id,
  });

  useEffect(() => {
    if (!realVendor) return;
    setName(realVendor.name ?? "");
    setDescription(realVendor.description ?? "");
    setDescriptionEn(realVendor.description_en ?? "");
    setAddress(realVendor.address ?? "");
    setPhone(realVendor.phone ?? "");
    setCoverImage(realVendor.cover_image ?? "");
    setHolidays(realVendor.holidays ?? []);
    const bh = realVendor.business_hours;
    setBusinessHours(bh && bh.length === 7 ? bh : DEFAULT_BH);
    setPickupWindows(realVendor.pickup_windows?.length ? realVendor.pickup_windows : DEFAULT_PICKUP_WINDOWS);
    setSlotCapacity(realVendor.slot_capacity ? String(realVendor.slot_capacity) : "");
    setCutoffTime(realVendor.cutoff_time ?? DEFAULT_PLATFORM_CONFIG.cutoffTime);
    setSafetyRate(String(Math.round((realVendor.safety_stock_rate ?? DEFAULT_PLATFORM_CONFIG.safetyStockRate) * 100)));
    setMinQty(String(realVendor.candidate_min_qty ?? DEFAULT_PLATFORM_CONFIG.candidateMinQty));
    setLat(realVendor.lat != null ? String(realVendor.lat) : "");
    setLng(realVendor.lng != null ? String(realVendor.lng) : "");
    setForecast(Object.fromEntries(Object.entries(realVendor.forecast_daily ?? {}).map(([k, v]) => [k, String(v)])));
  }, [realVendor]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!realVendor) throw new Error(tr("這個帳號還沒綁定商家，請聯絡平台", "This account isn't linked to a vendor yet. Please contact the platform"));
      const windowsProblem = pickupWindowsProblem(pickupWindows);
      if (windowsProblem) throw new Error(windowsProblem);
      const capacityText = slotCapacity.trim();
      const capacity = capacityText === "" ? 0 : Number(capacityText);
      if (!Number.isInteger(capacity) || capacity < 0 || capacity > 10000) {
        throw new Error(tr("份數上限請填 0～10000 的整數（空白或 0 代表不限）", "The limit must be a whole number from 0 to 10000 (blank or 0 means no limit)"));
      }
      if (holidays.length > MAX_HOLIDAYS) throw new Error(tr(`公休日最多 ${MAX_HOLIDAYS} 天`, `At most ${MAX_HOLIDAYS} closing days`));
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime) || cutoffTime > DEFAULT_PLATFORM_CONFIG.cutoffTime) {
        throw new Error(tr(`截單時間只能提前，不能晚於前一天 ${DEFAULT_PLATFORM_CONFIG.cutoffTime}`, `Cutoff can only be earlier than ${DEFAULT_PLATFORM_CONFIG.cutoffTime}`));
      }
      const safety = Number(safetyRate) / 100;
      if (!(safety >= 0 && safety <= 1)) throw new Error(tr("安全庫存請填 0～100%", "Safety stock must be 0–100%"));
      const min = Number(minQty);
      if (!Number.isInteger(min) || min < 1 || min > 500) throw new Error(tr("候選菜成立最低量請填 1～500 的整數", "Minimum must be 1–500"));
      const latNum = lat.trim() === "" ? null : Number(lat);
      const lngNum = lng.trim() === "" ? null : Number(lng);
      if ((latNum !== null && !Number.isFinite(latNum)) || (lngNum !== null && !Number.isFinite(lngNum))) throw new Error(tr("座標格式不正確", "Invalid coordinates"));
      await updateDoc(doc(db, "vendors", realVendor.id), {
        description: description.trim(),
        // 英文簡介：手動改過就釘住（i18n_src 設成目前中文，自動翻譯不會蓋掉）；
        // 清空＝交回自動翻譯；沒動＝只改中文時照常自動重翻
        ...(descriptionEn.trim() !== (realVendor.description_en ?? "").trim()
          ? descriptionEn.trim()
            ? { description_en: descriptionEn.trim(), "i18n_src.description": description.trim() }
            : { description_en: deleteField(), "i18n_src.description": deleteField() }
          : {}),
        address: address.trim(),
        phone: phone.trim(),
        business_hours: businessHours,
        holidays,
        pickup_windows: [...pickupWindows].sort(),
        slot_capacity: capacity,
        cover_image: coverImage,
        cutoff_time: cutoffTime,
        safety_stock_rate: safety,
        candidate_min_qty: min,
        ...(latNum !== null && lngNum !== null ? { lat: latNum, lng: lngNum } : {}),
        forecast_daily: Object.fromEntries(Object.entries(forecast).filter(([, v]) => v.trim() !== "" && Number(v) >= 0).map(([k, v]) => [k, Number(v)])),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myVendorDocKey(realVendor?.id) });
      toast({ title: tr("儲存成功", "Saved"), description: tr("消費者下單時會照新的取餐時段與份數上限。", "New orders will use your updated pickup times and limits.") });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: err.message }),
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
    toast({ title: tr(`已套用 ${first.openTime}─${first.closeTime} 至所有開放日`, `Applied ${first.openTime}–${first.closeTime} to all open days`) });
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

  if (realVendorLoading) return (
    <VendorPortalLayout>
      <div className="flex justify-center py-20">
        <div role="status" className="flex flex-col items-center gap-2 text-muted-foreground">
          <LoaderCircle className="w-6 h-6 animate-spin text-orange-400 motion-reduce:animate-none" aria-hidden="true" />
          <span className="sr-only">{tr("載入中", "Loading")}</span>
        </div>
      </div>
    </VendorPortalLayout>
  );

  const openDaysCount = businessHours.filter(h => h.open).length;

  return (
    <VendorPortalLayout>
      <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-4 flex items-center gap-2">
        <Settings className="w-5 h-5 text-orange-500" /> {tr("店家設定", "Store settings")}
      </h1>

      <div className="max-w-lg space-y-5">

        {/* ── 預購規則（第一階段規格 §2 店家可調） ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tr("預購規則", "Pre-order rules")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cutoff">{tr("截單時間（取餐前一天）", "Cutoff (day before)")}</Label>
                <Input id="cutoff" type="time" value={cutoffTime} max={DEFAULT_PLATFORM_CONFIG.cutoffTime} onChange={(e) => setCutoffTime(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">{tr(`只能提前，不能晚於 ${DEFAULT_PLATFORM_CONFIG.cutoffTime}`, `Earlier only, not after ${DEFAULT_PLATFORM_CONFIG.cutoffTime}`)}</p>
              </div>
              <div>
                <Label htmlFor="safety">{tr("安全庫存（%）", "Safety stock (%)")}</Label>
                <Input id="safety" type="number" min={0} max={100} value={safetyRate} onChange={(e) => setSafetyRate(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">{tr("預測用量 × (1 + 安全庫存)", "Forecast × (1 + safety)")}</p>
              </div>
              <div>
                <Label htmlFor="minqty">{tr("候選菜成立最低量（份）", "Candidate minimum (meals)")}</Label>
                <Input id="minqty" type="number" min={1} value={minQty} onChange={(e) => setMinQty(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>{tr("取餐點座標（附近愛心餐、區域洞察用）", "Pickup location (charity map, area insights)")}</Label>
              <div className="flex gap-2">
                <Input placeholder={tr("緯度", "Lat")} value={lat} onChange={(e) => setLat(e.target.value)} />
                <Input placeholder={tr("經度", "Lng")} value={lng} onChange={(e) => setLng(e.target.value)} />
                <Button type="button" variant="outline" size="sm" onClick={async () => { try { const pos = await currentPosition(); setLat(pos.lat.toFixed(5)); setLng(pos.lng.toFixed(5)); } catch { toast({ variant: "destructive", title: tr("無法定位", "Couldn't locate") }); } }}>{tr("用目前位置", "Use here")}</Button>
              </div>
            </div>
            {menuItems.length > 0 && (
              <div>
                <Label>{tr("新店家每日預估份數（前 4 週預測用）", "Daily estimate for new stores (first 4 weeks)")}</Label>
                <div className="space-y-1 mt-1">
                  {menuItems.map((item) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <span className="flex-1 truncate">{item.name}</span>
                      <Input className="w-24 h-8" type="number" min={0} value={forecast[item.id] ?? ""} onChange={(e) => setForecast((f) => ({ ...f, [item.id]: e.target.value }))} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── 基本資料 ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{tr("基本資料", "Basics")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>{tr("店家名稱", "Store name")}</Label>
              <Input value={name} readOnly disabled className="mt-1" />
              <p className="text-xs text-muted-foreground mt-1">{tr("店名變更請聯絡平台（避免冒用其他店家名稱）。", "Contact the platform to change your store name (to prevent impersonation).")}</p>
            </div>
            <div>
              <Label>{tr("店家簡介", "About")}</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="mt-1" />
            </div>
            <div>
              <Label>{tr("英文簡介（自動翻譯，可修改）", "About in English (auto-translated, editable)")}</Label>
              <Textarea
                value={descriptionEn}
                onChange={e => setDescriptionEn(e.target.value)}
                rows={2}
                className="mt-1"
                placeholder={tr("留空＝自動翻譯", "Leave blank to auto-translate")}
              />
              <p className="text-xs text-muted-foreground mt-1">{tr("只改中文、沒改英文時，英文會重新自動翻譯。", "If you change the Chinese but not the English, the English is re-translated automatically.")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tr("地址", "Address")}</Label>
                <Input value={address} onChange={e => setAddress(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label>{tr("聯絡電話", "Phone")}</Label>
                <Input value={phone} onChange={e => setPhone(e.target.value)} className="mt-1" />
              </div>
            </div>
            <ImageUploadField label={tr("店家封面圖", "Cover photo")} vendorId={realVendor?.id} value={coverImage} onChange={setCoverImage} />
          </CardContent>
        </Card>

        {/* ── 營業時段 ── */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="w-4 h-4 text-orange-500" /> {tr("營業時段", "Opening hours")}
              </CardTitle>
              {openDaysCount > 1 && (
                <Tooltip content={tr("將第一個開放日的時間套用至所有開放日", "Copy the first open day's hours to all open days")}>
                  <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-orange-600" onClick={syncAllOpenTimes}>
                    <Copy /> {tr("同步所有開放日", "Apply to all")}
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
                  aria-label={tr(`星期${dayNames()[h.weekday]}${h.open ? "營業" : "公休"}`, `${dayNames()[h.weekday]}: ${h.open ? "open" : "closed"}`)}
                  className={`w-9 h-9 rounded-full text-sm font-medium border transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    h.open
                      ? "bg-orange-500 text-white border-orange-500"
                      : "bg-white text-muted-foreground border-border hover:border-orange-300"
                  }`}
                >
                  {dayNames()[h.weekday]}
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
                      {tr("訂餐截止", "Order cutoff")} {deadlineOf(h.closeTime)}
                    </p>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">{tr("休息", "Closed")}</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── 公休日 ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarOff className="w-4 h-4 text-orange-500" /> {tr("公休日", "Closing days")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {tr("國定假日、臨時休息等特定日期，優先於每週營業時段。", "Specific dates like public holidays or one-off closures; these override your weekly hours.")}
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
                <Plus className="w-3.5 h-3.5 mr-1" /> {tr("新增", "Add")}
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
                      aria-label={tr(`移除公休日 ${fmtHoliday(d)}`, `Remove closing day ${fmtHoliday(d)}`)}
                      onClick={() => setHolidays(prev => prev.filter(h => h !== d))}
                    >
                      <X />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{tr("尚未設定公休日", "No closing days set")}</p>
            )}
          </CardContent>
        </Card>

        {/* ── 取餐時段 ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Timer className="w-4 h-4 text-orange-500" /> {tr("取餐時段", "Pickup times")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {tr("消費者預購時只能選這些時段（以 30 分鐘為一格）；依開始時間歸早餐 06:00–10:30／午餐 10:30–14:00／晚餐 16:30–20:00，每個餐期整段不超過 2 小時。品項在菜單設定供應哪些餐期。休息的星期、公休日不開放預購。", "Customers can only choose these times (30-minute slots). Each slot belongs to breakfast 06:00–10:30, lunch 10:30–14:00 or dinner 16:30–20:00 by its start time; each meal's window is at most 2 hours.")}
            </p>
            {[...pickupWindows.keys()].map(i => {
              const [start, end] = pickupWindows[i].split("-");
              return (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-10 text-xs font-semibold text-muted-foreground">{isValidWindow(pickupWindows[i]) ? mealPeriodLabel(mealPeriodOf(pickupWindows[i])) : ""}</span>
                  <Input type="time" value={start} aria-label={tr(`第 ${i + 1} 個時段開始`, `Pickup time ${i + 1} start`)}
                    onChange={e => setWindowPart(i, 0, e.target.value)} className="h-10 w-[6.8rem] px-2" />
                  <span className="text-muted-foreground text-xs">─</span>
                  <Input type="time" value={end} aria-label={tr(`第 ${i + 1} 個時段結束`, `Pickup time ${i + 1} end`)}
                    onChange={e => setWindowPart(i, 1, e.target.value)} className="h-10 w-[6.8rem] px-2" />
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-red-600"
                    aria-label={tr(`刪除第 ${i + 1} 個時段`, `Delete pickup time ${i + 1}`)} disabled={pickupWindows.length <= 1}
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
              <Plus className="w-3.5 h-3.5 mr-1" /> {tr("新增時段", "Add time")}
            </Button>
          </CardContent>
        </Card>

        {/* ── 份數上限 ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4 text-orange-500" /> {tr("每個時段份數上限", "Meals per pickup time")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2">
              <Input type="number" inputMode="numeric" min={0} max={10000} step={1}
                value={slotCapacity} onChange={e => setSlotCapacity(e.target.value)}
                placeholder={tr("不限", "No limit")} className="h-10 w-32" aria-label={tr("每個時段份數上限", "Meals per pickup time")} />
              <span className="text-sm text-muted-foreground">{tr("份／每個取餐時段", "meals per pickup time")}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {tr("同一天同一時段所有餐點合計的上限，額滿後消費者就選不到這個時段。空白或 0 代表不限。", "Total meals across all items for the same date and time. Once full, customers can't choose it. Blank or 0 means no limit.")}
            </p>
          </CardContent>
        </Card>

        {/* ── 儲存按鈕 ── */}
        {!realVendor && (
          <p className="text-sm text-muted-foreground">{tr("這個帳號還沒綁定商家，無法儲存設定。", "This account isn't linked to a vendor, so settings can't be saved.")}</p>
        )}
        <Button
          className="w-full"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !realVendor}
        >
          {saveMutation.isPending ? tr("儲存中...", "Saving...") : tr("儲存設定", "Save settings")}
        </Button>

        {/* ── 訂閱狀態 ── */}
        {realVendor && (() => {
          const sub = getSubscriptionState(realVendor);
          const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
            trial:     { label: tr("首月免費試用中", "Free first-month trial"), variant: "default" },
            active:    { label: tr("訂閱中", "Active"),        variant: "default" },
            cancelled: { label: tr("已申請取消（到期前仍可使用）", "Cancelling (usable until the end date)"), variant: "outline" },
            expired:   { label: tr("已到期／暫停", "Expired / suspended"),  variant: "destructive" },
          };
          const cfg = statusConfig[sub.status] ?? statusConfig.active;
          return (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="w-4 h-4 text-amber-500" /> {tr("訂閱狀態", "Subscription")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{tr("目前狀態", "Status")}</span>
                  <Badge variant={cfg.variant}>{sub.unset ? tr("尚未設定", "Not set") : cfg.label}</Badge>
                </div>
                {sub.endDate && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {sub.status === "trial" ? tr("試用到期日", "Trial ends") : sub.status === "cancelled" ? tr("帳號暫停日", "Suspends on") : sub.status === "expired" ? tr("到期日", "Expired on") : tr("下次續約日", "Renews on")}
                    </span>
                    <span className="font-medium">{sub.endDate.toLocaleDateString(tr("zh-TW", "en-US"))}</span>
                  </div>
                )}
                {sub.unset && (
                  <p className="text-xs text-muted-foreground bg-gray-50 border rounded p-2">
                    {tr("平台尚未為這個店家設定訂閱方案，目前可正常使用，之後由平台通知續約。", "No subscription plan has been set for this store yet. You can use everything as normal; the platform will contact you about renewal.")}
                  </p>
                )}
                {!sub.unset && (sub.status === "trial" || sub.status === "active") && (
                  <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-100 rounded p-2">
                    {sub.status === "trial" && trialNotStarted(realVendor)
                      ? tr("首月免費從第一次上架品項那天起算 30 天，目前還沒開始計算。", "Your free month starts the day you first list an item (30 days); it hasn't started yet.")
                      : sub.status === "trial"
                      ? tr("試用期結束後進入每月 NT$1,999 的訂閱方案，平台會在到期前聯絡您付款。", "After the trial, the plan is NT$1,999 / month. We'll contact you about payment before it ends.")
                      : tr("每月 NT$1,999，平台確認收款後延長到下一期。", "NT$1,999 / month; extended to the next period once payment is confirmed.")}
                  </p>
                )}
                {sub.canUndoCancel && (
                  <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{tr("您已申請取消訂閱，帳號將於暫停日後停用。資料完整保留，暫停日前都可以撤回。", "You've asked to cancel. The account will be suspended after the date above; your data is kept and you can undo this until then.")}</span>
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  {sub.canCancel && <SubscriptionCancelButton vendor={realVendor} />}
                  {sub.canUndoCancel && <SubscriptionUndoCancelButton vendor={realVendor} />}
                  <Button asChild size="sm" variant="ghost" className="text-xs">
                    <a href={`mailto:${PLATFORM_CONTACT_EMAIL}?subject=${encodeURIComponent(`訂閱：${realVendor.name}`)}`}>{tr("聯絡平台", "Contact us")}</a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })()}

      </div>
    </VendorPortalLayout>
  );
}

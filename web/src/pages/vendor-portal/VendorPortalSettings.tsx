import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useMyVendor, myVendorDocKey } from "@/hooks/useMyVendor";
import { PLATFORM_CONTACT_EMAIL } from "@/lib/subscription";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  Settings, Plus, Minus, CreditCard, AlertTriangle, CheckCircle2, Image as ImageIcon, LocateFixed, Mail, MapPin, Phone, Save, SlidersHorizontal, Store,
  Clock, X, CalendarOff, Copy, Timer, Users } from "lucide-react";
import InfoTip from "@/components/InfoTip";
import PortalPageHeader from "@/components/PortalPageHeader";
import { Spinner } from "@/components/ds";
import { cn } from "@/lib/utils";
import { ImageUploadField } from "@/components/ImageUploadField";
import { addMonths, eachDayOfInterval, endOfMonth, format, getDay, parseISO, startOfMonth } from "date-fns";
import { deleteField, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { DEFAULT_PICKUP_WINDOWS, MAX_HOLIDAYS, MAX_PICKUP_RANGE_MINUTES, MAX_PICKUP_WINDOWS, MEAL_PERIODS, isValidWindow, mealPeriodLabel, mealPeriodOf, pickupRangeMinutes, slotLabel, windowsOverlap } from "@/lib/pickupSlots";
import { DEFAULT_PLATFORM_CONFIG, liveConfig, usePlatformConfig } from "@/lib/platformConfig";
import { withCommission } from "@/lib/pricing";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, query, where } from "firebase/firestore";
import { currentPosition } from "@/lib/geo";
import type { MenuItem } from "@/types";
import { dateLocale, getLang, tr } from "@/lib/i18n";
import type { BusinessHour } from "@/types";

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

// For vendors that never set this, diners see "open every day", so the default here must match
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

/** Returns an error message if the pickup slot list is invalid. */
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
  // one pickup slot per meal period, each at most 2 hours (breakfast, lunch and dinner counted separately)
  if (pickupRangeMinutes(windows) > MAX_PICKUP_RANGE_MINUTES) return tr("每個餐期的取餐時段（最早到最晚）不可超過 2 小時", "Each meal's pickup window can't exceed 2 hours");
  return null;
}

// ── Main Component ───────────────────────────────────────────────────────────
// Ported from BunnBaa Parse_Ref's client/src/pages/vendor/settings.tsx.
// 2026-09-25: about / address / phone / business days / closed days / pickup slots / portion limit now read and write the real
// vendors/{id} (firestore.rules lets the vendor owner change only these fields; only admins can change the store name),
// and diner-side pickup slot selection and checkout validation follow these settings (lib/pickupSlots.ts, functions/src/pricing.js).
// The cover image moved to vendors/{id}.cover_image on 2026-09-28. The Parse prototype's "table QR (dine-in ordering)"
// was removed the same day: dine-in ordering is out of scope, and the /menu/:id page the QR linked to never existed.
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
  // Vendor-adjustable settings
  const [cutoffTime, setCutoffTime] = useState(liveConfig().cutoffTime);
  const [safetyRate, setSafetyRate] = useState(String(DEFAULT_PLATFORM_CONFIG.safetyStockRate * 100));
  const [minQty, setMinQty] = useState(String(DEFAULT_PLATFORM_CONFIG.candidateMinQty));
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [forecast, setForecast] = useState<Record<string, string>>({});
  const [section, setSection] = useState<"store" | "hours" | "pickup" | "rules" | "plan">("store");
  const { data: platformConfig } = usePlatformConfig();

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
    setCutoffTime(realVendor.cutoff_time ?? liveConfig().cutoffTime);
    setSafetyRate(String(Math.round((realVendor.safety_stock_rate ?? DEFAULT_PLATFORM_CONFIG.safetyStockRate) * 100)));
    setMinQty(String(realVendor.candidate_min_qty ?? DEFAULT_PLATFORM_CONFIG.candidateMinQty));
    setLat(realVendor.lat != null ? String(realVendor.lat) : "");
    setLng(realVendor.lng != null ? String(realVendor.lng) : "");
    setForecast(Object.fromEntries(Object.entries(realVendor.forecast_daily ?? {}).map(([k, v]) => [k, String(v)])));
  }, [realVendor]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!realVendor) throw new Error(tr("這個帳號還沒綁定店家，請聯絡平台", "This account isn't linked to a vendor yet. Please contact the platform"));
      const windowsProblem = pickupWindowsProblem(pickupWindows);
      if (windowsProblem) throw new Error(windowsProblem);
      const capacityText = slotCapacity.trim();
      const capacity = capacityText === "" ? 0 : Number(capacityText);
      if (!Number.isInteger(capacity) || capacity < 0 || capacity > 10000) {
        throw new Error(tr("份數上限請填 0～10000 的整數（空白或 0 代表不限）", "The limit must be a whole number from 0 to 10000 (blank or 0 means no limit)"));
      }
      // firestore.rules only accepts https cover URLs; check here first, otherwise the user only sees PERMISSION_DENIED
      if (coverImage && !coverImage.trim().startsWith("https://")) throw new Error(tr("封面圖網址要以 https:// 開頭", "The cover image URL must start with https://"));
      if (coverImage.length > 500) throw new Error(tr("封面圖網址太長（最多 500 字）", "The cover image URL is too long (500 characters max)"));
      if (holidays.length > MAX_HOLIDAYS) throw new Error(tr(`公休日最多 ${MAX_HOLIDAYS} 天`, `At most ${MAX_HOLIDAYS} closing days`));
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cutoffTime) || cutoffTime > liveConfig().cutoffTime) {
        throw new Error(tr(`截單時間只能提前，不能晚於前一天 ${liveConfig().cutoffTime}`, `Cutoff can only be earlier than ${liveConfig().cutoffTime}`));
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
        // English description: once edited by hand it's pinned (i18n_src is set to the current Chinese, so auto-translation won't overwrite it);
        // cleared = hand back to auto-translation; untouched = re-translated automatically as usual when only the Chinese changes
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

  // Apply the first open day's hours to all open days
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
        <Spinner size={24} className="text-muted-foreground" />
      </div>
    </VendorPortalLayout>
  );

  const openDays = businessHours.filter(h => h.open);
  const openDaysCount = openDays.length;
  const windowsProblem = pickupWindowsProblem(pickupWindows);
  const today = format(new Date(), "yyyy-MM-dd");
  const upcomingHolidays = holidays.filter((d) => d >= today);
  const commissionPct = Math.round((platformConfig?.commissionRate ?? DEFAULT_PLATFORM_CONFIG.commissionRate) * 1000) / 10;

  const sections = [
    { key: "store" as const, icon: Store, label: tr("店面", "Store"), sub: coverImage ? tr("封面、簡介、地址", "Cover, about, address") : tr("還沒放封面", "No cover yet"), warn: !coverImage || !address.trim() },
    { key: "hours" as const, icon: Clock, label: tr("營業", "Hours"), sub: tr(`每週 ${openDaysCount} 天・公休 ${upcomingHolidays.length} 天`, `${openDaysCount} days/wk · ${upcomingHolidays.length} closures`), warn: openDaysCount === 0 },
    { key: "pickup" as const, icon: Timer, label: tr("取餐", "Pickup"), sub: tr(`${pickupWindows.length} 個時段・${Number(slotCapacity) > 0 ? `每段 ${slotCapacity} 份` : "不限份數"}`, `${pickupWindows.length} times · ${Number(slotCapacity) > 0 ? `${slotCapacity}/slot` : "no limit"}`), warn: !!windowsProblem },
    { key: "rules" as const, icon: SlidersHorizontal, label: tr("預購規則", "Rules"), sub: tr(`前一天 ${cutoffTime} 截單`, `Cutoff ${cutoffTime} day before`), warn: !lat || !lng },
    { key: "plan" as const, icon: CreditCard, label: tr("合作方案", "Plan"), sub: tr(`每份抽成 ${commissionPct}%`, `${commissionPct}% per meal`) },
  ];

  // Pickup timeline range: 06:00–20:30, with the three meal periods as background bands
  const T0 = 6 * 60, T1 = 20 * 60 + 30;
  const pos = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return `${((Math.min(Math.max(h * 60 + m, T0), T1) - T0) / (T1 - T0)) * 100}%`;
  };
  const bandOf = (range: string) => { const [a, b] = range.split("-"); return { left: pos(a), width: `calc(${pos(b)} - ${pos(a)})` }; };

  return (
    <VendorPortalLayout>
      <PortalPageHeader icon={Settings} title={tr("店家設定", "Store settings")} />

      {/* Five large tab cards, each with a one-line status */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-5" role="tablist">
        {sections.map((s) => (
          <button key={s.key} type="button" role="tab" aria-selected={section === s.key} onClick={() => setSection(s.key)}
            className={cn("relative rounded-xl border-2 p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", section === s.key ? "border-foreground bg-card shadow-sm" : "border-border bg-card/60 hover:bg-card")}>
            <s.icon className="w-5 h-5 text-accent-foreground" />
            <p className="mt-1 font-semibold">{s.label}</p>
            <p className="text-xs text-muted-foreground leading-snug">{s.sub}</p>
            {s.warn && <AlertTriangle className="absolute top-2.5 right-2.5 w-4 h-4 text-primary" aria-label={tr("待補", "Needs attention")} />}
          </button>
        ))}
      </div>

      <div className="max-w-3xl space-y-4 pb-24">
        {/* ── Store ── */}
        {section === "store" && (
          <Card className="border-2 overflow-hidden">
            <div className="relative h-40 sm:h-52 bg-muted">
              {coverImage ? <img src={coverImage} alt={tr("店家封面", "Cover")} className="w-full h-full object-cover" /> : (
                <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground"><ImageIcon className="w-10 h-10" /><span className="text-sm">{tr("還沒有封面照片", "No cover photo yet")}</span></div>
              )}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                <p className="text-2xl font-bold text-white">{name || tr("店名", "Store name")}</p>
                {address && <p className="text-sm text-white/90 flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{address}</p>}
              </div>
            </div>
            <CardContent className="p-4 space-y-4">
              <ImageUploadField label={tr("換封面照片", "Change cover photo")} vendorId={realVendor?.id} value={coverImage} onChange={setCoverImage} />
              <div>
                <Label className="flex items-center gap-1">{tr("店家簡介", "About")}<InfoTip>{tr("店名變更請聯絡平台（避免冒用其他店家名稱）。英文簡介會自動翻譯。", "Contact the platform to change your store name. English is auto-translated.")}</InfoTip></Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="mt-1" placeholder={tr("例：每天現煮的家常便當", "e.g. Home-style bentos cooked daily")} />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><Label className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{tr("地址", "Address")}</Label><Input value={address} onChange={e => setAddress(e.target.value)} className="mt-1" /></div>
                <div><Label className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{tr("聯絡電話", "Phone")}</Label><Input value={phone} onChange={e => setPhone(e.target.value)} className="mt-1" inputMode="tel" /></div>
              </div>
              <details className="rounded-md border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">{tr("英文簡介（自動翻譯，可修改）", "English (auto-translated, editable)")}</summary>
                <Textarea value={descriptionEn} onChange={e => setDescriptionEn(e.target.value)} rows={2} className="mt-2" placeholder={tr("留空＝自動翻譯", "Leave blank to auto-translate")} />
                <p className="text-xs text-muted-foreground mt-1">{tr("只改中文、沒改英文時，英文會重新自動翻譯。", "If you change the Chinese but not the English, the English is re-translated.")}</p>
              </details>
            </CardContent>
          </Card>
        )}

        {/* ── Hours: weekly timeline + closed-day calendar ── */}
        {section === "hours" && (
          <>
            <Card className="border-2">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold flex items-center gap-1.5"><Clock className="w-4 h-4 text-accent-foreground" />{tr("每週營業時間", "Weekly hours")}<InfoTip>{tr("點星期幾切換營業／休息。訂餐截止是關店前 30 分鐘。", "Tap a day to toggle open/closed. Ordering closes 30 min before closing.")}</InfoTip></p>
                  {openDaysCount > 1 && <Button type="button" variant="ghost" size="sm" onClick={syncAllOpenTimes}><Copy /> {tr("全部照第一天", "Copy first day")}</Button>}
                </div>
                {businessHours.map(h => {
                  const [oh, om] = h.openTime.split(":").map(Number);
                  const [ch, cm] = h.closeTime.split(":").map(Number);
                  const a = ((oh * 60 + om) / 1440) * 100, b = ((ch * 60 + cm) / 1440) * 100;
                  return (
                    <div key={h.weekday} className="flex flex-wrap items-center gap-2 sm:gap-3">
                      <button type="button" onClick={() => setBH(h.weekday, { open: !h.open })} aria-pressed={h.open}
                        aria-label={tr(`星期${dayNames()[h.weekday]}${h.open ? "營業" : "公休"}`, `${dayNames()[h.weekday]}: ${h.open ? "open" : "closed"}`)}
                        className={cn("w-11 h-11 shrink-0 rounded-xl text-base font-bold border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", h.open ? "bg-primary text-white border-primary" : "bg-card text-muted-foreground border-border")}>
                        {dayNames()[h.weekday]}
                      </button>
                      <div className="relative flex-1 min-w-[8rem] h-7 rounded-md bg-muted overflow-hidden" aria-hidden="true">
                        {h.open && b > a && <div className="absolute top-0 bottom-0 bg-brand/50" style={{ left: `${a}%`, width: `${b - a}%` }} />}
                        {[6, 12, 18].map((x) => <div key={x} className="absolute top-0 bottom-0 w-px bg-input" style={{ left: `${(x / 24) * 100}%` }} />)}
                        {!h.open && <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">{tr("休息", "Closed")}</span>}
                      </div>
                      {h.open && (
                        <div className="flex items-center gap-1">
                          <Input type="time" value={h.openTime} onChange={e => setBH(h.weekday, { openTime: e.target.value })} className="h-10 w-[6.6rem] px-2" aria-label={tr("開店", "Opens")} />
                          <span className="text-muted-foreground text-xs">─</span>
                          <Input type="time" value={h.closeTime} onChange={e => setBH(h.weekday, { closeTime: e.target.value })} className="h-10 w-[6.6rem] px-2" aria-label={tr("關店", "Closes")} />
                        </div>
                      )}
                      {h.open && <span className="hidden sm:inline text-xs text-muted-foreground w-24">{tr("截止", "Orders by")} {deadlineOf(h.closeTime)}</span>}
                    </div>
                  );
                })}
                <div className="flex text-[11px] text-muted-foreground pl-14 sm:pl-[3.5rem]" aria-hidden="true"><span className="flex-1">0</span><span className="flex-1">6</span><span className="flex-1">12</span><span className="flex-1">18</span></div>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardContent className="p-4 space-y-3">
                <p className="font-semibold flex items-center gap-1.5"><CalendarOff className="w-4 h-4 text-accent-foreground" />{tr("公休日：點日期就休息", "Closing days: tap a date")}<InfoTip>{tr("國定假日、臨時休息等特定日期，優先於每週營業時間。再點一次取消。", "Specific dates like holidays; override weekly hours. Tap again to undo.")}</InfoTip></p>
                <div className="grid sm:grid-cols-2 gap-4">
                  {[0, 1].map((k) => <MonthGrid key={k} offset={k} holidays={holidays} closedWeekdays={businessHours.filter((h) => !h.open).map((h) => h.weekday)} onToggle={(d) => setHolidays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort())} />)}
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-destructive" />{tr("公休", "Closed")}</span>
                  <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-border" />{tr("每週休息", "Weekly off")}</span>
                  <span className="ml-auto inline-flex items-center gap-1.5">
                    {tr("更遠的日期：", "Later date:")}
                    <Input type="date" value={newHoliday} min={today} onChange={e => setNewHoliday(e.target.value)} className="h-8 w-40" />
                    <Button type="button" size="sm" variant="outline" disabled={!newHoliday || holidays.includes(newHoliday)} onClick={() => { setHolidays(prev => [...prev, newHoliday].sort()); setNewHoliday(""); }}><Plus /> {tr("加", "Add")}</Button>
                  </span>
                </div>
                {upcomingHolidays.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {upcomingHolidays.map(d => (
                      <button key={d} type="button" onClick={() => setHolidays(prev => prev.filter(x => x !== d))} className="inline-flex items-center gap-1 rounded-full bg-danger-soft border border-danger/40 px-2.5 py-1 text-sm text-danger-text hover:bg-danger/25" aria-label={tr(`移除公休日 ${fmtHoliday(d)}`, `Remove ${fmtHoliday(d)}`)}>
                        {fmtHoliday(d)} <X className="w-3.5 h-3.5" />
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}

        {/* ── Pickup: slot blocks on the meal-period bands + portion limit ── */}
        {section === "pickup" && (
          <>
            <Card className="border-2">
              <CardContent className="p-4 space-y-3">
                <p className="font-semibold flex items-center gap-1.5"><Timer className="w-4 h-4 text-accent-foreground" />{tr("取餐時段", "Pickup times")}<InfoTip>{tr("消費者只能選這些時段。依開始時間歸早餐 06:00–10:30／午餐 10:30–14:00／晚餐 16:30–20:00，每個餐期整段不超過 2 小時。休息日、公休日不開放。", "Customers can only choose these times. Each slot belongs to breakfast/lunch/dinner by start time; each meal's window is at most 2 hours.")}</InfoTip></p>
                <div className="relative h-14 rounded-lg bg-muted overflow-hidden" role="img" aria-label={pickupWindows.map(slotLabel).join("、")}>
                  {MEAL_PERIODS.map((p) => (
                    <div key={p} className="absolute top-0 bottom-0 bg-warning-soft/80 border-x border-warning/50" style={bandOf(DEFAULT_PLATFORM_CONFIG.mealPeriods[p])}>
                      <span className="absolute top-0.5 left-1 text-[10px] text-warning-text">{mealPeriodLabel(p)}</span>
                    </div>
                  ))}
                  {pickupWindows.filter(isValidWindow).map((w, i) => {
                    const [a, b] = w.split("-");
                    return <div key={i} className="absolute bottom-1.5 h-6 rounded bg-primary border border-white" style={{ left: pos(a), width: `calc(${pos(b)} - ${pos(a)})` }} title={slotLabel(w)} />;
                  })}
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground font-mono" aria-hidden="true">{["06", "09", "12", "15", "18", "20:30"].map((x) => <span key={x}>{x}</span>)}</div>
                <div className="grid sm:grid-cols-2 gap-2">
                  {[...pickupWindows.keys()].map(i => {
                    const [start, end] = pickupWindows[i].split("-");
                    return (
                      <div key={i} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1.5">
                        <span className="w-9 text-xs font-semibold text-warning-text">{isValidWindow(pickupWindows[i]) ? mealPeriodLabel(mealPeriodOf(pickupWindows[i])) : ""}</span>
                        <Input type="time" value={start} aria-label={tr(`第 ${i + 1} 個時段開始`, `Pickup time ${i + 1} start`)} onChange={e => setWindowPart(i, 0, e.target.value)} className="h-9 w-[6.4rem] px-2" />
                        <span className="text-muted-foreground text-xs">─</span>
                        <Input type="time" value={end} aria-label={tr(`第 ${i + 1} 個時段結束`, `Pickup time ${i + 1} end`)} onChange={e => setWindowPart(i, 1, e.target.value)} className="h-9 w-[6.4rem] px-2" />
                        <Button type="button" variant="ghost" size="icon" className="ml-auto h-8 w-8 text-muted-foreground hover:text-danger-text" aria-label={tr(`刪除第 ${i + 1} 個時段`, `Delete pickup time ${i + 1}`)} disabled={pickupWindows.length <= 1} onClick={() => setPickupWindows(prev => prev.filter((_, j) => j !== i))}><X className="w-4 h-4" /></Button>
                      </div>
                    );
                  })}
                </div>
                {windowsProblem && <p className="text-sm text-danger-text flex items-center gap-1"><AlertTriangle className="w-4 h-4" />{windowsProblem}</p>}
                <Button type="button" size="sm" variant="outline" onClick={addPickupWindow} disabled={pickupWindows.length >= MAX_PICKUP_WINDOWS}><Plus /> {tr("加一個時段", "Add a time")}</Button>
              </CardContent>
            </Card>

            <Card className="border-2">
              <CardContent className="p-4 space-y-2">
                <p className="font-semibold flex items-center gap-1.5"><Users className="w-4 h-4 text-accent-foreground" />{tr("每個時段最多做幾份", "Max meals per pickup time")}<InfoTip>{tr("同一天同一時段所有餐點合計，額滿後消費者就選不到這個時段。0 代表不限。", "Total across all items for one date and time. 0 = no limit.")}</InfoTip></p>
                <div className="flex flex-wrap items-center gap-3">
                  <Stepper value={Number(slotCapacity) || 0} step={5} onChange={(n) => setSlotCapacity(n > 0 ? String(n) : "")} label={tr("份數上限", "Limit")} />
                  <span className="text-lg font-semibold">{Number(slotCapacity) > 0 ? tr(`${slotCapacity} 份`, `${slotCapacity} meals`) : tr("不限", "No limit")}</span>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* ── Pre-order rules ── */}
        {section === "rules" && (
          <>
            <div className="grid sm:grid-cols-3 gap-3">
              <Card className="border-2">
                <CardContent className="p-4 space-y-2">
                  <p className="text-sm font-semibold flex items-center gap-1">{tr("截單時間", "Order cutoff")}<InfoTip>{tr(`取餐前一天的這個時間截單、判定許願、產生備料清單。只能提前，不能晚於 ${liveConfig().cutoffTime}。`, `Orders close at this time the day before. Earlier only, not after ${liveConfig().cutoffTime}.`)}</InfoTip></p>
                  <p className="text-xs text-muted-foreground">{tr("前一天", "Day before")}</p>
                  <Input id="cutoff" type="time" value={cutoffTime} max={liveConfig().cutoffTime} onChange={(e) => setCutoffTime(e.target.value)} className="h-12 text-2xl font-bold" />
                </CardContent>
              </Card>
              <Card className="border-2">
                <CardContent className="p-4 space-y-2">
                  <p className="text-sm font-semibold flex items-center gap-1">{tr("叫貨多備", "Safety stock")}<InfoTip>{tr("叫貨時預測用量多抓這個比例，以免不夠。", "Purchasing adds this % on top of forecast use.")}</InfoTip></p>
                  <p className="text-3xl font-bold">+{safetyRate || 0}%</p>
                  <input type="range" min={0} max={50} step={5} value={Number(safetyRate) || 0} onChange={(e) => setSafetyRate(e.target.value)} className="w-full accent-primary" aria-label={tr("安全庫存", "Safety stock")} />
                </CardContent>
              </Card>
              <Card className="border-2">
                <CardContent className="p-4 space-y-2">
                  <p className="text-sm font-semibold flex items-center gap-1">{tr("許願菜成立門檻", "Wish minimum")}<InfoTip>{tr("候選菜至少要這麼多份才會做，不夠就改預設菜。", "A candidate dish is made only when at least this many order it.")}</InfoTip></p>
                  <p className="text-3xl font-bold">{minQty || 0} <span className="text-base font-normal text-muted-foreground">{tr("份", "meals")}</span></p>
                  <Stepper value={Number(minQty) || 0} step={1} min={1} onChange={(n) => setMinQty(String(n))} label={tr("成立門檻", "Minimum")} />
                </CardContent>
              </Card>
            </div>

            <Card className={cn("border-2", (!lat || !lng) && "border-warning/50")}>
              <CardContent className="p-4 space-y-2">
                <p className="font-semibold flex items-center gap-1.5"><MapPin className="w-4 h-4 text-accent-foreground" />{tr("取餐點位置", "Pickup location")}<InfoTip>{tr("附近愛心餐地圖、區域洞察用。", "Used for the charity map and area insights.")}</InfoTip></p>
                {lat && lng ? <p className="text-sm text-success-text flex items-center gap-1"><CheckCircle2 className="w-4 h-4" />{tr("已設定", "Set")} <span className="font-mono text-muted-foreground">{lat}, {lng}</span></p> : <p className="text-sm text-warning-text">{tr("還沒設定，區域洞察和附近愛心餐看不到你的店", "Not set — area insights and the charity map can't find you")}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={async () => { try { const p = await currentPosition(); setLat(p.lat.toFixed(5)); setLng(p.lng.toFixed(5)); } catch { toast({ variant: "destructive", title: tr("無法定位", "Couldn't locate") }); } }}><LocateFixed /> {tr("我現在就在店裡，用目前位置", "I'm at the shop — use my location")}</Button>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs text-muted-foreground">{tr("手動輸入座標", "Enter coordinates")}</summary>
                  <div className="flex gap-2 mt-2">
                    <Input placeholder={tr("緯度", "Lat")} value={lat} onChange={(e) => setLat(e.target.value)} />
                    <Input placeholder={tr("經度", "Lng")} value={lng} onChange={(e) => setLng(e.target.value)} />
                  </div>
                </details>
              </CardContent>
            </Card>

            {menuItems.length > 0 && (
              <Card className="border-2">
                <CardContent className="p-0">
                  <details>
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">{tr("新店家：每天大概賣幾份（前 4 週預測用）", "New store: daily estimate per item (first 4 weeks)")}</summary>
                    <div className="px-4 pb-4 space-y-2">
                      {menuItems.map((item) => (
                        <div key={item.id} className="flex items-center gap-2 text-sm">
                          <span className="flex-1 truncate">{item.name}</span>
                          <Stepper value={Number(forecast[item.id]) || 0} step={1} onChange={(n) => setForecast((f) => ({ ...f, [item.id]: String(n) }))} label={item.name} />
                        </div>
                      ))}
                    </div>
                  </details>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* ── Plan: no monthly fee, commission per meal ── */}
        {section === "plan" && realVendor && (
          <Card className="border-2 border-success/40 bg-success-soft">
            <CardContent className="p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <CreditCard className="w-8 h-8 text-accent-foreground" />
                <div className="flex-1">
                  <p className="text-2xl font-bold">{tr("合作方案", "Partner plan")}</p>
                  <p className="text-sm text-muted-foreground">{tr("沒有月費、沒有上架費", "No monthly fee, no listing fee")}</p>
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold leading-none">{commissionPct}%</p>
                  <p className="text-xs text-muted-foreground">{tr("每份餐點抽成", "per meal")}</p>
                </div>
              </div>
              <p className="text-sm">{tr(`平台從每份餐點的實付金額抽 ${commissionPct}%，撥款時直接扣除；沒有訂單就沒有費用。`, `The platform takes ${commissionPct}% of what the customer pays for each meal, deducted at payout. No orders, no fee.`)}</p>
              <p className="text-sm text-muted-foreground">{tr(`定價時請把抽成加進去：想實收 100 元，售價訂 ${withCommission(100, commissionPct / 100)} 元。菜單編輯畫面的價格欄位旁有「加 ${commissionPct}%」可以一鍵換算。`, `Add the commission when pricing: to net NT$100, list at NT$${withCommission(100, commissionPct / 100)}. The menu editor has a one-tap "+${commissionPct}%" next to the price.`)}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button asChild size="sm" variant="outline"><a href={`mailto:${PLATFORM_CONTACT_EMAIL}?subject=${encodeURIComponent(`合作方案：${realVendor.name}`)}`}><Mail /> {tr("聯絡平台", "Contact us")}</a></Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Save: pinned to the bottom, reachable from any tab */}
      {section !== "plan" && (
        <div className="fixed bottom-16 md:bottom-0 left-0 right-0 md:left-60 z-30 border-t border-border bg-card/95 backdrop-blur px-4 py-3">
          <div className="max-w-3xl flex items-center gap-3">
            <p className="flex-1 text-xs text-muted-foreground">{!realVendor ? tr("這個帳號還沒綁定店家，無法儲存。", "Not linked to a vendor.") : windowsProblem ? <span className="text-danger-text">{windowsProblem}</span> : tr("五個分頁的設定一起存", "Saves all five sections")}</p>
            <Button size="lg" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !realVendor}>
              <Save /> {saveMutation.isPending ? tr("儲存中…", "Saving…") : tr("儲存設定", "Save settings")}
            </Button>
          </div>
        </div>
      )}
    </VendorPortalLayout>
  );
}

/** − number +, large and easy to tap */
function Stepper({ value, step, min = 0, onChange, label }: { value: number; step: number; min?: number; onChange: (n: number) => void; label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border-2 border-border bg-card">
      <button type="button" className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-accent disabled:opacity-40" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label={tr(`${label} 減少`, `${label} down`)}><Minus className="w-4 h-4" /></button>
      <input type="number" className="w-14 bg-transparent text-center font-semibold focus:outline-none [appearance:textfield]" value={value} min={min} onChange={(e) => onChange(Math.max(min, Math.round(Number(e.target.value) || 0)))} aria-label={label} />
      <button type="button" className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-accent" onClick={() => onChange(value + step)} aria-label={tr(`${label} 增加`, `${label} up`)}><Plus className="w-4 h-4" /></button>
    </span>
  );
}

/** One-month calendar; tap a date to toggle a closed day; weekly days off are greyed */
function MonthGrid({ offset, holidays, closedWeekdays, onToggle }: { offset: number; holidays: string[]; closedWeekdays: number[]; onToggle: (d: string) => void }) {
  const first = startOfMonth(addMonths(new Date(), offset));
  const days = eachDayOfInterval({ start: first, end: endOfMonth(first) });
  const today = format(new Date(), "yyyy-MM-dd");
  return (
    <div>
      <p className="text-sm font-semibold mb-1">{format(first, getLang() === "en" ? "MMMM yyyy" : "yyyy 年 M 月", { locale: dateLocale() })}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-xs">
        {dayNames().map((d) => <span key={d} className="text-muted-foreground py-1">{d}</span>)}
        {Array.from({ length: getDay(first) }, (_, i) => <span key={`e${i}`} />)}
        {days.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const off = holidays.includes(key);
          const weekly = closedWeekdays.includes(getDay(d));
          const past = key < today;
          return (
            <button key={key} type="button" disabled={past} onClick={() => onToggle(key)} aria-pressed={off} aria-label={tr(`${format(d, "M/d")}${off ? " 公休" : ""}`, `${format(d, "MMM d")}${off ? " closed" : ""}`)}
              className={cn("h-9 rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                off ? "bg-destructive text-white font-bold" : weekly ? "bg-border text-muted-foreground" : "bg-card hover:bg-accent border border-border",
                key === today && !off && "ring-2 ring-foreground", past && "opacity-40 cursor-default")}>
              {format(d, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { zhTW } from "date-fns/locale";
import { Search, CheckCircle2, AlertCircle, XCircle, CalendarDays } from "lucide-react";
import { db, functions } from "../lib/firebase";
import type { Lock } from "../types";
import VendorPortalLayout from "@/components/VendorPortalLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";

// 沒綁定商家的帳號（例如 emulator 下的 admin）退回 demo 商家
const DEMO_VENDOR_ID = "cafe-renheya-demo";

const noShowSchema = z.object({
  note: z.string().trim().min(2, "請簡短描述狀況（至少 2 個字），這會餵給校準報告的落差模式分析"),
});
type NoShowForm = z.infer<typeof noShowSchema>;

const LOCK_STATUS_STYLE: Record<string, { label: string; className: string }> = {
  locked: { label: "已鎖定", className: "bg-orange-100 text-orange-700" },
  for_resale: { label: "轉賣中", className: "bg-amber-100 text-amber-800" },
  fulfilled: { label: "已完成取餐", className: "bg-green-100 text-green-700" },
  resold_and_fulfilled: { label: "已由轉賣對象完成取餐", className: "bg-green-100 text-green-700" },
  no_show: { label: "已登記未取餐", className: "bg-red-100 text-red-700" },
};

function formatDateLabel(dateStr: string): string {
  try {
    return format(new Date(`${dateStr}T00:00:00`), "M/d (EEE)", { locale: zhTW });
  } catch {
    return dateStr;
  }
}

/**
 * Spec ref: README「尚未實作」清單 — 商家後台標記 no-show／備註的介面。
 * Ported from the old Parse prototype's vendor/scan.tsx pattern: match by
 * the last 8 chars of the lock id rather than a live camera QR scan (the
 * old app never actually wired up its html5-qrcode dependency either).
 * Outcome writes go through `markLockOutcome` because firestore.rules
 * blocks direct client writes to lock status transitions.
 *
 * 2026-09-21：視覺改成跟全站一致的 Tailwind/shadcn（原本是 legacy-ui 的純 CSS，
 * 跟其他頁面風格不一致），邏輯完全沒動——這頁是真的接 Firestore + markLockOutcome
 * Cloud Function 的核對取餐頁，是消費端 MyBookingsPage「使用」面板核銷碼的接受端。
 *
 * 2026-09-21（再次調整）：原本只有一個輸入框太陽春，補上「取餐總覽」日曆格
 * ——依取餐日期（欄）× 取餐時段（列）排成跟消費端 MyBookingsPage 一樣的行事曆
 * 格式，點格子裡的卡片直接帶入下面的核對結果卡（跟手動輸入編號查詢共用同一套
 * markOutcome 邏輯，沒有另外寫一套）。
 */
export default function VendorRedeemPage() {
  const { user } = useAuth();
  const VENDOR_ID = user?.vendorId ?? DEMO_VENDOR_ID;
  const [code, setCode] = useState("");
  const [foundLock, setFoundLock] = useState<Lock | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showNoShowForm, setShowNoShowForm] = useState(false);

  const [recentLocks, setRecentLocks] = useState<Lock[]>([]);
  const [loadingCalendar, setLoadingCalendar] = useState(true);

  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors },
  } = useForm<NoShowForm>({ resolver: zodResolver(noShowSchema) });

  // 「取餐總覽」日曆格用——跟下面 handleSearch() 重用同一組 vendor_id +
  // created_at 索引，即時監聽（onSnapshot）這樣核對完馬上就會從格子裡反映出新狀態。
  useEffect(() => {
    const q = query(
      collection(db, "locks"),
      where("vendor_id", "==", VENDOR_ID),
      orderBy("created_at", "desc"),
      limit(200)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRecentLocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock));
        setLoadingCalendar(false);
      },
      () => setLoadingCalendar(false)
    );
    return () => unsub();
  }, [VENDOR_ID]);

  const pickupDates = Array.from(new Set(recentLocks.map((l) => l.pickup_date))).sort();
  const pickupSlots = Array.from(new Set(recentLocks.map((l) => l.pickup_window))).sort();
  const calendarGrid = new Map<string, Lock[]>();
  for (const lock of recentLocks) {
    const key = `${lock.pickup_date}__${lock.pickup_window}`;
    const bucket = calendarGrid.get(key);
    if (bucket) bucket.push(lock);
    else calendarGrid.set(key, [lock]);
  }

  function selectLock(lock: Lock) {
    setFoundLock(lock);
    setCode(lock.id.slice(-8).toUpperCase());
    setSearchError("");
    setShowNoShowForm(false);
  }

  async function handleSearch() {
    // 取餐編號本身沒有空白，貼上時夾帶的空格（例如「AB3F 9K2M」）一律拿掉
    const input = code.replace(/\s/g, "").toUpperCase();
    if (!input) return;

    setSearchError("");
    setFoundLock(null);
    setShowNoShowForm(false);
    setSearching(true);
    try {
      // 撈最近 200 筆這個商家的鎖定紀錄，用末 8 碼比對——跟舊 Parse 版本的
      // scan.tsx 一樣的作法，避免需要額外的複合索引。
      const q = query(
        collection(db, "locks"),
        where("vendor_id", "==", VENDOR_ID),
        orderBy("created_at", "desc"),
        limit(200)
      );
      const snap = await getDocs(q);
      const match = snap.docs.find((d) => d.id.slice(-8).toUpperCase() === input.slice(-8));

      if (!match) {
        setSearchError("找不到符合的取餐編號，請確認是否輸入正確。");
        return;
      }
      if (match.data().status !== "locked" && match.data().status !== "for_resale") {
        setSearchError(`這筆已經是「${match.data().status}」狀態了，無法再次核對。`);
        return;
      }
      setFoundLock({ id: match.id, ...(match.data() as any) });
    } catch {
      setSearchError("查詢失敗，請重試。");
    } finally {
      setSearching(false);
    }
  }

  async function markOutcome(outcome: "fulfilled" | "resold_and_fulfilled" | "no_show", note?: string) {
    if (!foundLock) return;
    setSubmitting(true);
    try {
      const fn = httpsCallable(functions, "markLockOutcome");
      await fn({ lock_id: foundLock.id, outcome, note });
      setFoundLock({ ...foundLock, status: outcome, no_show_note: note ?? foundLock.no_show_note });
      setShowNoShowForm(false);
    } catch (err) {
      toast({ variant: "destructive", title: "操作失敗", description: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  function onNoShowSubmit(data: NoShowForm) {
    markOutcome("no_show", data.note);
    resetForm();
  }

  function reset() {
    setCode("");
    setFoundLock(null);
    setSearchError("");
    setShowNoShowForm(false);
  }

  const alreadyDone = foundLock && ["fulfilled", "no_show", "resold_and_fulfilled"].includes(foundLock.status);
  const statusInfo = foundLock ? LOCK_STATUS_STYLE[foundLock.status] : null;

  return (
    <VendorPortalLayout>
      <div className="max-w-[1400px] space-y-6">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <Search className="w-5 h-5 text-orange-500" /> 核對取餐
        </h1>

        {/* 取餐總覽（日曆格：欄＝取餐日期，列＝取餐時段），跟消費端 MyBookingsPage 同一套版面邏輯 */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 text-muted-foreground">
            <CalendarDays className="w-4 h-4" /> 取餐總覽
          </h2>

          {loadingCalendar ? (
            <SkeletonBlocks height={240} />
          ) : recentLocks.length === 0 ? (
            <div className="bg-white border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
              尚無取餐紀錄——消費端在 <span className="font-mono">/lock</span> 鎖定後會出現在這裡。
            </div>
          ) : (
            <div className="bg-white border border-border rounded-xl overflow-x-auto">
              <div className="min-w-[560px] grid" style={{ gridTemplateColumns: `96px repeat(${pickupDates.length}, minmax(140px, 1fr))` }}>
                <div className="border-b border-border" />
                {pickupDates.map((date) => (
                  <div key={date} className="border-b border-l border-border px-2 py-2 text-center text-xs font-semibold text-muted-foreground">
                    {formatDateLabel(date)}
                  </div>
                ))}

                {pickupSlots.map((slot) => (
                  <div key={slot} className="contents">
                    <div className="border-b border-border px-2 py-3 text-xs font-bold text-muted-foreground flex items-center">
                      {slot}
                    </div>
                    {pickupDates.map((date) => {
                      const cellLocks = calendarGrid.get(`${date}__${slot}`) ?? [];
                      return (
                        <div key={date + slot} className="border-b border-l border-border p-2 flex flex-col gap-1.5 min-h-[76px]">
                          {cellLocks.length === 0 ? (
                            <span className="text-micro text-gray-300">—</span>
                          ) : (
                            cellLocks.map((lock) => {
                              const style = LOCK_STATUS_STYLE[lock.status];
                              const isSelected = foundLock?.id === lock.id;
                              return (
                                <button
                                  key={lock.id}
                                  onClick={() => selectLock(lock)}
                                  aria-pressed={isSelected}
                                  className={`text-left rounded-lg border px-2 py-1.5 text-micro transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                                    isSelected ? "border-orange-400 bg-orange-50" : "border-border bg-gray-50 hover:bg-gray-100"
                                  }`}
                                >
                                  <div className="font-semibold truncate">{lock.item_name}</div>
                                  <div className="flex items-center justify-between mt-1 gap-1">
                                    {style && (
                                      <span className={`text-micro font-bold px-1.5 py-0.5 rounded-full truncate ${style.className}`}>
                                        {style.label}
                                      </span>
                                    )}
                                    <span className="text-muted-foreground shrink-0">${lock.locked_price}</span>
                                  </div>
                                </button>
                              );
                            })
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="max-w-xl space-y-4">
          {/* 查詢區 */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground font-normal">或直接輸入取餐編號（末 8 碼）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="例如：AB3F9K2M"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\s/g, "").toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  maxLength={10}
                  className="font-mono tracking-widest"
                />
                <Button
                  className="shrink-0"
                  onClick={handleSearch}
                  disabled={!code.trim() || searching}
                >
                  {searching ? "查詢中…" : "查詢"}
                </Button>
              </div>

              {searchError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{searchError}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 查詢結果 */}
          {foundLock && (
            <Card>
              <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{foundLock.item_name}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {foundLock.pickup_date}・{foundLock.pickup_window} 取餐 · NT${foundLock.locked_price}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <Badge variant="outline" className="font-mono text-xs">#{foundLock.id.slice(-8).toUpperCase()}</Badge>
                  {statusInfo && (
                    <Badge className={`text-xs border-0 ${statusInfo.className}`}>{statusInfo.label}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {alreadyDone ? (
                  <div className="space-y-3 pt-1">
                    <div
                      className={`flex items-center justify-center gap-2 py-3 rounded-lg font-medium ${
                        foundLock.status === "no_show" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"
                      }`}
                    >
                      {foundLock.status === "no_show" ? <XCircle className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                      {statusInfo?.label}
                    </div>
                    <Button variant="outline" className="w-full" onClick={reset}>
                      查詢下一筆
                    </Button>
                  </div>
                ) : (
                  <div className="pt-1">
                    {!showNoShowForm ? (
                      <div className="flex gap-2">
                        <Button
                          className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                          disabled={submitting}
                          onClick={() => markOutcome(foundLock.status === "for_resale" ? "resold_and_fulfilled" : "fulfilled")}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1.5" />
                          {submitting ? "處理中…" : "確認取餐"}
                        </Button>
                        <Button variant="outline" className="flex-1" disabled={submitting} onClick={() => setShowNoShowForm(true)}>
                          登記未取餐
                        </Button>
                      </div>
                    ) : (
                      <form onSubmit={handleSubmit(onNoShowSubmit)} className="space-y-3">
                        <Separator />
                        <div>
                          <Label htmlFor="noShowNote" className="text-xs text-muted-foreground">
                            未取餐備註（給校準報告分析落差模式用）
                          </Label>
                          <Input
                            id="noShowNote"
                            placeholder="例如：客人臨時取消，說今天下雨不方便出門"
                            className="mt-1"
                            {...register("note")}
                          />
                          {errors.note && <p className="text-xs text-red-600 mt-1">{errors.note.message}</p>}
                        </div>
                        <div className="flex gap-2">
                          <Button type="submit" className="flex-1" disabled={submitting}>
                            {submitting ? "送出中…" : "送出登記"}
                          </Button>
                          <Button type="button" variant="outline" className="flex-1" onClick={() => setShowNoShowForm(false)}>
                            取消
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </VendorPortalLayout>
  );
}

import { useCallback, useEffect, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where, type DocumentSnapshot } from "firebase/firestore";
import { httpsCallable } from "@/lib/callable";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { dateLocale, tr, loc } from "@/lib/i18n";
import { Search, CheckCircle2, AlertCircle, XCircle, CalendarDays, ScanLine } from "lucide-react";
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
import QrScannerDialog from "@/components/QrScannerDialog";
import { LOCK_STATUS_STYLE } from "@/lib/lockOutcome";

// 函式產生，驗證訊息才會跟著目前語言
const noShowSchema = () =>
  z.object({
    note: z.string().trim().min(2, tr("請簡短描述狀況（至少 2 個字），這會餵給校準報告的落差模式分析", "Please briefly describe what happened (at least 2 characters); it feeds the calibration report")),
  });
type NoShowForm = z.infer<ReturnType<typeof noShowSchema>>;


function formatDateLabel(dateStr: string): string {
  try {
    return format(new Date(`${dateStr}T00:00:00`), "M/d (EEE)", { locale: dateLocale() });
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
 *
 * 2026-09-28：補上相機掃碼（QrScannerDialog）。QR 內容是 { lockId, vendorId }，
 * 掃到後用完整 lockId 直接讀那筆 lock、以 Firestore 裡真正的 vendor_id 判斷是不是
 * 本店的單（QR 裡的 vendorId 不可信——舊版 PaymentConfirmPage 一律寫死仁和雅），
 * 也不受「最近 200 筆」限制；手動輸入末 8 碼仍保留當備援。
 */
export default function VendorRedeemPage() {
  const { user } = useAuth();
  // VendorPortalLayout 只讓 role=vendor 進來，vendorId 是登入店主綁定的商家
  const VENDOR_ID = user?.vendorId;
  const [code, setCode] = useState("");
  const [foundLock, setFoundLock] = useState<Lock | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showNoShowForm, setShowNoShowForm] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const [recentLocks, setRecentLocks] = useState<Lock[]>([]);
  const [loadingCalendar, setLoadingCalendar] = useState(true);

  const {
    register,
    handleSubmit,
    reset: resetForm,
    formState: { errors },
  } = useForm<NoShowForm>({ resolver: zodResolver(noShowSchema()) });

  // 「取餐總覽」日曆格用——跟下面 handleSearch() 重用同一組 vendor_id +
  // created_at 索引，即時監聽（onSnapshot）這樣核對完馬上就會從格子裡反映出新狀態。
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

  // fullLockId：掃碼時帶完整 id 精確比對；手動輸入只有末 8 碼
  async function handleSearch(fullLockId?: string) {
    // 取餐編號本身沒有空白，貼上時夾帶的空格（例如「AB3F 9K2M」）一律拿掉
    const input = code.replace(/\s/g, "").toUpperCase();
    if (!fullLockId && !input) return;

    setSearchError("");
    setFoundLock(null);
    setShowNoShowForm(false);
    setSearching(true);
    try {
      let match: DocumentSnapshot | undefined;
      if (fullLockId) {
        // 掃碼：直接讀那一筆。別家店的 lock 被 firestore.rules 擋下（permission-denied）
        // 或讀得到但 vendor_id 不同（管理員、轉讓中公開讀），一律當成不是本店的單
        let snap: DocumentSnapshot | null = null;
        try {
          snap = await getDoc(doc(db, "locks", fullLockId));
        } catch (err) {
          if ((err as { code?: string }).code !== "permission-denied") throw err;
        }
        if (!snap?.exists() || snap.data().vendor_id !== VENDOR_ID) {
          setSearchError(tr("這張取餐碼不是本店的訂單，請顧客確認取餐店家。", "This pickup code isn't for your store. Ask the customer to check the vendor."));
          return;
        }
        match = snap;
      } else {
        // 撈最近 200 筆這個商家的鎖定紀錄，用末 8 碼比對——跟舊 Parse 版本的
        // scan.tsx 一樣的作法，避免需要額外的複合索引。
        const q = query(
          collection(db, "locks"),
          where("vendor_id", "==", VENDOR_ID),
          orderBy("created_at", "desc"),
          limit(200)
        );
        const snap = await getDocs(q);
        match = snap.docs.find((d) => d.id.slice(-8).toUpperCase() === input.slice(-8));
      }

      if (!match?.exists()) {
        setSearchError(tr("找不到符合的取餐編號，請確認是否輸入正確。", "No matching pickup code. Please check what you entered."));
        return;
      }
      const status = match.data().status;
      if (status !== "locked" && status !== "for_resale") {
        setSearchError(tr(`這筆已經是「${LOCK_STATUS_STYLE[status]?.label ?? status}」狀態了，無法再次核對。`, `This order is already "${LOCK_STATUS_STYLE[status]?.label ?? status}" and can't be redeemed again.`));
        return;
      }
      setFoundLock({ id: match.id, ...(match.data() as any) });
    } catch {
      setSearchError(tr("查詢失敗，請重試。", "Lookup failed. Please try again."));
    } finally {
      setSearching(false);
    }
  }

  const handleScan = useCallback(
    (text: string) => {
      setScannerOpen(false);
      // QR 內容是 { lockId, vendorId }，只取 lockId；店家歸屬由 handleSearch 讀 Firestore 判斷
      let lockId: string | undefined;
      try {
        const parsed = JSON.parse(text);
        lockId = typeof parsed?.lockId === "string" ? parsed.lockId : undefined;
      } catch {
        // 不是 JSON——可能是別的 QR（例如桌位點餐碼），下面統一報錯
      }
      if (!lockId) {
        setFoundLock(null);
        setSearchError(tr("這不是 BunnBaa 的取餐 QR Code，請顧客打開「我的餐點」→「使用」。", "That isn't a BunnBaa pickup QR code. Ask the customer to open My meals → Use."));
        return;
      }
      setCode(lockId.slice(-8).toUpperCase());
      handleSearch(lockId);
    },
    // 要穩定引用，不然 QrScannerDialog 每次 render 都會重開相機。handleSearch
    // 帶 fullLockId 時不讀 code state，所以只依賴 VENDOR_ID
    [VENDOR_ID]
  );

  async function markOutcome(outcome: "fulfilled" | "resold_and_fulfilled" | "no_show", note?: string) {
    if (!foundLock) return;
    setSubmitting(true);
    try {
      const fn = httpsCallable(functions, "markLockOutcome");
      await fn({ lock_id: foundLock.id, outcome, note });
      setFoundLock({ ...foundLock, status: outcome, no_show_note: note ?? foundLock.no_show_note });
      setShowNoShowForm(false);
    } catch (err) {
      toast({ variant: "destructive", title: tr("操作失敗", "Action failed"), description: (err as Error).message });
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
          <Search className="w-5 h-5 text-orange-500" /> {tr("核對取餐", "Redeem pickups")}
        </h1>

        {/* 取餐總覽（日曆格：欄＝取餐日期，列＝取餐時段），跟消費端 MyBookingsPage 同一套版面邏輯 */}
        <section className="space-y-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5 text-muted-foreground">
            <CalendarDays className="w-4 h-4" /> {tr("取餐總覽", "Pickup overview")}
          </h2>

          {loadingCalendar ? (
            <SkeletonBlocks height={240} />
          ) : recentLocks.length === 0 ? (
            <div className="bg-white border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
              {tr("尚無取餐紀錄——顧客鎖定餐點後會出現在這裡。", "No pickups yet — they'll show up here once customers lock meals.")}
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
                                  <div className="font-semibold truncate">{loc(lock, "item_name")}</div>
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
              <CardTitle className="text-sm text-muted-foreground font-normal">{tr("掃描 QR Code，或輸入取餐編號（末 8 碼）", "Scan the QR code, or enter the pickup code (last 8 characters)")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder={tr("例如：AB3F9K2M", "e.g. AB3F9K2M")}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\s/g, "").toUpperCase())}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  maxLength={10}
                  className="font-mono tracking-widest"
                />
                <Button
                  className="shrink-0"
                  onClick={() => handleSearch()}
                  disabled={!code.trim() || searching}
                >
                  {searching ? tr("查詢中…", "Looking up…") : tr("查詢", "Look up")}
                </Button>
              </div>
              <Button variant="outline" className="w-full" onClick={() => setScannerOpen(true)}>
                <ScanLine className="w-4 h-4 mr-1.5" /> {tr("用相機掃描 QR Code", "Scan with camera")}
              </Button>

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
                  <CardTitle className="text-base">{loc(foundLock, "item_name")}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {foundLock.pickup_date}・{foundLock.pickup_window} {tr("取餐", "pickup")} · NT${foundLock.locked_price}
                  </p>
                  {foundLock.note && <p className="text-xs text-orange-700 mt-1">{tr("顧客備註：", "Customer note: ")}{foundLock.note}</p>}
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
                      {tr("查詢下一筆", "Next")}
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
                          {submitting ? tr("處理中…", "Working…") : tr("確認取餐", "Confirm pickup")}
                        </Button>
                        <Button variant="outline" className="flex-1" disabled={submitting} onClick={() => setShowNoShowForm(true)}>
                          {tr("登記未取餐", "Mark no-show")}
                        </Button>
                      </div>
                    ) : (
                      <form onSubmit={handleSubmit(onNoShowSubmit)} className="space-y-3">
                        <Separator />
                        <div>
                          <Label htmlFor="noShowNote" className="text-xs text-muted-foreground">
                            {tr("未取餐備註（給校準報告分析落差模式用）", "No-show note (used by the calibration report)")}
                          </Label>
                          <Input
                            id="noShowNote"
                            placeholder={tr("例如：客人臨時取消，說今天下雨不方便出門", "e.g. customer cancelled last minute because of the rain")}
                            className="mt-1"
                            {...register("note")}
                          />
                          {errors.note && <p className="text-xs text-red-600 mt-1">{errors.note.message}</p>}
                        </div>
                        <div className="flex gap-2">
                          <Button type="submit" className="flex-1" disabled={submitting}>
                            {submitting ? tr("送出中…", "Submitting…") : tr("送出登記", "Submit")}
                          </Button>
                          <Button type="button" variant="outline" className="flex-1" onClick={() => setShowNoShowForm(false)}>
                            {tr("取消", "Cancel")}
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
      <QrScannerDialog open={scannerOpen} onOpenChange={setScannerOpen} onScan={handleScan} />
    </VendorPortalLayout>
  );
}

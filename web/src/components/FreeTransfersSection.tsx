import { useEffect, useMemo, useState } from "react";
import { formatNT, formatPickupDate } from "@/lib/format";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { Gift, MapPin, UtensilsCrossed } from "lucide-react";
import { useLocation } from "wouter";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { useAuth } from "@/hooks/useAuth";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useToast } from "@/hooks/use-toast";
import { useVendors } from "@/hooks/useVendors";
import { useItemImages } from "@/hooks/useItemImages";
import { useSelectedArea, vendorInArea } from "@/lib/location";
import { isFreeTransfer, newShareToken, resaleDeadlineOf, takeOverLock } from "@/lib/transfers";
import { tr, loc } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import type { Lock } from "@/types";

/**
 * 「附近愛心餐」分頁上方的免費轉讓（2026-10-09：$0 的轉讓從轉讓市集移過來）：
 *   - 轉讓人自訂 0 元：還在轉讓期限內 → 走 createResaleLinePayReservation（0 元不經 LINE Pay，直接到確認頁換人）
 *   - 逾時沒人接手：firestore.rules 允許任何登入用戶直接免費領取（locked_price 0）
 * 跟愛心餐不同的是這些是完整的一份訂單，領到後出現在「我的餐點」，照一般取餐流程用 QR 取餐。
 */
export default function FreeTransfersSection() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  const requireLogin = useRequireLogin();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { data: vendors = [] } = useVendors();
  const imageOf = useItemImages();
  const area = useSelectedArea();
  const [locks, setLocks] = useState<Lock[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // 跟轉讓市集同一個查詢（只有 for_resale 公開可讀），免費的在前端挑
  useEffect(() => {
    const q = query(collection(db, "locks"), where("status", "==", "for_resale"), limit(200));
    return onSnapshot(q, (snap) => setLocks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Lock)), () => setLocks([]));
  }, []);

  const free = useMemo(
    () =>
      locks
        .filter((l) => l.buyer_uid !== uid && isFreeTransfer(l, now) && (!area || vendorInArea(vendors.find((v) => v.id === l.vendor_id), area)))
        .sort((a, b) => a.pickup_date.localeCompare(b.pickup_date) || a.pickup_window.localeCompare(b.pickup_window)),
    [locks, uid, now, area, vendors]
  );

  async function claim(lock: Lock) {
    if (!requireLogin() || !uid) return;
    setBusy(lock.id);
    const deadline = resaleDeadlineOf(lock);
    try {
      if (deadline && deadline.getTime() <= Date.now()) {
        await takeOverLock(lock.id, uid, { locked_price: 0, share_token: newShareToken() });
        toast({ title: tr("已免費領取", "Claimed for free"), description: tr("取餐碼在「我的餐點」。", "Find the pickup code under My meals.") });
        setBusy(null);
      } else {
        const res = await httpsCallable(functions, "createResaleLinePayReservation")({ lock_id: lock.id });
        navigate(`/payment/confirm/${(res.data as { order_id: string }).order_id}`);
      }
    } catch (err) {
      toast({ title: tr("領取失敗", "Couldn't claim it"), description: (err as Error).message, variant: "destructive" });
      setBusy(null);
    }
  }

  if (free.length === 0) return null;
  const vendorName = (id: string) => loc(vendors.find((v) => v.id === id), "name");

  return (
    <section className="space-y-3" aria-labelledby="free-transfers-title">
      <div className="flex items-center gap-2.5 flex-wrap">
        <Gift className="w-5 h-5 text-pink-600" aria-hidden="true" />
        <h2 id="free-transfers-title" className="font-heading text-2xl font-semibold">{tr("$0 免費領取", "Free ($0) meals")}</h2>
        <span className="text-xs text-muted-foreground">{tr("同學免費轉出、或逾時沒人接手的餐點，先到先得；領到後在「我的餐點」出示取餐碼", "Given away for free or not taken in time — first come, first served. Show the pickup code from My meals.")}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {free.map((item) => (
          <article key={item.id} className="rounded-[1.75rem] bg-card border border-ink overflow-hidden flex flex-col">
            <div className="relative aspect-[4/3] bg-secondary flex items-center justify-center border-b border-ink overflow-hidden">
              {imageOf(item) ? (
                <img src={imageOf(item)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <UtensilsCrossed className="h-10 w-10 text-secondary-foreground/50" strokeWidth={1.25} aria-hidden="true" />
              )}
              <span className="absolute top-2.5 right-2.5 text-caption font-bold px-2.5 py-1 rounded-full bg-pink-600 text-white">$0</span>
            </div>
            <div className="flex flex-col gap-2 p-4 flex-1">
              <h3 className="font-heading text-lg font-semibold leading-snug">{loc(item, "item_name")}</h3>
              <p className="flex items-start gap-1 text-xs text-muted-foreground">
                <MapPin className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
                <span>{vendorName(item.vendor_id) ? `${vendorName(item.vendor_id)} · ` : ""}{formatPickupDate(item.pickup_date)} · {item.pickup_window}</span>
              </p>
              <Button size="sm" className="mt-auto" disabled={busy === item.id} onClick={() => claim(item)}>
                {busy === item.id ? tr("處理中…", "Working…") : tr("免費領取", "Claim free")}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

import { useEffect, useState } from "react";
import { formatNT, formatPickupDate } from "@/lib/format";
import { Link, useParams } from "wouter";
import { doc, getDoc } from "firebase/firestore";
import { Gift } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ds";
import { db } from "@/lib/firebase";
import { newShareToken, takeOverLock } from "@/lib/transfers";
import { useAuth } from "@/hooks/useAuth";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useToast } from "@/hooks/use-toast";
import { slotText } from "@/lib/bento";
import { tr, loc } from "@/lib/i18n";
import type { Lock } from "@/types";

/**
 * Accept a gift (split out of the old /lock demo page on 2026-09-30). Locks being gifted are publicly readable;
 * accepting writes locks directly from the client (firestore.rules checks for_gift → locked and records the original holder).
 */
export default function GiftClaimPage() {
  const { lockId } = useParams<{ lockId: string }>();
  const { user } = useAuth();
  const requireLogin = useRequireLogin();
  const { toast } = useToast();
  const [lock, setLock] = useState<Lock | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "locks", lockId))
      .then((snap) => setLock(snap.exists() ? ({ id: snap.id, ...snap.data() } as Lock) : null))
      .catch(() => setLock(null));
  }, [lockId]);

  async function accept() {
    if (!requireLogin() || !user) return;
    setBusy(true);
    try {
      // Replace the proxy pickup link so the original holder's link stops working
      await takeOverLock(lockId, user.id, { share_token: newShareToken() });
      setDone(true);
    } catch (err) {
      toast({ variant: "destructive", title: tr("接受贈送失敗", "Couldn't accept the gift"), description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader />
      <div className="max-w-xl mx-auto px-4 pt-12 md:pt-20 pb-16">
        {lock === undefined ? null : done ? (
          <EmptyState icon={<Gift size={32} />} title={tr("已收下！", "It's yours!")} description={tr("到「我的餐點」出示取餐碼即可取餐。", "Show the pickup code from My meals.")} action={<Button asChild><Link href="/my-bookings">{tr("前往我的餐點", "Go to My meals")}</Link></Button>} />
        ) : !lock || lock.status !== "for_gift" ? (
          <EmptyState icon={<Gift size={32} />} title={tr("這份贈送已經不存在", "This gift is no longer available")} description={tr("可能已被收下或贈送者取消了。", "It may have been accepted or cancelled.")} />
        ) : (
          <div className="bb-receipt space-y-4 text-center">
            <span className="bb-receipt__check" aria-hidden="true"><Gift className="w-9 h-9" /></span>
            <h1 className="font-heading font-semibold text-[clamp(30px,5vw,44px)] leading-tight">{tr("有同學送你一份便當", "A classmate gifted you a meal")}</h1>
            <p className="font-heading text-2xl font-semibold">{loc(lock, "item_name")}</p>
            <p className="text-sm text-muted-foreground">{formatPickupDate(lock.pickup_date)} {lock.pickup_window}</p>
            {(lock.slots?.length ?? 0) > 0 && (
              <ul className="text-xs text-muted-foreground">{lock.slots!.map((s, i) => <li key={i}>• {slotText(s, lock)}</li>)}</ul>
            )}
            <Button className="w-full h-12 text-base" disabled={busy || lock.buyer_uid === user?.id} onClick={accept}>
              {busy ? tr("處理中…", "Working…") : lock.buyer_uid === user?.id ? tr("這是你送出的", "You sent this") : tr("接受贈送", "Accept gift")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

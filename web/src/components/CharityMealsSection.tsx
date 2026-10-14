import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { Clock, HeartHandshake, LocateFixed, MapPin, Footprints } from "lucide-react";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { useAuth } from "@/hooks/useAuth";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { EmptyState, Tag } from "@/components/ds";
import PickupQr from "@/components/PickupQr";
import { currentPosition, decodeGeohash, distanceMeters, formatDistance, walkMinutes } from "@/lib/geo";
import { todayStr } from "@/lib/pickupSlots";
import { tr, loc, useI18n } from "@/lib/i18n";
import { liveConfig } from "@/lib/platformConfig";
import { policy } from "@/lib/policy";
import type { CharityMeal, CharityReservation } from "@/types";

const RANGES = [500, 1000, 2000, 3000];
/** Charity meal deadline (hours / minutes after the pickup slot ends), read from platform settings */
const closeHours = () => {
  const m = liveConfig().charityCloseAfterMinutes;
  return m % 60 === 0 ? tr(`${m / 60} 小時`, `${m / 60} hour${m === 60 ? "" : "s"}`) : tr(`${m} 分鐘`, `${m} min`);
};
const millis = (ts: unknown) => (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

/**
 * "Charity meals nearby" tab at the top of the "My meals" page.
 * No-show or donated bentos, picked up in person the same day: reserve online (phone verification, 1 per person per day, arrive within 10 minutes; if late it goes to the next person, no suspension)
 * or first come, first served on site. Sorted by distance, showing remaining count, deadline and walking time; ones you can't reach in time are marked "Too late".
 * Charity meal reservations, pickups and views are never included in stats or recommendations.
 */
export default function CharityMealsSection() {
  const { user } = useAuth();
  const requireLogin = useRequireLogin();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [meals, setMeals] = useState<CharityMeal[]>([]);
  const [mine, setMine] = useState<CharityReservation[]>([]);
  const [range, setRange] = useState(1000);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const today = todayStr();
  const { lang } = useI18n();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    return onSnapshot(query(collection(db, "charityMeals"), where("date", "==", today), limit(500)), (snap) => {
      setMeals(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CharityMeal));
    }, () => setMeals([]));
  }, [today]);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(query(collection(db, "charityReservations"), where("user_id", "==", user.id), limit(20)), (snap) => {
      setMine(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CharityReservation).filter((r) => r.date === today));
    }, () => setMine([]));
  }, [user?.id, today]);

  // Use the saved frequent location (coarse geohash) as the default position
  useEffect(() => {
    if (!here && user) {
      const home = decodeGeohash(user.homeGeo ?? "");
      if (home) setHere(home);
    }
  }, [user?.id]);

  async function locate() {
    setLocating(true);
    try {
      setHere(await currentPosition());
    } catch {
      toast({ title: tr("無法取得目前位置", "Couldn't get your location"), description: tr("請允許定位，或到會員中心設定常用地點。", "Allow location access, or set a usual location in My account."), variant: "destructive" });
    } finally {
      setLocating(false);
    }
  }

  // Aggregate by vendor: remaining count, deadline
  const byVendor = useMemo(() => {
    const map = new Map<string, { vendor_id: string; name: string; address?: string; lat: number | null; lng: number | null; available: CharityMeal[]; deadline: number }>();
    for (const m of meals) {
      if (millis(m.deadline) <= now) continue;
      const g = map.get(m.vendor_id) ?? { vendor_id: m.vendor_id, name: loc(m, "vendor_name"), address: loc(m, "vendor_address"), lat: m.lat, lng: m.lng, available: [], deadline: millis(m.deadline) };
      if (m.status === "available") g.available.push(m);
      map.set(m.vendor_id, g);
    }
    return [...map.values()]
      .map((g) => ({ ...g, distance: distanceMeters(here, g) }))
      .filter((g) => g.available.length > 0 && (!here || g.distance <= range))
      .sort((a, b) => a.distance - b.distance);
  }, [meals, here, range, now, lang]);

  const activeReservation = mine.find((r) => r.status === "reserved" && millis(r.expires_at) > now);

  async function reserve(vendorId: string) {
    if (!requireLogin()) return;
    const ok = await confirm({
      title: tr("預約愛心餐", "Reserve a charity meal"),
      // The policy text is a mid-sentence clause; as a standalone English sentence it needs a capital and a period
      description: tr(`${policy.charityReserve()}。`, `${policy.charityReserve().replace(/^./, (c) => c.toUpperCase())}.`),
      confirmLabel: tr("我了解，預約", "I understand — reserve"),
    });
    if (!ok) return;
    setBusy(vendorId);
    try {
      await httpsCallable(functions, "reserveCharity")({ vendor_id: vendorId });
      toast({ title: tr(`已預約，請在 ${liveConfig().charityReserveMinutes} 分鐘內到場出示 QR Code`, `Reserved — please arrive within ${liveConfig().charityReserveMinutes} minutes and show the QR code`) });
    } catch (err) {
      toast({ title: tr("預約失敗", "Couldn't reserve"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-card bg-accent border border-ink p-6 text-sm space-y-2">
        <p className="font-heading text-2xl font-semibold flex items-center gap-2"><HeartHandshake className="w-6 h-6 text-primary" aria-hidden="true" /> {tr("愛心餐", "Charity meals")}</p>
        <p className="text-xs leading-relaxed">
          {tr(`沒有被領取或訂購人主動捐出的便當，當天開放給需要的人。可以線上預約（手機驗證帳號；${policy.charityReserve()}），或直接到店現場領取（未被預約的份數先到先領、不需帳號）。取餐時段結束 ${closeHours()} 後截止。`,
            `Meals not picked up, or donated by classmates, are open to anyone in need on the same day. Reserve online (phone-verified account; ${policy.charityReserve()}) or just walk in — unreserved meals are first come, first served. Closes ${closeHours()} after the pickup window.`)}
        </p>
      </div>

      {activeReservation && (
        <div className="rounded-card bg-card border-2 border-ink p-5 max-w-sm">
          <p className="font-semibold">{tr("你的愛心餐預約：", "Your reservation: ")}{loc(activeReservation, "vendor_name")}</p>
          <p className="text-xs text-muted-foreground">
            {tr(`請在 ${new Date(millis(activeReservation.expires_at)).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} 前到場`, `Arrive by ${new Date(millis(activeReservation.expires_at)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`)}
          </p>
          <PickupQr reservationId={activeReservation.id} size={160} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={locate} disabled={locating}>
          <LocateFixed /> {locating ? tr("定位中…", "Locating…") : here ? tr("重新定位", "Update location") : tr("使用目前位置", "Use my location")}
        </Button>
        {RANGES.map((r) => (
          <Tag key={r} selected={range === r} onClick={() => setRange(r)}>{r < 1000 ? `${r} m` : `${r / 1000} km`}</Tag>
        ))}
        {!here && <span className="text-xs text-muted-foreground">{tr("還沒有位置，先列出全部", "No location yet — showing all")}</span>}
      </div>

      {byVendor.length === 0 ? (
        <EmptyState icon={<HeartHandshake size={32} />} title={tr("附近目前沒有愛心餐", "No charity meals nearby right now")} description={tr(`通常在各餐期取餐時段結束後 ${liveConfig().charityConvertAfterMinutes} 分鐘開放。`, `They usually open ${liveConfig().charityConvertAfterMinutes} minutes after each meal's pickup window ends.`)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {byVendor.map((g) => {
            const minutesLeft = Math.max(0, Math.round((g.deadline - now) / 60000));
            const walk = Number.isFinite(g.distance) ? walkMinutes(g.distance) : null;
            const tooFar = walk !== null && walk > minutesLeft;
            return (
              <article key={g.vendor_id} className="rounded-card bg-card border border-ink p-6 flex flex-col gap-2.5">
                <h3 className="font-heading text-xl font-semibold">{g.name}</h3>
                {g.address && <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {g.address}</p>}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{tr(`剩 ${g.available.length} 份`, `${g.available.length} left`)}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {tr(`${minutesLeft} 分後截止`, `closes in ${minutesLeft} min`)}</span>
                  {walk !== null && <span className="flex items-center gap-1"><Footprints className="w-3.5 h-3.5" /> {formatDistance(g.distance)}{tr("・", " · ")}{tr(`步行 ${walk} 分`, `${walk} min walk`)}</span>}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{g.available.slice(0, 3).map((m) => loc(m, "item_name")).join(tr("、", ", "))}</p>
                {tooFar && <span className="text-xs font-semibold text-danger-text">{tr("來不及（步行時間超過剩餘時間）", "Too far to make it in time")}</span>}
                <Button size="sm" className="mt-auto" disabled={!!activeReservation || busy === g.vendor_id || tooFar} onClick={() => reserve(g.vendor_id)}>
                  {busy === g.vendor_id ? tr("預約中…", "Reserving…") : tr("預約一份", "Reserve one")}
                </Button>
              </article>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">{tr("用詞為「已開放領取」：第一階段無法追蹤單一盒的去向。愛心餐的預約與領取紀錄不會用在統計或推薦。", "We say \"open for pickup\" because we can't track each box in phase 1. Charity reservations are never used for stats or recommendations.")}</p>
    </div>
  );
}

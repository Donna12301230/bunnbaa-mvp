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
import { tr } from "@/lib/i18n";
import type { CharityMeal, CharityReservation } from "@/types";

const RANGES = [500, 1000, 2000, 3000];
const millis = (ts: unknown) => (ts as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;

/**
 * 轉讓市集裡的「愛心餐」分頁（規格 §7，使用者 2026-09-30 決定放在轉讓市集）。
 * 未取餐或主動捐出的便當，當天現場領取：線上預約（手機驗證、每人每天 1 份、10 分鐘內到場；逾時釋出給下一位、不停權）
 * 或現場先到先領。依距離排序、顯示剩餘份數、截止時間、步行時間，走不到的標「來不了」。
 * 愛心餐的預約、領取、瀏覽紀錄一律不進入統計與推薦（§10.3）。
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

  // 常用地點（粗略 geohash）當預設位置
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

  // 依店家彙總：剩餘份數、截止時間
  const byVendor = useMemo(() => {
    const map = new Map<string, { vendor_id: string; name: string; address?: string; lat: number | null; lng: number | null; available: CharityMeal[]; deadline: number }>();
    for (const m of meals) {
      if (millis(m.deadline) <= now) continue;
      const g = map.get(m.vendor_id) ?? { vendor_id: m.vendor_id, name: m.vendor_name, address: m.vendor_address, lat: m.lat, lng: m.lng, available: [], deadline: millis(m.deadline) };
      if (m.status === "available") g.available.push(m);
      map.set(m.vendor_id, g);
    }
    return [...map.values()]
      .map((g) => ({ ...g, distance: distanceMeters(here, g) }))
      .filter((g) => g.available.length > 0 && (!here || g.distance <= range))
      .sort((a, b) => a.distance - b.distance);
  }, [meals, here, range, now]);

  const activeReservation = mine.find((r) => r.status === "reserved" && millis(r.expires_at) > now);

  async function reserve(vendorId: string) {
    if (!requireLogin()) return;
    const ok = await confirm({
      title: tr("預約愛心餐", "Reserve a charity meal"),
      description: tr("每人每天限 1 份，預約後 30 分鐘內到店出示 QR Code。逾時未到，這份會釋出，且 7 天內不能再預約愛心餐（不影響一般訂餐）。", "One per person per day. Arrive within 30 minutes and show the QR code. If you don't, it's released and you can't reserve charity meals for 7 days (regular orders aren't affected)."),
      confirmLabel: tr("我了解，預約", "I understand — reserve"),
    });
    if (!ok) return;
    setBusy(vendorId);
    try {
      await httpsCallable(functions, "reserveCharity")({ vendor_id: vendorId });
      toast({ title: tr("已預約，請在 10 分鐘內到場出示 QR code", "Reserved — please arrive within 10 minutes") });
    } catch (err) {
      toast({ title: tr("預約失敗", "Couldn't reserve"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-[1.75rem] bg-accent border border-ink p-6 text-sm space-y-2">
        <p className="font-heading text-2xl font-semibold flex items-center gap-2"><HeartHandshake className="w-6 h-6 text-primary" aria-hidden="true" /> {tr("愛心餐", "Charity meals")}</p>
        <p className="text-xs leading-relaxed">
          {tr("沒有被領取或同學主動捐出的便當，當天開放給需要的人。可以線上預約（手機驗證帳號、每人每天 1 份、預約後 10 分鐘內到場，逾時自動釋出給下一位、不停權），或直接到店現場領取（未被預約的份數先到先領、不需帳號）。取餐時段結束 2 小時後截止。",
            "Meals not picked up, or donated by classmates, are open to anyone in need on the same day. Reserve online (phone-verified account, one per day, arrive within 30 min) or just walk in — unreserved meals are first come, first served. Closes 2 hours after the pickup window.")}
        </p>
      </div>

      {activeReservation && (
        <div className="rounded-[1.5rem] bg-card border-2 border-ink p-5 max-w-sm">
          <p className="font-semibold">{tr("你的愛心餐預約", "Your reservation")}：{activeReservation.vendor_name}</p>
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
        <EmptyState icon={<HeartHandshake size={32} />} title={tr("附近目前沒有愛心餐", "No charity meals nearby right now")} description={tr("通常在午餐取餐時段結束後 30 分鐘開放。", "They usually open 30 minutes after the lunch pickup window.")} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {byVendor.map((g) => {
            const minutesLeft = Math.max(0, Math.round((g.deadline - now) / 60000));
            const walk = Number.isFinite(g.distance) ? walkMinutes(g.distance) : null;
            const tooFar = walk !== null && walk > minutesLeft;
            return (
              <article key={g.vendor_id} className="rounded-[1.75rem] bg-card border border-ink p-6 flex flex-col gap-2.5">
                <h3 className="font-heading text-xl font-semibold">{g.name}</h3>
                {g.address && <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {g.address}</p>}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{tr(`剩 ${g.available.length} 份`, `${g.available.length} left`)}</span>
                  <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {tr(`${minutesLeft} 分後截止`, `closes in ${minutesLeft} min`)}</span>
                  {walk !== null && <span className="flex items-center gap-1"><Footprints className="w-3.5 h-3.5" /> {formatDistance(g.distance)}・{tr(`步行 ${walk} 分`, `${walk} min walk`)}</span>}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{g.available.slice(0, 3).map((m) => m.item_name).join("、")}</p>
                {tooFar && <span className="text-xs font-semibold text-red-700">{tr("來不了（步行時間超過剩餘時間）", "Too far to make it in time")}</span>}
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

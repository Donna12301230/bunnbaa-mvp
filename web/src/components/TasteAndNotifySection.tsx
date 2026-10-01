import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import { HeartHandshake, MapPin, Utensils } from "lucide-react";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Switch, Tag } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { currentPosition, encodeGeohash } from "@/lib/geo";
import { ALLERGEN_LIST, tagEn, type UserProfile } from "@/types";
import { tr } from "@/lib/i18n";

const PREFS = [
  { key: "spicy", zh: "愛吃辣", en: "Loves spicy" },
  { key: "no_spicy", zh: "不吃辣", en: "No spicy" },
  { key: "no_beef", zh: "不吃牛", en: "No beef" },
  { key: "no_pork", zh: "不吃豬", en: "No pork" },
  { key: "no_seafood", zh: "不吃海鮮", en: "No seafood" },
  { key: "vegetarian", zh: "素食", en: "Vegetarian" },
  { key: "vegan", zh: "全素", en: "Vegan" },
  { key: "light", zh: "偏好清淡", en: "Prefers light" },
  { key: "heavy_flavor", zh: "重口味", en: "Prefers strong flavor" },
  { key: "less_oil", zh: "少油", en: "Less oily" },
  { key: "less_salt", zh: "少鹽", en: "Less salty" },
  { key: "more_veggie", zh: "多蔬菜", en: "More veggies" },
];

/**
 * 會員中心：口味偏好（規格 §10.1，僅本人可讀）與通知設定（§7.3、§7.4）。
 * 主動設定寫 tasteProfiles/{uid}.prefs／allergies；行為推算的分數由後端算（30 天半衰期）。
 * 過敏資訊只用於自己的篩選。常用地點只存粗略 geohash（約 150 公尺），不存定位軌跡。
 */
export default function TasteAndNotifySection({ user }: { user: UserProfile }) {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [allergies, setAllergies] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [muted, setMuted] = useState<string[]>(user.mutedKinds ?? []);
  const [nearbyPush, setNearbyPush] = useState(!!user.charityNearbyPush);
  const [homeGeo, setHomeGeo] = useState(user.homeGeo ?? "");

  useEffect(() => onSnapshot(doc(db, "tasteProfiles", user.id), (snap) => {
    const d = snap.data() ?? {};
    setPrefs(d.prefs ?? {});
    setAllergies(d.allergies ?? []);
    setScores(d.scores ?? {});
  }, () => undefined), [user.id]);

  async function saveTaste(next: { prefs?: Record<string, boolean>; allergies?: string[] }) {
    const merged = { prefs: next.prefs ?? prefs, allergies: next.allergies ?? allergies };
    setPrefs(merged.prefs);
    setAllergies(merged.allergies);
    await setDoc(doc(db, "tasteProfiles", user.id), merged, { merge: true }).catch((err) => toast({ variant: "destructive", title: (err as Error).message }));
  }

  async function saveUser(patch: Record<string, unknown>) {
    await setDoc(doc(db, "users", user.id), patch, { merge: true }).catch((err) => toast({ variant: "destructive", title: (err as Error).message }));
  }

  async function setHome() {
    try {
      const pos = await currentPosition();
      const hash = encodeGeohash(pos.lat, pos.lng, 7);
      setHomeGeo(hash);
      await saveUser({ home_geo: hash });
      toast({ title: tr("已設定常用地點（只存約 150 公尺範圍）", "Usual location saved (about 150 m precision)") });
    } catch {
      toast({ variant: "destructive", title: tr("無法取得位置", "Couldn't get your location") });
    }
  }

  const topTags = Object.entries(scores).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const charityMuted = muted.includes("charity");
  const toggleMuted = (kind: string, on: boolean) => {
    const next = on ? muted.filter((k) => k !== kind) : [...muted, kind];
    setMuted(next);
    saveUser({ muted_kinds: next });
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <section className="bg-card rounded-[1.75rem] border border-ink p-6 md:p-8 space-y-4">
        <h2 className="font-heading text-2xl font-semibold flex items-center gap-2"><Utensils className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("我的口味", "My taste")}</h2>
        <div className="flex flex-wrap gap-2">
          {PREFS.map((p) => (
            <Tag key={p.key} selected={!!prefs[p.key]} onClick={() => saveTaste({ prefs: { ...prefs, [p.key]: !prefs[p.key] } })}>{tr(p.zh, p.en)}</Tag>
          ))}
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">{tr("過敏原（只用於你自己的篩選）", "Allergies (only used for your own filtering)")}</p>
          <div className="flex flex-wrap gap-2">
            {ALLERGEN_LIST.map((a) => (
              <Tag key={a} selected={allergies.includes(a)} onClick={() => saveTaste({ allergies: allergies.includes(a) ? allergies.filter((x) => x !== a) : [...allergies, a] })}>{tr(a, tagEn(a))}</Tag>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {topTags.length > 0
            ? tr(`從你的訂單推算你喜歡：${topTags.map(([t]) => t).join("、")}`, `From your orders, you like: ${topTags.map(([t]) => t).join(", ")}`)
            : tr("多訂幾次，我們會從訂單推算你喜歡吃什麼（許願比購買的訊號更強，選「不要」算負面訊號）。", "Order a few times and we'll learn what you like.")}
        </p>
      </section>

      <section className="bg-card rounded-[1.75rem] border border-ink p-6 md:p-8 space-y-4">
        <h2 className="font-heading text-2xl font-semibold flex items-center gap-2"><HeartHandshake className="w-5 h-5 text-primary" aria-hidden="true" /> {tr("愛心餐與通知", "Charity meals & notifications")}</h2>
        <p className="text-sm">{tr(`你主動捐出了 ${user.donatedCount ?? 0} 份愛心餐`, `You've donated ${user.donatedCount ?? 0} meal(s)`)}</p>
        <Switch
          checked={!charityMuted}
          onCheckedChange={(on) => toggleMuted("charity", on)}
          label={tr("愛心餐相關通知", "Charity meal notifications")}
          description={tr("捐出、未取餐轉愛心餐、預約提醒", "Donations, unclaimed meals, reservation reminders")}
        />
        {/* AI 轉讓媒合（functions/src/resaleMatch.js）：有人轉讓你常訂的類似便當時通知 */}
        <Switch
          checked={!muted.includes("resale_match")}
          onCheckedChange={(on) => toggleMuted("resale_match", on)}
          label={tr("可能想接手的轉讓通知", "Transfers you might want")}
          description={tr("有人轉讓你常訂的類似便當時通知你，每天最多 2 則", "When someone transfers a meal like the ones you order; max 2 a day")}
        />
        <Switch
          checked={nearbyPush}
          onCheckedChange={(on) => {
            setNearbyPush(on);
            saveUser({ charity_nearby_push: on });
          }}
          label={tr("附近有愛心餐時推播", "Notify me about nearby charity meals")}
          description={tr("預設關閉；只在愛心餐時段、常用地點 1 公里內推播，每天最多 2 則", "Off by default; only during charity hours, within 1 km of your usual location, max 2 a day")}
        />
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="w-4 h-4 text-muted-foreground" />
          <span className="flex-1">{homeGeo ? tr("已設定常用地點", "Usual location set") : tr("尚未設定常用地點", "No usual location")}</span>
          <Button size="sm" variant="outline" onClick={setHome}>{homeGeo ? tr("更新", "Update") : tr("用目前位置設定", "Use current location")}</Button>
        </div>
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { liveConfig } from "@/lib/platformConfig";
import { businessDaysText } from "@/lib/pickupSlots";
import { policy } from "@/lib/policy";
import { doc, setDoc } from "firebase/firestore";
import { SlidersHorizontal } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { queryClient } from "@/lib/queryClient";
import { DEFAULT_PLATFORM_CONFIG, PLATFORM_CONFIG_FIELDS, usePlatformConfig, type PlatformConfig } from "@/lib/platformConfig";
import { tr } from "@/lib/i18n";

/**
 * 平台全域參數（規格 §2）：存於 platformConfig/global，平台統一設定；第一階段店家只能在
 * 「店家可調」的範圍內調整。Functions 與前端都讀同一份（缺的欄位用預設值）。
 */
function PlatformContent() {
  const { data: config } = usePlatformConfig();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!config) return;
    setDraft(Object.fromEntries(PLATFORM_CONFIG_FIELDS.map((f) => [f.key, String(config[f.key])])));
  }, [config]);

  async function save() {
    setSaving(true);
    try {
      const out: Partial<PlatformConfig> = {};
      for (const f of PLATFORM_CONFIG_FIELDS) {
        const raw = draft[f.key];
        const def = DEFAULT_PLATFORM_CONFIG[f.key];
        (out as Record<string, unknown>)[f.key] = typeof def === "number" ? Number(raw) : raw;
        if (typeof def === "number" && !Number.isFinite(Number(raw))) throw new Error(`${f.label} 不是數字`);
      }
      await setDoc(doc(db, "platformConfig", "global"), { ...out, updated_at: new Date() }, { merge: true });
      queryClient.invalidateQueries({ queryKey: ["platformConfig"] });
      toast({ title: tr("已儲存平台參數", "Saved") });
    } catch (err) {
      toast({ variant: "destructive", title: tr("儲存失敗", "Couldn't save"), description: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1">{tr("參數", "Parameter")}</th><th>{tr("值", "Value")}</th><th>{tr("店家可調", "Vendor-adjustable")}</th></tr></thead>
          <tbody>
            {PLATFORM_CONFIG_FIELDS.map((f) => (
              <tr key={f.key} className="border-t">
                <td className="py-1.5 pr-2">{f.label}{f.unit && <span className="text-xs text-muted-foreground">（{f.unit}）</span>}</td>
                <td className="pr-2"><Input className="h-8 w-32" value={draft[f.key] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} /></td>
                <td className="text-xs text-muted-foreground">{f.vendorAdjustable ?? tr("否", "No")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted-foreground">{(() => {
          const c = liveConfig();
          const mp = c.mealPeriods;
          return tr(
            `營業日（${businessDaysText()}）、餐期範圍（早 ${mp.breakfast}／中 ${mp.lunch}／晚 ${mp.dinner}）、預訂開放範圍（${c.bookingRangeDays} 天）也存在 platformConfig/global，前後端都會讀，但不在上面這張表裡；要改請直接改資料庫。早鳥級距（${policy.earlyBird()}）寫在程式裡（functions/src/pricing.js 與 web/src/lib/pricing.ts，要一起改）。基本工資在 platformConfig/minimumWage（依生效日自動套用）。`,
            `Business days (${businessDaysText()}), meal periods and the ${c.bookingRangeDays}-day booking range also live in platformConfig/global and are read by both the server and the app, but aren't editable here — change them in the database. Early-bird tiers (${policy.earlyBird()}) are in code (functions/src/pricing.js and web/src/lib/pricing.ts).`
          );
        })()}</p>
        <Button onClick={save} disabled={saving}>{saving ? tr("儲存中…", "Saving…") : tr("儲存", "Save")}</Button>
      </CardContent>
    </Card>
  );
}

export default function AdminPlatformPage() {
  return (
    <AdminLayout>
      <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-3 flex items-center gap-2"><SlidersHorizontal className="w-5 h-5" /> {tr("平台參數", "Platform parameters")}</h1>
      <RequireRealAdmin><PlatformContent /></RequireRealAdmin>
    </AdminLayout>
  );
}

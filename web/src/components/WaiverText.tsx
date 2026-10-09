import { tr } from "@/lib/i18n";
import { policy } from "@/lib/policy";
import type { MaybeSchedule } from "@/lib/pickupSlots";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * 結帳前的消保法聲明（購物車、加入計畫共用；2026-10-09 統一成同一份）。
 * 規則全部讀 lib/policy.ts（平台參數），跟 FAQ、服務須知同一套說法。
 */
export default function WaiverText({ vendor }: { vendor?: MaybeSchedule }) {
  return (
    <>
      {tr("我了解本商品為現做餐點，依消保法通訊交易解除權合理例外情事適用準則，", "I understand these are freshly made meals. Under Taiwan's Consumer Protection Act exceptions for distance sales, ")}
      <strong className="text-foreground">
        {tr(`${policy.cutoff(vendor)}；${policy.cancel()}，不適用 7 天猶豫期`, `${policy.cutoff(vendor)}; ${policy.cancel()}, and the 7-day cooling-off period doesn't apply`)}
      </strong>
      {tr(
        `。${policy.afterCutoff()}。${policy.noShow()}。${policy.disaster()}。${policy.refunds()}。`,
        `. ${cap(policy.afterCutoff())}. ${cap(policy.noShow())}. ${cap(policy.disaster())}. ${cap(policy.refunds())}.`
      )}
    </>
  );
}

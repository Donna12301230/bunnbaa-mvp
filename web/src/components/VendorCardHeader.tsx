import { Link } from "wouter";
import { BadgeCheck, CheckCircle2, Store } from "lucide-react";
import FavoriteButton from "@/components/FavoriteButton";
import { loc, useI18n } from "@/lib/i18n";
import type { RewardStatus, Vendor } from "@/types";

/** 店家卡片抬頭：店名、標章、愛心收藏；右側「再 X 元開獎」＋藍色「看店家」（§4.5） */
export default function VendorCardHeader({ vendor, subtitle, reward }: { vendor: Vendor; subtitle: string; reward?: RewardStatus }) {
  const { t } = useI18n();
  const name = loc(vendor, "name");
  return (
    <header className="flex items-center gap-3 flex-wrap mb-4">
      <span className="w-11 h-11 rounded-full overflow-hidden border border-ink bg-secondary shrink-0 flex items-center justify-center">
        {vendor.cover_image
          ? <img src={vendor.cover_image} alt="" loading="lazy" className="w-full h-full object-cover" />
          : <Store className="w-5 h-5 text-secondary-foreground/70" aria-hidden="true" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-heading text-xl font-semibold">{name}</h3>
          {vendor.verified && (
            <span className="flex items-center gap-1 text-caption font-bold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-ink">
              <BadgeCheck className="w-3 h-3" /> {t("認證店家", "Verified")}
            </span>
          )}
          {vendor.reliability_tone === "stable" && (
            <span className="flex items-center gap-1 text-caption font-bold px-2 py-0.5 rounded-full bg-secondary text-success-text border border-ink">
              <CheckCircle2 className="w-3 h-3" /> {t("履約穩定", "Stable")}
            </span>
          )}
          <FavoriteButton vendorId={vendor.id} vendorName={name} />
        </div>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0 text-sm">
        {reward && !reward.paused && (
          <Link href="/rewards" className="text-xs font-semibold text-muted-foreground hover:text-foreground">
            {reward.pool_open ? t("開獎中", "Draw open") : reward.amount_to_open <= 0 ? t("已達標，週一開獎", "Target reached — draw opens Monday") : t(`再 ${reward.amount_to_open} 元開獎`, `NT$${reward.amount_to_open} to the draw`)}
          </Link>
        )}
        <Link href={`/vendor/${vendor.id}`} className="font-semibold text-info-text underline underline-offset-4 decoration-1 hover:decoration-2 hover:text-info-text">
          {t("看店家", "View vendor")}
        </Link>
      </div>
    </header>
  );
}

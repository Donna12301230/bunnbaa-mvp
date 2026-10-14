import { Heart } from "lucide-react";
import { useFavorites } from "@/hooks/useFavorites";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Heart (favorite) button next to the badge on vendor cards */
export default function FavoriteButton({ vendorId, vendorName, className }: { vendorId: string; vendorName: string; className?: string }) {
  const { ids, toggle } = useFavorites();
  const requireLogin = useRequireLogin();
  const { toast } = useToast();
  const { t } = useI18n();
  const on = ids.has(vendorId);
  // Vendor accounts have no member features (2026-10-09), so no favorite button
  const { isVendor } = useAuth();

  async function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!requireLogin()) return;
    try {
      const added = await toggle(vendorId);
      toast({ title: added ? t(`已加入我的最愛：${vendorName}`, `Saved ${vendorName} to favorites`) : t("已從我的最愛移除", "Removed from favorites") });
    } catch (err) {
      toast({ variant: "destructive", title: t("操作失敗", "Action failed"), description: (err as Error).message });
    }
  }

  if (isVendor) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? t(`從我的最愛移除 ${vendorName}`, `Remove ${vendorName} from favorites`) : t(`把 ${vendorName} 加入我的最愛`, `Save ${vendorName} to favorites`)}
      className={cn(
        "inline-flex items-center justify-center w-7 h-7 rounded-full border border-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "bg-danger-soft text-danger-text" : "bg-card text-muted-foreground hover:text-danger-text",
        className
      )}
    >
      <Heart className={cn("w-3.5 h-3.5", on && "fill-current")} aria-hidden="true" />
    </button>
  );
}

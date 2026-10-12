import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import { getLang, tr } from "@/lib/i18n";

/**
 * AI discount explanation in the item page's "Price breakdown" (2026-10-09): before ordering, diners can see why the discount is what it is and what flexibility a pre-order gives.
 * Functions getDiscountExplanation caches by "discount tier × vendor reliability"; on failure or when missing, nothing is shown and ordering is unaffected.
 */
export default function DiscountExplanation({ vendorId, discountPercent }: { vendorId: string; discountPercent: number }) {
  const lang = getLang();
  const { data } = useQuery({
    queryKey: ["discountExplanation", vendorId, discountPercent, lang],
    queryFn: async () => (await httpsCallable(functions, "getDiscountExplanation")({ vendor_id: vendorId, discount_percent: discountPercent })).data as { explanation: string | null; disclaimer?: string },
    enabled: discountPercent > 0,
    staleTime: 60 * 60 * 1000,
    retry: false,
  });
  if (!data?.explanation) return null;
  return (
    <div className="pt-2 border-t border-border space-y-0.5">
      <p className="flex gap-1.5 text-xs text-foreground">
        <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-accent-foreground" aria-hidden="true" />
        <span>{data.explanation}</span>
      </p>
      <p className="text-[11px] text-muted-foreground pl-5">{tr("AI 產生的規則說明，不是購買建議", "AI-written explanation of the rules, not a recommendation to buy")}</p>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import { getLang, tr } from "@/lib/i18n";

/**
 * 品項頁「金額明細」裡的 AI 折扣說明（2026-10-09）：下單前讓消費者看懂為什麼是這個折數、預購後有哪些彈性。
 * Functions getDiscountExplanation 依「折扣級距 × 店家穩定度」快取；失敗或沒有就不顯示，不影響下單。
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

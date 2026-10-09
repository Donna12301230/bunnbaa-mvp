import { Link } from "wouter";
import { Sparkles } from "lucide-react";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { useVendorMenu } from "@/hooks/useVendorMenu";
import { aiDraftComponentsInUse } from "@/lib/prep";
import { tr } from "@/lib/i18n";
import { useConfirm } from "@/components/ConfirmDialog";

/** 上架品項用到的 AI 草稿半成品（還沒確認）；沒有就空陣列 */
export function useAiDraftsInUse(vendorId: string | undefined) {
  const { data: catalog } = useVendorCatalog(vendorId);
  const { data: items = [] } = useVendorMenu(vendorId);
  return catalog ? aiDraftComponentsInUse(items, catalog.componentsById) : [];
}

/**
 * 備料、叫貨頁上方的提醒：AI 一次補完產生的配方份量是估計值，店家確認前照它備料、叫貨可能多叫或少叫。
 * AI 不替商家決定備貨量（doc/AI功能設計.md 負責任 AI 原則），所以要讓店家看到、自己決定。
 */
export default function AiDraftWarning({ vendorId, what }: { vendorId: string | undefined; what: string }) {
  const drafts = useAiDraftsInUse(vendorId);
  if (drafts.length === 0) return null;
  const names = drafts.map((d) => d.component.name);
  return (
    <div role="alert" className="mb-5 rounded-xl border border-brand/40 bg-accent p-4 text-sm text-accent-foreground">
      <p className="flex items-center gap-1.5 font-semibold">
        <Sparkles className="w-4 h-4 shrink-0" aria-hidden="true" />
        {tr(`${drafts.length} 道半成品的份量還是 AI 估計，${what}可能不準`, `${drafts.length} recipe(s) still use AI-estimated portions — ${what} may be off`)}
      </p>
      <p className="mt-1">
        {names.slice(0, 5).join(tr("、", ", "))}{names.length > 5 ? tr(` 等 ${names.length} 道`, ` and ${names.length - 5} more`) : ""}。
        {tr("請到", "Check them in ")}
        <Link href="/vendor-portal/recipes" className="font-semibold underline underline-offset-2">{tr("食材與供應商", "Ingredients")}</Link>
        {tr("照店裡實際做法改好份量並儲存，就不會再提醒。", " and save them with your real portions to clear this.")}
      </p>
    </div>
  );
}

/** 傳 LINE 叫貨前：有未確認的 AI 草稿就先問店家要不要照樣傳 */
export function useConfirmAiDrafts(vendorId: string | undefined) {
  const drafts = useAiDraftsInUse(vendorId);
  const confirm = useConfirm();
  return async function confirmAiDrafts(): Promise<boolean> {
    if (drafts.length === 0) return true;
    return confirm({
      title: tr("叫貨量含 AI 估計的份量", "This order uses AI-estimated portions"),
      description: tr(
        `${drafts.map((d) => d.component.name).join("、")} 的份量是 AI 估的、還沒確認，叫貨量可能多或少。確定照這份清單傳送嗎？`,
        `${drafts.map((d) => d.component.name).join(", ")} still use AI-estimated portions, so quantities may be off. Send it anyway?`
      ),
      confirmLabel: tr("照樣傳送", "Send anyway"),
      cancelLabel: tr("先去確認", "Check first"),
    });
  };
}

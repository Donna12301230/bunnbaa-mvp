import { useMemo, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { useVendorMenu } from "@/hooks/useVendorMenu";
import { useToast } from "@/hooks/use-toast";
import { aiFillMenu, recipeTargets } from "@/lib/aiFill";
import { itemIssues } from "@/lib/prep";
import { setPendingEdit } from "@/lib/pendingEdit";
import { tr } from "@/lib/i18n";

/**
 * Menu recipe completeness + "AI fill all". Shared by the top of the menu page and the purchasing page.
 * - ready: every dish in listed items has a recipe and every ingredient has a unit price (cost can be computed)
 * - gapItems: listed items that still have dishes without recipes (AI can fill these)
 * - unpriced: recipes complete but ingredients lack unit prices (AI can't fill these; the vendor must)
 */
export function useRecipeGaps() {
  const { data: vendor } = useMyVendor();
  const vendorId = vendor?.id;
  const { data: catalog } = useVendorCatalog(vendorId);
  const { data: items = [] } = useVendorMenu(vendorId);
  const { toast } = useToast();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const listed = useMemo(() => items.filter((i) => i.is_available), [items]);
  const stats = useMemo(() => {
    if (!catalog) return null;
    const gapItems = listed.filter((i) => recipeTargets(i, catalog).length > 0);
    const ready = listed.filter((i) => itemIssues(i, catalog.componentsById, catalog.ingredientsById).length === 0);
    const unpriced = new Map<string, string>();
    for (const i of listed) {
      for (const x of itemIssues(i, catalog.componentsById, catalog.ingredientsById)) {
        if (x.issue.kind === "no_price") unpriced.set(x.issue.ingredientId, x.issue.name);
      }
    }
    return { gapItems, ready, unpriced: [...unpriced] };
  }, [catalog, listed]);

  async function fill(only?: typeof items) {
    if (!vendorId || !catalog || progress) return;
    const targetItems = only ?? stats?.gapItems ?? [];
    if (targetItems.length === 0) return;
    setProgress({ done: 0, total: 0 });
    try {
      const r = await aiFillMenu(vendorId, targetItems, catalog, (done, total) => setProgress({ done, total }));
      toast({
        title: tr(`AI 填好 ${r.drafted} 道菜的配方草稿`, `AI drafted ${r.drafted} recipe(s)`),
        description: [
          r.failed.length ? tr(`${r.failed.join("、")} 沒產生成功，可以再按一次。`, `${r.failed.join(", ")} failed — try again.`) : "",
          tr("份量是 AI 估的，點便當格子確認或修改；單價記得填。", "Amounts are AI estimates — tap a cell to check, and add prices."),
        ].filter(Boolean).join(" "),
      });
    } catch (err) {
      toast({ variant: "destructive", title: tr("AI 產生失敗", "AI fill failed"), description: (err as Error).message });
    } finally {
      setProgress(null);
    }
  }

  return { vendorId, catalog, listed, stats, fill, progress };
}

export const fillingText = (p: { done: number; total: number }) =>
  p.total ? tr(`AI 填寫中 ${p.done}/${p.total}…`, `Filling ${p.done}/${p.total}…`) : tr("AI 準備中…", "Starting…");

/**
 * Replaces the alert bar at the top: a single card with one button. Hidden when everything is complete (don't show anything empty).
 */
export default function RecipeGapCard() {
  const [, navigate] = useLocation();
  const { stats, fill, progress } = useRecipeGaps();
  if (!stats) return null;
  const gaps = stats.gapItems.length;
  if (gaps > 0) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border-2 border-brand/40 bg-accent px-4 py-3 print:hidden">
        <Sparkles className="w-5 h-5 text-accent-foreground shrink-0" />
        <p className="flex-1 min-w-[12rem] text-sm">
          {tr("還有 ", "")}<b className="text-lg">{gaps}</b>{tr(" 道菜沒有配方，叫貨單會不準", ` item(s) have no recipe — purchasing will be off`)}
        </p>
        <Button onClick={() => fill()} disabled={!!progress}>
          <Sparkles /> {progress ? fillingText(progress) : tr("一次產生全部草稿", "Draft them all")}
        </Button>
      </div>
    );
  }
  if (stats.unpriced.length > 0) {
    const [firstId, firstName] = stats.unpriced[0];
    return (
      <button
        type="button"
        className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1 text-sm font-medium text-warning-text hover:bg-warning/30 print:hidden"
        onClick={() => { setPendingEdit("ingredient", firstId); navigate("/vendor-portal/recipes"); }}
      >
        <AlertTriangle className="w-4 h-4" />
        {tr(`缺單價：${firstName}`, `No price: ${firstName}`)}{stats.unpriced.length > 1 ? tr(` 等 ${stats.unpriced.length} 項`, ` +${stats.unpriced.length - 1}`) : ""}
      </button>
    );
  }
  return null;
}

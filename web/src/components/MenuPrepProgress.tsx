import { Fragment, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { useLocation } from "wouter";
import { Check, AlertTriangle, Circle } from "lucide-react";
import { useMyVendor } from "@/hooks/useMyVendor";
import { useVendorCatalog } from "@/hooks/useVendorCatalog";
import { useVendorMenu } from "@/hooks/useVendorMenu";
import { db } from "@/lib/firebase";
import { addDaysStr, mondayOf, todayStr } from "@/lib/pickupSlots";
import { costIssue, ingredientIssues, itemIssues } from "@/lib/prep";
import { setPendingEdit } from "@/lib/pendingEdit";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type Status = "ok" | "warn" | "todo";

/**
 * 「菜單與備料」四頁共用的設定進度條：原物料 → 配方 → 菜單 → 本週盤點 → 叫貨單。
 * 每一格點下去跳到要補的地方（有缺漏就直接打開第一筆）。都設好時縮成一行。
 */
export default function MenuPrepProgress() {
  const [location, navigate] = useLocation();
  const { data: vendor } = useMyVendor();
  const vendorId = vendor?.id;
  const { data: catalog } = useVendorCatalog(vendorId);
  const { data: items = [] } = useVendorMenu(vendorId);
  const thisMonday = mondayOf(todayStr());
  const nextMonday = addDaysStr(thisMonday, 7);

  const { data: weekState } = useQuery({
    queryKey: ["menuPrepProgress", vendorId, thisMonday],
    queryFn: async () => {
      const [inv, list] = await Promise.all([
        getDoc(doc(db, "vendors", vendorId!, "inventory", thisMonday)),
        getDoc(doc(db, "vendors", vendorId!, "purchaseLists", `weekly_${nextMonday}`)),
      ]);
      return { counted: inv.exists() && !!inv.data().counted, listReady: list.exists() };
    },
    enabled: !!vendorId,
    staleTime: 30_000,
  });

  const steps = useMemo(() => {
    if (!catalog) return [];
    const usedIng = new Set(catalog.components.flatMap((c) => c.ingredients.map((l) => l.ingredient_id)));
    // 「沒有配方用到」只是提醒，不算進缺漏（不影響成本與叫貨）
    const badIng = catalog.ingredients.filter((i) => ingredientIssues(i, usedIng).some((x) => x.code !== "unused"));
    const badComp = catalog.components.filter((c) => costIssue(c.id, catalog.componentsById, catalog.ingredientsById));
    const listed = items.filter((i) => i.is_available);
    const badItems = listed.filter((i) => itemIssues(i, catalog.componentsById, catalog.ingredientsById).length > 0);
    const s = (empty: boolean, bad: number): Status => (empty ? "todo" : bad > 0 ? "warn" : "ok");
    return [
      { key: "ing", label: tr("原物料", "Ingredients"), status: s(catalog.ingredients.length === 0, badIng.length), count: badIng.length,
        go: () => { if (badIng[0]) setPendingEdit("ingredient", badIng[0].id); navigate("/vendor-portal/recipes"); } },
      { key: "comp", label: tr("配方", "Recipes"), status: s(catalog.components.length === 0, badComp.length), count: badComp.length,
        go: () => { if (badComp[0]) setPendingEdit("component", badComp[0].id); navigate("/vendor-portal/recipes"); } },
      { key: "menu", label: tr("菜單", "Menu"), status: s(listed.length === 0, badItems.length), count: badItems.length,
        go: () => { if (badItems[0]) setPendingEdit("menu_item", badItems[0].id); navigate("/vendor-portal/menu"); } },
      { key: "count", label: tr("本週盤點", "Stock count"), status: (weekState?.counted ? "ok" : "todo") as Status, count: 0,
        go: () => navigate("/vendor-portal/purchasing") },
      { key: "list", label: tr("下週叫貨單", "Next week's order"), status: (weekState?.listReady ? "ok" : "todo") as Status, count: 0,
        go: () => navigate("/vendor-portal/purchasing") },
    ];
  }, [catalog, items, weekState, location]);

  if (steps.length === 0) return null;
  const allOk = steps.every((st) => st.status === "ok");

  return (
    <nav aria-label={tr("設定進度", "Setup progress")} className={cn("mb-4 rounded-lg border px-3 py-2 text-xs print:hidden", allOk ? "border-green-200 bg-green-50/60" : "border-amber-200 bg-amber-50/60")}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {allOk && <span className="font-semibold text-green-800 mr-1">{tr("設定都齊了：", "All set:")}</span>}
        {steps.map((st, i) => (
          <Fragment key={st.key}>
            {i > 0 && <span className="text-muted-foreground" aria-hidden="true">→</span>}
            <button
              type="button"
              onClick={st.go}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium hover:underline",
                st.status === "ok" && "text-green-800",
                st.status === "warn" && "bg-amber-100 text-amber-900",
                st.status === "todo" && "bg-white border border-border text-foreground",
              )}
            >
              {st.status === "ok" ? <Check className="w-3 h-3" /> : st.status === "warn" ? <AlertTriangle className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
              {st.label}{st.status === "warn" ? ` ${st.count}` : ""}
            </button>
          </Fragment>
        ))}
      </div>
    </nav>
  );
}

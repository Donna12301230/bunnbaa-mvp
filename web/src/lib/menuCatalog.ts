// 菜單兩層：目錄 > 分類（例：目錄「午餐便當」底下有分類「雞肉」「豬肉」）。
// 目錄名稱存在 menu_items.catalog（沒填＝未分目錄），目錄的順序存在 vendors.menu_catalogs；
// 分類沿用 menu_items.category。菜單管理頁與消費者商家頁用同一套分組。

type WithCatalog = { catalog?: string | null };

export const catalogOf = (item: WithCatalog): string => (item.catalog ?? "").trim();

/** 目錄順序：店家排好的在前，品項上有、但還沒列進清單的接在後面（不含「未分目錄」） */
export function catalogOrder(listed: string[] | undefined, items: WithCatalog[]): string[] {
  const out: string[] = [];
  for (const name of [...(listed ?? []), ...items.map(catalogOf)]) {
    const n = name.trim();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export interface CatalogGroup<T> {
  catalog: string; // "" ＝未分目錄
  categories: { category: string; items: T[] }[];
}

/**
 * 依目錄 > 分類分組：目錄照 catalogOrder，未分目錄排最後；同一目錄內的分類保留品項原本的先後。
 * 沒有品項的目錄不會出現。categoryOf 讓呼叫端決定分類要顯示中文還是英文。
 */
export function groupByCatalog<T extends WithCatalog>(items: T[], listed: string[] | undefined, categoryOf: (item: T) => string): CatalogGroup<T>[] {
  const groups: CatalogGroup<T>[] = [];
  for (const catalog of [...catalogOrder(listed, items), ""]) {
    const mine = items.filter((i) => catalogOf(i) === catalog);
    if (mine.length === 0) continue;
    const byCategory = new Map<string, T[]>();
    for (const item of mine) {
      const category = categoryOf(item);
      byCategory.set(category, [...(byCategory.get(category) ?? []), item]);
    }
    groups.push({ catalog, categories: [...byCategory].map(([category, list]) => ({ category, items: list })) });
  }
  return groups;
}

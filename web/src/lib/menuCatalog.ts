// Two menu levels: catalog > category (e.g. catalog "Lunch bentos" contains the categories "Chicken" and "Pork").
// Catalog names are stored in menu_items.catalog (empty = uncataloged), catalog order in vendors.menu_catalogs;
// categories reuse menu_items.category. Menu management and the diner vendor page use the same grouping.

type WithCatalog = { catalog?: string | null };

export const catalogOf = (item: WithCatalog): string => (item.catalog ?? "").trim();

/** Catalog order: the vendor's ordered catalogs first, then ones that appear on items but aren't in the list yet (excluding "uncataloged") */
export function catalogOrder(listed: string[] | undefined, items: WithCatalog[]): string[] {
  const out: string[] = [];
  for (const name of [...(listed ?? []), ...items.map(catalogOf)]) {
    const n = name.trim();
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

export interface CatalogGroup<T> {
  catalog: string; // "" = uncataloged
  categories: { category: string; items: T[] }[];
}

/**
 * Groups by catalog > category: catalogs follow catalogOrder with uncataloged last; categories within a catalog keep the items' original order.
 * Catalogs without items are omitted. categoryOf lets the caller decide whether categories are shown in Chinese or English.
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

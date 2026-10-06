import { useSyncExternalStore } from "react";

// 頂部搜尋列（§4.5）的關鍵字。MarketplaceHeader 寫、預購餐點頁讀；
// hash router 不方便帶 query string，跟 setPreferredPickup 一樣用模組層級的 store。
let current = "";
const listeners = new Set<() => void>();

export function setSearchQuery(q: string) {
  if (q === current) return;
  current = q;
  listeners.forEach((fn) => fn());
}

export function useSearchQuery() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current
  );
}

/** 不分大小寫、忽略空白的包含比對 */
export function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase().replace(/\s+/g, "");
  if (!needle) return true;
  return fields.some((f) => (f || "").toLowerCase().replace(/\s+/g, "").includes(needle));
}

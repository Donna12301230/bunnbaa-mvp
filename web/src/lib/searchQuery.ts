import { useSyncExternalStore } from "react";

// Keyword for the top search bar. MarketplaceHeader writes it and the pre-order meals page reads it;
// the hash router makes passing a query string awkward, so like setPreferredPickup it uses a module-level store.
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

/** Case-insensitive, whitespace-insensitive substring match */
export function matchesQuery(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase().replace(/\s+/g, "");
  if (!needle) return true;
  return fields.some((f) => (f || "").toLowerCase().replace(/\s+/g, "").includes(needle));
}

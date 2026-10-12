import type { Supplier } from "@/types";
import { tr } from "@/lib/i18n";

export interface ShareLine {
  name: string;
  supplier_id: string | null;
  units: number;
  unit_label: string;
  /** Split deliveries: only listed when there is more than one day */
  deliveries?: { date: string; units: number }[];
}

/** Supplier order text grouped by supplier, e.g. "【Supplier A】\nCabbage 3 cases" */
export function purchaseText(title: string, lines: ShareLine[], suppliers: Supplier[]): string {
  const name = (id: string | null) => suppliers.find((s) => s.id === id)?.name ?? tr("未指定", "Unassigned");
  const groups = new Map<string, ShareLine[]>();
  lines.filter((l) => l.units > 0).forEach((l) => groups.set(name(l.supplier_id), [...(groups.get(name(l.supplier_id)) ?? []), l]));
  return [
    title,
    ...[...groups.entries()].map(([sup, ls]) => `【${sup}】\n${ls.map((l) => `${l.name} ${l.units} ${l.unit_label}${l.deliveries && l.deliveries.length > 1 ? `（${l.deliveries.map((d) => `${d.date.slice(5)} ${d.units}`).join("／")}）` : ""}`).join("\n")}`),
  ].join("\n\n");
}

/** Send the supplier order text via LINE in one tap */
export function shareToLine(text: string) {
  window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, "_blank", "noopener");
}

/** Ingredient amount (in ingredient units) → number of purchase units to order (rounded up) */
export function toPurchaseUnits(amount: number, purchaseUnitSize: number): number {
  const size = purchaseUnitSize > 0 ? purchaseUnitSize : 1;
  return Math.ceil(amount / size - 1e-9);
}

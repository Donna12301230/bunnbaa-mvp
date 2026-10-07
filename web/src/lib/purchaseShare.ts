import type { Supplier } from "@/types";
import { tr } from "@/lib/i18n";

export interface ShareLine {
  name: string;
  supplier_id: string | null;
  units: number;
  unit_label: string;
  /** 分日到貨：只有一天以上才列 */
  deliveries?: { date: string; units: number }[];
}

/** 叫貨文字：依小盤商分組，例「【阿明菜行】\n高麗菜 3 箱」 */
export function purchaseText(title: string, lines: ShareLine[], suppliers: Supplier[]): string {
  const name = (id: string | null) => suppliers.find((s) => s.id === id)?.name ?? tr("未指定", "Unassigned");
  const groups = new Map<string, ShareLine[]>();
  lines.filter((l) => l.units > 0).forEach((l) => groups.set(name(l.supplier_id), [...(groups.get(name(l.supplier_id)) ?? []), l]));
  return [
    title,
    ...[...groups.entries()].map(([sup, ls]) => `【${sup}】\n${ls.map((l) => `${l.name} ${l.units} ${l.unit_label}${l.deliveries && l.deliveries.length > 1 ? `（${l.deliveries.map((d) => `${d.date.slice(5)} ${d.units}`).join("／")}）` : ""}`).join("\n")}`),
  ].join("\n\n");
}

/** 一鍵用 LINE 傳出叫貨文字 */
export function shareToLine(text: string) {
  window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, "_blank", "noopener");
}

/** 原物料用量（原物料單位）→ 要叫幾個採購單位（無條件進位） */
export function toPurchaseUnits(amount: number, purchaseUnitSize: number): number {
  const size = purchaseUnitSize > 0 ? purchaseUnitSize : 1;
  return Math.ceil(amount / size - 1e-9);
}

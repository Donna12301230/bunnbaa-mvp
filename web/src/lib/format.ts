import { getLang } from "@/lib/i18n";

// Site-wide money and date formats (2026-10-09 consistency pass):
//   money is always "NT$100" (no space, thousands separators); in Chinese sentences "X 元" / "X 點" are written as is
//   pickup date: Chinese "10/12（一）", English "Mon, 10/12"

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** NT$100, NT$1,250; negatives −NT$30 */
export function formatNT(n: number | null | undefined): string {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? "−" : ""}NT$${Math.abs(v).toLocaleString("en-US")}`;
}

/** "2026-10-12" → 10/12（一） / Mon, 10/12. Returns the input unchanged if it isn't a valid date */
export function formatPickupDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  const md = `${Number(m[2])}/${Number(m[3])}`;
  return getLang() === "en" ? `${WEEKDAY_EN[wd]}, ${md}` : `${md}（${WEEKDAY_ZH[wd]}）`;
}

/** Pickup date + slot: 10/12（一）12:00-12:30 / Mon, 10/12 12:00-12:30 */
export function formatPickup(dateStr: string | null | undefined, window?: string | null): string {
  return [formatPickupDate(dateStr), window || ""].filter(Boolean).join(" ");
}

/** Timestamp (activity, logs): 10/12 14:05 */
export function formatDateTime(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Value in brackets after a label: Chinese "（7+）", English " (7+)" */
export function paren(s: string | number): string {
  return getLang() === "en" ? ` (${s})` : `（${s}）`;
}

import { getLang } from "@/lib/i18n";

// 全站共用的金額與日期格式（2026-10-09 一致性整理）：
//   金額一律「NT$100」（無空格、千分位）；中文敘述句裡的「X 元」「X 點」照寫
//   取餐日：中文「10/12（一）」、英文「Mon, 10/12」

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** NT$100、NT$1,250；負數 −NT$30 */
export function formatNT(n: number | null | undefined): string {
  const v = Math.round(Number(n) || 0);
  return `${v < 0 ? "−" : ""}NT$${Math.abs(v).toLocaleString("en-US")}`;
}

/** "2026-10-12" → 10/12（一）／Mon, 10/12。不是合法日期就原樣回傳 */
export function formatPickupDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return dateStr;
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  const md = `${Number(m[2])}/${Number(m[3])}`;
  return getLang() === "en" ? `${WEEKDAY_EN[wd]}, ${md}` : `${md}（${WEEKDAY_ZH[wd]}）`;
}

/** 取餐日＋時段：10/12（一）12:00-12:30／Mon, 10/12 12:00-12:30 */
export function formatPickup(dateStr: string | null | undefined, window?: string | null): string {
  return [formatPickupDate(dateStr), window || ""].filter(Boolean).join(" ");
}

/** 時間戳（明細、紀錄）：10/12 14:05 */
export function formatDateTime(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

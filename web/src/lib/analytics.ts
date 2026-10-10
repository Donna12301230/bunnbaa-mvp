import { useQuery } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { todayStr } from "@/lib/pickupSlots";

// BigQuery 分析結果寫回 Firestore 後，前端讀的資料格式（doc/GoogleCloud改動建議.md 的 P1、P2）。
// 這些文件都由後端排程用 Admin SDK 寫，前端只讀；還沒有資料時各畫面顯示空狀態，後端接上就會出現。
// 欄位是前端先定的版本（2026-10-10），後端實作時如果要改，改這個檔和 doc/GoogleCloud改動建議.md 的「前端資料格式」一節。

/**
 * 需求預測：vendors/{vendorId}/forecast/{YYYY-MM-DD}，一天一筆（BigQuery AI.FORECAST 的結果）。
 * 店主與管理員可讀（firestore.rules 的 vendors/{vendorId}/{sub}/{docId}）。
 */
export interface DemandForecast {
  date: string; // 取餐日 YYYY-MM-DD，跟文件 id 相同
  predicted: number; // 預估份數（AI.FORECAST 的 forecast_value）
  lower?: number; // 預測區間下界（prediction_interval_lower_bound）
  upper?: number; // 預測區間上界（prediction_interval_upper_bound）
  generated_at?: unknown; // Firestore Timestamp
}

/**
 * 客群：vendors/{vendorId}/segments/{id}，一群一筆（ML.KMEANS 分群＋AI.GENERATE 產生的描述）。
 * 只有彙總數字，不含任何個人資料。
 */
export interface CustomerSegment {
  id: string;
  name: string; // 群名，例：平日午餐固定客
  name_en?: string;
  description: string; // Gemini 產生的一句話描述
  description_en?: string;
  customers: number; // 這一群有幾位客人
  share?: number; // 占全部客人的比例 0–1（沒給就由前端用 customers 算）
  avg_spend?: number; // 平均每筆實付（元）
  orders_per_month?: number; // 平均每月訂幾次
  generated_at?: unknown;
}

/** 管理後台嵌入的 Looker Studio 儀表板網址：platformConfig/analytics（管理員可寫、公開可讀） */
export interface AnalyticsConfig {
  lookerStudioEmbedUrl?: string;
}

/** Looker Studio 的嵌入網址長這樣；只收這個網域，避免管理頁被塞進別的網站 */
export const LOOKER_EMBED_PREFIX = "https://lookerstudio.google.com/embed/";
export const isLookerEmbedUrl = (url: string) => url.startsWith(LOOKER_EMBED_PREFIX) && url.length <= 500;

const numberOr = (v: unknown, fallback?: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/** 今天起最多 7 天的預測，依日期排序；沒有資料回空陣列 */
export function useDemandForecast(vendorId: string | undefined) {
  return useQuery({
    queryKey: ["demandForecast", vendorId, todayStr()],
    queryFn: async (): Promise<DemandForecast[]> => {
      const snap = await getDocs(query(collection(db, "vendors", vendorId!, "forecast"), where("date", ">=", todayStr()), orderBy("date"), limit(7)));
      return snap.docs
        .map((d) => {
          const x = d.data();
          return { date: String(x.date || d.id), predicted: numberOr(x.predicted, NaN)!, lower: numberOr(x.lower), upper: numberOr(x.upper), generated_at: x.generated_at };
        })
        .filter((f) => Number.isFinite(f.predicted) && /^\d{4}-\d{2}-\d{2}$/.test(f.date));
    },
    enabled: !!vendorId,
    staleTime: 10 * 60 * 1000,
  });
}

/** 客群，人數多的在前；沒有資料回空陣列 */
export function useCustomerSegments(vendorId: string | undefined) {
  return useQuery({
    queryKey: ["customerSegments", vendorId],
    queryFn: async (): Promise<CustomerSegment[]> => {
      const snap = await getDocs(query(collection(db, "vendors", vendorId!, "segments"), limit(12)));
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerSegment, "id">) }))
        .filter((s) => typeof s.name === "string" && s.name && numberOr(s.customers, 0)! > 0);
      const total = rows.reduce((sum, s) => sum + s.customers, 0);
      return rows
        .map((s) => ({ ...s, share: numberOr(s.share) ?? (total > 0 ? s.customers / total : 0) }))
        .sort((a, b) => b.customers - a.customers);
    },
    enabled: !!vendorId,
    staleTime: 30 * 60 * 1000,
  });
}

export const analyticsConfigKey = ["analyticsConfig"] as const;
export function useAnalyticsConfig() {
  return useQuery({
    queryKey: analyticsConfigKey,
    queryFn: async (): Promise<AnalyticsConfig> => {
      const snap = await getDoc(doc(db, "platformConfig", "analytics"));
      return snap.exists() ? (snap.data() as AnalyticsConfig) : {};
    },
  });
}

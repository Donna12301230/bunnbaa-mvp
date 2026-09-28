import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Review } from "@/types";

export interface RatingSummary {
  average: number;
  count: number;
}

/** 最近的公開評分（首頁計畫評分、店家排序、Landing 同學評價共用） */
export function useReviews() {
  return useQuery({
    queryKey: ["reviews"],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "reviews"), orderBy("created_at", "desc"), limit(500)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Review);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** 依 key（vendor_id 或 meal_plan_id）算平均星數，沒有評分的 key 不會出現 */
export function summarizeRatings(reviews: Review[], keyOf: (r: Review) => string | null): Map<string, RatingSummary> {
  const sums = new Map<string, { total: number; count: number }>();
  for (const r of reviews) {
    const key = keyOf(r);
    if (!key) continue;
    const row = sums.get(key) ?? { total: 0, count: 0 };
    row.total += r.rating;
    row.count += 1;
    sums.set(key, row);
  }
  return new Map([...sums].map(([k, { total, count }]) => [k, { average: Math.round((total / count) * 10) / 10, count }]));
}

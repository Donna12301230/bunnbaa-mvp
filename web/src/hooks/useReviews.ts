import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Review } from "@/types";

export interface RatingSummary {
  average: number;
  count: number;
}

/** Recent public ratings (shared by home page meal-plan ratings, vendor sorting and Landing student reviews) */
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

/** Average stars per key (vendor_id or meal_plan_id); keys without ratings are omitted */
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

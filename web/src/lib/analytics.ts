import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// Looker Studio URL embedded in the admin console's "Platform dashboard".
// The demand-forecast and segment / frequently-bought-together cards read the backend's documents directly; see components/insights/DemandForecastCard.tsx and CustomerInsightsCard.tsx.

/** Looker Studio dashboard URL embedded in the admin console: platformConfig/analytics (admin-writable, publicly readable) */
export interface AnalyticsConfig {
  lookerStudioEmbedUrl?: string;
  /** Old field name (written by another version before the merge); read only, never written */
  looker_embed_url?: string | null;
}

/** What a Looker Studio embed URL looks like; only this domain is accepted so the admin page can't be made to embed another site */
export const LOOKER_EMBED_PREFIX = "https://lookerstudio.google.com/embed/";
export const isLookerEmbedUrl = (url: string) => url.startsWith(LOOKER_EMBED_PREFIX) && url.length <= 500;

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

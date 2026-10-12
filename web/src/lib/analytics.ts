import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// 管理後台「平台儀表板」嵌入的 Looker Studio 網址。
// 需求預測與客群／常一起買的卡片直接讀後端寫的文件，見 components/insights/DemandForecastCard.tsx、CustomerInsightsCard.tsx。

/** 管理後台嵌入的 Looker Studio 儀表板網址：platformConfig/analytics（管理員可寫、公開可讀） */
export interface AnalyticsConfig {
  lookerStudioEmbedUrl?: string;
  /** 舊欄位名（合併前另一版寫的），只讀不寫 */
  looker_embed_url?: string | null;
}

/** Looker Studio 的嵌入網址長這樣；只收這個網域，避免管理頁被塞進別的網站 */
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

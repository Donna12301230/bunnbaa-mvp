import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { ThemeRoot, type BbLook } from "@/components/ds";

// 整站視覺風格（styles/look-cafe.css）。同步寫到 <html data-look>，
// 讓渲染到 body 的 shadcn 彈層（Dialog、Sheet、Dropdown、Toast）也吃得到同一組 tokens。
// 設計系統預覽頁用 setLook 即時切換比較。
export const DEFAULT_SITE_LOOK: BbLook = "cafe";

const SiteLookContext = createContext<{ look: BbLook; setLook: (look: BbLook) => void }>({
  look: DEFAULT_SITE_LOOK,
  setLook: () => undefined,
});

export function useSiteLook() {
  return useContext(SiteLookContext);
}

/** 取代最外層的 <ThemeRoot>：提供整站風格並套到 ThemeRoot 與 <html>。 */
export function SiteThemeRoot({ children }: { children: ReactNode }) {
  const [look, setLook] = useState<BbLook>(DEFAULT_SITE_LOOK);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-look", look);
  }, [look]);

  return (
    <SiteLookContext.Provider value={{ look, setLook }}>
      <ThemeRoot look={look}>{children}</ThemeRoot>
    </SiteLookContext.Provider>
  );
}

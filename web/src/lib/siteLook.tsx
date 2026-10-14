import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";
import { ThemeRoot, type BbLook } from "@/components/ds";

// Site-wide visual look (styles/look-cafe.css). Also written to <html data-look>
// so shadcn overlays rendered into body (Dialog, Sheet, Dropdown, Toast) get the same tokens.
// The design system preview page uses setLook to switch and compare live.
export const DEFAULT_SITE_LOOK: BbLook = "cafe";

const SiteLookContext = createContext<{ look: BbLook; setLook: (look: BbLook) => void }>({
  look: DEFAULT_SITE_LOOK,
  setLook: () => undefined,
});

export function useSiteLook() {
  return useContext(SiteLookContext);
}

/** Replaces the outermost <ThemeRoot>: provides the site look and applies it to ThemeRoot and <html>. */
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

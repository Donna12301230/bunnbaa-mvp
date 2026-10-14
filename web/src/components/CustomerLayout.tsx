import { ReactNode } from "react";
import MarketplaceHeader, { type MarketplaceTab } from "./MarketplaceHeader";

// Shared shell for the vendor browsing flow (/vendors, /vendor/:id, /item/:id).
// It used to mount a separate Navbar.tsx (whose cart / my orders / my group-buys links pointed to routes that
// didn't exist and 404'd); on 2026-09-21 it switched to the same
// MarketplaceHeader as /home, /marketplace and /my-bookings, keeping the nav bar consistent site-wide.
// hero: full-width page banner (PageHero) between the nav bar and the content, e.g. /vendors.
// active: the nav tab to mark as current, default "Vendors" (the original only use); footer-linked pages such as
// About us / FAQ belong to no tab, so callers pass undefined.
// Pass active = null to mark no tab (undefined gets replaced by the default and wrongly marks "Vendors").
export default function CustomerLayout({ children, hero, active = "vendors" }: { children: ReactNode; hero?: ReactNode; active?: MarketplaceTab | null }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketplaceHeader active={active ?? undefined} />
      {hero}
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 md:px-6 py-6 md:py-12">
        {children}
      </main>
    </div>
  );
}

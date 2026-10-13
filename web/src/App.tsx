import { tr, useI18n } from "@/lib/i18n";
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Switch, Route, Link, Router, Redirect, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { SiteThemeRoot } from "@/lib/siteLook";
import { useAuth } from "@/hooks/useAuth";
import { usePlatformConfig } from "@/lib/platformConfig";

/**
 * After a deploy, an old open tab asks for page files (hashed chunks) that are no longer on Hosting, gets index.html back and fails to load,
 * leaving a blank page. On a load failure, reload once to get the new version; if it fails again within a minute, throw as usual instead of reloading forever.
 */
function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((err) => {
      const KEY = "bunnbaa.chunkReloadAt";
      let last = 0;
      try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* unreadable (e.g. private mode): treat as not reloaded yet */ }
      if (Date.now() - last < 60_000) throw err;
      try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* same as above */ }
      window.location.reload();
      return new Promise<{ default: T }>(() => {});
    })
  );
}

const VendorRedeemPage = lazyPage(() => import("./pages/VendorRedeemPage"));
const PaymentConfirmPage = lazyPage(() => import("./pages/PaymentConfirmPage"));
const PaymentCancelPage = lazyPage(() => import("./pages/PaymentCancelPage"));

const LoginPage = lazyPage(() => import("./pages/LoginPage"));
const HomePage = lazyPage(() => import("./pages/HomePage"));
const FavoritesPage = lazyPage(() => import("./pages/FavoritesPage"));
const ProfilePage = lazyPage(() => import("./pages/ProfilePage"));
const MyBookingsPage = lazyPage(() => import("./pages/MyBookingsPage"));
const GiftClaimPage = lazyPage(() => import("./pages/GiftClaimPage"));
const PickupProxyPage = lazyPage(() => import("./pages/PickupProxyPage"));
const RewardsPage = lazyPage(() => import("./pages/RewardsPage"));
const CartPage = lazyPage(() => import("./pages/CartPage"));
const VendorListPage = lazyPage(() => import("./pages/VendorListPage"));
const VendorPage = lazyPage(() => import("./pages/VendorPage"));
const MenuItemPage = lazyPage(() => import("./pages/MenuItemPage"));
const AboutPage = lazyPage(() => import("./pages/AboutPage"));
const ContactPage = lazyPage(() => import("./pages/ContactPage"));
const FaqPage = lazyPage(() => import("./pages/FaqPage"));
const JoinUsPage = lazyPage(() => import("./pages/JoinUsPage"));
import CustomerLayout from "./components/CustomerLayout";
import MarketplaceHeader from "./components/MarketplaceHeader";
import SiteFooter from "./components/SiteFooter";
import CartPreview from "./components/CartPreview";
import { RequireVendorSignIn } from "./components/RequireRealAdmin";
const AdminVendorsPage = lazyPage(() => import("./pages/admin/AdminVendorsPage"));
const AdminAppealsPage = lazyPage(() => import("./pages/admin/AdminAppealsPage"));
const AdminLocksPage = lazyPage(() => import("./pages/admin/AdminLocksPage"));
const AdminPayoutsPage = lazyPage(() => import("./pages/admin/AdminPayoutsPage"));
const AdminSettingsPage = lazyPage(() => import("./pages/admin/AdminSettingsPage"));
const AdminPlatformPage = lazyPage(() => import("./pages/admin/AdminPlatformPage"));
const AdminAnalyticsPage = lazyPage(() => import("./pages/admin/AdminAnalyticsPage"));
const AdminDishesPage = lazyPage(() => import("./pages/admin/AdminDishesPage"));
const AdminAnomaliesPage = lazyPage(() => import("./pages/admin/AdminEventsPage").then((m) => ({ default: m.AdminAnomaliesPage })));
const AdminDisastersPage = lazyPage(() => import("./pages/admin/AdminEventsPage").then((m) => ({ default: m.AdminDisastersPage })));
const VendorPortalDashboard = lazyPage(() => import("./pages/vendor-portal/VendorPortalDashboard"));
const VendorPortalMenu = lazyPage(() => import("./pages/vendor-portal/VendorPortalMenu"));
const VendorPortalOrders = lazyPage(() => import("./pages/vendor-portal/VendorPortalOrders"));
const VendorPortalPrep = lazyPage(() => import("./pages/vendor-portal/VendorPortalPrep"));
const VendorPortalGrowth = lazyPage(() => import("./pages/vendor-portal/VendorPortalGrowth"));
const VendorPortalReports = lazyPage(() => import("./pages/vendor-portal/VendorPortalReports"));
const VendorPortalSessions = lazyPage(() => import("./pages/vendor-portal/VendorPortalSessions"));
const VendorPortalSessionSummary = lazyPage(() => import("./pages/vendor-portal/VendorPortalSessionSummary"));
const VendorPortalSettings = lazyPage(() => import("./pages/vendor-portal/VendorPortalSettings"));
const VendorPortalRecipes = lazyPage(() => import("./pages/vendor-portal/VendorPortalRecipes"));
const VendorPortalPurchasing = lazyPage(() => import("./pages/vendor-portal/VendorPortalPurchasing"));
const VendorPortalCharity = lazyPage(() => import("./pages/vendor-portal/VendorPortalCharity"));
const VendorPortalInsights = lazyPage(() => import("./pages/vendor-portal/VendorPortalInsights"));

const DesignSystemPreview = lazyPage(() => import("./pages/DesignSystemPreview"));
const LandingPage = lazyPage(() => import("./pages/LandingPage"));

function NotFound() {
  return (
    <>
    <MarketplaceHeader />
    <section className="bb-404">
      {/* Decorative large text: the digits live in CSS ::before, outside the accessibility tree */}
      <p className="bb-404__code" aria-hidden="true" data-text="404" />
      <h1 className="bb-404__title">{tr("這一頁還沒開飯。", "This page isn't on the menu.")}</h1>
      <p className="bb-404__body">{tr("找不到你要的頁面，可能是連結打錯了，或餐點已經下架。", "We couldn't find that page — the link may be wrong or the item is gone.")}</p>
      <div className="bb-404__actions">
        <Link href="/home" className="bb-404__btn">{tr("看今日菜單", "See today's menu")}</Link>
        <Link href="/" className="bb-404__link">{tr("回首頁", "Back home")}</Link>
      </div>
    </section>
    </>
  );
}

// Shown while a lazy (React.lazy) route chunk loads: the brand mark pulses gently so page changes don't flash blank
function RouteFallback() {
  return (
    <div className="bb-route-fallback" role="status" aria-live="polite">
      <img src="/飯飽R-sm.webp" alt="" width={72} height={64} />
      <span className="sr-only">{tr("載入中…", "Loading…")}</span>
    </div>
  );
}

// Scroll to top on route change (hash routing doesn't do this). In-page #anchor links are not handled here.
function ScrollToTopOnRouteChange() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

// Shared site shell: every route is wrapped here, and the footer (SiteFooter) is mounted once here,
// so pages (including CustomerLayout) don't handle it themselves. /landing is the only exception, because
// LandingPage uses its own lazy Suspense route, skips this layer, and mounts its own footer.
function MarketplacePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-sans antialiased bg-background text-foreground">
      {/* bb-page-enter: content fades in and moves up on every route change (global.css, respects reduced-motion) */}
      <div className="bb-page-enter">{children}</div>
      <SiteFooter />
      <CartPreview />
    </div>
  );
}

// Back-office pages (platform admin /admin, vendor /vendor-portal, pickup scan page): same shell, no footer
function BackOfficePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-sans antialiased bg-background text-foreground">
      <div className="bb-page-enter">{children}</div>
    </div>
  );
}

// Store the signed-in user's UI language in users/{uid}.lang so scheduled pushes (pickup reminders) know which language to use.
// Only write when it differs from the stored value; failures are harmless (retried on the next switch or sign-in).
function useSyncUserLang(lang: "zh" | "en") {
  const { user } = useAuth();
  // Remember the last value written during this session (user.lang is read at sign-in and doesn't update after a write)
  const saved = useRef<{ uid: string; lang?: string } | null>(null);
  useEffect(() => {
    if (!user) return;
    if (saved.current?.uid !== user.id) saved.current = { uid: user.id, lang: user.lang };
    if (saved.current.lang === lang) return;
    saved.current.lang = lang;
    setDoc(doc(db, "users", user.id), { lang }, { merge: true }).catch((err) => console.warn("Failed to save language setting", err));
  }, [user?.id, user?.lang, lang]);
}

// Load platform settings (cut-off time, business days, bookable days, extra-rice price…) before rendering, so dates and amounts computed on the frontend match the server
// (lib/platformConfig.ts liveConfig). Waits at most 1.5 s; if the read fails, render with the defaults.
function PlatformConfigGate({ children }: { children: React.ReactNode }) {
  const { isPlaceholderData } = usePlatformConfig();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setTimedOut(true), 1500);
    return () => clearTimeout(id);
  }, []);
  if (isPlaceholderData && !timedOut) return <RouteFallback />;
  return <>{children}</>;
}

// Member-only pages (2026-10-09): vendor accounts only use the public listing and the vendor portal, so these pages redirect them to the vendor portal
function MemberOnly({ children }: { children: React.ReactNode }) {
  const { isVendor } = useAuth();
  if (isVendor) return <Redirect to="/vendor-portal/dashboard" replace />;
  return <>{children}</>;
}

// Root path: always show the brand page LandingPage first, signed in or not (not the ordering
// HomePage — LandingPage's own footer and MarketplaceHeader label /landing as
// "Home" (首頁) and /home as "Today's menu" (今日菜單)). Browsing never required sign-in; users sign in via
// the "Sign in / Sign up" button on LandingPage, and the /login route itself is unchanged.
function RootGate() {
  return <LandingPage />;
}

export default function App() {
  // Remount the whole route tree on language change so strings built with tr() in components (toasts, status labels, error messages) switch too
  const { lang } = useI18n();
  useSyncUserLang(lang);
  return (
    <QueryClientProvider client={queryClient}>
      {/* Design-system tokens are scoped to .bb-theme; wrapping the whole site lets pages use @/components/ds directly */}
      <SiteThemeRoot>
      <ConfirmProvider>
      <PlatformConfigGate>
      <Router hook={useHashLocation} key={lang}>
        <ScrollToTopOnRouteChange />
        <Suspense fallback={<RouteFallback />}>
        <Switch>
          {/* Root path: signed out = login page, signed in = home page (same behavior as bunnbaa.com) */}
          {/* Not wrapped in MarketplacePage: RootGate always shows LandingPage, which has its own SiteFooter;
              wrapping it would render two footers (same as the /landing route, a bare Suspense) */}
          <Route path="/">
            <RootGate />
          </Route>

          {/* The old single-item lock demo pages (/lock, /lock/vendor) were removed on 2026-09-30: ordering now goes through the bento cart,
              and gifting moved to /gift/:lockId. /lock/vendor/redeem stays as the path of the pickup scan page. */}
          <Route path="/lock">
            <Redirect to="/home" replace />
          </Route>
          <Route path="/lock/vendor">
            <Redirect to="/vendor-portal/dashboard" replace />
          </Route>
          <Route path="/lock/vendor/redeem">
            <BackOfficePage><RequireVendorSignIn><VendorRedeemPage /></RequireVendorSignIn></BackOfficePage>
          </Route>
          <Route path="/gift/:lockId">
            <MarketplacePage><MemberOnly><GiftClaimPage /></MemberOnly></MarketplacePage>
          </Route>
          <Route path="/pickup/:lockId/:token">
            <MarketplacePage><PickupProxyPage /></MarketplacePage>
          </Route>
          <Route path="/rewards">
            <MarketplacePage><MemberOnly><RewardsPage /></MemberOnly></MarketplacePage>
          </Route>
          {/* :orderId, not a query string — LINE Pay appends ?transactionId=...
              by string concatenation with no regard for the "#" boundary, which
              would otherwise land inside the hash fragment and break the match.
              See functions/src/index.js's createLinePayReservation. */}
          <Route path="/payment/confirm/:orderId">
            <MarketplacePage><PaymentConfirmPage /></MarketplacePage>
          </Route>
          <Route path="/payment/cancel/:orderId">
            <MarketplacePage><PaymentCancelPage /></MarketplacePage>
          </Route>

          {/* Marketing platform UI ported from BunnBaa Parse_Ref (login / home / admin) */}
          <Route path="/login">
            <MarketplacePage><LoginPage /></MarketplacePage>
          </Route>
          <Route path="/home">
            <MarketplacePage><HomePage /></MarketplacePage>
          </Route>
          {/* Pre-order "meal plan" page (the second-row "Single | Meal plan" tabs are two separate pages) */}
          <Route path="/plans">
            <MarketplacePage><HomePage /></MarketplacePage>
          </Route>
          <Route path="/favorites">
            <MarketplacePage><MemberOnly><FavoritesPage /></MemberOnly></MarketplacePage>
          </Route>
          <Route path="/profile">
            <MarketplacePage><MemberOnly><ProfilePage /></MemberOnly></MarketplacePage>
          </Route>
          {/* The resale market was merged into the "My meals" tab (1002 spec §4.5); old links redirect there */}
          <Route path="/marketplace">
            <Redirect to={/tab=charity/.test(window.location.search + window.location.hash) ? "/my-bookings?tab=charity" : "/my-bookings?tab=market"} replace />
          </Route>
          <Route path="/my-bookings">
            <MarketplacePage><MemberOnly><MyBookingsPage /></MemberOnly></MarketplacePage>
          </Route>
          <Route path="/my-locks">
            <Redirect to="/my-bookings" replace />
          </Route>
          <Route path="/cart">
            <MarketplacePage><MemberOnly><CartPage /></MemberOnly></MarketplacePage>
          </Route>
          <Route path="/vendors">
            <MarketplacePage><VendorListPage /></MarketplacePage>
          </Route>
          <Route path="/vendor/:id">
            <MarketplacePage><CustomerLayout><VendorPage /></CustomerLayout></MarketplacePage>
          </Route>
          <Route path="/item/:id">
            <MarketplacePage><CustomerLayout><MenuItemPage /></CustomerLayout></MarketplacePage>
          </Route>
          <Route path="/about">
            <MarketplacePage><AboutPage /></MarketplacePage>
          </Route>
          <Route path="/contact">
            <MarketplacePage><ContactPage /></MarketplacePage>
          </Route>
          <Route path="/faq">
            <MarketplacePage><FaqPage /></MarketplacePage>
          </Route>
          <Route path="/join">
            <MarketplacePage><JoinUsPage /></MarketplacePage>
          </Route>
          <Route path="/admin/vendors">
            <BackOfficePage><AdminVendorsPage /></BackOfficePage>
          </Route>
          <Route path="/admin/appeals">
            <BackOfficePage><AdminAppealsPage /></BackOfficePage>
          </Route>
          <Route path="/admin/locks">
            <BackOfficePage><AdminLocksPage /></BackOfficePage>
          </Route>
          <Route path="/admin/payouts">
            <BackOfficePage><AdminPayoutsPage /></BackOfficePage>
          </Route>
          <Route path="/admin/analytics">
            <BackOfficePage><AdminAnalyticsPage /></BackOfficePage>
          </Route>
          <Route path="/admin/settings">
            <BackOfficePage><AdminSettingsPage /></BackOfficePage>
          </Route>
          <Route path="/admin/platform">
            <BackOfficePage><AdminPlatformPage /></BackOfficePage>
          </Route>
          <Route path="/admin/dishes">
            <BackOfficePage><AdminDishesPage /></BackOfficePage>
          </Route>
          <Route path="/admin/anomalies">
            <BackOfficePage><AdminAnomaliesPage /></BackOfficePage>
          </Route>
          <Route path="/admin/disasters">
            <BackOfficePage><AdminDisastersPage /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/dashboard">
            <BackOfficePage><VendorPortalDashboard /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/menu">
            <BackOfficePage><VendorPortalMenu /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/orders">
            <BackOfficePage><VendorPortalOrders /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/prep">
            <BackOfficePage><VendorPortalPrep /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/reports">
            <BackOfficePage><VendorPortalReports /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/growth">
            <BackOfficePage><VendorPortalGrowth /></BackOfficePage>
          </Route>
          {/* Old mock scan page, replaced by the real pickup verification page; path kept so old links don't 404 */}
          <Route path="/vendor-portal/scan">
            <Redirect to="/lock/vendor/redeem" replace />
          </Route>
          <Route path="/vendor-portal/sessions/:sessionId/summary">
            <BackOfficePage><VendorPortalSessionSummary /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/sessions">
            <BackOfficePage><VendorPortalSessions /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/settings">
            <BackOfficePage><VendorPortalSettings /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/recipes">
            <BackOfficePage><VendorPortalRecipes /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/purchasing">
            <BackOfficePage><VendorPortalPurchasing /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/charity">
            <BackOfficePage><VendorPortalCharity /></BackOfficePage>
          </Route>
          <Route path="/vendor-portal/insights">
            <BackOfficePage><VendorPortalInsights /></BackOfficePage>
          </Route>

          {/* Design-system preview (tokens + component states); lazy-loaded so it doesn't add to other pages' bundles */}
          <Route path="/design-system">
            <DesignSystemPreview />
          </Route>

          {/* Brand page (layout inspired by cafen, visuals entirely from the design system); lazy-loaded */}
          <Route path="/landing">
            <LandingPage />
          </Route>

          <Route>
            <MarketplacePage><NotFound /></MarketplacePage>
          </Route>
        </Switch>
        </Suspense>
      </Router>
      </PlatformConfigGate>
      </ConfirmProvider>
      <Toaster />
      </SiteThemeRoot>
    </QueryClientProvider>
  );
}

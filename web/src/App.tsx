import { tr, useI18n } from "@/lib/i18n";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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

const VendorRedeemPage = lazy(() => import("./pages/VendorRedeemPage"));
const PaymentConfirmPage = lazy(() => import("./pages/PaymentConfirmPage"));
const PaymentCancelPage = lazy(() => import("./pages/PaymentCancelPage"));

const LoginPage = lazy(() => import("./pages/LoginPage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const MyBookingsPage = lazy(() => import("./pages/MyBookingsPage"));
const GiftClaimPage = lazy(() => import("./pages/GiftClaimPage"));
const PickupProxyPage = lazy(() => import("./pages/PickupProxyPage"));
const RewardsPage = lazy(() => import("./pages/RewardsPage"));
const CartPage = lazy(() => import("./pages/CartPage"));
const VendorListPage = lazy(() => import("./pages/VendorListPage"));
const VendorPage = lazy(() => import("./pages/VendorPage"));
const MenuItemPage = lazy(() => import("./pages/MenuItemPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const FaqPage = lazy(() => import("./pages/FaqPage"));
const JoinUsPage = lazy(() => import("./pages/JoinUsPage"));
import CustomerLayout from "./components/CustomerLayout";
import MarketplaceHeader from "./components/MarketplaceHeader";
import SiteFooter from "./components/SiteFooter";
import CartPreview from "./components/CartPreview";
import { RequireVendorSignIn } from "./components/RequireRealAdmin";
const AdminVendorsPage = lazy(() => import("./pages/admin/AdminVendorsPage"));
const AdminAppealsPage = lazy(() => import("./pages/admin/AdminAppealsPage"));
const AdminLocksPage = lazy(() => import("./pages/admin/AdminLocksPage"));
const AdminPayoutsPage = lazy(() => import("./pages/admin/AdminPayoutsPage"));
const AdminSettingsPage = lazy(() => import("./pages/admin/AdminSettingsPage"));
const AdminPlatformPage = lazy(() => import("./pages/admin/AdminPlatformPage"));
const AdminDishesPage = lazy(() => import("./pages/admin/AdminDishesPage"));
const AdminAnalyticsPage = lazy(() => import("./pages/admin/AdminAnalyticsPage"));
const AdminAnomaliesPage = lazy(() => import("./pages/admin/AdminEventsPage").then((m) => ({ default: m.AdminAnomaliesPage })));
const AdminDisastersPage = lazy(() => import("./pages/admin/AdminEventsPage").then((m) => ({ default: m.AdminDisastersPage })));
const VendorPortalDashboard = lazy(() => import("./pages/vendor-portal/VendorPortalDashboard"));
const VendorPortalMenu = lazy(() => import("./pages/vendor-portal/VendorPortalMenu"));
const VendorPortalOrders = lazy(() => import("./pages/vendor-portal/VendorPortalOrders"));
const VendorPortalPrep = lazy(() => import("./pages/vendor-portal/VendorPortalPrep"));
const VendorPortalGrowth = lazy(() => import("./pages/vendor-portal/VendorPortalGrowth"));
const VendorPortalReports = lazy(() => import("./pages/vendor-portal/VendorPortalReports"));
const VendorPortalSessions = lazy(() => import("./pages/vendor-portal/VendorPortalSessions"));
const VendorPortalSessionSummary = lazy(() => import("./pages/vendor-portal/VendorPortalSessionSummary"));
const VendorPortalSettings = lazy(() => import("./pages/vendor-portal/VendorPortalSettings"));
const VendorPortalRecipes = lazy(() => import("./pages/vendor-portal/VendorPortalRecipes"));
const VendorPortalPurchasing = lazy(() => import("./pages/vendor-portal/VendorPortalPurchasing"));
const VendorPortalCharity = lazy(() => import("./pages/vendor-portal/VendorPortalCharity"));
const VendorPortalInsights = lazy(() => import("./pages/vendor-portal/VendorPortalInsights"));

const DesignSystemPreview = lazy(() => import("./pages/DesignSystemPreview"));
const LandingPage = lazy(() => import("./pages/LandingPage"));

function NotFound() {
  return (
    <>
    <MarketplaceHeader />
    <section className="bb-404">
      {/* 純裝飾大字：數字放在 CSS ::before，不進可及性樹 */}
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

// 路由拆包（React.lazy）載入中的畫面：品牌標誌輕微呼吸，避免換頁時整片空白
function RouteFallback() {
  return (
    <div className="bb-route-fallback" role="status" aria-live="polite">
      <img src="/飯飽R.png" alt="" width={72} height={64} />
      <span className="sr-only">{tr("載入中…", "Loading…")}</span>
    </div>
  );
}

// 換頁時捲回頂端（hash 路由不會自己做）。同一頁內的 #anchor 不在這裡處理。
function ScrollToTopOnRouteChange() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

// 全站共用外框：所有路由都包在這裡，頁尾（SiteFooter）統一在這裡掛一次，
// 頁面本身（含 CustomerLayout）不用各自處理。/landing 是唯一例外，因為
// LandingPage 走獨立的 lazy Suspense 路由、不經過這層，自己掛了一份。
function MarketplacePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-sans antialiased bg-background text-foreground">
      {/* bb-page-enter：每次換頁內容淡入上移（global.css，尊重 reduced-motion） */}
      <div className="bb-page-enter">{children}</div>
      <SiteFooter />
      <CartPreview />
    </div>
  );
}

// 後台（平台管理 /admin、店家 /vendor-portal、取餐掃碼頁）：同樣外框，但不掛頁尾
function BackOfficePage({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-sans antialiased bg-background text-foreground">
      <div className="bb-page-enter">{children}</div>
    </div>
  );
}

// 登入中的使用者把介面語言存進 users/{uid}.lang，排程推播（取餐提醒）才知道要用哪種語言。
// 只有跟已存的不同時才寫；失敗不影響使用（下次切換或登入再試）。
function useSyncUserLang(lang: "zh" | "en") {
  const { user } = useAuth();
  // 記住這次登入期間最後寫進去的值（user.lang 是登入當下讀的，寫完不會自己更新）
  const saved = useRef<{ uid: string; lang?: string } | null>(null);
  useEffect(() => {
    if (!user) return;
    if (saved.current?.uid !== user.id) saved.current = { uid: user.id, lang: user.lang };
    if (saved.current.lang === lang) return;
    saved.current.lang = lang;
    setDoc(doc(db, "users", user.id), { lang }, { merge: true }).catch((err) => console.warn("儲存語言設定失敗", err));
  }, [user?.id, user?.lang, lang]);
}

// 平台參數（截單時間、營業日、可訂天數、加飯價…）先讀進來再畫頁面，前端算的日期與金額才會跟伺服器一致
// （lib/platformConfig.ts liveConfig）。最多等 1.5 秒，讀不到就用預設值照常顯示。
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

// 會員專用頁（2026-10-09）：廠商帳號只用「上架顯示」與廠商後台，打開這些頁直接導去廠商後台
function MemberOnly({ children }: { children: React.ReactNode }) {
  const { isVendor } = useAuth();
  if (isVendor) return <Redirect to="/vendor-portal/dashboard" replace />;
  return <>{children}</>;
}

// 根路徑：不管有沒有登入都先看品牌形象頁 LandingPage（不是訂購用的
// HomePage——LandingPage 自己的頁尾／MarketplaceHeader 都把 /landing 標成
// 「首頁」、/home 標成「今日菜單」）。瀏覽本來就不用登入，登入從
// LandingPage 上的「登入／註冊」按鈕自己點，/login 路由本身沒有動。
function RootGate() {
  return <LandingPage />;
}

export default function App() {
  // 切換語言時整個路由樹重新掛載，元件裡用 tr() 組的字串（toast、狀態標籤、錯誤訊息）才會一起換
  const { lang } = useI18n();
  useSyncUserLang(lang);
  return (
    <QueryClientProvider client={queryClient}>
      {/* 設計系統 tokens 限定在 .bb-theme 之內；包住全站，頁面才能直接使用 @/components/ds */}
      <SiteThemeRoot>
      <ConfirmProvider>
      <PlatformConfigGate>
      <Router hook={useHashLocation} key={lang}>
        <ScrollToTopOnRouteChange />
        <Suspense fallback={<RouteFallback />}>
        <Switch>
          {/* 根路徑：未登入 = 登入頁，已登入 = 首頁（與 bunnbaa.com 行為一致） */}
          {/* 不包 MarketplacePage：RootGate 一律顯示 LandingPage，LandingPage 自己有 SiteFooter，
              包了會變兩份頁尾（跟 /landing 路由一樣直接裸 Suspense） */}
          <Route path="/">
            <RootGate />
          </Route>

          {/* 舊的單品鎖定示範頁（/lock、/lock/vendor）2026-09-30 拿掉：下單改走便當購物車，
              贈送改 /gift/:lockId。/lock/vendor/redeem 保留為取餐掃碼頁的路徑。 */}
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

          {/* 搬移自 BunnBaa Parse_Ref 的行銷平台 UI（登入/首頁/後台） */}
          <Route path="/login">
            <MarketplacePage><LoginPage /></MarketplacePage>
          </Route>
          <Route path="/home">
            <MarketplacePage><HomePage /></MarketplacePage>
          </Route>
          {/* 預購餐點的「方案」頁（第二排「單點｜方案」是兩個獨立頁面） */}
          <Route path="/plans">
            <MarketplacePage><HomePage /></MarketplacePage>
          </Route>
          <Route path="/favorites">
            <MarketplacePage><MemberOnly><FavoritesPage /></MemberOnly></MarketplacePage>
          </Route>
          <Route path="/profile">
            <MarketplacePage><MemberOnly><ProfilePage /></MemberOnly></MarketplacePage>
          </Route>
          {/* 轉讓市集併入「我的餐點」分頁（1002 規格 §4.5）；舊連結轉過去 */}
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
          <Route path="/admin/settings">
            <BackOfficePage><AdminSettingsPage /></BackOfficePage>
          </Route>
          <Route path="/admin/platform">
            <BackOfficePage><AdminPlatformPage /></BackOfficePage>
          </Route>
          <Route path="/admin/analytics">
            <BackOfficePage><AdminAnalyticsPage /></BackOfficePage>
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
          {/* 舊版 mock 掃碼頁，已由真的核對取餐頁取代，保留路徑避免舊連結 404 */}
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

          {/* 設計系統預覽（tokens + 元件狀態一覽）；lazy 載入，不增加其他頁面的 bundle */}
          <Route path="/design-system">
            <DesignSystemPreview />
          </Route>

          {/* 品牌形象頁（版面參考 cafen，視覺全用設計系統）；lazy 載入 */}
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

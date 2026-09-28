import { tr, useI18n } from "@/lib/i18n";
import { lazy, Suspense, useEffect, useRef } from "react";
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Switch, Route, Link, Router, Redirect } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { SiteThemeRoot } from "@/lib/siteLook";
import { useAuth } from "@/hooks/useAuth";

import ConsumerLockPage from "./pages/ConsumerLockPage";
import VendorDashboard from "./pages/VendorDashboard";
import VendorRedeemPage from "./pages/VendorRedeemPage";
import PaymentConfirmPage from "./pages/PaymentConfirmPage";
import PaymentCancelPage from "./pages/PaymentCancelPage";

import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import ProfilePage from "./pages/ProfilePage";
import TransferMarketPage from "./pages/TransferMarketPage";
import MyBookingsPage from "./pages/MyBookingsPage";
import MyLocksPage from "./pages/MyLocksPage";
import CartPage from "./pages/CartPage";
import VendorListPage from "./pages/VendorListPage";
import VendorPage from "./pages/VendorPage";
import MenuItemPage from "./pages/MenuItemPage";
import CustomerLayout from "./components/CustomerLayout";
import { RequireVendorSignIn } from "./components/RequireRealAdmin";
import AdminVendorsPage from "./pages/admin/AdminVendorsPage";
import AdminAppealsPage from "./pages/admin/AdminAppealsPage";
import AdminLocksPage from "./pages/admin/AdminLocksPage";
import AdminPayoutsPage from "./pages/admin/AdminPayoutsPage";
import AdminSettingsPage from "./pages/admin/AdminSettingsPage";
import VendorPortalDashboard from "./pages/vendor-portal/VendorPortalDashboard";
import VendorPortalMenu from "./pages/vendor-portal/VendorPortalMenu";
import VendorPortalOrders from "./pages/vendor-portal/VendorPortalOrders";
import VendorPortalPrep from "./pages/vendor-portal/VendorPortalPrep";
import VendorPortalGrowth from "./pages/vendor-portal/VendorPortalGrowth";
import VendorPortalReports from "./pages/vendor-portal/VendorPortalReports";
import VendorPortalSessions from "./pages/vendor-portal/VendorPortalSessions";
import VendorPortalSessionSummary from "./pages/vendor-portal/VendorPortalSessionSummary";
import VendorPortalSettings from "./pages/vendor-portal/VendorPortalSettings";

const DesignSystemPreview = lazy(() => import("./pages/DesignSystemPreview"));
const LandingPage = lazy(() => import("./pages/LandingPage"));

function NotFound() {
  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <p>{tr("找不到這個頁面。", "Page not found.")}</p>
      <Link href="/">{tr("回首頁", "Home")}</Link>
    </div>
  );
}

function MarketplacePage({ children }: { children: React.ReactNode }) {
  return <div className="font-sans antialiased bg-background text-foreground">{children}</div>;
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

// 根路徑跟來源專案一致：未登入顯示登入頁、已登入顯示首頁
function RootGate() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  return isAuthenticated ? <HomePage /> : <LoginPage />;
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
      <Router hook={useHashLocation} key={lang}>
        <Switch>
          {/* 根路徑：未登入 = 登入頁，已登入 = 首頁（與 bunnbaa.com 行為一致） */}
          <Route path="/">
            <MarketplacePage><RootGate /></MarketplacePage>
          </Route>

          {/* 既有的預購鎖定機制 Demo — 維持原樣，改掛在 /lock 底下 */}
          <Route path="/lock">
            <div className="legacy-ui"><ConsumerLockPage /></div>
          </Route>
          <Route path="/lock/vendor">
            <div className="legacy-ui"><RequireVendorSignIn><VendorDashboard /></RequireVendorSignIn></div>
          </Route>
          <Route path="/lock/vendor/redeem">
            <MarketplacePage><VendorRedeemPage /></MarketplacePage>
          </Route>
          {/* :orderId, not a query string — LINE Pay appends ?transactionId=...
              by string concatenation with no regard for the "#" boundary, which
              would otherwise land inside the hash fragment and break the match.
              See functions/src/index.js's createLinePayReservation. */}
          <Route path="/payment/confirm/:orderId">
            <div className="legacy-ui"><PaymentConfirmPage /></div>
          </Route>
          <Route path="/payment/cancel/:orderId">
            <div className="legacy-ui"><PaymentCancelPage /></div>
          </Route>

          {/* 搬移自 BunnBaa Parse_Ref 的行銷平台 UI（登入/首頁/後台） */}
          <Route path="/login">
            <MarketplacePage><LoginPage /></MarketplacePage>
          </Route>
          <Route path="/home">
            <MarketplacePage><HomePage /></MarketplacePage>
          </Route>
          <Route path="/profile">
            <MarketplacePage><ProfilePage /></MarketplacePage>
          </Route>
          <Route path="/marketplace">
            <MarketplacePage><TransferMarketPage /></MarketplacePage>
          </Route>
          <Route path="/my-bookings">
            <MarketplacePage><MyBookingsPage /></MarketplacePage>
          </Route>
          <Route path="/my-locks">
            <MarketplacePage><MyLocksPage /></MarketplacePage>
          </Route>
          <Route path="/cart">
            <MarketplacePage><CartPage /></MarketplacePage>
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
          <Route path="/admin/vendors">
            <MarketplacePage><AdminVendorsPage /></MarketplacePage>
          </Route>
          <Route path="/admin/appeals">
            <MarketplacePage><AdminAppealsPage /></MarketplacePage>
          </Route>
          <Route path="/admin/locks">
            <MarketplacePage><AdminLocksPage /></MarketplacePage>
          </Route>
          <Route path="/admin/payouts">
            <MarketplacePage><AdminPayoutsPage /></MarketplacePage>
          </Route>
          <Route path="/admin/settings">
            <MarketplacePage><AdminSettingsPage /></MarketplacePage>
          </Route>
          <Route path="/vendor-portal/dashboard">
            <MarketplacePage><VendorPortalDashboard /></MarketplacePage>
          </Route>
          <Route path="/vendor-portal/menu">
            <MarketplacePage><VendorPortalMenu /></MarketplacePage>
          </Route>
          <Route path="/vendor-portal/orders">
            <MarketplacePage><VendorPortalOrders /></MarketplacePage>
          </Route>
          <Route path="/vendor-portal/prep">
            <MarketplacePage><VendorPortalPrep /></MarketplacePage>
          </Route>
          <Route path="/vendor-portal/reports">
            <MarketplacePage><VendorPortalReports /></MarketplacePage>
          </Route>
          <Route path="/vendor-portal/growth">
            <MarketplacePage><VendorPortalGrowth /></MarketplacePage>
          </Route>
          {/* 舊版 mock 掃碼頁，已由真的核對取餐頁取代，保留路徑避免舊連結 404 */}
          <Route path="/vendor-portal/scan">
            <Redirect to="/lock/vendor/redeem" replace />
          </Route>
          <Route path="/vendor-portal/sessions/:sessionId/summary">
            <MarketplacePage><VendorPortalSessionSummary /></MarketplacePage>
          </Route>
          <Route path="/vendor-portal/sessions">
            <MarketplacePage><VendorPortalSessions /></MarketplacePage>
          </Route>
          <Route path="/vendor-portal/settings">
            <MarketplacePage><VendorPortalSettings /></MarketplacePage>
          </Route>

          {/* 設計系統預覽（tokens + 元件狀態一覽）；lazy 載入，不增加其他頁面的 bundle */}
          <Route path="/design-system">
            <Suspense fallback={null}><DesignSystemPreview /></Suspense>
          </Route>

          {/* 品牌形象頁（版面參考 cafen，視覺全用設計系統）；lazy 載入 */}
          <Route path="/landing">
            <Suspense fallback={null}><LandingPage /></Suspense>
          </Route>

          <Route>
            <MarketplacePage><NotFound /></MarketplacePage>
          </Route>
        </Switch>
      </Router>
      </ConfirmProvider>
      <Toaster />
      </SiteThemeRoot>
    </QueryClientProvider>
  );
}

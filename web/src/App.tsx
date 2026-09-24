import { lazy, Suspense } from "react";
import { Switch, Route, Link, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { ConfirmProvider } from "@/components/ConfirmDialog";
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
import VendorPortalScan from "./pages/vendor-portal/VendorPortalScan";
import VendorPortalSessions from "./pages/vendor-portal/VendorPortalSessions";
import VendorPortalSessionSummary from "./pages/vendor-portal/VendorPortalSessionSummary";
import VendorPortalSettings from "./pages/vendor-portal/VendorPortalSettings";

const DesignSystemPreview = lazy(() => import("./pages/DesignSystemPreview"));

function NotFound() {
  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <p>找不到這個頁面。</p>
      <Link href="/">回首頁</Link>
    </div>
  );
}

function MarketplacePage({ children }: { children: React.ReactNode }) {
  return <div className="font-sans antialiased bg-background text-foreground">{children}</div>;
}

// 根路徑跟來源專案一致：未登入顯示登入頁、已登入顯示首頁
function RootGate() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <HomePage /> : <LoginPage />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
      <Router hook={useHashLocation}>
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
            <RequireVendorSignIn><VendorRedeemPage /></RequireVendorSignIn>
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
            <MarketplacePage><CustomerLayout><VendorListPage /></CustomerLayout></MarketplacePage>
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
          <Route path="/vendor-portal/scan">
            <MarketplacePage><VendorPortalScan /></MarketplacePage>
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

          <Route>
            <MarketplacePage><NotFound /></MarketplacePage>
          </Route>
        </Switch>
      </Router>
      </ConfirmProvider>
      <Toaster />
    </QueryClientProvider>
  );
}

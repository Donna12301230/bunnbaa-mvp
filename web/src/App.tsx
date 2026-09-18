import { Switch, Route, Link, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@/hooks/useAuth";

import ConsumerLockPage from "./pages/ConsumerLockPage";
import VendorDashboard from "./pages/VendorDashboard";
import VendorRedeemPage from "./pages/VendorRedeemPage";

import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import AdminVendorsPage from "./pages/admin/AdminVendorsPage";
import AdminAppealsPage from "./pages/admin/AdminAppealsPage";
import VendorPortalDashboard from "./pages/vendor-portal/VendorPortalDashboard";
import VendorPortalMenu from "./pages/vendor-portal/VendorPortalMenu";
import VendorPortalOrders from "./pages/vendor-portal/VendorPortalOrders";
import VendorPortalReports from "./pages/vendor-portal/VendorPortalReports";
import VendorPortalScan from "./pages/vendor-portal/VendorPortalScan";
import VendorPortalSessions from "./pages/vendor-portal/VendorPortalSessions";
import VendorPortalSessionSummary from "./pages/vendor-portal/VendorPortalSessionSummary";
import VendorPortalSettings from "./pages/vendor-portal/VendorPortalSettings";

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
            <div className="legacy-ui"><VendorDashboard /></div>
          </Route>
          <Route path="/lock/vendor/redeem">
            <div className="legacy-ui"><VendorRedeemPage /></div>
          </Route>

          {/* 搬移自 BunnBaa Parse_Ref 的行銷平台 UI（登入/首頁/後台） */}
          <Route path="/login">
            <MarketplacePage><LoginPage /></MarketplacePage>
          </Route>
          <Route path="/home">
            <MarketplacePage><HomePage /></MarketplacePage>
          </Route>
          <Route path="/admin/vendors">
            <MarketplacePage><AdminVendorsPage /></MarketplacePage>
          </Route>
          <Route path="/admin/appeals">
            <MarketplacePage><AdminAppealsPage /></MarketplacePage>
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
          <Route path="/vendor-portal/reports">
            <MarketplacePage><VendorPortalReports /></MarketplacePage>
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

          <Route>
            <MarketplacePage><NotFound /></MarketplacePage>
          </Route>
        </Switch>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}

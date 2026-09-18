import { Switch, Route, Link, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";

import ConsumerLockPage from "./pages/ConsumerLockPage";
import VendorDashboard from "./pages/VendorDashboard";
import VendorRedeemPage from "./pages/VendorRedeemPage";

import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import AdminVendorsPage from "./pages/admin/AdminVendorsPage";
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
      <Link href="/home">回首頁</Link>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router hook={useHashLocation}>
        <nav style={{ display: "flex", flexWrap: "wrap", gap: 16, padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
          <strong style={{ color: "var(--brand)" }}>BunnBaa</strong>
          <span style={{ opacity: 0.5 }}>|</span>
          <Link to="/">鎖定 Demo</Link>
          <Link to="/vendor">鎖定商家後台 Demo</Link>
          <Link to="/vendor/redeem">核對取餐 Demo</Link>
          <span style={{ opacity: 0.5 }}>|</span>
          <Link to="/login">登入</Link>
          <Link to="/home">首頁</Link>
          <Link to="/admin/vendors">平台管理後台</Link>
          <Link to="/vendor-portal/dashboard">商家後台</Link>
        </nav>

        <Switch>
          {/* 既有的預購鎖定機制 Demo — 維持原樣 */}
          <Route path="/">
            <div className="legacy-ui"><ConsumerLockPage /></div>
          </Route>
          <Route path="/vendor">
            <div className="legacy-ui"><VendorDashboard /></div>
          </Route>
          <Route path="/vendor/redeem">
            <div className="legacy-ui"><VendorRedeemPage /></div>
          </Route>

          {/* 搬移自 BunnBaa Parse_Ref 的行銷平台 UI（登入/首頁/後台） */}
          <Route path="/login">
            <div className="font-sans antialiased bg-background text-foreground"><LoginPage /></div>
          </Route>
          <Route path="/home">
            <div className="font-sans antialiased bg-background text-foreground"><HomePage /></div>
          </Route>
          <Route path="/admin/vendors">
            <div className="font-sans antialiased bg-background text-foreground"><AdminVendorsPage /></div>
          </Route>
          <Route path="/vendor-portal/dashboard">
            <div className="font-sans antialiased bg-background text-foreground"><VendorPortalDashboard /></div>
          </Route>
          <Route path="/vendor-portal/menu">
            <div className="font-sans antialiased bg-background text-foreground"><VendorPortalMenu /></div>
          </Route>
          <Route path="/vendor-portal/orders">
            <div className="font-sans antialiased bg-background text-foreground"><VendorPortalOrders /></div>
          </Route>
          <Route path="/vendor-portal/reports">
            <div className="font-sans antialiased bg-background text-foreground"><VendorPortalReports /></div>
          </Route>
          <Route path="/vendor-portal/scan">
            <div className="font-sans antialiased bg-background text-foreground"><VendorPortalScan /></div>
          </Route>
          <Route path="/vendor-portal/sessions/:sessionId/summary">
            <div className="font-sans antialiased bg-background text-foreground"><VendorPortalSessionSummary /></div>
          </Route>
          <Route path="/vendor-portal/sessions">
            <div className="font-sans antialiased bg-background text-foreground"><VendorPortalSessions /></div>
          </Route>
          <Route path="/vendor-portal/settings">
            <div className="font-sans antialiased bg-background text-foreground"><VendorPortalSettings /></div>
          </Route>

          <Route>
            <div className="font-sans antialiased bg-background text-foreground"><NotFound /></div>
          </Route>
        </Switch>
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}

import type { ReactNode } from "react";
import { HashRouter, Routes, Route, Link, Navigate } from "react-router-dom";
import ConsumerLockPage from "./pages/ConsumerLockPage";
import VendorDashboard from "./pages/VendorDashboard";
import VendorRedeemPage from "./pages/VendorRedeemPage";
import AdminLoginPage from "./pages/admin/AdminLoginPage";
import AdminLayout from "./pages/admin/AdminLayout";
import AdminVendorsPage from "./pages/admin/AdminVendorsPage";
import AdminLocksPage from "./pages/admin/AdminLocksPage";
import AdminPayoutsPage from "./pages/admin/AdminPayoutsPage";
import AdminSettingsPage from "./pages/admin/AdminSettingsPage";
import RequireAdmin from "./components/RequireAdmin";

function withAdminChrome(children: ReactNode) {
  return (
    <RequireAdmin>
      <AdminLayout>{children}</AdminLayout>
    </RequireAdmin>
  );
}

export default function App() {
  return (
    <HashRouter>
      <nav style={{ display: "flex", gap: 16, padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
        <strong style={{ color: "var(--brand)" }}>BunnBaa</strong>
        <Link to="/">消費者端</Link>
        <Link to="/vendor">商家後台</Link>
        <Link to="/vendor/redeem">核對取餐</Link>
        <Link to="/admin" style={{ marginLeft: "auto", fontSize: 12, color: "var(--faint)" }}>
          管理後台
        </Link>
      </nav>
      <Routes>
        <Route path="/" element={<ConsumerLockPage />} />
        <Route path="/vendor" element={<VendorDashboard />} />
        <Route path="/vendor/redeem" element={<VendorRedeemPage />} />
        <Route path="/admin/login" element={<AdminLoginPage />} />
        <Route path="/admin" element={<Navigate to="/admin/vendors" replace />} />
        <Route path="/admin/vendors" element={withAdminChrome(<AdminVendorsPage />)} />
        <Route path="/admin/locks" element={withAdminChrome(<AdminLocksPage />)} />
        <Route path="/admin/payouts" element={withAdminChrome(<AdminPayoutsPage />)} />
        <Route path="/admin/settings" element={withAdminChrome(<AdminSettingsPage />)} />
      </Routes>
    </HashRouter>
  );
}

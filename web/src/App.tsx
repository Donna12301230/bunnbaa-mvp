import { HashRouter, Routes, Route, Link } from "react-router-dom";
import ConsumerLockPage from "./pages/ConsumerLockPage";
import VendorDashboard from "./pages/VendorDashboard";
import VendorRedeemPage from "./pages/VendorRedeemPage";

export default function App() {
  return (
    <HashRouter>
      <nav style={{ display: "flex", gap: 16, padding: "14px 20px", borderBottom: "1px solid var(--line)" }}>
        <strong style={{ color: "var(--brand)" }}>BunnBaa</strong>
        <Link to="/">消費者端</Link>
        <Link to="/vendor">商家後台</Link>
        <Link to="/vendor/redeem">核對取餐</Link>
      </nav>
      <Routes>
        <Route path="/" element={<ConsumerLockPage />} />
        <Route path="/vendor" element={<VendorDashboard />} />
        <Route path="/vendor/redeem" element={<VendorRedeemPage />} />
      </Routes>
    </HashRouter>
  );
}

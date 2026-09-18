import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../../lib/firebase";

const TABS = [
  { to: "/admin/vendors", label: "商家管理" },
  { to: "/admin/locks", label: "訂單總覽" },
  { to: "/admin/payouts", label: "撥款總覽" },
  { to: "/admin/settings", label: "系統設定" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();

  async function handleLogout() {
    await signOut(auth);
    navigate("/admin/login", { replace: true });
  }

  return (
    <div>
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 20px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <strong style={{ color: "var(--brand)" }}>BunnBaa 管理後台</strong>
        {TABS.map((tab) => (
          <Link
            key={tab.to}
            to={tab.to}
            style={{
              fontWeight: location.pathname === tab.to ? 700 : 400,
              textDecoration: location.pathname === tab.to ? "underline" : "none",
            }}
          >
            {tab.label}
          </Link>
        ))}
        <button className="secondary" style={{ marginLeft: "auto" }} onClick={handleLogout}>
          登出
        </button>
      </nav>
      {children}
    </div>
  );
}

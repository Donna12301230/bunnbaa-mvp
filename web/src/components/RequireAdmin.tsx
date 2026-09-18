import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAdminUser } from "../lib/adminAuth";

/**
 * UX-level guard only — the real access boundary is firestore.rules'
 * isAdmin() check. This just keeps non-admins out of the admin pages.
 */
export default function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useAdminUser();

  if (loading) {
    return (
      <div className="page">
        <p className="muted">確認登入狀態中…</p>
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}

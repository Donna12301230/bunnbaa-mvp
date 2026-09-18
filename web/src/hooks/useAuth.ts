import { useEffect, useState } from "react";
import { mockAuthStore } from "@/lib/mockAuth";
import type { UserProfile } from "@/types";

// TODO(firebase): ported from Parse_Ref's useAuth.ts, which synced against
// Parse.User.currentAsync(). This reads the mock session in mockAuth.ts so the
// ported login/home/admin/vendor-portal UI is still navigable; swap the
// underlying store for real Firebase Auth state once the backend is wired up.
export function useAuth() {
  const [user, setUser] = useState<UserProfile | null>(mockAuthStore.user);

  useEffect(() => mockAuthStore.subscribe(() => setUser(mockAuthStore.user)), []);

  return {
    user,
    isLoading: false,
    isAuthenticated: !!user,
    isVendor: user?.role === "vendor",
    isAdmin: user?.role === "admin",
    isCustomer: !user || user.role === "customer",
    isOrderBanned: user?.orderBanned ?? false,
  };
}

import { useSyncExternalStore } from "react";
import { authStore } from "@/lib/auth";

// Platform sign-in state: reads the shared store in lib/auth.ts maintained by
// Firebase Auth (onAuthStateChanged). user is null when signed out.
export function useAuth() {
  const { user, loading } = useSyncExternalStore(authStore.subscribe, authStore.getSnapshot);

  return {
    user,
    isLoading: loading,
    isAuthenticated: !!user,
    isVendor: user?.role === "vendor",
    isAdmin: user?.role === "admin",
    isCustomer: !user || user.role === "customer",
    isOrderBanned: user?.orderBanned ?? false,
  };
}

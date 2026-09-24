import { useSyncExternalStore } from "react";
import { authStore } from "@/lib/auth";

// 平台登入狀態：讀 lib/auth.ts 裡由 Firebase Auth（onAuthStateChanged）維護的
// 共用 store。匿名身分（消費端鎖定流程用）不算登入，user 會是 null。
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

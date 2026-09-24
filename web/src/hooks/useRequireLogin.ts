import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";

/**
 * 鎖定／下單／轉讓等動作要先登入（2026-09-24 起不再用匿名身分）。
 * 在動作一開始呼叫 requireLogin()：沒登入就提示並導到登入頁、回傳 false。
 */
export function useRequireLogin() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  return function requireLogin(): boolean {
    if (isAuthenticated) return true;
    if (!isLoading) {
      toast({ title: "請先登入", description: "登入後才能預購、下單或轉讓餐點。" });
      navigate("/login");
    }
    return false;
  };
}

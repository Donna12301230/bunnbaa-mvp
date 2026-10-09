import { tr } from "@/lib/i18n";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { toast, useToast } from "@/hooks/use-toast";
import { rememberReturnPath } from "@/lib/returnPath";

/** 廠商帳號只用來看上架顯示與廠商後台（2026-10-09），會員功能（下單、轉讓、收藏、愛心餐…）一律擋下 */
export function vendorBlockedToast() {
  toast({
    title: tr("廠商帳號不能使用會員功能", "Vendor accounts can't use member features"),
    description: tr("廠商帳號只能查看上架顯示與廠商後台；要訂餐請改用一般會員帳號。", "Vendor accounts are for checking your listings and the vendor portal. Use a member account to order."),
  });
}

/**
 * 鎖定／下單／轉讓等動作要先登入（2026-09-24 起不再用匿名身分）。
 * 在動作一開始呼叫 requireLogin()：沒登入就提示並導到登入頁、回傳 false；廠商帳號也回傳 false。
 */
export function useRequireLogin() {
  const { isAuthenticated, isLoading, isVendor } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  return function requireLogin(): boolean {
    if (isVendor) {
      vendorBlockedToast();
      return false;
    }
    if (isAuthenticated) return true;
    if (!isLoading) {
      toast({ title: tr("請先登入", "Please sign in"), description: tr("登入後才能預購、下單或轉讓餐點。", "Sign in to pre-order, check out or transfer meals.") });
      rememberReturnPath();
      navigate("/login");
    }
    return false;
  };
}

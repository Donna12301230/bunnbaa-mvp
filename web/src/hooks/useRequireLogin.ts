import { tr } from "@/lib/i18n";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { toast, useToast } from "@/hooks/use-toast";
import { rememberReturnPath } from "@/lib/returnPath";

/** Vendor accounts are only for viewing the storefront and the vendor portal (2026-10-09); member features (ordering, resale, favorites, charity meals...) are all blocked */
export function vendorBlockedToast() {
  toast({
    title: tr("店家帳號不能使用會員功能", "Vendor accounts can't use member features"),
    description: tr("店家帳號只能查看上架顯示與店家後台；要訂餐請改用一般會員帳號。", "Vendor accounts are for checking your listings and the vendor portal. Use a member account to order."),
  });
}

/**
 * Lock / order / resale actions require sign-in (anonymous identities are no longer used since 2026-09-24).
 * Call requireLogin() at the start of the action: if signed out it shows a prompt, redirects to the login page and returns false; vendor accounts also return false.
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

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { X } from "lucide-react";
import { useCart } from "@/hooks/useCart";
import { tr, loc } from "@/lib/i18n";
import { slotLabel } from "@/lib/pickupSlots";

// 加入購物車後在右下角浮出「已選品項」，讓使用者不用離開目前頁面就看到自己選了什麼。
// 由 MenuItemPage 的 confirmAdd() 發出 BB_CART_ADDED_EVENT 觸發；不自動收起，由使用者手動關閉。
export const BB_CART_ADDED_EVENT = "bb:cart-added";
export function notifyCartAdded() {
  globalThis.dispatchEvent(new Event(BB_CART_ADDED_EVENT));
}

export default function CartPreview() {
  const { lines, count } = useCart();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(BB_CART_ADDED_EVENT, show);
    return () => window.removeEventListener(BB_CART_ADDED_EVENT, show);
  }, []);

  if (!open || lines.length === 0) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      aria-label={tr("已選品項", "Selected items")}
      className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-sm bg-card border border-ink rounded-2xl shadow-lg p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-sm">{tr(`已選品項（共 ${count} 份）`, `Selected items (${count})`)}</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={tr("收起", "Dismiss")}
          className="h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <ul className="max-h-56 overflow-y-auto divide-y divide-border text-sm">
        {lines.map((line) => (
          <li key={line.key} className="py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium truncate">{loc(line.menuItem, "name")}</p>
              <p className="text-xs text-muted-foreground">{line.pickupDate}・{slotLabel(line.pickupWindow)}</p>
            </div>
            <span className="shrink-0 font-medium">×{line.quantity}</span>
          </li>
        ))}
      </ul>
      <Link
        href="/cart"
        onClick={() => setOpen(false)}
        className="block text-center h-10 leading-10 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary-hover"
      >
        {tr("前往購物車結帳", "Go to checkout")}
      </Link>
    </aside>
  );
}

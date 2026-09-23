import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { mockVendors } from "@/lib/mockData";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { auth, functions } from "@/lib/firebase";

// 購物車頁面。
// UIUX 檢視後新增:原本 MenuItemPage「加入購物車」只會彈 toast,useCart 把品項存進
// localStorage,但全站沒有任何頁面能查看/調整/送出購物車——是斷掉的核心動線。
// 這頁補上查看、調整數量、刪除、送出預購的畫面。
// 2026-09-23：「送出預購」改接真的 LINE Pay（createCartLinePayReservation，
// functions/src/index.js），付款確認後才建立真實 locks 文件。這條線用的
// mockVendors/MenuItemData 目錄跟真正在跑的 Vendor/Lock 模型是兩套平行資料
// （見 TODO.md「兩套平行資料模型」），這個試營運階段只有一個真實商家
// cafe-renheya-demo，所以不管購物車品項來自哪個 mock 商家，結帳出來的
// locks 一律掛在這個真實商家底下（品項名稱/價格仍是真的）。
export default function CartPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { items, vendorId, total, removeItem, updateQuantity, clearCart } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);

  const vendor = vendorId ? mockVendors.find(v => v.id === vendorId) : null;

  useEffect(() => {
    signInAnonymously(auth).catch(console.error);
  }, []);

  async function handleCheckout() {
    setCheckingOut(true);
    try {
      // Mount's signInAnonymously() call usually finishes well before the
      // buyer reviews the cart and clicks checkout, but wait for it here too
      // in case they landed straight on /cart before it resolved.
      if (!auth.currentUser) {
        await new Promise<void>((resolve, reject) => {
          const unsub = onAuthStateChanged(auth, (u) => {
            if (u) { unsub(); resolve(); }
          }, reject);
        });
      }

      const fn = httpsCallable(functions, "createCartLinePayReservation");
      const result = await fn({
        items: items.map(({ menuItem, quantity }) => ({
          item_name: menuItem.name,
          unit_price: menuItem.price,
          quantity,
        })),
      });
      const { payment_url: paymentUrl } = result.data as { order_id: string; payment_url: string };
      clearCart();
      window.location.href = paymentUrl;
    } catch (err) {
      toast({ title: "前往付款失敗", description: (err as Error).message, variant: "destructive" });
      setCheckingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader />

      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 space-y-4">
        <h1 className="text-2xl font-bold">購物車</h1>

        {items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-border py-16 px-6 text-center space-y-3">
            <ShoppingCart className="w-10 h-10 mx-auto text-gray-300" />
            <p className="text-muted-foreground">購物車是空的</p>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
              onClick={() => navigate("/vendors")}
            >
              去逛逛商家
            </Button>
          </div>
        ) : (
          <>
            {vendor && (
              <p className="text-sm text-muted-foreground">
                來自 <span className="font-semibold text-foreground">{vendor.name}</span>
                ・一次只能跟一家商家預購
              </p>
            )}

            <div className="bg-white rounded-2xl border border-border divide-y divide-border">
              {items.map(({ menuItem, quantity, note }) => (
                <div key={`${menuItem.id}-${note}`} className="p-4 flex items-start gap-3">
                  <div className="w-14 h-14 shrink-0 rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center text-2xl">
                    🍱
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{menuItem.name}</p>
                    {note && <p className="text-xs text-muted-foreground mt-0.5">備註：{note}</p>}
                    <p className="text-sm font-bold text-orange-600 mt-1">NT${menuItem.price}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <button
                      onClick={() => removeItem(menuItem.id, note)}
                      className="text-gray-400 hover:text-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 rounded"
                      aria-label={`移除 ${menuItem.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateQuantity(menuItem.id, note, quantity - 1)}
                        className="w-7 h-7 rounded-full border border-border flex items-center justify-center hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                        aria-label="減少數量"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="w-5 text-center text-sm font-medium">{quantity}</span>
                      <button
                        onClick={() => updateQuantity(menuItem.id, note, quantity + 1)}
                        className="w-7 h-7 rounded-full border border-border flex items-center justify-center hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
                        aria-label="增加數量"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={clearCart}
              className="text-xs text-muted-foreground hover:text-red-500 underline underline-offset-2"
            >
              清空購物車
            </button>

            <div className="bg-white rounded-2xl border border-border p-4 space-y-3 sticky bottom-4">
              <div className="flex items-center justify-between text-base font-bold">
                <span>總計</span>
                <span className="text-orange-600">NT${total}</span>
              </div>
              <Button
                className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                onClick={handleCheckout}
                disabled={checkingOut}
              >
                {checkingOut ? "前往付款中…" : "送出預購並付款"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

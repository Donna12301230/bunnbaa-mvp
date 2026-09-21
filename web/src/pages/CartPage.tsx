import { useLocation } from "wouter";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { mockVendors } from "@/lib/mockData";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import MarketplaceHeader from "@/components/MarketplaceHeader";

// 購物車頁面。
// UIUX 檢視後新增:原本 MenuItemPage「加入購物車」只會彈 toast,useCart 把品項存進
// localStorage,但全站沒有任何頁面能查看/調整/送出購物車——是斷掉的核心動線。
// 這頁補上查看、調整數量、刪除、送出預購的畫面。
// TODO(firebase): 「送出預購」目前只是示意畫面(清空購物車 + toast),之後要接建立
// PreOrder 的 Cloud Function(對應 mockData.ts 裡其他 mockCreate*/mockSave* 的接法)。
export default function CartPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { items, vendorId, total, removeItem, updateQuantity, clearCart } = useCart();

  const vendor = vendorId ? mockVendors.find(v => v.id === vendorId) : null;

  function handleCheckout() {
    toast({
      title: "已送出預購",
      description: "示意畫面：實際送出需串接建立 PreOrder 的 Cloud Function。",
    });
    clearCart();
    navigate("/my-bookings");
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
              >
                送出預購
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

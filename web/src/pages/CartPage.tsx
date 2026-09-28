import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { CalendarDays, MapPin, Minus, Plus, ShoppingCart, Trash2, UtensilsCrossed } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { db, functions } from "@/lib/firebase";
import type { Vendor } from "@/types";
import { EmptyState } from "@/components/ds";
import PickupPicker from "@/components/PickupPicker";
import { useAuth } from "@/hooks/useAuth";
import { applyEarlyBirdPrice } from "@/lib/pricing";
import { DEFAULT_PICKUP_WINDOWS, nextAvailablePickup, slotLabel as toSlotLabel, todayStr } from "@/lib/pickupSlots";
import { useSlotAvailability } from "@/hooks/useSlotAvailability";
import { tr } from "@/lib/i18n";

// 購物車頁面。
// UIUX 檢視後新增:原本 MenuItemPage「加入購物車」只會彈 toast,useCart 把品項存進
// localStorage,但全站沒有任何頁面能查看/調整/送出購物車——是斷掉的核心動線。
// 這頁補上查看、調整數量、刪除、送出預購的畫面。
// 「送出預購」接真的 LINE Pay（createCartLinePayReservation，
// functions/src/index.js），付款確認後才建立真實 locks 文件。每個 cart
// item 現在都帶著真實 vendor_id（來自真實 menu_items），Cloud Function
// 依此各自歸戶到正確的商家，不再全部掛在單一寫死的商家底下。
// 2026-09-25：結帳前要選取餐日期＋時段（原本伺服器寫死「今天 12:00-13:00」、
// 沒有早鳥價），並列出完整明細。價格由伺服器依 menu_items 重算，這裡的金額只是預覽。
export default function CartPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { items, vendorId, total, removeItem, updateQuantity, clearCart } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const requireLogin = useRequireLogin();
  const { user } = useAuth();
  const [pickup, setPickup] = useState(
    () => nextAvailablePickup() ?? { date: todayStr(), window: DEFAULT_PICKUP_WINDOWS[0] }
  );
  const { discountPercent, tierLabel } = applyEarlyBirdPrice(100, pickup.date);
  const lines = items.map((line) => ({
    ...line,
    unitPrice: applyEarlyBirdPrice(line.menuItem.price, pickup.date).lockedPrice,
  }));
  const discountedTotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const slotLabel = toSlotLabel(pickup.window);

  const { data: vendor } = useQuery({
    queryKey: ["vendor", vendorId],
    queryFn: async () => {
      if (!vendorId) return null;
      const snap = await getDoc(doc(db, "vendors", vendorId));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Vendor) : null;
    },
    enabled: !!vendorId,
  });

  // 商家資料載入後，如果目前選的日期這家店不營業，跳到這家店最近一個能訂的日期
  const [pickupSyncedFor, setPickupSyncedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!vendor || pickupSyncedFor === vendor.id) return;
    setPickupSyncedFor(vendor.id);
    const next = nextAvailablePickup(vendor);
    if (next && next.date > pickup.date) setPickup(next);
  }, [vendor, pickupSyncedFor, pickup.date]);
  const { closedReason, slots } = useSlotAvailability(vendor, pickup.date);
  const selectedSlot = slots.find((s) => s.window === pickup.window);
  const canCheckout = !closedReason && !!selectedSlot?.open
    && (selectedSlot.remaining === null || selectedSlot.remaining >= items.reduce((n, i) => n + i.quantity, 0));

  async function handleCheckout() {
    // 購物車可以先放著不登入，結帳才要求登入（購物車存在本機，登入回來還在）
    if (!requireLogin()) return;
    setCheckingOut(true);
    try {

      const fn = httpsCallable(functions, "createCartLinePayReservation");
      const result = await fn({
        pickup_date: pickup.date,
        pickup_window: pickup.window,
        items: items.map(({ menuItem, quantity, note }) => ({
          menu_item_id: menuItem.id,
          quantity,
          note: note.trim(),
        })),
      });
      const { payment_url: paymentUrl } = result.data as { order_id: string; payment_url: string };
      clearCart();
      window.location.href = paymentUrl;
    } catch (err) {
      toast({ title: tr("前往付款失敗", "Couldn't start payment"), description: (err as Error).message, variant: "destructive" });
      setCheckingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader />

      <div className="max-w-2xl mx-auto px-4 md:px-6 py-6 space-y-4">
        <h1 className="text-2xl font-bold">{tr("購物車", "Cart")}</h1>

        {items.length === 0 ? (
          <div className="bg-white rounded-xl border border-border shadow-sm">
            <EmptyState
              icon={<ShoppingCart size={32} />}
              title={tr("購物車還是空的", "Your cart is empty")}
              description={tr("逛逛附近的商家，提前預約享早鳥價。", "Browse nearby vendors and book early for early-bird prices.")}
              action={<Button onClick={() => navigate("/vendors")}>{tr("去逛逛商家", "Browse vendors")}</Button>}
            />
          </div>
        ) : (
          <>
            {vendor && (
              <p className="text-sm text-muted-foreground">
                {tr("來自 ", "From ")}<span className="font-semibold text-foreground">{vendor.name}</span>
                {tr("・一次只能跟一家商家預購", " · you can pre-order from one vendor at a time")}
              </p>
            )}

            <div className="bg-white rounded-xl border border-border p-4 space-y-3">
              <h2 className="text-sm font-semibold flex items-center gap-1.5">
                <CalendarDays className="w-4 h-4 text-orange-500" /> {tr("取餐日期與時段", "Pickup date & time")}
              </h2>
              <PickupPicker
                date={pickup.date}
                window={pickup.window}
                onDateChange={(date) => setPickup((p) => ({ ...p, date }))}
                onWindowChange={(window) => setPickup((p) => ({ ...p, window }))}
                uid={user?.id}
                vendor={vendor}
              />
              <p className="text-xs text-muted-foreground">{tr("早鳥優惠：", "Early bird: ")}{discountPercent > 0 ? tierLabel : tr("此日期沒有早鳥折扣", "no early-bird discount for this date")}</p>
            </div>

            <div className="bg-white rounded-xl border border-border divide-y divide-border">
              {lines.map(({ menuItem, quantity, note, unitPrice }) => (
                <div key={`${menuItem.id}-${note}`} className="p-4 flex items-start gap-3">
                  <div className="w-14 h-14 shrink-0 rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
                    <UtensilsCrossed className="h-6 w-6 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">{menuItem.name}</p>
                    {note && <p className="text-xs text-muted-foreground mt-0.5">{tr("備註：", "Note: ")}{note}</p>}
                    <p className="text-sm font-bold text-orange-600 mt-1">
                      NT${unitPrice}
                      {unitPrice < menuItem.price && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground line-through">NT${menuItem.price}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                      onClick={() => removeItem(menuItem.id, note)}
                      aria-label={tr(`移除 ${menuItem.name}`, `Remove ${menuItem.name}`)}
                    >
                      <Trash2 />
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-full"
                        onClick={() => updateQuantity(menuItem.id, note, quantity - 1)}
                        aria-label={tr("減少數量", "Decrease quantity")}
                      >
                        <Minus />
                      </Button>
                      <span className="w-5 text-center text-sm font-medium">{quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-full"
                        onClick={() => updateQuantity(menuItem.id, note, quantity + 1)}
                        aria-label={tr("增加數量", "Increase quantity")}
                      >
                        <Plus />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-muted-foreground hover:text-red-600"
              onClick={async () => {
                if (await confirm({ title: tr("要清空購物車嗎？", "Clear your cart?"), description: tr("購物車內的餐點都會被移除。", "All items will be removed."), confirmLabel: tr("清空購物車", "Clear cart"), destructive: true })) clearCart();
              }}
            >
              {tr("清空購物車", "Clear cart")}
            </Button>

            <div className="bg-white rounded-xl border border-border p-4 space-y-3">
              <h2 className="text-sm font-semibold">{tr("訂單明細", "Order summary")}</h2>
              <dl className="text-sm space-y-1.5">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{tr("商家", "Vendor")}</dt>
                  <dd className="text-right">{vendor?.name ?? "—"}</dd>
                </div>
                {vendor?.address && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {tr("取餐地點", "Pickup location")}</dt>
                    <dd className="text-right">{vendor.address}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{tr("取餐時間", "Pickup time")}</dt>
                  <dd className="text-right font-medium">{pickup.date}・{slotLabel}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{tr("原價小計", "Subtotal")}</dt>
                  <dd className="text-right">NT${total}</dd>
                </div>
                {total > discountedTotal && (
                  <div className="flex justify-between gap-3 text-green-700">
                    <dt>{tr("早鳥折扣", "Early-bird discount")}</dt>
                    <dd className="text-right">−NT${total - discountedTotal}</dd>
                  </div>
                )}
              </dl>
              <div className="flex items-center justify-between text-base font-bold pt-2 border-t border-border">
                <span>{tr("總計", "Total")}</span>
                <span className="text-orange-600">NT${discountedTotal}</span>
              </div>
              {!canCheckout && (
                <p className="text-xs text-red-600">
                  {selectedSlot?.remaining != null && selectedSlot.remaining > 0
                    ? tr(`這個時段只剩 ${selectedSlot.remaining} 份，請減少數量或改選其他時段。`, `Only ${selectedSlot.remaining} left in this slot. Reduce the quantity or pick another time.`)
                    : tr("請先選一個可以預約的取餐日期與時段。", "Please choose an available pickup date and time.")}
                </p>
              )}
              <Button
                className="w-full"
                onClick={handleCheckout}
                disabled={checkingOut || !canCheckout}
              >
                {checkingOut ? tr("前往付款中…", "Redirecting to payment…") : tr("送出預購並付款", "Place order & pay")}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

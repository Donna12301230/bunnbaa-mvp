import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { CalendarDays, MapPin, Minus, Plus, ShoppingCart, Ticket, Trash2, UtensilsCrossed } from "lucide-react";
import { httpsCallable } from "@/lib/callable";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useCart, type CartLine } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { db, functions } from "@/lib/firebase";
import type { Vendor } from "@/types";
import { EmptyState } from "@/components/ds";
import { useAuth } from "@/hooks/useAuth";
import { useMyCoupons, millis } from "@/hooks/useMyRewards";
import { bookingProblem, slotLabel, vendorCutoffTime } from "@/lib/pickupSlots";
import { discountText } from "@/lib/pricing";
import { itemMains, portionLabel, priceBreakdown, riceLabel, sideOptions } from "@/lib/bento";
import { couponTitle } from "@/lib/rewards";
import { tr, loc } from "@/lib/i18n";

// 購物車（規格 §4）：每一行是一份便當，各自有取餐日（到下週五）、時段、配菜與加減飯；
// 每筆（每一份）限用一張折價券，折抵 = min(券面, 加減後小計)。金額只是預覽，
// createCartLinePayReservation 會依 menu_items 重算；金額 0 元（折價券全額折抵）不經 LINE Pay。
export default function CartPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { lines, vendorId, update, remove, clearCart } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const [ack, setAck] = useState(false);
  const requireLogin = useRequireLogin();
  const { user } = useAuth();
  const { usable } = useMyCoupons(user?.id);

  const { data: vendor } = useQuery({
    queryKey: ["vendor", vendorId],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "vendors", vendorId!));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Vendor) : null;
    },
    enabled: !!vendorId,
  });

  const vendorCoupons = usable.filter((c) => c.vendor_id === vendorId);
  const usedCoupons = new Set(lines.map((l) => l.couponId).filter(Boolean));
  const couponOf = (l: CartLine) => vendorCoupons.find((c) => c.id === l.couponId);

  const priced = lines.map((l) => {
    const unit = priceBreakdown(l.menuItem, l.pickupDate, l.rice, l.choices, 0, { mainIndex: l.mainIndex, extra: l.extraSide });
    const coupon = couponOf(l);
    const couponDiscount = coupon ? Math.min(coupon.discount, unit.subtotal) : 0;
    return { line: l, unit, couponDiscount, total: unit.subtotal * l.quantity - couponDiscount, problem: vendor ? bookingProblem(vendor, l.pickupDate) : null };
  });
  const listTotal = priced.reduce((s, p) => s + p.unit.listPrice * p.line.quantity, 0);
  const earlyTotal = priced.reduce((s, p) => s + p.unit.earlyBird * p.line.quantity, 0);
  const adjustTotal = priced.reduce((s, p) => s + p.unit.adjust * p.line.quantity, 0);
  const couponTotal = priced.reduce((s, p) => s + p.couponDiscount, 0);
  const grandTotal = priced.reduce((s, p) => s + p.total, 0);
  const blocked = priced.find((p) => p.problem);

  async function handleCheckout() {
    if (!requireLogin()) return;
    setCheckingOut(true);
    try {
      const fn = httpsCallable(functions, "createCartLinePayReservation");
      const result = await fn({
        lines: lines.map((l) => ({
          menu_item_id: l.menuItem.id,
          pickup_date: l.pickupDate,
          pickup_window: l.pickupWindow,
          slots: l.choices.map((choice) => ({ choice })),
          rice: l.rice,
          main_index: l.mainIndex ?? null,
          extra_side: l.extraSide ?? null,
          quantity: l.quantity,
          note: l.note,
          coupon_id: l.couponId || null,
        })),
      });
      const { order_id: orderId, payment_url: paymentUrl, free } = result.data as { order_id: string; payment_url: string; free?: boolean };
      clearCart();
      if (free) navigate(`/payment/confirm/${orderId}`);
      else window.location.href = paymentUrl;
    } catch (err) {
      toast({ title: tr("前往付款失敗", "Couldn't start payment"), description: (err as Error).message, variant: "destructive" });
      setCheckingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader />
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 pt-10 md:pt-16 pb-16 space-y-8">
        <div>
          <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.14em] uppercase text-muted-foreground mb-4">
            <span className="w-8 h-px bg-current opacity-60" aria-hidden="true" />{tr("結帳", "Checkout")}
          </p>
          <h1 className="font-heading font-semibold text-[clamp(40px,6vw,84px)] leading-[1.04] tracking-[-0.025em]">
            {tr("購物車", "Cart")}{lines.length > 0 && <span className="ml-3 align-top text-[0.4em] text-muted-foreground font-normal">{lines.reduce((n, l) => n + l.quantity, 0)}</span>}
          </h1>
        </div>

        {lines.length === 0 ? (
          <div className="bg-card rounded-[2rem] border border-ink">
            <EmptyState
              icon={<ShoppingCart size={32} />}
              title={tr("購物車還是空的", "Your cart is empty")}
              description={tr("越早訂，越開心：提前預約享早鳥價。", "Book early, save more.")}
              action={<Button onClick={() => navigate("/home")}>{tr("去預購餐點", "Pre-order a meal")}</Button>}
            />
          </div>
        ) : (
          /* 桌機兩欄：左邊餐點，右邊訂單明細（sticky） */
          <div className="grid gap-8 lg:grid-cols-[1fr_420px] items-start">
          <div className="space-y-4">
            {vendor && (
              <p className="text-sm text-muted-foreground">
                {tr("來自 ", "From ")}<span className="font-semibold text-foreground">{loc(vendor, "name")}</span>
                {tr("・一次只能跟一家商家預購", " · one vendor per checkout")}
              </p>
            )}

            <div className="bg-card rounded-[2rem] border border-ink divide-y divide-border overflow-hidden">
              {priced.map(({ line, unit, couponDiscount, problem }) => (
                <div key={line.key} className="p-5 md:p-6 flex items-start gap-4">
                  {line.menuItem.image ? (
                    <img src={line.menuItem.image} alt="" className="w-20 h-20 md:w-24 md:h-24 shrink-0 rounded-2xl border border-ink object-cover" />
                  ) : (
                    <div className="w-20 h-20 md:w-24 md:h-24 shrink-0 rounded-2xl border border-ink bg-secondary flex items-center justify-center">
                      <UtensilsCrossed className="h-6 w-6 text-secondary-foreground/50" strokeWidth={1.5} aria-hidden="true" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="font-heading text-lg font-semibold">{loc(line.menuItem, "name")}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <CalendarDays className="w-3.5 h-3.5" /> {line.pickupDate}・{slotLabel(line.pickupWindow)}
                      {unit.discountPercent > 0 && <span className="text-green-700">・{tr("早鳥", "Early bird")} {discountText(unit.discountPercent)}</span>}
                    </p>
                    {line.mainIndex != null && itemMains(line.menuItem)[line.mainIndex] && (
                      <p className="text-xs text-muted-foreground">{tr("主菜：", "Main: ")}{itemMains(line.menuItem)[line.mainIndex].name}</p>
                    )}
                    {line.menuItem.slots && line.choices.length > 0 && (
                      <ul className="text-xs text-muted-foreground">
                        {line.menuItem.slots.map((slot, i) => {
                          const c = line.choices[i];
                          const text = c === "none" ? tr("少一道", "none") : c === "default" || c === undefined ? slot.default.name
                            : tr(`許願 ${slot.candidates[c].name}（${portionLabel(slot.candidates[c].portion_level)}）`, `Wish: ${slot.candidates[c].name}`);
                          return <li key={i}>{slot.category}：{text}</li>;
                        })}
                      </ul>
                    )}
                    {line.extraSide && (() => {
                      const o = sideOptions(line.menuItem).find((x) => x.slot === line.extraSide!.slot && x.candidate === line.extraSide!.candidate);
                      return o ? <p className="text-xs text-muted-foreground">{line.extraSide.mode === "addon" ? tr(`第四道加菜：${o.name}（+10）`, `Add-on: ${o.name} (+10)`) : tr(`第四道備案：${o.name}`, `Backup: ${o.name}`)}</p> : null;
                    })()}
                    {riceLabel(line.rice) && <p className="text-xs text-muted-foreground">{riceLabel(line.rice)}</p>}
                    {line.note && <p className="text-xs text-muted-foreground">{tr("備註：", "Note: ")}{line.note}</p>}
                    <p className="font-heading text-lg font-semibold">
                      NT${unit.subtotal}{line.quantity > 1 && ` × ${line.quantity}`}
                      {couponDiscount > 0 && <span className="ml-1.5 text-xs text-green-700">{tr(`折價券 −${couponDiscount}`, `coupon −${couponDiscount}`)}</span>}
                    </p>
                    {vendorCoupons.length > 0 && (
                      <label className="flex items-center gap-1.5 text-xs">
                        <Ticket className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                        <select
                          className="h-8 rounded-md border border-input bg-background px-1.5 text-xs"
                          value={line.couponId ?? ""}
                          onChange={(e) => update(line.key, { couponId: e.target.value || null })}
                          aria-label={tr("使用折價券", "Use a coupon")}
                        >
                          <option value="">{tr("不使用折價券", "No coupon")}</option>
                          {vendorCoupons.map((c) => (
                            <option key={c.id} value={c.id} disabled={usedCoupons.has(c.id) && line.couponId !== c.id}>
                              {couponTitle(c.discount)}（{tr("到期", "exp.")} {new Date(millis(c.expires_at)).toLocaleDateString()}）
                            </option>
                          ))}
                        </select>
                        {line.quantity > 1 && line.couponId && <span className="text-muted-foreground">{tr("只折其中一份", "applies to one")}</span>}
                      </label>
                    )}
                    {problem && <p className="text-xs text-red-600">{problem}{tr("，請移除後重新選擇日期。", " — remove it and pick another date.")}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:bg-red-50 hover:text-red-700" onClick={() => remove(line.key)} aria-label={tr(`移除 ${loc(line.menuItem, "name")}`, `Remove ${loc(line.menuItem, "name")}`)}>
                      <Trash2 />
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={() => update(line.key, { quantity: line.quantity - 1 })} aria-label={tr("減少數量", "Decrease quantity")}><Minus /></Button>
                      <span className="w-5 text-center text-sm font-medium">{line.quantity}</span>
                      <Button variant="outline" size="icon" className="h-10 w-10 rounded-full" onClick={() => update(line.key, { quantity: line.quantity + 1 })} aria-label={tr("增加數量", "Increase quantity")}><Plus /></Button>
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

          </div>

            <div className="lg:sticky lg:top-24 bg-accent rounded-[2rem] border border-ink p-6 md:p-7 space-y-4">
              <h2 className="font-heading text-2xl font-semibold">{tr("訂單明細", "Order summary")}</h2>
              <dl className="text-sm space-y-1.5">
                {vendor?.address && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {tr("取餐地點（自取）", "Pickup (self)")}</dt>
                    <dd className="text-right">{vendor.address}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{tr("原價小計", "Subtotal")}</dt><dd>NT${listTotal}</dd></div>
                {earlyTotal > 0 && <div className="flex justify-between gap-3 text-green-700"><dt>{tr("早鳥折扣", "Early-bird discount")}</dt><dd>−NT${earlyTotal}</dd></div>}
                {adjustTotal !== 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{tr("加減選項", "Adjustments")}</dt><dd>{adjustTotal > 0 ? "+" : "−"}NT${Math.abs(adjustTotal)}</dd></div>}
                {couponTotal > 0 && <div className="flex justify-between gap-3 text-green-700"><dt>{tr("折價券", "Coupons")}</dt><dd>−NT${couponTotal}</dd></div>}
              </dl>
              <div className="flex items-baseline justify-between font-bold pt-3 border-t border-ink/30">
                <span>{tr("實付", "Total")}</span>
                <span className="font-heading text-4xl">NT${grandTotal}</span>
              </div>
              <label className="flex items-start gap-2 p-3 rounded-2xl bg-card border border-border cursor-pointer">
                <Checkbox checked={ack} onCheckedChange={() => setAck((v) => !v)} className="mt-0.5 shrink-0" />
                <span className="text-caption leading-relaxed text-muted-foreground">
                  {tr(
                    `我了解：取餐前一天 ${vendorCutoffTime(vendor)} 截單，截單前可免費取消全額退款；截單後店家已依訂單備料，不可退款，但可以轉讓、贈送或捐為愛心餐。取餐時段結束 30 分鐘仍未取餐，將轉為愛心餐、不退款（照常發抽獎券）。停班停課當日訂單自動全額退款；天災期間店家可等值替換配菜。`,
                    `I understand: orders close at ${vendorCutoffTime(vendor)} the day before pickup and can be cancelled for a full refund until then. After cutoff there are no refunds, but you can transfer, gift or donate the meal. Meals not picked up 30 min after the window become charity meals (no refund; reward tickets still issued). Orders are refunded automatically on work-suspension days; during disasters the vendor may substitute an equivalent side.`
                  )}
                </span>
              </label>
              {blocked && <p className="text-xs text-red-600">{tr("有餐點已過截單或不能預訂，請先移除。", "Some meals are past cutoff — please remove them first.")}</p>}
              <Button className="w-full h-13 min-h-[52px] rounded-full text-base" onClick={handleCheckout} disabled={checkingOut || !ack || !!blocked}>
                {checkingOut ? tr("處理中…", "Working…") : grandTotal === 0 ? tr("折價券全額折抵，送出預購", "Covered by coupons — place order") : tr("送出預購並以 LINE Pay 付款", "Place order & pay with LINE Pay")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

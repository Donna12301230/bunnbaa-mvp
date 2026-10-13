import { useState } from "react";
import PageHero from "@/components/PageHero";
import { selectClass } from "@/lib/fieldStyles";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { CalendarDays, MapPin, Minus, Plus, ShoppingCart, Ticket, Trash2, UtensilsCrossed } from "lucide-react";
import { httpsCallable } from "@/lib/callable";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { cartStore, useCart, type CartLine } from "@/hooks/useCart";
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
import { customFields, itemMains, portionLabel, priceBreakdown, priceDeltaText, riceLabel, sideOptions } from "@/lib/bento";
import { couponTitle } from "@/lib/rewards";
import { tr, loc, dishName } from "@/lib/i18n";
import UsePointsToggle, { usePointsPreview } from "@/components/UsePointsToggle";
import WaiverText from "@/components/WaiverText";
import { formatNT } from "@/lib/format";

// Cart (spec §4): each line is one bento with its own pickup date (up to bookingRangeDays, 30 days, ahead), pickup slot, sides and rice adjustment;
// each line (each meal) can use one coupon, discount = min(coupon value, subtotal after adjustments). Amounts are only a preview;
// createCartLinePayReservation recalculates from menu_items; a 0 total (coupon covers everything) skips LINE Pay.
export default function CartPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { lines, vendorId, update, remove, clearCart } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const [ack, setAck] = useState(false);
  const [usePoints, setUsePoints] = useState(true);
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
    const unit = priceBreakdown(l.menuItem, l.pickupDate, l.rice, l.choices, 0, { mainIndex: l.mainIndex, extra: l.extraSide, customPicks: l.customPicks });
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
  const points = usePointsPreview(grandTotal, usePoints);

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
          custom_picks: l.customPicks ?? [],
          quantity: l.quantity,
          note: l.note,
          coupon_id: l.couponId || null,
        })),
        use_points: usePoints && points.balance > 0,
      });
      const { order_id: orderId, payment_url: paymentUrl, free } = result.data as { order_id: string; payment_url: string; free?: boolean };
      cartStore.stashForPayment(orderId);
      if (free) navigate(`/payment/confirm/${orderId}`);
      else window.location.href = paymentUrl;
    } catch (err) {
      toast({ title: tr("前往付款失敗", "Couldn't start payment"), description: (err as Error).message, variant: "destructive" });
      setCheckingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader />
      <PageHero
        eyebrow={tr("結帳", "Checkout")}
        title={tr("購物車", "Cart")}
        description={lines.length > 0 ? tr(`共 ${lines.reduce((n, l) => n + l.quantity, 0)} 份餐點`, `${lines.reduce((n, l) => n + l.quantity, 0)} meal(s)`) : undefined}
      />
      <div className={`max-w-[1400px] mx-auto px-4 md:px-6 pt-8 md:pt-10 space-y-8 ${lines.length > 0 ? "pb-28 lg:pb-16" : "pb-16"}`}>
        {lines.length === 0 ? (
          <div className="bg-card rounded-card border border-ink">
            <EmptyState
              icon={<ShoppingCart size={32} />}
              title={tr("購物車還是空的", "Your cart is empty")}
              description={tr("越早訂，越開心：提前預約享早鳥價。", "Book early, save more.")}
              action={
                <div className="flex flex-wrap justify-center gap-3">
                  {cartStore.hasPending && (
                    <Button variant="outline" onClick={() => cartStore.restoreAfterCancel()}>{tr("放回上次沒付完的餐點", "Restore your unpaid items")}</Button>
                  )}
                  <Button onClick={() => navigate("/home")}>{tr("去預購餐點", "Pre-order a meal")}</Button>
                </div>
              }
            />
          </div>
        ) : (
          /* Desktop two columns: meals on the left, order summary on the right (sticky) */
          <div className="grid gap-8 lg:grid-cols-[1fr_420px] items-start">
          <div className="space-y-4">
            {vendor && (
              <p className="text-sm text-muted-foreground">
                {tr("來自 ", "From ")}<span className="font-semibold text-foreground">{loc(vendor, "name")}</span>
                {tr("・一次只能跟一家店家預購", " · one vendor per checkout")}
              </p>
            )}

            <div className="bg-card rounded-card border border-ink divide-y divide-border overflow-hidden">
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
                      {unit.discountPercent > 0 && <span className="text-success-text">・{tr("早鳥", "Early bird")} {discountText(unit.discountPercent)}</span>}
                    </p>
                    {line.mainIndex != null && itemMains(line.menuItem)[line.mainIndex] && (
                      <p className="text-xs text-muted-foreground">{tr("主菜：", "Main: ")}{dishName(line.menuItem, itemMains(line.menuItem)[line.mainIndex].name)}</p>
                    )}
                    {line.menuItem.slots && line.choices.length > 0 && (
                      <ul className="text-xs text-muted-foreground">
                        {line.menuItem.slots.map((slot, i) => {
                          const c = line.choices[i];
                          const text = c === "none" ? tr("少一道", "none") : c === "default" || c === undefined ? dishName(line.menuItem, slot.default.name)
                            : tr(`許願 ${slot.candidates[c].name}（${portionLabel(slot.candidates[c].portion_level)}）`, `Wish: ${dishName(line.menuItem, slot.candidates[c].name)}`);
                          return <li key={i}>{dishName(line.menuItem, slot.category)}{tr("：", ": ")}{text}</li>;
                        })}
                      </ul>
                    )}
                    {line.extraSide && (() => {
                      const o = sideOptions(line.menuItem).find((x) => x.slot === line.extraSide!.slot && x.candidate === line.extraSide!.candidate);
                      return o ? <p className="text-xs text-muted-foreground">{line.extraSide.mode === "addon" ? tr(`第四道加菜：${o.name}（+10）`, `Add-on: ${dishName(line.menuItem, o.name)} (+10)`) : tr(`第四道備案：${o.name}`, `Backup: ${dishName(line.menuItem, o.name)}`)}</p> : null;
                    })()}
                    {customFields(line.menuItem).map((f, i) => {
                      const o = f.options[line.customPicks?.[i] ?? 0];
                      return o ? <p key={i} className="text-xs text-muted-foreground">{dishName(line.menuItem, f.label)}{tr("：", ": ")}{dishName(line.menuItem, o.name)}{o.price ? `（${priceDeltaText(o.price)}）` : ""}</p> : null;
                    })}
                    {riceLabel(line.rice) && <p className="text-xs text-muted-foreground">{riceLabel(line.rice)}</p>}
                    {line.note && <p className="text-xs text-muted-foreground">{tr("備註：", "Note: ")}{line.note}</p>}
                    <p className="font-heading text-lg font-semibold">
                      NT${unit.subtotal}{line.quantity > 1 && ` × ${line.quantity}`}
                      {couponDiscount > 0 && <span className="ml-1.5 text-xs text-success-text">{tr(`折價券 −${couponDiscount}`, `coupon −${couponDiscount}`)}</span>}
                    </p>
                    {vendorCoupons.length > 0 && (
                      <label className="flex items-center gap-1.5 text-xs">
                        <Ticket className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                        <select
                          className={selectClass("sm")}
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
                    {problem && <p className="text-xs text-danger-text">{problem}{tr("，請移除後重新選擇日期。", " — remove it and pick another date.")}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Button variant="ghost" size="icon" className="h-10 w-10 text-muted-foreground hover:bg-danger-soft hover:text-danger-text" onClick={() => remove(line.key)} aria-label={tr(`移除 ${loc(line.menuItem, "name")}`, `Remove ${loc(line.menuItem, "name")}`)}>
                      <Trash2 />
                    </Button>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => update(line.key, { quantity: line.quantity - 1 })} aria-label={tr("減少數量", "Decrease quantity")}><Minus /></Button>
                      <span className="w-5 text-center text-sm font-medium">{line.quantity}</span>
                      <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => update(line.key, { quantity: line.quantity + 1 })} aria-label={tr("增加數量", "Increase quantity")}><Plus /></Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="link"
              size="sm"
              className="h-auto px-0 text-muted-foreground hover:text-danger-text"
              onClick={async () => {
                if (await confirm({ title: tr("要清空購物車嗎？", "Clear your cart?"), description: tr("購物車內的餐點都會被移除。", "All items will be removed."), confirmLabel: tr("清空購物車", "Clear cart"), destructive: true })) clearCart();
              }}
            >
              {tr("清空購物車", "Clear cart")}
            </Button>

          </div>

            <div className="lg:sticky lg:top-24 bg-accent rounded-card border border-ink p-6 md:p-7 space-y-4">
              <h2 className="font-heading text-2xl font-semibold">{tr("訂單明細", "Order summary")}</h2>
              <dl className="text-sm space-y-1.5">
                {vendor?.address && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> {tr("取餐地點（自取）", "Pickup (self)")}</dt>
                    <dd className="text-right">{loc(vendor, "address")}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{tr("原價小計", "Subtotal")}</dt><dd>NT${listTotal}</dd></div>
                {earlyTotal > 0 && <div className="flex justify-between gap-3 text-success-text"><dt>{tr("早鳥折扣", "Early-bird discount")}</dt><dd>−NT${earlyTotal}</dd></div>}
                {adjustTotal !== 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{tr("加減選項", "Adjustments")}</dt><dd>{adjustTotal > 0 ? "+" : "−"}NT${Math.abs(adjustTotal)}</dd></div>}
                {couponTotal > 0 && <div className="flex justify-between gap-3 text-success-text"><dt>{tr("折價券", "Coupons")}</dt><dd>−NT${couponTotal}</dd></div>}
              </dl>
              <UsePointsToggle total={grandTotal} checked={usePoints} onChange={setUsePoints} />
              <div className="flex items-baseline justify-between font-bold pt-3 border-t border-ink/30">
                <span>{tr("實付", "Total")}</span>
                <span className="font-heading text-4xl">{formatNT(points.pay)}</span>
              </div>
              <label className="flex items-start gap-2 p-3 rounded-2xl bg-card border border-border cursor-pointer">
                <Checkbox checked={ack} onCheckedChange={() => setAck((v) => !v)} className="mt-0.5 shrink-0" />
                <span className="text-caption leading-relaxed text-muted-foreground"><WaiverText vendor={vendor} /></span>
              </label>
              {blocked && <p className="text-xs text-danger-text">{tr("有餐點已過截單或不能預訂，請先移除。", "Some meals are past cutoff — please remove them first.")}</p>}
              <Button className="w-full h-13 min-h-[52px] text-base" onClick={handleCheckout} disabled={checkingOut || !ack || !!blocked}>
                {checkingOut ? tr("處理中…", "Working…") : points.pay === 0 ? tr("已全額折抵，送出預購", "Fully covered — place order") : tr("送出預購並以 LINE Pay 付款", "Place order & pay with LINE Pay")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* On mobile the checkout button is pinned to the bottom of the screen, matching the sticky "Add to cart" bar on the item page,
          so users don't have to scroll past every item and the disclaimer checkbox to find it (on desktop the right-hand summary is already sticky) */}
      {lines.length > 0 && (
        <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-card border-t border-ink p-3 flex items-center gap-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{tr("實付", "Total")}</p>
            <p className="font-heading text-xl font-semibold truncate">{formatNT(points.pay)}</p>
          </div>
          <Button className="flex-1 h-12 text-sm" onClick={handleCheckout} disabled={checkingOut || !ack || !!blocked}>
            {checkingOut ? tr("處理中…", "Working…") : points.pay === 0 ? tr("已全額折抵，送出預購", "Fully covered") : tr("送出預購並付款", "Place order & pay")}
          </Button>
        </div>
      )}
    </div>
  );
}

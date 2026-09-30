import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { AlertTriangle, ArrowLeft, CalendarDays, Info, Minus, Plus, ShoppingCart, Sparkles, UtensilsCrossed } from "lucide-react";
import { auth, db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import type { MenuItem, RiceOption, SlotChoice, Vendor } from "@/types";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { tr, loc } from "@/lib/i18n";
import { tagEn } from "@/types";
import { cn } from "@/lib/utils";
import { discountText } from "@/lib/pricing";
import { isBento, portionLabel, priceBreakdown } from "@/lib/bento";
import { usePlatformConfig } from "@/lib/platformConfig";
import { useSideWishes } from "@/hooks/useSideWishes";
import { useSlotAvailability } from "@/hooks/useSlotAvailability";
import {
  bookableDateRange, bookingProblem, getPreferredPickup, slotLabel, vendorCutoffTime, weekdayOf,
} from "@/lib/pickupSlots";
import { applyEarlyBirdPrice } from "@/lib/pricing";

const WEEKDAY_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// 品項頁＝組便當（規格 §4）：選取餐日（到下週五）、時段、每格配菜（預設／候選菜許願／不要）、
// 加減飯，金額即時預覽（早鳥折扣＋加減）；結帳時伺服器會重算。
export default function MenuItemPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { add, vendorId: cartVendorId } = useCart();
  const { data: config } = usePlatformConfig();
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [rice, setRice] = useState<RiceOption>("normal");
  const [choices, setChoices] = useState<SlotChoice[]>([]);
  const [date, setDate] = useState<string>("");
  const [window, setWindow] = useState<string>("");

  const { data: item, isLoading } = useQuery({
    queryKey: ["menuItem", id],
    queryFn: async () => {
      if (!id) return null;
      const snap = await getDoc(doc(db, "menu_items", id));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as MenuItem) : null;
    },
    enabled: !!id,
  });

  const { data: vendor } = useQuery({
    queryKey: ["vendor", item?.vendor_id],
    queryFn: async () => {
      const snap = await getDoc(doc(db, "vendors", item!.vendor_id));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Vendor) : null;
    },
    enabled: !!item,
  });

  const dates = useMemo(() => bookableDateRange(), []);
  const servedOn = (d: string) => !item?.weekdays?.length || item.weekdays.includes(weekdayOf(d));
  const dateProblem = (d: string) => (vendor ? bookingProblem(vendor, d) : null) ?? (servedOn(d) ? null : tr("這天沒有供應", "Not served this day"));

  // 預設日期：首頁帶過來的，否則最近一個能訂的
  useEffect(() => {
    if (!vendor || date) return;
    const pref = getPreferredPickup();
    const first = pref && !dateProblem(pref.date) ? pref.date : dates.find((d) => !dateProblem(d));
    if (first) setDate(first);
    if (pref?.window) setWindow(pref.window);
  }, [vendor]);

  useEffect(() => {
    if (item?.slots) setChoices(item.slots.map(() => "default"));
  }, [item?.id]);

  // 瀏覽訊號（§10.1）：登入者看品項頁記一次，伺服器端同一天同品項只算一次
  useEffect(() => {
    if (!item?.id || !auth.currentUser) return;
    httpsCallable(functions, "recordItemView")({ menu_item_id: item.id }).catch(() => {});
  }, [item?.id]);

  const { slots: windowSlots } = useSlotAvailability(vendor, date);
  useEffect(() => {
    const open = windowSlots.filter((s) => s.open);
    if (open.length > 0 && !open.some((s) => s.window === window)) setWindow(open[0].window);
  }, [windowSlots, window]);

  const { dayCount, weekCount } = useSideWishes(vendor?.id, date);

  if (isLoading) return <SkeletonBlocks height={256} />;
  if (!item) {
    return (
      <EmptyState
        icon={<UtensilsCrossed size={32} />}
        title={tr("找不到這個品項", "Item not found")}
        description={tr("可能已下架，或連結有誤。", "It may have been removed, or the link is wrong.")}
        action={<Button variant="outline" asChild><Link href="/vendors">{tr("回商家清單", "Back to vendors")}</Link></Button>}
      />
    );
  }

  const bento = isBento(item);
  const breakdown = date ? priceBreakdown(item, date, rice, choices) : null;
  const minQtyDefault = vendor?.candidate_min_qty || config?.candidateMinQty || 10;
  const problem = date ? dateProblem(date) : tr("請選擇取餐日", "Choose a pickup date");
  const canAdd = !problem && !!window && windowSlots.some((s) => s.window === window && s.open);
  const typhoon = date && vendor?.typhoon_notice?.dates?.includes(date);

  function candidateState(slotIdx: number, candIdx: number) {
    const cand = item!.slots![slotIdx].candidates[candIdx];
    const count = dayCount(item!.id, slotIdx, candIdx);
    const min = cand.min_qty || minQtyDefault;
    const full = !!cand.weekly_cap && weekCount(item!.id, slotIdx, candIdx) >= cand.weekly_cap;
    return { cand, count, min, full };
  }

  function handleAdd() {
    if (!canAdd || !vendor) return;
    if (cartVendorId && cartVendorId !== item!.vendor_id) {
      toast({
        title: tr("購物車裡有別家商家的品項", "Your cart has items from another vendor"),
        description: tr("加入這項會清空目前的購物車（一次只能跟一家商家預購）。", "Adding this will clear your cart (one vendor at a time)."),
      });
    }
    add({
      menuItem: item!, vendorId: item!.vendor_id, pickupDate: date, pickupWindow: window,
      choices: bento ? choices : [], rice: bento && item!.rice_component_id ? rice : "normal", quantity: qty, note: note.trim(), couponId: null,
    });
    toast({ title: tr("已加入購物車", "Added to cart"), description: `${loc(item, "name")} ${date} x${qty}` });
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Link href={`/vendor/${item.vendor_id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> {loc(vendor, "name") || tr("回商家頁", "Back to vendor")}
      </Link>

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        {item.image ? (
          <img src={item.image} alt={loc(item, "name")} className="w-full h-48 sm:h-64 object-cover" />
        ) : (
          <div className="w-full h-48 bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
            <UtensilsCrossed className="h-14 w-14 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
          </div>
        )}
        <div className="p-5 space-y-5">
          <div>
            <h1 className="text-xl font-bold mb-1">{loc(item, "name")}</h1>
            <p className="text-sm text-muted-foreground">{loc(item, "description")}</p>
            {item.main?.name && <p className="text-sm mt-1">{tr("主菜：", "Main: ")}<strong>{item.main.name}</strong></p>}
            {(item.fixed?.length ?? 0) > 0 && <p className="text-sm">{tr("附：", "Comes with: ")}{item.fixed!.map((f) => f.name).join("、")}</p>}
            {(item.dietary_tags?.length > 0 || item.allergens?.length > 0) && (
              <div className="space-y-1.5 mt-2">
                {item.dietary_tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.dietary_tags.map((tag) => (
                      <span key={tag} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">{tr(tag, tagEn(tag))}</span>
                    ))}
                  </div>
                )}
                {item.allergens?.length > 0 && (
                  <p className="text-xs text-red-500">{tr("含過敏原：", "Contains: ")}{item.allergens.map((a) => tr(a, tagEn(a))).join(tr("、", ", "))}</p>
                )}
              </div>
            )}
          </div>

          {/* 取餐日（到下週五）＋早鳥折扣 */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold flex items-center gap-1.5"><CalendarDays className="w-4 h-4 text-orange-500" /> {tr("取餐日", "Pickup day")}</h2>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {dates.map((d) => {
                const p = dateProblem(d);
                const { discountPercent } = applyEarlyBirdPrice(item.price, d);
                const wd = weekdayOf(d);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={!!p}
                    title={p ?? undefined}
                    onClick={() => setDate(d)}
                    className={cn(
                      "shrink-0 w-16 rounded-xl border px-1 py-2 text-center transition-colors",
                      p ? "opacity-40 cursor-not-allowed bg-gray-50" : date === d ? "border-orange-500 bg-orange-50" : "border-border bg-white hover:bg-gray-50"
                    )}
                  >
                    <div className="text-xs text-muted-foreground">{tr(`週${WEEKDAY_ZH[wd]}`, WEEKDAY_EN[wd])}</div>
                    <div className="text-sm font-semibold">{d.slice(5).replace("-", "/")}</div>
                    <div className="text-micro text-orange-600">{p ? tr("截單", "Closed") : discountPercent > 0 ? discountText(discountPercent) : ""}</div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {tr(`越早訂，越開心：預訂到下週五；取餐前一天 ${vendorCutoffTime(vendor)} 截單，截單前可免費取消。`, `Book early, save more: up to next Friday; orders close at ${vendorCutoffTime(vendor)} the day before, and you can cancel for free until then.`)}
            </p>
            {date && (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tr("取餐時段", "Pickup time")}>
                {windowSlots.map((s) => (
                  <button
                    key={s.window}
                    type="button"
                    disabled={!s.open}
                    onClick={() => setWindow(s.window)}
                    className={cn(
                      "px-3 py-1.5 rounded-full border text-sm",
                      !s.open ? "opacity-40 cursor-not-allowed" : window === s.window ? "border-orange-500 bg-orange-50 text-orange-700" : "border-border"
                    )}
                  >
                    {slotLabel(s.window)}{s.remaining !== null && s.open ? tr(`（剩 ${s.remaining}）`, ` (${s.remaining} left)`) : ""}
                  </button>
                ))}
              </div>
            )}
            {typhoon && (
              <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {tr("颱風警報期間：這天可能因停班停課取消，取消時會自動全額退款。", "Typhoon warning: this day may be cancelled for a work suspension — you'd get a full automatic refund.")}
              </div>
            )}
          </section>

          {/* 配菜格：預設菜、候選菜許願、不要 */}
          {bento && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-orange-500" /> {tr("配菜（可許願）", "Sides (make a wish)")}</h2>
              {item.slots!.map((slot, i) => (
                <div key={i} className="rounded-lg border border-border p-3 space-y-1.5">
                  <label className="text-xs text-muted-foreground" htmlFor={`slot-${i}`}>{slot.category || tr(`配菜 ${i + 1}`, `Side ${i + 1}`)}</label>
                  <select
                    id={`slot-${i}`}
                    className="w-full h-10 rounded-md border border-input bg-background px-2 text-sm"
                    value={String(choices[i] ?? "default")}
                    onChange={(e) => {
                      const v = e.target.value;
                      setChoices((prev) => prev.map((c, j) => (j === i ? (v === "default" || v === "none" ? v : Number(v)) : c)));
                    }}
                  >
                    <option value="default">{slot.default.name}{tr("（預設）", " (default)")}</option>
                    {slot.candidates.map((_, ci) => {
                      const s = candidateState(i, ci);
                      if (s.cand.disabled) return null;
                      return (
                        <option key={ci} value={ci} disabled={s.full}>
                          {s.cand.name}（{portionLabel(s.cand.portion_level)}）{s.full ? tr(" 已滿", " full") : ` ${s.count}/${s.min}`}
                        </option>
                      );
                    })}
                    <option value="none">{tr(`不要（−${Math.abs(config?.slotRemovePrice ?? 5)} 元）`, `None (−NT$${Math.abs(config?.slotRemovePrice ?? 5)})`)}</option>
                  </select>
                  {typeof choices[i] === "number" && (() => {
                    const s = candidateState(i, choices[i] as number);
                    return (
                      <p className="text-xs text-orange-700">
                        {tr(`許願進度 ${s.count}/${s.min} 份：截單時達到 ${s.min} 份才成立，未成立自動改為「${slot.default.name}」，訂單照常成立。`,
                          `${s.count}/${s.min} wishes: it happens only if ${s.min} people wish by cutoff; otherwise you get ${slot.default.name}.`)}
                      </p>
                    );
                  })()}
                </div>
              ))}
              <p className="text-xs text-muted-foreground flex gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{tr("候選菜不加價，改以份量平衡成本；選「不要」的格子不能許願。", "Candidates cost the same — the portion is balanced instead. Sides you remove can't be wished for.")}</p>
            </section>
          )}

          {bento && item.rice_component_id && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">{tr("飯量", "Rice")}</h2>
              <div className="flex gap-2">
                {([
                  ["normal", tr("一般", "Regular"), 0],
                  ["add", tr("加飯", "Extra"), config?.riceAddPrice ?? 10],
                  ["less", tr("減飯（半碗）", "Less (half)"), config?.riceLessPrice ?? -5],
                ] as [RiceOption, string, number][]).map(([value, label, price]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRice(value)}
                    className={cn("flex-1 rounded-lg border py-2 text-sm", rice === value ? "border-orange-500 bg-orange-50" : "border-border")}
                  >
                    {label}{price !== 0 && <span className="text-xs text-muted-foreground"> {price > 0 ? `+${price}` : price}</span>}
                  </button>
                ))}
              </div>
            </section>
          )}

          <div>
            <label htmlFor="item-note" className="text-sm font-medium block mb-1">{tr("備註（選填）", "Note (optional)")}</label>
            <Input id="item-note" type="text" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder={tr("例如：不要香菜", "e.g. no coriander")} />
          </div>

          {breakdown && (
            <dl className="text-sm space-y-1 rounded-lg bg-gray-50 p-3">
              <div className="flex justify-between"><dt className="text-muted-foreground">{tr("原價", "Price")}</dt><dd>NT${breakdown.listPrice}</dd></div>
              {breakdown.earlyBird > 0 && (
                <div className="flex justify-between text-green-700"><dt>{tr(`早鳥 ${discountText(breakdown.discountPercent)}`, `Early bird ${discountText(breakdown.discountPercent)}`)}</dt><dd>−NT${breakdown.earlyBird}</dd></div>
              )}
              {breakdown.adjust !== 0 && (
                <div className="flex justify-between"><dt className="text-muted-foreground">{tr("加減飯菜", "Adjustments")}</dt><dd>{breakdown.adjust > 0 ? "+" : "−"}NT${Math.abs(breakdown.adjust)}</dd></div>
              )}
              <div className="flex justify-between font-bold pt-1 border-t border-border"><dt>{tr("每份", "Each")}</dt><dd className="text-orange-600">NT${breakdown.total}</dd></div>
              <p className="text-xs text-muted-foreground">{tr("有折價券可在購物車套用（每筆限一張）。", "Apply a coupon in your cart (one per meal).")}</p>
            </dl>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" aria-label={tr("減少數量", "Decrease quantity")} onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus /></Button>
              <span className="w-6 text-center font-medium bb-num" aria-live="polite">{qty}</span>
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" aria-label={tr("增加數量", "Increase quantity")} onClick={() => setQty((q) => Math.min(20, q + 1))}><Plus /></Button>
            </div>
            <Button onClick={handleAdd} disabled={!canAdd}>
              <ShoppingCart /> {tr("加入購物車", "Add to cart")}{breakdown ? ` · NT$${breakdown.total * qty}` : ""}
            </Button>
          </div>
          {problem && date && <p className="text-xs text-red-600 text-right">{problem}</p>}
        </div>
      </div>
    </div>
  );
}

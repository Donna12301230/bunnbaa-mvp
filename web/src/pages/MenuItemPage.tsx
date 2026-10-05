import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { collection, doc, getDocs, getDoc, query, where } from "firebase/firestore";
import { AlertTriangle, ArrowLeft, ChevronUp, Info, Minus, Plus, ShoppingCart, UtensilsCrossed } from "lucide-react";
import { auth, db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import type { ExtraSideChoice, ExtraSideMode, MenuItem, RiceOption, SlotChoice, Vendor } from "@/types";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState, Select } from "@/components/ds";
import { Input } from "@/components/ui/input";
import PriceDateStrip from "@/components/PriceDateStrip";
import { tr, loc } from "@/lib/i18n";
import { tagEn } from "@/types";
import { cn } from "@/lib/utils";
import { discountText } from "@/lib/pricing";
import { RICE_OPTIONS, customFields, isBento, itemListPrice, itemMains, portionLabel, priceBreakdown, priceDeltaText, sideOptions } from "@/lib/bento";
import { usePlatformConfig } from "@/lib/platformConfig";
import { useSideWishes } from "@/hooks/useSideWishes";
import { useSlotAvailability } from "@/hooks/useSlotAvailability";
import { getPreferredPickup, mealPeriodLabel, mealPeriodOf, priceDays, slotLabel, vendorCutoffTime, weekdayOf } from "@/lib/pickupSlots";
import { notifyCartAdded } from "@/components/CartPreview";

/** 下拉式選單一列（§4.2）：左邊是目前選的那道菜的小圖，右邊是原生下拉（手機上是系統選單） */
function DishSelectRow({
  label, image, hint, children,
}: {
  label: string;
  image?: string | null;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3">
        <span className="shrink-0 w-12 h-12 rounded-xl overflow-hidden border border-border bg-secondary flex items-center justify-center">
          {image ? (
            <img src={image} alt="" loading="lazy" className="w-full h-full object-cover" />
          ) : (
            <UtensilsCrossed className="w-5 h-5 text-secondary-foreground/50" strokeWidth={1.5} aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted-foreground mb-0.5">{label}</p>
          {children}
        </div>
      </div>
      {hint && <div className="pl-[60px] text-xs">{hint}</div>}
    </div>
  );
}

// 品項頁＝組便當（規格 §4.2）：價格日期列選取餐日（30 天內）、時段；白飯、主菜、配菜都用下拉式選單
// （配菜預設菜已選好、選候選菜就是許願、選「不要」＝少一道）、第四道（備案或加菜）；
// 下方以「素材 + 素材 → 便當」列出材料總和；底部固定合計、可展開金額拆解。
// 金額只是預覽，結帳時伺服器會重算。
export default function MenuItemPage() {
  const { id } = useParams<{ id: string }>();
  return <MenuItemOrder id={id} />;
}

// 品項點餐內容：路由頁與商家頁的彈窗共用。dialog 模式不顯示回上一頁連結，加入後呼叫 onAdded。
export function MenuItemOrder({ id, dialog = false, onAdded }: { id: string; dialog?: boolean; onAdded?: () => void }) {
  const { toast } = useToast();
  const { add, vendorId: cartVendorId } = useCart();
  const { data: config } = usePlatformConfig();
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");
  const [rice, setRice] = useState<RiceOption>("normal");
  const [choices, setChoices] = useState<SlotChoice[]>([]);
  const [mainIndex, setMainIndex] = useState<number | null>(null);
  const [extra, setExtra] = useState<ExtraSideChoice | null>(null);
  const [customPicks, setCustomPicks] = useState<number[]>([]);
  const [showMaterials, setShowMaterials] = useState(false);
  const [imageOpen, setImageOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
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

  const { data: relatedItems = [] } = useQuery({
    queryKey: ["vendorItemsRelated", item?.vendor_id],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "menu_items"), where("vendor_id", "==", item!.vendor_id), where("is_available", "==", true)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MenuItem).filter((x) => x.id !== item!.id);
    },
    enabled: !!item,
  });

  const servedProblem = useCallback(
    (d: string) => (!item?.weekdays?.length || item.weekdays.includes(weekdayOf(d)) ? null : tr("這天沒有供應", "Not served this day")),
    [item?.weekdays]
  );

  // 預設日期：首頁帶過來的，否則最近一個能訂的
  useEffect(() => {
    if (!vendor || date) return;
    const pref = getPreferredPickup();
    const days = priceDays(vendor).filter((d) => !d.problem && !servedProblem(d.date));
    const first = pref && days.some((d) => d.date === pref.date) ? pref.date : days[0]?.date;
    if (first) setDate(first);
    if (pref?.window) setWindow(pref.window);
  }, [vendor]);

  useEffect(() => {
    if (item?.slots) setChoices(item.slots.map(() => "default"));
    setMainIndex((item?.mains || []).length > 0 ? 0 : null);
    setExtra(null);
    setCustomPicks(customFields(item).map(() => 0));
  }, [item?.id]);

  // 瀏覽訊號（§10）：登入者看品項頁記一次，伺服器端同一天同品項只算一次
  useEffect(() => {
    if (!item?.id || !auth.currentUser) return;
    httpsCallable(functions, "recordItemView")({ menu_item_id: item.id }).catch(() => {});
  }, [item?.id]);

  const { slots: windowSlots } = useSlotAvailability(vendor, date, item);
  useEffect(() => {
    const open = windowSlots.filter((s) => s.open);
    if (open.length > 0 && !open.some((s) => s.window === window)) setWindow(open[0].window);
  }, [windowSlots, window]);

  const { dayCount, weekCount } = useSideWishes(vendor?.id, date);
  const mains = useMemo(() => (item ? itemMains(item) : []), [item]);
  const options = useMemo(() => (item ? sideOptions(item) : []), [item]);
  const custom = useMemo(() => customFields(item), [item]);

  if (isLoading) return <SkeletonBlocks height={256} />;
  if (!item) {
    return (
      <EmptyState
        icon={<UtensilsCrossed size={32} />}
        title={tr("找不到這個品項", "Item not found")}
        description={tr("可能已下架，或連結有誤。", "It may have been removed, or the link is wrong.")}
        action={<Button variant="outline" asChild><Link href="/home">{tr("回預購餐點", "Back to pre-order")}</Link></Button>}
      />
    );
  }

  const bento = isBento(item) && item.item_type !== "single";
  const listPrice = itemListPrice(item, mainIndex);
  const breakdown = date ? priceBreakdown(item, date, rice, choices, 0, { mainIndex, extra, customPicks }) : null;
  const minQtyDefault = vendor?.candidate_min_qty || config?.candidateMinQty || 10;
  const maxSides = config?.maxSides ?? 4;
  const standardCount = item.slots?.length ?? 0;
  const removedCount = choices.filter((c) => c === "none").length;
  const selectedCount = standardCount - removedCount + (extra ? 1 : 0);
  const canAddFourth = bento && standardCount < maxSides && removedCount === 0;
  const removePrice = Math.abs(config?.slotRemovePrice ?? 5);
  const addonPrice = config?.addonSidePrice ?? 10;
  const problem = !date ? tr("請選擇取餐日", "Choose a pickup date") : servedProblem(date);
  const canAdd = !problem && !!window && windowSlots.some((s) => s.window === window && s.open);
  const typhoon = date && vendor?.typhoon_notice?.dates?.includes(date);

  function candidateState(slotIdx: number, candIdx: number) {
    const cand = item!.slots![slotIdx].candidates[candIdx];
    const count = dayCount(item!.id, slotIdx, candIdx);
    const min = cand.min_qty || minQtyDefault;
    const full = !!cand.weekly_cap && weekCount(item!.id, slotIdx, candIdx) >= cand.weekly_cap;
    return { cand, count, min, full };
  }

  /** 某一格的下拉選了什麼：預設菜、候選菜（許願）或 "none"（這格不要，少一道 −5） */
  function pickSide(slotIdx: number, choice: SlotChoice) {
    setChoices((prev) => item!.slots!.map((_, j) => (j === slotIdx ? choice : prev[j] ?? "default")));
    // 第四道跟這格新選的菜撞到，就把第四道拿掉
    if (extra && extra.slot === slotIdx && extra.candidate === (choice === "default" ? null : choice)) setExtra(null);
  }

  const chosenNames = new Set(
    (item.slots || []).map((slot, i) => {
      const c = choices[i];
      if (c === "none" || c === undefined) return null;
      return c === "default" ? slot.default.name : slot.candidates[c as number]?.name;
    }).filter(Boolean) as string[]
  );
  const extraOptions = options.filter((o) => !chosenNames.has(o.name));

  /** 第四道下拉的值："" 不加；"backup|slot|cand" 或 "addon|slot|cand"（cand 為 d＝預設菜） */
  const extraValue = extra ? `${extra.mode}|${extra.slot}|${extra.candidate ?? "d"}` : "";
  function pickExtra(value: string) {
    if (!value) return setExtra(null);
    const [mode, slot, cand] = value.split("|");
    setExtra({ mode: mode as ExtraSideMode, slot: Number(slot), candidate: cand === "d" ? null : Number(cand) });
  }

  // 材料總和（§4.2）：這一份實際包含的每樣材料與份量；跟店家每日備料用同一份配方
  const riceText = RICE_OPTIONS.find((r) => r.value === rice);
  const materials: { label: string; image?: string | null }[] = [];
  if (bento && item.rice_component_id && riceText) materials.push({ label: tr(`白飯 ${riceText.label}`, `Rice: ${riceText.labelEn}`) });
  const main = mainIndex != null ? mains[mainIndex] : mains[0];
  if (main) materials.push({ label: main.portion_text || main.name, image: main.image_url });
  for (const f of item.fixed || []) materials.push({ label: `${f.portion_text || f.name}${f.portions && f.portions !== 1 ? ` ×${f.portions}` : ""}` });
  (item.slots || []).forEach((slot, i) => {
    const c = choices[i];
    if (c === "none" || c === undefined) return;
    if (c === "default") materials.push({ label: slot.default.portion_text || slot.default.name, image: slot.default.image_url });
    else {
      const cand = slot.candidates[c as number];
      materials.push({ label: `${cand.portion_text || cand.name}${cand.portion_level < 1 ? tr("（半份）", " (half)") : ""}`, image: cand.image_url });
    }
  });
  const extraOpt = extra ? options.find((o) => o.slot === extra.slot && o.candidate === extra.candidate) : null;
  if (extra?.mode === "addon" && extraOpt) materials.push({ label: extraOpt.portion_text || extraOpt.name, image: extraOpt.image_url });
  custom.forEach((f, i) => {
    const o = f.options[customPicks[i] ?? 0];
    if (o) materials.push({ label: `${f.label}：${o.name}` });
  });

  // 加入購物車前先用對話框確認訂單內容（不直接加入）
  function openConfirm() {
    if (!canAdd || !vendor) return;
    if (cartVendorId && cartVendorId !== item!.vendor_id) {
      toast({
        title: tr("購物車裡有別家商家的品項", "Your cart has items from another vendor"),
        description: tr("一次只能跟一家商家預購，請先結帳或清空購物車再加入。", "You can only pre-order from one vendor at a time. Check out or clear your cart first."),
        variant: "destructive",
      });
      return;
    }
    setConfirmOpen(true);
  }

  function confirmAdd() {
    if (!canAdd || !vendor) return;
    add({
      menuItem: item!, vendorId: item!.vendor_id, pickupDate: date, pickupWindow: window,
      choices: bento ? choices : [], rice: bento && item!.rice_component_id ? rice : "normal",
      mainIndex: (item!.mains || []).length > 0 ? mainIndex ?? 0 : null, extraSide: bento ? extra : null,
      customPicks: custom.map((_, i) => customPicks[i] ?? 0),
      quantity: qty, note: note.trim(), couponId: null,
    });
    setConfirmOpen(false);
    notifyCartAdded();
    onAdded?.();
  }

  function choiceName(i: number): string {
    const slot = item!.slots![i];
    const c = choices[i];
    if (c === "none") return tr("不要", "None");
    if (c === undefined || c === "default") return slot.default.name;
    return slot.candidates[c]?.name ?? slot.default.name;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-4">
      {!dialog && (
        <Link href="/home" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {tr("回預購餐點", "Back to pre-order")}
        </Link>
      )}

      <div className="grid grid-cols-1 gap-8 lg:gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start">
        <div className="min-w-0 lg:sticky lg:top-24 space-y-4">
          {item.image ? (
            <button
              type="button"
              onClick={() => setImageOpen(true)}
              aria-label={tr("放大圖片", "Enlarge photo")}
              className="block w-full rounded-[2rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-zoom-in"
            >
              <img src={item.image} alt={loc(item, "name")} className="w-full aspect-[4/3] rounded-[2rem] border border-ink object-cover" />
            </button>
          ) : (
            <div className="w-full aspect-[4/3] rounded-[2rem] border border-ink bg-secondary flex items-center justify-center">
              <UtensilsCrossed className="h-14 w-14 text-secondary-foreground/50" strokeWidth={1.25} aria-hidden="true" />
            </div>
          )}
          <div>
            <p className="text-sm font-semibold text-muted-foreground">
              <Link href={`/vendor/${item.vendor_id}`} className="text-blue-600 underline underline-offset-4">{loc(vendor, "name")}</Link>
            </p>
            <h1 className="font-heading font-semibold text-[clamp(28px,3.6vw,46px)] leading-[1.08] tracking-[-0.02em] mb-2">{loc(item, "name")}</h1>
            <p className="text-muted-foreground leading-relaxed">{loc(item, "description")}</p>
            {(item.fixed?.length ?? 0) > 0 && <p className="text-sm mt-1">{bento ? tr("附：", "Comes with: ") : tr("內含：", "Contains: ")}{item.fixed!.map((f) => f.name).join("、")}</p>}
            {(item.dietary_tags?.length > 0 || item.allergens?.length > 0) && (
              <div className="space-y-1.5 mt-2">
                {item.dietary_tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.dietary_tags.map((tag) => <span key={tag} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">{tr(tag, tagEn(tag))}</span>)}
                  </div>
                )}
                {item.allergens?.length > 0 && <p className="text-xs text-red-700">{tr("含過敏原：", "Contains: ")}{item.allergens.map((a) => tr(a, tagEn(a))).join(tr("、", ", "))}</p>}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-7">
          {/* 價格日期列＋時段 */}
          <section className="space-y-3">
            <PriceDateStrip value={date} onChange={setDate} vendor={vendor} basePrice={listPrice} extraProblem={servedProblem} />
            {date && (
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={tr("取餐時段", "Pickup time")}>
                {windowSlots.length === 0 && <p className="text-sm text-muted-foreground">{tr("這家店沒有這個品項供應餐期的取餐時段。", "No pickup times for this item's meal periods.")}</p>}
                {windowSlots.map((s) => (
                  <button
                    key={s.window}
                    type="button"
                    disabled={!s.open}
                    onClick={() => setWindow(s.window)}
                    aria-checked={window === s.window}
                    role="radio"
                    className={cn(
                      "h-10 px-4 rounded-full border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      !s.open ? "opacity-40 cursor-not-allowed" : window === s.window ? "border-ink bg-secondary text-secondary-foreground" : "border-border bg-card hover:border-ink"
                    )}
                  >
                    <span className="text-xs text-muted-foreground mr-1">{mealPeriodLabel(mealPeriodOf(s.window))}</span>
                    {slotLabel(s.window)}{s.remaining !== null && s.open ? tr(`（剩 ${s.remaining}）`, ` (${s.remaining} left)`) : ""}
                  </button>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {tr(`取餐前一天 ${vendorCutoffTime(vendor)} 截單，截單前可免費修改或取消。`, `Orders close at ${vendorCutoffTime(vendor)} the day before; change or cancel for free until then.`)}
            </p>
            {typhoon && (
              <div className="flex gap-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-800">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                {tr("颱風警報期間：這天可能因停班停課取消，取消時會自動全額退款。", "Typhoon warning: this day may be cancelled for a work suspension — you'd get a full automatic refund.")}
              </div>
            )}
          </section>

          {/* 組便當：白飯、主菜、配菜都用下拉式選單 */}
          {bento && (
            <section className="space-y-4">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <h2 className="font-heading text-xl font-semibold">{tr("組便當", "Build your bento")}</h2>
                <span className="text-xs text-muted-foreground">{tr(`配菜已選 ${selectedCount}／最多 ${maxSides} 道・少一道 −${removePrice}`, `${selectedCount} of up to ${maxSides} sides · −${removePrice} per side removed`)}</span>
              </div>

              {item.rice_component_id && (
                <DishSelectRow label={tr("白飯", "Rice")}>
                  <Select aria-label={tr("飯量", "Rice amount")} value={rice} onChange={(e) => setRice(e.target.value as RiceOption)}>
                    {RICE_OPTIONS.map((opt) => {
                      const price = opt.value === "add" ? config?.riceAddPrice ?? 10 : opt.value === "less" ? config?.riceLessPrice ?? -5 : 0;
                      return <option key={opt.value} value={opt.value}>{tr(opt.label, opt.labelEn)}{price !== 0 ? `（${price > 0 ? `+${price}` : price}）` : ""}</option>;
                    })}
                  </Select>
                </DishSelectRow>
              )}

              {mains.length > 0 && (
                <DishSelectRow label={tr("主菜", "Main")} image={main?.image_url}>
                  <Select aria-label={tr("主菜", "Main")} value={String(mainIndex ?? 0)} disabled={mains.length === 1} onChange={(e) => setMainIndex(Number(e.target.value))}>
                    {mains.map((m, i) => <option key={i} value={i}>{m.name}{mains.length > 1 ? `（NT$ ${m.price}）` : ""}</option>)}
                  </Select>
                </DishSelectRow>
              )}

              {item.slots!.map((slot, i) => {
                const choice = choices[i] ?? "default";
                const picked = choice === "none" ? null : choice === "default" ? slot.default : slot.candidates[choice];
                const wish = typeof choice === "number" ? candidateState(i, choice) : null;
                return (
                  <DishSelectRow
                    key={i}
                    label={`${tr(`配菜 ${i + 1}`, `Side ${i + 1}`)}${slot.category ? `・${slot.category}` : ""}`}
                    image={picked?.image_url}
                    hint={wish ? (
                      <p className="text-orange-700">
                        {tr(`許願中：截單時滿 ${wish.min} 人才成立；未成立${extra?.mode === "backup" ? "換成備案" : `換回「${slot.default.name}」`}，訂單照常成立。`,
                          `Wish: needs ${wish.min} people by cutoff; otherwise ${extra?.mode === "backup" ? "your backup" : slot.default.name} is used.`)}
                      </p>
                    ) : choice === "none" ? <p className="text-orange-700">{tr(`這道不要（−${removePrice}）`, `Skipped (−${removePrice})`)}</p> : null}
                  >
                    <Select aria-label={tr(`配菜 ${i + 1}`, `Side ${i + 1}`)} value={String(choice)} onChange={(e) => pickSide(i, e.target.value === "default" || e.target.value === "none" ? e.target.value : Number(e.target.value))}>
                      <option value="default">{slot.default.name}{tr("（預設）", " (default)")}</option>
                      {slot.candidates.map((_, ci) => {
                        const st = candidateState(i, ci);
                        const status = st.cand.disabled
                          ? tr("今日未供應", "not served today")
                          : st.full && choice !== ci
                            ? tr("已滿", "full")
                            : tr(`${portionLabel(st.cand.portion_level)}・${st.count}/${st.min} 人成立`, `${portionLabel(st.cand.portion_level)} · ${st.count}/${st.min} wishes`);
                        return <option key={ci} value={ci} disabled={st.cand.disabled || (st.full && choice !== ci)}>{st.cand.name}（{status}）</option>;
                      })}
                      <option value="none">{tr(`不要這道（−${removePrice}）`, `None (−${removePrice})`)}</option>
                    </Select>
                  </DishSelectRow>
                );
              })}

              {/* 第四道：選滿標準數量後才能選，「備案」不加價或「加菜 +10」 */}
              {standardCount < maxSides && (
                <DishSelectRow
                  label={tr(`配菜 ${standardCount + 1}（選填）`, `Side ${standardCount + 1} (optional)`)}
                  image={extraOpt?.image_url}
                  hint={<p className="text-muted-foreground">{!canAddFourth
                    ? tr("先選滿前面每一格，才能加第四道。", "Fill every side above first to add a fourth.")
                    : tr(`備案：平常不放進便當，前面任一道沒供應、已滿或許願未成立時自動遞補。加菜 +${addonPrice}：四道都放進便當。`, `Backup: fills in only if a side isn't served or a wish fails. Add-on +${addonPrice}: all four go in the box.`)}</p>}
                >
                  <Select aria-label={tr("第四道", "4th side")} value={canAddFourth ? extraValue : ""} disabled={!canAddFourth} onChange={(e) => pickExtra(e.target.value)}>
                    <option value="">{tr("不加", "None")}</option>
                    {(["backup", "addon"] as const).map((mode) => (
                      <optgroup key={mode} label={mode === "backup" ? tr("備案（不加價）", "Backup (free)") : tr(`加菜 +${addonPrice}`, `Add-on +${addonPrice}`)}>
                        {extraOptions.map((o) => {
                          const st = o.candidate != null ? candidateState(o.slot, o.candidate) : null;
                          const value = `${mode}|${o.slot}|${o.candidate ?? "d"}`;
                          return (
                            <option key={value} value={value} disabled={!!st?.full && value !== extraValue}>
                              {o.name}{o.portion_level < 1 ? tr("（半份）", " (half)") : ""}{st ? tr(`・${st.count}/${st.min} 人`, ` · ${st.count}/${st.min}`) : ""}
                            </option>
                          );
                        })}
                      </optgroup>
                    ))}
                  </Select>
                </DishSelectRow>
              )}
              {/* 店家自訂欄位（例：湯品、飲料、辣度），第一個選項是預設 */}
              {custom.map((f, i) => (
                <DishSelectRow key={`custom-${i}`} label={f.label}>
                  <Select aria-label={f.label} value={String(customPicks[i] ?? 0)} onChange={(e) => setCustomPicks((prev) => custom.map((_, j) => (j === i ? Number(e.target.value) : prev[j] ?? 0)))}>
                    {f.options.map((o, oi) => <option key={oi} value={oi}>{o.name}{o.price ? `（${priceDeltaText(o.price)}）` : ""}</option>)}
                  </Select>
                </DishSelectRow>
              ))}
              <p className="text-xs text-muted-foreground flex gap-1"><Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />{tr("候選菜不加價，改以份量平衡成本（標示全份／半份）；已滿或今日未供應的選項不能選。", "Candidates cost the same — portions balance the cost (full/half). Full or unavailable options can't be picked.")}</p>
            </section>
          )}

          {/* 材料總和（§4.2）：素材 + 素材 + … → 便當 */}
          {materials.length > 0 && (
            <section className="rounded-2xl border border-ink bg-accent p-4 space-y-3" aria-label={tr("材料總和", "What's in it")}>
              <h2 className="font-heading text-lg font-semibold">{tr("材料總和", "What's in it")}</h2>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {materials.map((m, i) => (
                  <span key={i} className="contents">
                    {i > 0 && <span className="font-semibold text-muted-foreground" aria-hidden="true">+</span>}
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-ink bg-card px-2.5 py-1.5">
                      {m.image && <img src={m.image} alt="" className="w-6 h-6 rounded object-cover" />}
                      {m.label}
                    </span>
                  </span>
                ))}
                <span className="font-semibold text-muted-foreground" aria-hidden="true">→</span>
                <span className="inline-flex items-center rounded-lg border-2 border-ink bg-ink text-[var(--text-on-inverse)] px-2.5 py-1.5 font-semibold">
                  {loc(item, "name")}{breakdown ? `・NT$ ${breakdown.total}` : ""}
                </span>
              </div>
              {extra?.mode === "backup" && extraOpt && <p className="text-xs text-muted-foreground">{tr(`備案：${extraOpt.name}（前面許願沒成立才遞補）`, `Backup: ${extraOpt.name} (only if a wish fails)`)}</p>}
            </section>
          )}

          <div>
            <label htmlFor="item-note" className="text-sm font-medium block mb-1">{tr("備註（選填）", "Note (optional)")}</label>
            <Input id="item-note" type="text" value={note} maxLength={100} onChange={(e) => setNote(e.target.value)} placeholder={tr("例如：不要香菜", "e.g. no coriander")} />
          </div>

          {/* 底部固定：合計（已含早鳥），點開看材料總和與金額拆解 */}
          <div className="sticky bottom-0 z-10 -mx-4 px-4 md:mx-0 md:px-0 pt-2 pb-4 bg-background/95 backdrop-blur-md border-t border-border space-y-2">
            {showMaterials && breakdown && (
              <div className="rounded-2xl border border-ink bg-accent p-4 text-sm space-y-2">
                <p className="font-semibold">{tr("金額拆解", "Price breakdown")}</p>
                <dl className="space-y-1 pt-2 border-t border-border">
                  <div className="flex justify-between"><dt className="text-muted-foreground">{tr("原價", "Price")}</dt><dd>NT${breakdown.listPrice}</dd></div>
                  {breakdown.earlyBird > 0 && <div className="flex justify-between text-green-700"><dt>{tr(`早鳥 ${discountText(breakdown.discountPercent)}`, `Early bird ${discountText(breakdown.discountPercent)}`)}</dt><dd>−NT${breakdown.earlyBird}</dd></div>}
                  {breakdown.adjust !== 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{tr("加減選項", "Adjustments")}</dt><dd>{breakdown.adjust > 0 ? "+" : "−"}NT${Math.abs(breakdown.adjust)}</dd></div>}
                  <div className="flex justify-between font-bold"><dt>{tr("應付（每份）", "Total (each)")}</dt><dd>NT${breakdown.total}</dd></div>
                </dl>
                <p className="text-xs text-muted-foreground">{tr("有折價券可在購物車套用（每筆限一張）。", "Apply a coupon in your cart (one per meal).")}</p>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setShowMaterials((v) => !v)}
                aria-expanded={showMaterials}
                className="min-w-0 text-left rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-center gap-1 font-heading text-xl font-semibold">
                  {tr("合計", "Total")} NT$ {breakdown ? breakdown.total * qty : "—"}
                  <ChevronUp className={cn("w-4 h-4 transition-transform", !showMaterials && "rotate-180")} aria-hidden="true" />
                </span>
                <span className="block text-xs text-muted-foreground truncate">
                  {breakdown?.discountPercent ? tr(`已含早鳥 ${discountText(breakdown.discountPercent)}・點開看明細`, `Incl. early bird ${discountText(breakdown.discountPercent)} · tap for details`) : tr("點開看金額明細", "Tap for details")}
                </span>
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <Button variant="outline" size="icon" className="h-10 w-10 rounded-full" aria-label={tr("減少數量", "Decrease quantity")} onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus /></Button>
                <span className="w-5 text-center font-medium bb-num" aria-live="polite">{qty}</span>
                <Button variant="outline" size="icon" className="h-10 w-10 rounded-full" aria-label={tr("增加數量", "Increase quantity")} onClick={() => setQty((q) => Math.min(20, q + 1))}><Plus /></Button>
                <Button onClick={openConfirm} disabled={!canAdd} className="h-12 px-5 rounded-full text-base">
                  <ShoppingCart /> {tr("加入購物車", "Add to cart")}
                </Button>
              </div>
            </div>
            {problem && date && <p className="text-xs text-red-600 text-right">{problem}</p>}
          </div>
        </div>
      </div>

      {/* 同一商店的其他品項（頁面模式才顯示；彈窗模式不另外跳頁） */}
      {!dialog && relatedItems.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-xl font-semibold">{tr("同一家店的其他品項", "More from this vendor")}</h2>
          <ul className="flex gap-4 overflow-x-auto pb-2">
            {relatedItems.map((r) => (
              <li key={r.id} className="shrink-0 w-40">
                <Link href={`/item/${r.id}`} className="block group">
                  <span className="block aspect-[4/3] rounded-2xl overflow-hidden border border-ink bg-secondary">
                    {r.image && <img src={r.image} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.05]" />}
                  </span>
                  <span className="block mt-2 text-sm font-semibold truncate">{loc(r, "name")}</span>
                  <span className="block text-sm text-muted-foreground">NT${r.price}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 點商品圖片放大 */}
      <Dialog open={imageOpen} onOpenChange={setImageOpen}>
        <DialogContent className="max-w-3xl p-3 md:p-4 bg-transparent border-0 shadow-none">
          <DialogTitle className="sr-only">{loc(item, "name")}</DialogTitle>
          {item.image && <img src={item.image} alt={loc(item, "name")} className="w-full max-h-[80vh] object-contain rounded-2xl bg-card" />}
        </DialogContent>
      </Dialog>

      {/* 下訂前確認：把要下的訂單完整列出來，確認後才真正加入購物車 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tr("確認訂單內容", "Confirm your order")}</DialogTitle>
            <DialogDescription>{tr("確認無誤後加入購物車，結帳時才會付款。", "Add to cart now; you only pay at checkout.")}</DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{tr("品項", "Item")}</dt><dd className="text-right font-medium">{loc(item, "name")}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{tr("取餐", "Pickup")}</dt><dd className="text-right">{date}・{slotLabel(window)}</dd></div>
            {bento && item.mains && item.mains.length > 0 && mainIndex !== null && (
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{tr("主菜", "Main")}</dt><dd className="text-right">{item.mains[mainIndex]?.name}</dd></div>
            )}
            {bento && (item.slots || []).map((slot, i) => (
              <div key={i} className="flex justify-between gap-4"><dt className="text-muted-foreground">{slot.category}</dt><dd className="text-right">{choiceName(i)}</dd></div>
            ))}
            {bento && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{tr("飯量", "Rice")}</dt>
                <dd className="text-right">{rice === "add" ? tr("加飯", "More rice") : rice === "less" ? tr("減飯", "Less rice") : tr("正常", "Normal")}</dd>
              </div>
            )}
            {bento && extra && (
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{tr("第四道", "4th side")}</dt><dd className="text-right">{extra.mode === "backup" ? tr("備案", "Backup") : tr("加菜", "Add-on")}</dd></div>
            )}
            {custom.map((f, i) => (
              <div key={`custom-${i}`} className="flex justify-between gap-4"><dt className="text-muted-foreground">{f.label}</dt><dd className="text-right">{f.options[customPicks[i] ?? 0]?.name}</dd></div>
            ))}
            <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{tr("數量", "Qty")}</dt><dd className="text-right">{qty}</dd></div>
            {note.trim() && <div className="flex justify-between gap-4"><dt className="text-muted-foreground">{tr("備註", "Note")}</dt><dd className="text-right">{note.trim()}</dd></div>}
          </dl>
          <div className="flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">{tr("合計", "Total")}</span>
            <span className="font-heading text-2xl font-semibold">NT${breakdown ? breakdown.total * qty : "—"}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} className="h-11 rounded-full">{tr("再改改", "Edit")}</Button>
            <Button onClick={confirmAdd} disabled={!canAdd} className="h-11 rounded-full"><ShoppingCart /> {tr("確認加入", "Confirm")}</Button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}

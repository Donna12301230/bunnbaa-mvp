import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { doc, getDoc } from "firebase/firestore";
import { ArrowLeft, Minus, Plus, ShoppingCart, UtensilsCrossed } from "lucide-react";
import { db } from "@/lib/firebase";
import type { MenuItem, Vendor } from "@/types";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { tr } from "@/lib/i18n";
import { tagEn } from "@/types";

// 商品詳情頁。
export default function MenuItemPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { addItem, vendorId: cartVendorId } = useCart();
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState("");

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
      if (!item?.vendor_id) return null;
      const snap = await getDoc(doc(db, "vendors", item.vendor_id));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Vendor) : null;
    },
    enabled: !!item,
  });

  if (isLoading) {
    return <SkeletonBlocks height={256} />;
  }

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

  function handleAddToCart() {
    if (cartVendorId && cartVendorId !== item!.vendor_id) {
      toast({
        title: tr("購物車裡有別家商家的品項", "Your cart has items from another vendor"),
        description: tr("加入這項會清空目前的購物車（一次只能跟一家商家預購）。", "Adding this will clear your cart (you can only pre-order from one vendor at a time)."),
      });
    }
    for (let i = 0; i < qty; i++) addItem(item!, item!.vendor_id, note.trim());
    toast({ title: tr("已加入購物車", "Added to cart"), description: `${item!.name} x${qty}` });
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Link
        href={`/vendor/${item.vendor_id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> {vendor?.name ?? tr("回商家頁", "Back to vendor")}
      </Link>

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <div className="w-full h-48 bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
          <UtensilsCrossed className="h-14 w-14 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="p-5 space-y-4">
          <div>
            <h1 className="text-xl font-bold mb-1">{item.name}</h1>
            <p className="text-sm text-muted-foreground">{item.description}</p>
          </div>

          <div className="text-2xl font-bold text-orange-600">NT${item.price}</div>
          <p className="text-xs text-muted-foreground -mt-2">{tr("取餐日期與時段在購物車結帳時選擇，提前預約享早鳥折扣。", "Choose your pickup date and time at checkout — book early for an early-bird discount.")}</p>

          {(item.dietary_tags?.length > 0 || item.allergens?.length > 0) && (
            <div className="space-y-1.5">
              {item.dietary_tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.dietary_tags.map((tag) => (
                    <span key={tag} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                      {tr(tag, tagEn(tag))}
                    </span>
                  ))}
                </div>
              )}
              {item.allergens?.length > 0 && (
                <p className="text-xs text-red-500">{tr("含過敏原：", "Contains: ")}{item.allergens.map((a) => tr(a, tagEn(a))).join(tr("、", ", "))}</p>
              )}
            </div>
          )}

          <div className="field">
            <label htmlFor="item-note" className="text-sm font-medium block mb-1">{tr("備註（選填）", "Note (optional)")}</label>
            <Input
              id="item-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={tr("例如：不要香菜", "e.g. no coriander")}
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" aria-label={tr("減少數量", "Decrease quantity")} onClick={() => setQty((q) => Math.max(1, q - 1))}>
                <Minus />
              </Button>
              <span className="w-6 text-center font-medium bb-num" aria-live="polite">{qty}</span>
              <Button variant="outline" size="icon" className="h-8 w-8 rounded-full" aria-label={tr("增加數量", "Increase quantity")} onClick={() => setQty((q) => q + 1)}>
                <Plus />
              </Button>
            </div>
            <Button onClick={handleAddToCart}>
              <ShoppingCart /> {tr("加入購物車", "Add to cart")} · NT${item.price * qty}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

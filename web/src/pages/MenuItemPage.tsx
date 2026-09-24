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
    return <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />;
  }

  if (!item) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <p>找不到這個品項</p>
        <Link href="/vendors" className="text-sm text-orange-600 hover:underline mt-2 inline-block">
          回商家清單
        </Link>
      </div>
    );
  }

  function handleAddToCart() {
    if (cartVendorId && cartVendorId !== item!.vendor_id) {
      toast({
        title: "購物車裡有別家商家的品項",
        description: "加入這項會清空目前的購物車（一次只能跟一家商家預購）。",
      });
    }
    for (let i = 0; i < qty; i++) addItem(item!, item!.vendor_id, note);
    toast({ title: "已加入購物車", description: `${item!.name} x${qty}` });
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <Link
        href={`/vendor/${item.vendor_id}`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" /> {vendor?.name ?? "回商家頁"}
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

          {(item.dietary_tags?.length > 0 || item.allergens?.length > 0) && (
            <div className="space-y-1.5">
              {item.dietary_tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.dietary_tags.map((tag) => (
                    <span key={tag} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {item.allergens?.length > 0 && (
                <p className="text-xs text-red-500">含過敏原：{item.allergens.join("、")}</p>
              )}
            </div>
          )}

          <div className="field">
            <label className="text-sm font-medium block mb-1">備註（選填）</label>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="例如：不要香菜"
              className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-gray-50"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-6 text-center font-medium">{qty}</span>
              <button
                onClick={() => setQty((q) => q + 1)}
                className="w-8 h-8 rounded-full border border-border flex items-center justify-center hover:bg-gray-50"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <Button className="bg-orange-500 hover:bg-orange-600 text-white" onClick={handleAddToCart}>
              <ShoppingCart className="w-4 h-4 mr-1.5" /> 加入購物車 · NT${item.price * qty}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

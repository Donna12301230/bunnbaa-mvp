import { useMemo, useState, type MouseEvent } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { AlertCircle, AlertTriangle, ArrowLeft, MapPin, Phone, Plus, Sparkles, Star, Store, UtensilsCrossed } from "lucide-react";
import { db } from "@/lib/firebase";
import type { Vendor, MenuItem } from "@/types";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { tr, loc } from "@/lib/i18n";
import { tagEn } from "@/types";
import { useCart } from "@/hooks/useCart";
import { useToast } from "@/hooks/use-toast";
import { useReviews, summarizeRatings } from "@/hooks/useReviews";
import { isBento } from "@/lib/bento";
import { nextAvailablePickup } from "@/lib/pickupSlots";
import OpenWishDialog from "@/components/OpenWishDialog";


function categoryAnchorId(category: string) {
  return `category-${encodeURIComponent(category)}`;
}

// 手機上長菜單一直滑很痛苦，點分類直接捲到對應區塊；避免用 <a href="#..">，
// 整站是 hash router（wouter + useHashLocation），網址的 # 是路由本身，不能
// 拿來當錨點用，所以用 scrollIntoView 純 DOM 捲動。
function scrollToCategory(category: string) {
  document.getElementById(categoryAnchorId(category))?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 商家頁 — 也兼商品(鎖定品項)列表頁：顯示這家商家所有可預購品項。
export default function VendorPage() {
  const { id } = useParams<{ id: string }>();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const { add, vendorId: cartVendorId } = useCart();
  const [, navigate] = useLocation();
  const [wishOpen, setWishOpen] = useState(false);
  const { toast } = useToast();
  const { data: reviews = [] } = useReviews();

  const { data: vendor, isLoading: vendorLoading } = useQuery({
    queryKey: ["vendor", id],
    queryFn: async () => {
      if (!id) return null;
      const snap = await getDoc(doc(db, "vendors", id));
      return snap.exists() ? ({ id: snap.id, ...snap.data() } as Vendor) : null;
    },
    enabled: !!id,
  });

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["vendorMenuItems", id],
    queryFn: async () => {
      const snap = await getDocs(
        query(collection(db, "menu_items"), where("vendor_id", "==", id), where("is_available", "==", true))
      );
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MenuItem);
    },
    enabled: !!id,
  });

  // 依 category 分組，保留品項在資料庫裡原本的順序，只是把同分類的拉在一起。
  const categories = useMemo(() => {
    const groups = new Map<string, MenuItem[]>();
    for (const item of items) {
      const cat = loc(item, "category").trim() || tr("其他", "Other");
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(item);
    }
    return [...groups.entries()];
  }, [items]);

  const rating = useMemo(() => {
    if (!id) return null;
    return summarizeRatings(reviews, (r) => r.vendor_id ?? null).get(id) ?? null;
  }, [reviews, id]);

  const effectiveCategory = activeCategory ?? categories[0]?.[0] ?? null;

  // 便當要選日期與配菜，直接帶到品項頁；單品用最近能訂的日期時段快速加入
  function quickAdd(e: MouseEvent, item: MenuItem) {
    e.preventDefault();
    e.stopPropagation();
    const next = nextAvailablePickup(vendor);
    if (isBento(item) || !next) {
      navigate(`/item/${item.id}`);
      return;
    }
    if (cartVendorId && cartVendorId !== item.vendor_id) {
      toast({
        title: tr("購物車裡有別家商家的品項", "Your cart has items from another vendor"),
        description: tr("一次只能跟一家商家預購，請先結帳或清空購物車再加入。", "You can only pre-order from one vendor at a time. Check out or clear your cart first."),
        variant: "destructive",
      });
      return;
    }
    add({ menuItem: item, vendorId: item.vendor_id, pickupDate: next.date, pickupWindow: next.window, choices: [], rice: "normal", quantity: 1, note: "", couponId: null });
    toast({ title: tr("已加入購物車", "Added to cart"), description: `${loc(item, "name")}・${next.date} ${next.window}` });
  }

  if (vendorLoading) {
    return <SkeletonBlocks height={192} />;
  }

  if (!vendor) {
    return (
      <EmptyState
        icon={<Store size={32} />}
        title={tr("找不到這個商家", "Vendor not found")}
        description={tr("可能已停止營業，或連結有誤。", "It may have closed, or the link is wrong.")}
        action={<Button variant="outline" asChild><Link href="/vendors">{tr("回商家清單", "Back to vendors")}</Link></Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/vendors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> {tr("回商家清單", "Back to vendors")}
      </Link>

      <div>
        {vendor.cover_image ? (
          <img src={vendor.cover_image} alt="" className="w-full h-40 sm:h-48 rounded-xl object-cover" />
        ) : (
          <div className="w-full h-40 sm:h-48 rounded-xl bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center">
            <Store className="h-12 w-12 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
          </div>
        )}

        <div className="mt-4">
          <h1 className="text-xl font-bold mb-1">{loc(vendor, "name")}</h1>
          {rating && (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground mb-1.5">
              <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
              <span className="font-medium text-foreground">{rating.average}</span>
              ({rating.count}+)
            </span>
          )}
          {vendor.description && <p className="text-sm text-muted-foreground mb-3">{loc(vendor, "description")}</p>}
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            {vendor.address && (
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 shrink-0" /> {vendor.address}
              </span>
            )}
            {vendor.phone && (
              <span className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 shrink-0" /> {vendor.phone}
              </span>
            )}
          </div>
        </div>

        {vendor.typhoon_notice?.dates?.length ? (
          <div className="flex items-start gap-2 bg-amber-50 rounded-lg px-3 py-2 text-xs text-amber-800 mt-4">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{tr(`颱風警報：${vendor.typhoon_notice.dates.join("、")} 的訂單可能因停班停課取消（會自動全額退款）。`, `Typhoon warning: orders on ${vendor.typhoon_notice.dates.join(", ")} may be cancelled (automatic full refund).`)}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 bg-orange-50 rounded-lg px-3 py-2 text-xs text-orange-900 mt-4">
          <span className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 shrink-0" />{tr("想吃的菜這家店沒有？許願看看，人數夠多店家就會考慮上架。", "Want a dish this vendor doesn't have? Make a wish — enough wishes and they may add it.")}</span>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setWishOpen(true)}>{tr("許願新菜", "Wish for a dish")}</Button>
        </div>
        <OpenWishDialog open={wishOpen} onOpenChange={setWishOpen} vendorId={vendor.id} vendorName={loc(vendor, "name")} />

        {vendor.phone && (
          <div className="flex items-start gap-2 bg-amber-50 rounded-lg px-3 py-2 text-xs text-amber-800 mt-4">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {tr(`如有餐點變動，請致電 ${vendor.phone} 確認！`, `If your order changes, please call ${vendor.phone} to confirm.`)}
            </span>
          </div>
        )}
      </div>

      <div>
        {itemsLoading ? (
          <SkeletonBlocks count={2} height={72} className="space-y-1" />
        ) : items.length === 0 ? (
          <EmptyState size="compact" icon={<UtensilsCrossed size={32} />} title={tr("這家商家目前沒有上架品項", "This vendor has no items available right now")} />
        ) : (
          <>
            {categories.length > 1 && (
              <div className="sticky top-16 z-10 -mx-3 md:-mx-4 mb-2 bg-gray-50/95 backdrop-blur-sm border-b border-border">
                <div className="flex gap-5 overflow-x-auto px-3 md:px-4">
                  {categories.map(([category]) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => {
                        setActiveCategory(category);
                        scrollToCategory(category);
                      }}
                      className={cn(
                        "shrink-0 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap",
                        effectiveCategory === category
                          ? "border-orange-500 text-orange-600"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-6">
              {categories.map(([category, categoryItems]) => (
                <section key={category} id={categoryAnchorId(category)} className="scroll-mt-32">
                  <h3 className="font-semibold mb-1 pb-2 border-b-2 border-orange-500 inline-block">{category}</h3>
                  <div className="divide-y divide-border">
                    {categoryItems.map((item) => (
                      <Link
                        key={item.id}
                        href={`/item/${item.id}`}
                        className="flex items-center justify-between gap-3 py-4"
                      >
                        {item.image && (
                          <img src={item.image} alt="" loading="lazy" className="w-16 h-16 rounded-lg object-cover shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <h4 className="font-semibold text-sm mb-0.5">{loc(item, "name")}</h4>
                          {loc(item, "description") && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{loc(item, "description")}</p>
                          )}
                          {item.dietary_tags?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {item.dietary_tags.map((tag) => (
                                <span key={tag} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                                  {tr(tag, tagEn(tag))}
                                </span>
                              ))}
                            </div>
                          )}
                          <span className="text-sm font-bold text-orange-600">NT${item.price}</span>
                          {isBento(item) && <span className="ml-2 text-xs text-muted-foreground">{tr("可選配菜・加減飯", "Choose sides · rice")}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => quickAdd(e, item)}
                          aria-label={tr("加入購物車", "Add to cart")}
                          className="shrink-0 w-9 h-9 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 active:scale-95 transition-[transform,background-color]"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </Link>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

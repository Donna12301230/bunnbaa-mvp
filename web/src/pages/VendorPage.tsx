import { useMemo, useState, type MouseEvent } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { AlertCircle, AlertTriangle, ArrowLeft, MapPin, Phone, Plus, Sparkles, Star, Store, UtensilsCrossed } from "lucide-react";
import { db } from "@/lib/firebase";
import type { Vendor, MenuItem } from "@/types";
import { catalogOf, groupByCatalog } from "@/lib/menuCatalog";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { MenuItemOrder } from "@/pages/MenuItemPage";
import { cn } from "@/lib/utils";
import { tr, loc } from "@/lib/i18n";
import { tagEn } from "@/types";
import { useCart } from "@/hooks/useCart";
import { notifyCartAdded } from "@/components/CartPreview";
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
  const [activeCatalog, setActiveCatalog] = useState<string | null>(null);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
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

  // 目錄 > 分類 兩層（lib/menuCatalog.ts）：店家有用目錄、而且不只一個目錄時，先切目錄再看分類；
  // 否則維持只有分類一層。分類保留品項在資料庫裡原本的順序，只是把同分類的拉在一起。
  const categoryOf = (item: MenuItem) => loc(item, "category").trim() || tr("其他", "Other");
  const catalogGroups = useMemo(() => groupByCatalog(items, vendor?.menu_catalogs, categoryOf), [items, vendor?.menu_catalogs]); // eslint-disable-line react-hooks/exhaustive-deps
  const showCatalogs = catalogGroups.length > 1 && catalogGroups.some((g) => g.catalog);
  const effectiveCatalog = showCatalogs ? (catalogGroups.find((g) => g.catalog === activeCatalog) ?? catalogGroups[0]).catalog : null;
  const categories = useMemo(() => {
    const shown = showCatalogs ? items.filter((item) => catalogOf(item) === effectiveCatalog) : items;
    const groups = new Map<string, MenuItem[]>();
    for (const item of shown) {
      const cat = categoryOf(item);
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(item);
    }
    return [...groups.entries()];
  }, [items, showCatalogs, effectiveCatalog]); // eslint-disable-line react-hooks/exhaustive-deps

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
        title: tr("購物車裡有別家店家的品項", "Your cart has items from another vendor"),
        description: tr("一次只能跟一家店家預購，請先結帳或清空購物車再加入。", "You can only pre-order from one vendor at a time. Check out or clear your cart first."),
        variant: "destructive",
      });
      return;
    }
    if (!add({ menuItem: item, vendorId: item.vendor_id, pickupDate: next.date, pickupWindow: next.window, choices: [], rice: "normal", quantity: 1, note: "", couponId: null })) return;
    notifyCartAdded();
  }

  if (vendorLoading) {
    return <SkeletonBlocks height={192} />;
  }

  if (!vendor) {
    return (
      <EmptyState
        icon={<Store size={32} />}
        title={tr("找不到這個店家", "Vendor not found")}
        description={tr("可能已停止營業，或連結有誤。", "It may have closed, or the link is wrong.")}
        action={<Button variant="outline" asChild><Link href="/vendors">{tr("回店家清單", "Back to vendors")}</Link></Button>}
      />
    );
  }

  return (
    <div className="space-y-10">
      <Link href="/vendors" className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {tr("回店家清單", "Back to vendors")}
      </Link>

      {/* ── 店家頁首：大圖＋疊在圖上的店名（深色漸層保證白字對比） ── */}
      <section className="relative overflow-hidden rounded-[2rem] border border-ink bg-secondary">
        {vendor.cover_image ? (
          <img src={vendor.cover_image} alt="" className="w-full h-[260px] md:h-[420px] object-cover" />
        ) : (
          <div className="w-full h-[260px] md:h-[420px] flex items-center justify-center">
            <Store className="h-14 w-14 text-secondary-foreground/60" strokeWidth={1.25} aria-hidden="true" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#1c110a]/85 via-[#1c110a]/25 to-transparent" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 p-6 md:p-10 text-[#fff6e3]">
          {vendor.verified && (
            <span className="inline-block mb-3 text-caption font-bold px-2.5 py-1 rounded-full bg-[#ffe1a1] text-[#2b180d]">{tr("認證店家", "Verified")}</span>
          )}
          <h1 className="font-heading font-semibold text-[clamp(36px,5.5vw,72px)] leading-[1.04] tracking-[-0.02em]">{loc(vendor, "name")}</h1>
          {vendor.description && <p className="mt-2 max-w-2xl text-sm md:text-base opacity-90">{loc(vendor, "description")}</p>}
        </div>
      </section>

      {/* ── 店家資訊列 ── */}
      <div className="flex flex-wrap gap-3 text-sm">
        {rating && (
          <span className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full border border-ink bg-card">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" aria-hidden="true" />
            <span className="font-semibold">{rating.average}</span>
            <span className="text-muted-foreground">（{rating.count}+）</span>
          </span>
        )}
        {vendor.address && (
          <span className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full border border-ink bg-card">
            <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" /> {vendor.address}
          </span>
        )}
        {vendor.phone && (
          <a href={`tel:${vendor.phone}`} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full border border-ink bg-card hover:bg-secondary transition-colors">
            <Phone className="w-4 h-4 shrink-0" aria-hidden="true" /> {vendor.phone}
          </a>
        )}
      </div>

      {/* ── 提醒 ── */}
      <div className="grid gap-3 md:grid-cols-2">
        {vendor.typhoon_notice?.dates?.length ? (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 md:col-span-2">
            <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>{tr(`颱風警報：${vendor.typhoon_notice.dates.join("、")} 的訂單可能因停班停課取消（會自動全額退成平台點數）。`, `Typhoon warning: orders on ${vendor.typhoon_notice.dates.join(", ")} may be cancelled (automatic full refund as points).`)}</span>
          </div>
        ) : null}
        <div className="flex items-center gap-4 rounded-2xl border border-ink bg-accent p-4 text-sm">
          <Sparkles className="w-5 h-5 shrink-0 text-primary" aria-hidden="true" />
          <span className="flex-1">{tr("想吃的菜這家店沒有？許願看看，人數夠多店家就會考慮上架。", "Want a dish this vendor doesn't have? Make a wish — enough wishes and they may add it.")}</span>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setWishOpen(true)}>{tr("許願新菜", "Wish for a dish")}</Button>
        </div>
        {vendor.phone && (
          <div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span>{tr(`如有餐點變動，請致電 ${vendor.phone} 確認！`, `If your order changes, please call ${vendor.phone} to confirm.`)}</span>
          </div>
        )}
      </div>
      <OpenWishDialog open={wishOpen} onOpenChange={setWishOpen} vendorId={vendor.id} vendorName={loc(vendor, "name")} />

      {/* ── 菜單 ── */}
      <div>
        <h2 className="font-heading text-3xl md:text-4xl font-semibold mb-6">{tr("菜單", "Menu")}</h2>
        {itemsLoading ? (
          <SkeletonBlocks count={2} height={72} className="space-y-1" />
        ) : items.length === 0 ? (
          <EmptyState size="compact" icon={<UtensilsCrossed size={32} />} title={tr("這家店家目前沒有上架品項", "This vendor has no items available right now")} />
        ) : (
          <>
            {showCatalogs && (
              <div className="mb-5 flex gap-2 overflow-x-auto bb-thin-scroll" role="tablist" aria-label={tr("菜單目錄", "Menu catalogs")}>
                {catalogGroups.map((g) => (
                  <button
                    key={g.catalog || "_none"}
                    type="button"
                    role="tab"
                    aria-selected={effectiveCatalog === g.catalog}
                    onClick={() => {
                      setActiveCatalog(g.catalog);
                      setActiveCategory(null);
                    }}
                    className={cn(
                      "shrink-0 h-11 px-5 rounded-full text-base font-semibold border transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      effectiveCatalog === g.catalog ? "border-ink bg-primary text-primary-foreground" : "border-ink bg-card hover:bg-accent"
                    )}
                  >
                    {g.catalog ? loc(g.categories[0].items[0], "catalog") : tr("其他", "Other")}
                  </button>
                ))}
              </div>
            )}

            {categories.length > 1 && (
              <div className="sticky top-16 z-10 -mx-4 md:-mx-6 mb-6 bg-background/90 backdrop-blur-md border-b border-border">
                <div className="flex gap-2 overflow-x-auto px-4 md:px-6 py-3 bb-thin-scroll">
                  {categories.map(([category]) => (
                    <button
                      key={category}
                      type="button"
                      aria-pressed={effectiveCategory === category}
                      onClick={() => {
                        setActiveCategory(category);
                        scrollToCategory(category);
                      }}
                      className={cn(
                        "shrink-0 h-10 px-4 rounded-full text-sm font-semibold border transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        effectiveCategory === category
                          ? "border-ink bg-secondary text-secondary-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                      )}
                    >
                      {category}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-12">
              {categories.map(([category, categoryItems]) => (
                <section key={category} id={categoryAnchorId(category)} className="scroll-mt-36">
                  <h3 className="font-heading text-2xl font-semibold mb-4 flex items-baseline gap-3">
                    {category}
                    <span className="text-sm font-normal text-muted-foreground">{categoryItems.length}</span>
                  </h3>
                  <ul className="grid gap-x-10 md:grid-cols-2">
                    {categoryItems.map((item) => (
                      /* 整列是連結，「加入購物車」是旁邊的獨立按鈕（原本 button 包在 a 裡，互動元素不能巢狀） */
                      <li key={item.id} className="flex items-center gap-4 py-5 border-b border-border">
                        <button type="button" onClick={() => setOpenItemId(item.id)} className="group text-left flex items-center gap-4 min-w-0 flex-1 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                          <span className="w-20 h-20 md:w-24 md:h-24 rounded-2xl overflow-hidden border border-ink bg-secondary shrink-0 flex items-center justify-center">
                            {item.image
                              ? <img src={item.image} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.08]" />
                              : <UtensilsCrossed className="w-6 h-6 text-secondary-foreground/50" strokeWidth={1.5} aria-hidden="true" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block font-heading text-lg font-semibold group-hover:underline underline-offset-4 decoration-1">{loc(item, "name")}</span>
                            {loc(item, "description") && (
                              <span className="block text-sm text-muted-foreground line-clamp-2 mt-0.5">{loc(item, "description")}</span>
                            )}
                            {item.dietary_tags?.length > 0 && (
                              <span className="flex flex-wrap gap-1 mt-1.5">
                                {item.dietary_tags.map((tag) => (
                                  <span key={tag} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                                    {tr(tag, tagEn(tag))}
                                  </span>
                                ))}
                              </span>
                            )}
                            <span className="flex items-baseline gap-2 mt-1.5">
                              <span className="font-heading text-xl font-semibold">NT${item.price}</span>
                              {isBento(item) && <span className="text-xs text-muted-foreground">{tr("點圖選主菜、配菜、飯量", "Pick main, sides & rice")}</span>}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => quickAdd(e, item)}
                          aria-label={tr(`加入購物車：${loc(item, "name")}`, `Add to cart: ${loc(item, "name")}`)}
                          className="shrink-0 w-11 h-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary-hover active:scale-95 transition-[transform,background-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        >
                          <Plus className="w-5 h-5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 點品項跳出點餐視窗（同品項頁的內容），加入購物車後自動關閉 */}
      <Dialog open={!!openItemId} onOpenChange={(open) => !open && setOpenItemId(null)}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogTitle className="sr-only">{tr("點餐", "Order")}</DialogTitle>
          {openItemId && <MenuItemOrder id={openItemId} dialog onAdded={() => setOpenItemId(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

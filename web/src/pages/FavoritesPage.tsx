import { useEffect, useMemo, useState } from "react";
import { rememberReturnPath } from "@/lib/returnPath";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { Heart, UtensilsCrossed } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import PageHero from "@/components/PageHero";
import VendorCardHeader from "@/components/VendorCardHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ds";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { db } from "@/lib/firebase";
import { useFavorites } from "@/hooks/useFavorites";
import { useVendors } from "@/hooks/useVendors";
import { useAuth } from "@/hooks/useAuth";
import { loc, tr, useI18n } from "@/lib/i18n";
import { applyEarlyBirdPrice, discountText } from "@/lib/pricing";
import { itemMinPrice } from "@/lib/bento";
import { itemWindows, nextAvailablePickup, setPreferredPickup } from "@/lib/pickupSlots";
import type { MealPlan, MenuItem, RewardStatus, Vendor } from "@/types";

/**
 * 我的最愛（§4.5）：收藏的店家依收藏時間排序（新的在前），每家列出可預購品項與計畫。
 * 僅本人可讀（firestore.rules users/{uid}/favorites）。
 */
export default function FavoritesPage() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { favorites, loading } = useFavorites();
  const { data: vendors = [] } = useVendors();
  const vendorIds = favorites.map((f) => f.vendor_id);
  const key = vendorIds.join(",");
  const [rewardStatuses, setRewardStatuses] = useState<Map<string, RewardStatus>>(new Map());

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "rewardStatus"), (snap) => {
      setRewardStatuses(new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as RewardStatus])));
    }, () => setRewardStatuses(new Map()));
    return () => unsub();
  }, []);

  // Firestore 的 in 查詢一次最多 30 個值，分批查
  const { data: catalog } = useQuery({
    queryKey: ["favoriteCatalog", key],
    queryFn: async () => {
      const items: MenuItem[] = [];
      const plans: MealPlan[] = [];
      for (let i = 0; i < vendorIds.length; i += 30) {
        const chunk = vendorIds.slice(i, i + 30);
        const [itemSnap, planSnap] = await Promise.all([
          getDocs(query(collection(db, "menu_items"), where("vendor_id", "in", chunk))),
          getDocs(query(collection(db, "meal_plans"), where("vendor_id", "in", chunk))),
        ]);
        itemSnap.docs.forEach((d) => items.push({ id: d.id, ...d.data() } as MenuItem));
        planSnap.docs.forEach((d) => plans.push({ id: d.id, ...d.data() } as MealPlan));
      }
      return { items: items.filter((i) => i.is_available !== false), plans };
    },
    enabled: vendorIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const groups = useMemo(() => {
    const byId = new Map(vendors.map((v) => [v.id, v]));
    return favorites
      .map((f) => byId.get(f.vendor_id))
      .filter((v): v is Vendor => !!v)
      .map((vendor) => ({
        vendor,
        next: nextAvailablePickup(vendor),
        items: (catalog?.items || []).filter((i) => i.vendor_id === vendor.id && itemWindows(vendor, i).length > 0),
        plans: (catalog?.plans || []).filter((p) => p.vendor_id === vendor.id),
      }));
  }, [favorites, vendors, catalog]);

  function openItem(item: MenuItem, vendor: Vendor) {
    const next = nextAvailablePickup(vendor);
    if (next) setPreferredPickup({ date: next.date, window: itemWindows(vendor, item)[0] ?? next.window });
    navigate(`/item/${item.id}`);
  }

  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader active="favorites" />
      <PageHero
        eyebrow={tr("收藏的店家", "Saved vendors")}
        title={tr("我的最愛", "Favorites")}
        description={tr("在預購餐點的店家卡片按愛心就能收藏；這裡集中列出它們目前可預購的品項與方案。", "Tap the heart on any vendor card to save it. Their bookable meals and plans show up here.")}
      />
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-8 space-y-5">
        {!authLoading && !user ? (
          <EmptyState
            icon={<Heart size={32} />}
            title={tr("請先登入", "Please sign in")}
            description={tr("登入後就能收藏喜歡的店家。", "Sign in to save your favorite vendors.")}
            action={<Button asChild><Link href="/login" onClick={() => rememberReturnPath()}>{tr("前往登入", "Sign in")}</Link></Button>}
          />
        ) : loading ? (
          <SkeletonBlocks count={2} height={200} className="space-y-4" />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Heart size={32} />}
            title={tr("還沒有收藏的店家", "No favorites yet")}
            description={tr("到「預購餐點」在店家名稱旁按愛心收藏。", "Go to Pre-order and tap the heart next to a vendor's name.")}
            action={<Button asChild><Link href="/home">{tr("去逛逛", "Browse vendors")}</Link></Button>}
          />
        ) : (
          groups.map(({ vendor, next, items, plans }) => (
            <article key={vendor.id} className="bg-card rounded-3xl border border-ink p-4 md:p-5">
              <VendorCardHeader
                vendor={vendor}
                reward={rewardStatuses.get(vendor.id)}
                subtitle={next ? t(`最快 ${next.date.slice(5).replace("-", "/")} 可取餐・${items.length} 項單點、${plans.length} 個方案`, `Earliest pickup ${next.date.slice(5)} · ${items.length} meals, ${plans.length} plans`) : t("目前沒有可預購的日期", "Nothing bookable right now")}
              />
              {items.length > 0 && (
                <ul className="flex gap-4 overflow-x-auto pb-2 bb-thin-scroll">
                  {items.map((item) => {
                    const base = itemMinPrice(item);
                    const { lockedPrice, discountPercent } = next ? applyEarlyBirdPrice(base, next.date) : { lockedPrice: base, discountPercent: 0 };
                    return (
                      <li key={item.id} className="shrink-0 w-[172px]">
                        <button type="button" onClick={() => openItem(item, vendor)} className="group w-full text-left rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span className="relative block aspect-[4/3] rounded-2xl overflow-hidden border border-ink bg-secondary">
                            {item.image
                              ? <img src={item.image} alt="" loading="lazy" className="w-full h-full object-cover" />
                              : <span className="w-full h-full flex items-center justify-center"><UtensilsCrossed className="w-7 h-7 text-secondary-foreground/50" aria-hidden="true" /></span>}
                            {discountPercent > 0 && <span className="absolute top-2 left-2 text-caption font-bold px-2 py-0.5 rounded-full bg-brand text-[#2b180d]">{discountText(discountPercent)}</span>}
                          </span>
                          <span className="block mt-2 text-sm font-semibold truncate">{loc(item, "name")}</span>
                          <span className="font-heading text-lg font-semibold">NT${lockedPrice}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {plans.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {plans.map((plan) => (
                    <Link key={plan.id} href="/plans" className="text-xs font-semibold px-3 py-1.5 rounded-full border border-ink bg-accent hover:bg-secondary">
                      {loc(plan, "label")}{t("：", ": ")}{loc(plan, "name")}・NT${plan.price_per_meal}{t(" / 餐", " / meal")}
                    </Link>
                  ))}
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </div>
  );
}

import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { ArrowLeft, MapPin, Phone, Store, UtensilsCrossed } from "lucide-react";
import { db } from "@/lib/firebase";
import type { Vendor, MenuItem } from "@/types";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";

// 商家頁 — 也兼商品(鎖定品項)列表頁：顯示這家商家所有可預購品項。
export default function VendorPage() {
  const { id } = useParams<{ id: string }>();

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

  if (vendorLoading) {
    return <SkeletonBlocks height={192} />;
  }

  if (!vendor) {
    return (
      <EmptyState
        icon={<Store size={32} />}
        title="找不到這個商家"
        description="可能已停止營業，或連結有誤。"
        action={<Button variant="outline" asChild><Link href="/vendors">回商家清單</Link></Button>}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/vendors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> 回商家清單
      </Link>

      <div className="bg-white rounded-xl border border-border p-5">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full sm:w-32 h-32 rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center shrink-0">
            <Store className="h-12 w-12 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold mb-1">{vendor.name}</h1>
            {vendor.description && <p className="text-sm text-muted-foreground mb-3">{vendor.description}</p>}
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
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold mb-3">品項</h2>
        {itemsLoading ? (
          <SkeletonBlocks count={2} height={96} className="grid grid-cols-1 sm:grid-cols-2 gap-3" />
        ) : items.length === 0 ? (
          <EmptyState size="compact" icon={<UtensilsCrossed size={32} />} title="這家商家目前沒有上架品項" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/item/${item.id}`}
                className="block bg-white rounded-xl border border-border p-4 shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm mb-0.5 truncate">{item.name}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                  </div>
                  <span className="text-sm font-bold text-orange-600 shrink-0">NT${item.price}</span>
                </div>
                {item.dietary_tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.dietary_tags.map((tag) => (
                      <span key={tag} className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

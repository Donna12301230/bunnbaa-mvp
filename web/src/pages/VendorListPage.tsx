import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { MapPin, Phone, Store } from "lucide-react";
import { db } from "@/lib/firebase";
import { isClean } from "@/lib/searchFilter";
import type { Vendor } from "@/types";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero, { HeroSearch } from "@/components/PageHero";

// 商家清單頁 — 消費者瀏覽所有上架商家。真實 vendors collection 沒有
// isApproved/isActive 這兩個欄位，用 status !== 'disabled' 頂替。
export default function VendorListPage() {
  const [search, setSearch] = useState("");

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const snap = await getDocs(collection(db, "vendors"));
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as Vendor)
        .filter((v) => v.status !== "disabled");
    },
    staleTime: 15 * 60 * 1000,
  });

  // 不雅字詞當作沒輸入搜尋字串處理，不特別跳錯誤訊息。
  const effectiveSearch = isClean(search) ? search : "";
  const filtered = vendors.filter(
    (v) => v.name.includes(effectiveSearch) || (v.description ?? "").includes(effectiveSearch)
  );

  return (
    <CustomerLayout
      hero={
        <PageHero title="商家" description="選一家商家看看他們的預購品項。">
          <HeroSearch id="vendorSearch" label="搜尋商家" value={search} onChange={setSearch} placeholder="搜尋商家名稱或介紹" />
        </PageHero>
      }
    >
      <div className="space-y-4">
        {isLoading ? (
          <SkeletonBlocks count={3} height={160} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Store size={32} />}
            title={search ? "找不到符合的商家" : "目前還沒有合作商家"}
            description={search ? "換個關鍵字試試看。" : "新商家上架後會出現在這裡。"}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((vendor) => (
              <Link
                key={vendor.id}
                href={`/vendor/${vendor.id}`}
                className="block bg-white rounded-xl border border-border p-4 shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                <div className="w-full h-28 rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center mb-3">
                  <Store className="h-10 w-10 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
                </div>
                <h3 className="font-semibold mb-1 truncate">{vendor.name}</h3>
                {vendor.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{vendor.description}</p>
                )}
                {vendor.address && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="w-3 h-3 shrink-0" />
                    <span className="truncate">{vendor.address}</span>
                  </div>
                )}
                {vendor.phone && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="w-3 h-3 shrink-0" />
                    <span>{vendor.phone}</span>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </CustomerLayout>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search, MapPin, Phone, Store } from "lucide-react";
import { mockVendors } from "@/lib/mockData";
import { isClean } from "@/lib/searchFilter";

// 商家清單頁 — 消費者瀏覽所有上架商家。
// TODO(firebase): queryFn 讀的是 mockData.ts 的假資料，之後接 Firestore
// 時把它換成 Vendor collection 的 query 即可（只讀 isApproved && isActive）。
export default function VendorListPage() {
  const [search, setSearch] = useState("");

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => mockVendors.filter((v) => v.isApproved && v.isActive),
    staleTime: 15 * 60 * 1000,
  });

  // 不雅字詞當作沒輸入搜尋字串處理，不特別跳錯誤訊息。
  const effectiveSearch = isClean(search) ? search : "";
  const filtered = vendors.filter(
    (v) => v.name.includes(effectiveSearch) || v.description.includes(effectiveSearch)
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold mb-1">商家</h1>
        <p className="text-sm text-muted-foreground">選一家商家看看他們的預購品項</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋商家名稱或介紹"
          className="w-full pl-9 pr-3 h-10 rounded-full border border-border bg-white text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Store className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>找不到符合的商家</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((vendor) => (
            <Link
              key={vendor.id}
              href={`/vendor/${vendor.id}`}
              className="block bg-white rounded-xl border border-border p-4 hover:border-orange-300 hover:shadow-sm transition-all"
            >
              <div className="w-full h-28 rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center text-4xl mb-3">
                🍱
              </div>
              <h3 className="font-semibold mb-1 truncate">{vendor.name}</h3>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{vendor.description}</p>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{vendor.address}</span>
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="w-3 h-3 shrink-0" />
                <span>{vendor.phone}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

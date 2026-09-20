import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, MapPin, Phone, Store } from "lucide-react";
import { mockVendors, mockMenuItems } from "@/lib/mockData";

// 商家頁 — 也兼商品(鎖定品項)列表頁：顯示這家商家所有可預購品項。
// TODO(firebase): queryFn 讀的是 mockData.ts 的假資料，之後接 Firestore 時
// 把它換成 Vendor doc get + MenuItem collection where(vendorId==, isAvailable==true) 即可。
export default function VendorPage() {
  const { id } = useParams<{ id: string }>();

  const { data: vendor, isLoading: vendorLoading } = useQuery({
    queryKey: ["vendor", id],
    queryFn: async () => mockVendors.find((v) => v.id === id) ?? null,
  });

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["vendorMenuItems", id],
    queryFn: async () => mockMenuItems.filter((m) => m.vendorId === id && m.isAvailable),
    enabled: !!id,
  });

  if (vendorLoading) {
    return <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />;
  }

  if (!vendor) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Store className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>找不到這個商家</p>
        <Link href="/vendors" className="text-sm text-orange-600 hover:underline mt-2 inline-block">
          回商家清單
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/vendors" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-4 h-4" /> 回商家清單
      </Link>

      <div className="bg-white rounded-xl border border-border p-5">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full sm:w-32 h-32 rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center text-5xl shrink-0">
            🍱
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold mb-1">{vendor.name}</h1>
            <p className="text-sm text-muted-foreground mb-3">{vendor.description}</p>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 shrink-0" /> {vendor.address}
              </span>
              <span className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 shrink-0" /> {vendor.phone}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-bold mb-3">品項</h2>
        {itemsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1, 2].map((i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">這家商家目前沒有上架品項</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/item/${item.id}`}
                className="block bg-white rounded-xl border border-border p-4 hover:border-orange-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm mb-0.5 truncate">{item.name}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.description}</p>
                  </div>
                  <span className="text-sm font-bold text-orange-600 shrink-0">NT${item.price}</span>
                </div>
                {item.dietaryTags?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {item.dietaryTags.map((tag) => (
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

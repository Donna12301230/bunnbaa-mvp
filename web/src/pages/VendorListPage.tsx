import { tr, loc } from "@/lib/i18n";
import { useState } from "react";
import { Link } from "wouter";
import { MapPin, Phone, Store } from "lucide-react";
import { isClean } from "@/lib/searchFilter";
import type { Vendor } from "@/types";
import { SkeletonBlocks } from "@/components/SkeletonBlocks";
import { EmptyState } from "@/components/ds";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero, { HeroSearch } from "@/components/PageHero";
import { useVendors } from "@/hooks/useVendors";
import { areaLabel, setSelectedArea, useSelectedArea, vendorInArea } from "@/lib/location";

// 商家清單頁 — 消費者瀏覽所有上架商家。真實 vendors collection 沒有
// isApproved/isActive 這兩個欄位，用 status !== 'disabled' 頂替。
export default function VendorListPage() {
  const [search, setSearch] = useState("");

  const { data: vendors = [], isLoading } = useVendors();

  // 不雅字詞當作沒輸入搜尋字串處理，不特別跳錯誤訊息。
  const effectiveSearch = isClean(search) ? search : "";
  const area = useSelectedArea();
  const filtered = vendors.filter(
    (v) =>
      vendorInArea(v, area) &&
      [v.name, v.description, v.name_en, v.description_en].some((text) => (text ?? "").toLowerCase().includes(effectiveSearch.toLowerCase()))
  );

  return (
    <CustomerLayout
      hero={
        <PageHero title={tr("商家", "Vendors")} description={tr("選一家商家看看他們的預購品項。", "Pick a vendor to see what you can pre-order.")}>
          <HeroSearch id="vendorSearch" label={tr("搜尋商家", "Search vendors")} value={search} onChange={setSearch} placeholder={tr("搜尋商家名稱或介紹", "Search by name or description")} />
        </PageHero>
      }
    >
      <div className="space-y-4">
        {area && (
          <p className="text-sm text-muted-foreground">
            {tr(`只顯示 ${areaLabel(area)} 的店家・`, `Showing vendors in ${areaLabel(area)} · `)}
            <button type="button" className="text-primary underline" onClick={() => setSelectedArea(null)}>{tr("顯示全部地區", "Show all areas")}</button>
          </p>
        )}
        {isLoading ? (
          <SkeletonBlocks count={3} height={160} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Store size={32} />}
            title={search || area ? tr("找不到符合的商家", "No matching vendors") : tr("目前還沒有合作商家", "No partner vendors yet")}
            description={search || area ? tr("換個關鍵字或地區試試看。", "Try a different keyword or area.") : tr("新商家上架後會出現在這裡。", "New vendors will show up here.")}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((vendor) => (
              <Link
                key={vendor.id}
                href={`/vendor/${vendor.id}`}
                className="block bg-white rounded-xl border border-border p-4 shadow-sm transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              >
                {vendor.cover_image ? (
                  <img src={vendor.cover_image} alt="" className="w-full h-28 rounded-lg object-cover mb-3" />
                ) : (
                  <div className="w-full h-28 rounded-lg bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center mb-3">
                    <Store className="h-10 w-10 text-orange-400" strokeWidth={1.75} aria-hidden="true" />
                  </div>
                )}
                <h3 className="font-semibold mb-1 truncate">{loc(vendor, "name")}</h3>
                {vendor.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{loc(vendor, "description")}</p>
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

import { tr, loc } from "@/lib/i18n";
import { useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, MapPin, Phone, Store } from "lucide-react";
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
        <PageHero eyebrow={tr("合作店家", "Partners")} title={tr("商家", "Vendors")} description={tr("選一家商家看看他們的預購品項。", "Pick a vendor to see what you can pre-order.")}>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-10">
            {filtered.map((vendor) => (
              <Link
                key={vendor.id}
                href={`/vendor/${vendor.id}`}
                className="group block rounded-[1.75rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
              >
                <div className="relative aspect-[4/3] rounded-[1.75rem] overflow-hidden border border-ink bg-secondary">
                  {vendor.cover_image ? (
                    <img src={vendor.cover_image} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-[900ms] ease-out group-hover:scale-[1.05] motion-reduce:transition-none" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Store className="h-12 w-12 text-secondary-foreground/60" strokeWidth={1.25} aria-hidden="true" />
                    </div>
                  )}
                  {vendor.verified && (
                    <span className="absolute top-3 left-3 text-caption font-bold px-2.5 py-1 rounded-full bg-card/95 border border-ink">{tr("認證商家", "Verified")}</span>
                  )}
                </div>
                <div className="flex items-start gap-3 mt-4">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-heading text-xl font-semibold truncate">{loc(vendor, "name")}</h3>
                    {vendor.description && (
                      <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">{loc(vendor, "description")}</p>
                    )}
                    {vendor.address && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1.5">
                        <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{vendor.address}</span>
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 w-11 h-11 rounded-full border border-ink flex items-center justify-center transition-[background-color,transform] duration-500 group-hover:bg-secondary group-hover:rotate-45" aria-hidden="true">
                    <ArrowUpRight className="w-5 h-5" />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </CustomerLayout>
  );
}

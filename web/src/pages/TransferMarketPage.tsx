import { useState } from "react";
import { Link } from "wouter";
import { Search, Clock, MapPin, ArrowRight } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  mockMarketplaceListings, mockMarketplaceReleased, mockMyMarketplaceListings,
} from "@/lib/mockData";

// 對應 UI草圖 Marketplace.dc.html「轉讓市集」。
// TODO(firebase): 目前是版面骨架 + 前端 local state 示意（我要接手／免費領取／
// 取消轉讓皆未寫回後端）。接後端時：
//   - 「我要接手」呼叫 claimResoldLock（functions/src/index.js）
//   - 「免費領取」2026-09-21 已有對應機制：firestore.rules 新增了「for_resale
//     的 lock 一旦 resale_deadline 已過，任何登入用戶可直接 updateDoc 把
//     status 改成 locked、buyer_uid 換自己、locked_price 設 0」，不用 Cloud
//     Function/排程。真實端到端範例在 ConsumerLockPage.tsx 的 handleClaimFree
//     （判斷邏輯：resale_deadline < now，同頁的 pickupWindowEnd() 算法可沿用）
//   - 「取消轉讓」目前沒有對應的 Cloud Function／規則
const CATEGORIES: { id: "all" | "fit" | "veg" | "seafood"; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "fit", label: "健身餐" },
  { id: "veg", label: "蔬食" },
  { id: "seafood", label: "海鮮" },
];

export default function TransferMarketPage() {
  const { toast } = useToast();
  const [browseTab, setBrowseTab] = useState<"browse" | "mine">("browse");
  const [category, setCategory] = useState<"all" | "fit" | "veg" | "seafood">("all");
  const [search, setSearch] = useState("");
  const [claimed, setClaimed] = useState<Record<string, boolean>>({});
  const [released, setReleased] = useState<Record<string, boolean>>({});
  const [canceled, setCanceled] = useState<Record<string, boolean>>({});

  const listings = mockMarketplaceListings.filter(
    l => category === "all" || l.category === category
  );

  function toggleClaim(id: string) {
    setClaimed(prev => {
      const next = !prev[id];
      toast({
        title: next ? "已接手" : "已取消接手",
        description: next ? "示意畫面：實際接手需串接 claimResoldLock。" : undefined,
      });
      return { ...prev, [id]: next };
    });
  }

  function toggleReleased(id: string) {
    setReleased(prev => {
      const next = !prev[id];
      toast({ title: next ? "已領取" : "已取消領取", description: next ? "示意畫面：$0 元免費領取尚未接後端。" : undefined });
      return { ...prev, [id]: next };
    });
  }

  function cancelMine(id: string) {
    setCanceled(prev => ({ ...prev, [id]: true }));
    toast({ title: "已取消轉讓" });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader active="transfer" />

      {/* ── Hero ── */}
      <section className="bg-gradient-to-br from-amber-400 to-orange-400 px-4 md:px-6 py-10">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-6 flex-wrap">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-1.5">轉讓市集</h1>
            <p className="text-sm text-amber-50">同學安全轉讓已鎖定的方案，全額入袋；逾時沒人接手，系統會自動開放 $0 元供人領取。</p>
          </div>
          <div className="flex items-center gap-2 bg-white rounded-2xl p-1.5 pl-4 min-w-[300px]">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <label htmlFor="marketplaceSearch" className="sr-only">搜尋轉讓項目</label>
            <input
              id="marketplaceSearch"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜尋方案、店家或同學名稱"
              className="flex-1 border-none outline-none bg-transparent text-sm py-2"
            />
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white rounded-xl">搜尋</Button>
          </div>
        </div>
      </section>

      {/* ── Body ── */}
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-8 space-y-6">
        <div className="flex gap-2">
          <button
            onClick={() => setBrowseTab("browse")}
            className={`text-sm font-bold px-[18px] py-2.5 rounded-full transition-colors ${
              browseTab === "browse" ? "bg-orange-500 text-white" : "bg-white text-muted-foreground border border-border"
            }`}
          >
            瀏覽轉讓
          </button>
          <button
            onClick={() => setBrowseTab("mine")}
            className={`text-sm font-bold px-[18px] py-2.5 rounded-full transition-colors ${
              browseTab === "mine" ? "bg-orange-500 text-white" : "bg-white text-muted-foreground border border-border"
            }`}
          >
            我的轉讓
          </button>
        </div>

        {browseTab === "browse" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3.5">
              <div className="flex gap-2 flex-wrap">
                {CATEGORIES.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setCategory(c.id)}
                    className={`text-sm font-bold px-4 py-2 rounded-full border transition-colors ${
                      category === c.id ? "bg-orange-500 border-orange-500 text-white" : "bg-white border-border text-muted-foreground"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <span className="text-sm text-muted-foreground font-semibold">目前 {listings.length} 筆轉讓中</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {listings.map(item => {
                const isClaimed = !!claimed[item.id];
                return (
                  <article key={item.id} className="rounded-2xl bg-white border border-border overflow-hidden flex flex-col">
                    <div className="relative h-[130px] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center text-4xl">
                      🍱
                      <span className="absolute top-2.5 right-2.5 flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-900 text-white">
                        <Clock className="w-3 h-3" /> {item.expiresIn}後截止
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 p-4 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-orange-100 flex items-center justify-center text-[11px] font-bold text-orange-600 shrink-0">
                          {item.sellerInitial}
                        </div>
                        <span className="text-xs font-medium text-muted-foreground">{item.seller} 轉讓</span>
                      </div>
                      <h3 className="text-[15px] font-bold leading-snug">{item.title}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" /> {item.location}
                      </div>
                      <div className="flex items-center justify-between mt-auto pt-1.5">
                        <div>
                          <span className="text-xs text-gray-400 line-through mr-1.5">${item.original}</span>
                          <span className="text-lg font-extrabold">${item.resale}</span>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => toggleClaim(item.id)}
                          className={isClaimed ? "bg-green-700 hover:bg-green-800 text-white" : "bg-orange-500 hover:bg-orange-600 text-white"}
                        >
                          {isClaimed ? "已接手" : "我要接手"}
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="flex items-center gap-2.5 pt-2 flex-wrap">
              <Clock className="w-5 h-5" />
              <h2 className="text-lg font-bold">已逾期・開放 $0 元領取</h2>
              <span className="text-xs text-muted-foreground">取餐時段結束仍未被接手，系統自動開放給任何人免費領取，先到先得</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {mockMarketplaceReleased.map(item => {
                const isReleased = !!released[item.id];
                return (
                  <article key={item.id} className="rounded-2xl bg-white border border-border overflow-hidden flex flex-col">
                    <div className="relative h-[130px] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center text-4xl">
                      🍱
                      <span className="absolute top-2.5 right-2.5 text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-900 text-white">
                        已逾期・開放中
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 p-4 flex-1">
                      <h3 className="text-[15px] font-bold leading-snug">{item.title}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" /> {item.location}
                      </div>
                      <div className="flex items-center justify-between mt-auto pt-1.5">
                        <div>
                          <span className="text-xs text-gray-400 line-through mr-1.5">${item.original}</span>
                          <span className="text-lg font-extrabold">$0</span>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => toggleReleased(item.id)}
                          className={isReleased ? "bg-green-700 hover:bg-green-800 text-white" : "bg-gray-900 hover:bg-gray-800 text-white"}
                        >
                          {isReleased ? "已領取" : "免費領取"}
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}

        {browseTab === "mine" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3.5">
              <span className="text-sm text-muted-foreground font-semibold">
                你目前有 {mockMyMarketplaceListings.filter(i => !canceled[i.id]).length} 筆商品在轉讓市集
              </span>
              <Link href="/my-bookings" className="text-sm font-bold text-orange-600 flex items-center gap-1 hover:text-orange-700">
                從我的餐點新增轉讓 <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {mockMyMarketplaceListings.map(item => {
                const isCanceled = !!canceled[item.id];
                const status = isCanceled ? "已取消" : item.outcome === "claimed" ? "已被接手" : "轉讓中";
                const statusClass = isCanceled
                  ? "bg-gray-200 text-gray-500"
                  : item.outcome === "claimed"
                  ? "bg-green-100 text-green-700"
                  : "bg-orange-500 text-white";
                return (
                  <article key={item.id} className="rounded-2xl bg-white border border-border overflow-hidden flex flex-col">
                    <div className="relative h-[130px] bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center text-4xl">
                      🍱
                      <span className={`absolute top-2.5 right-2.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${statusClass}`}>
                        {status}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5 p-4 flex-1">
                      <h3 className="text-[15px] font-bold leading-snug">{item.title}</h3>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" /> {item.location}
                      </div>
                      <div className="flex items-center justify-between mt-auto pt-1.5">
                        <div>
                          <span className="text-xs text-gray-400 line-through mr-1.5">${item.original}</span>
                          <span className="text-lg font-extrabold">${item.resale}</span>
                        </div>
                        {!isCanceled && item.outcome === "listed" && (
                          <Button size="sm" variant="outline" className="border-red-400 text-red-600 hover:bg-red-50" onClick={() => cancelMine(item.id)}>
                            取消轉讓
                          </Button>
                        )}
                        {isCanceled && <span className="text-xs font-bold text-gray-400">已取消</span>}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

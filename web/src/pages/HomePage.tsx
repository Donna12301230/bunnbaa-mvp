import { useQuery } from "@tanstack/react-query";
import { mockVendors, mockMenuItems } from "@/lib/mockData";
import { isClean } from "@/lib/searchFilter";
import CustomerLayout from "@/components/CustomerLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  MapPin, Phone, Store, Search, Shuffle, ClipboardList, ShoppingCart,
  Users, Clock, X, TrendingUp, History, UtensilsCrossed, Plus,
} from "lucide-react";
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useCart } from "@/hooks/useCart";
import type { VendorData, MenuItemData } from "@/types";
import { useToast } from "@/hooks/use-toast";

// Ported from BunnBaa Parse_Ref's client/src/pages/home.tsx.
// TODO(firebase): the two useQuery calls below read static mockData instead
// of Parse.Query("Vendor")/Parse.Query("MenuItem") — swap for Firestore reads.

// ── LocalStorage helpers ────────────────────────────────────────────────────
const HISTORY_KEY = "obento_search_history";
const RANK_KEY    = "obento_search_rank";

function getHistory(): string[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]"); } catch { return []; }
}
function getRankMap(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(RANK_KEY) ?? "{}"); } catch { return {}; }
}
function logSearchLocal(keyword: string) {
  const k = keyword.trim();
  if (!k) return;
  const h = getHistory().filter(x => x !== k);
  localStorage.setItem(HISTORY_KEY, JSON.stringify([k, ...h].slice(0, 10)));
  const r = getRankMap();
  r[k] = (r[k] ?? 0) + 1;
  localStorage.setItem(RANK_KEY, JSON.stringify(r));
}
function getTopRanks(n: number): { keyword: string; count: number }[] {
  return Object.entries(getRankMap())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([keyword, count]) => ({ keyword, count }));
}

function timeToMins(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minsToTime(mins: number): string {
  const h = Math.floor(((mins % 1440) + 1440) % 1440 / 60);
  const m = ((mins % 1440) + 1440) % 1440 % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const ORDER_DEADLINE_OFFSET = 30; // 營業結束前 N 分鐘截止

function getTodayBadge(vendor: VendorData): { label: string; className: string; style?: React.CSSProperties } {
  const openStyle: React.CSSProperties = { background: "#8B4A1C" };
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const todayWeekday = now.getDay();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  // 指定公休日優先
  if (vendor.holidays && vendor.holidays.includes(todayStr)) {
    return { label: "今日公休", className: "bg-gray-400 text-white", style: undefined };
  }

  // 新版 businessHours
  if (vendor.businessHours && vendor.businessHours.length > 0) {
    const h = vendor.businessHours.find(bh => bh.weekday === todayWeekday);
    if (!h || !h.open) {
      return { label: "今日休息", className: "bg-gray-400 text-white", style: undefined };
    }
    const deadlineMins = timeToMins(h.closeTime) - ORDER_DEADLINE_OFFSET;
    if (nowMins < timeToMins(h.openTime)) {
      return { label: `${h.openTime} 起接單`, className: "text-white", style: openStyle };
    }
    if (nowMins > deadlineMins) {
      return { label: "今日截止", className: "bg-gray-400 text-white", style: undefined };
    }
    return { label: `訂餐至 ${minsToTime(deadlineMins)}`, className: "text-white", style: openStyle };
  }

  // 向下相容舊版 orderWeekdays
  if (vendor.orderWeekdays && vendor.orderWeekdays.length > 0) {
    return vendor.orderWeekdays.includes(todayWeekday)
      ? { label: "今日開放", className: "text-white", style: openStyle }
      : { label: "今日休息", className: "bg-gray-400 text-white", style: undefined };
  }

  return { label: "接單中", className: "text-white", style: openStyle };
}

// ── FlipCard ────────────────────────────────────────────────────────────────
interface RandomItem { itemId: string; itemName: string; price: number; image?: string; vendorId: string; vendorName: string; }

function FlipCard({ item, onNavigate }: { item: RandomItem; onNavigate: () => void }) {
  const [flipped, setFlipped] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className="cursor-pointer w-full"
      style={{ perspective: "1000px", aspectRatio: "1146 / 1566" }}
      onClick={() => { if (!flipped) setFlipped(true); else onNavigate(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ position: "relative", width: "100%", height: "100%", transformStyle: "preserve-3d", transition: "transform 0.5s ease", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
        <div style={{ backfaceVisibility: "hidden", position: "absolute", inset: 0 }} className="rounded-xl shadow-md overflow-hidden">
          <img src="/卡.png" alt="翻牌" className="w-full h-full object-cover" />
        </div>
        <div style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)", position: "absolute", inset: 0 }} className="rounded-xl shadow-md overflow-hidden relative">
          {item.image
            ? <img src={item.image} alt={item.itemName} className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center bg-orange-50"><span className="text-4xl">🍱</span></div>}
          <div className="absolute inset-0 flex flex-col justify-end transition-opacity duration-200" style={{ opacity: hovered ? 1 : 0, background: "linear-gradient(to top, rgba(139,74,28,0.92) 0%, rgba(139,74,28,0.4) 60%, transparent 100%)" }}>
            <div className="p-2 space-y-0.5">
              <div className="font-bold text-xs text-white line-clamp-1">{item.itemName}</div>
              <div className="text-xs font-semibold" style={{ color: "#EFA010" }}>NT$ {item.price}</div>
              <div className="text-xs text-white/80 line-clamp-1">{item.vendorName}</div>
              <div className="text-xs text-white/70">點擊前往 →</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Home ────────────────────────────────────────────────────────────────────
export default function HomePage() {
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [focused, setFocused] = useState(false);
  const [searchWarn, setSearchWarn] = useState("");
  const [history, setHistory] = useState<string[]>(() => getHistory());
  const [topRanks, setTopRanks] = useState<{ keyword: string; count: number }[]>(() => getTopRanks(8));
  const [randomItems, setRandomItems] = useState<RandomItem[]>([]);
  const [addingItem, setAddingItem] = useState<{ menuItem: MenuItemData; vendorId: string } | null>(null);
  const [addNote, setAddNote] = useState("");
  const [, navigate] = useLocation();
  const { count, addItem } = useCart();
  const { toast } = useToast();
  const searchRef = useRef<HTMLDivElement>(null);

  const { data: vendors = [], isLoading } = useQuery({
    queryKey: ["vendors", "approved"],
    queryFn: async () => mockVendors.filter(v => v.isApproved && v.isActive),
    staleTime: 15 * 60 * 1000,
  });

  const { data: menuItems = [] } = useQuery({
    queryKey: ["menuItems", "all"],
    queryFn: async () => mockMenuItems.filter(i => i.isAvailable),
    staleTime: 10 * 60 * 1000,
  });

  const deal = useCallback((items: MenuItemData[]) => {
    if (items.length === 0) return;
    const shuffled = [...items].sort(() => Math.random() - 0.5);
    setRandomItems(shuffled.slice(0, Math.min(5, shuffled.length)).map(item => {
      const vendorData = vendors.find(v => v.id === item.vendorId);
      return { itemId: item.id, itemName: item.name || "未命名", price: item.price || 0, image: item.image, vendorId: item.vendorId ?? "", vendorName: vendorData?.name ?? "未知店家" };
    }));
  }, [vendors]);

  useEffect(() => {
    if (menuItems.length > 0 && randomItems.length === 0) deal(menuItems);
  }, [menuItems]);

  // 關閉 dropdown（點外部）
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function submitSearch(keyword: string) {
    const k = keyword.trim();
    if (!k) return;
    if (!isClean(k)) {
      setSearchWarn("搜尋內容含有不適當字詞，請重新輸入。");
      setSearchInput("");
      return;
    }
    setSearchWarn("");
    logSearchLocal(k);
    setHistory(getHistory());
    setTopRanks(getTopRanks(8));
    setSubmittedSearch(k);
    setSearchInput(k);
    setFocused(false);
  }

  function clearSearch() {
    setSubmittedSearch("");
    setSearchInput("");
    setSearchWarn("");
  }

  function clearHistory() {
    localStorage.removeItem(HISTORY_KEY);
    setHistory([]);
  }

  const today = new Date().getDay();
  const todayStr = new Date().toISOString().slice(0, 10);
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const isOpenToday = (v: VendorData) => {
    if (v.holidays?.includes(todayStr)) return false;
    if (v.businessHours && v.businessHours.length > 0) {
      const h = v.businessHours.find(bh => bh.weekday === today);
      if (!h?.open) return false;
      const deadlineMins = timeToMins(h.closeTime) - ORDER_DEADLINE_OFFSET;
      return nowMins >= timeToMins(h.openTime) && nowMins <= deadlineMins;
    }
    return !v.orderWeekdays?.length || v.orderWeekdays.includes(today);
  };

  // 即時建議（input 有文字時）
  const suggestions = searchInput.trim()
    ? Array.from(new Set([
        ...menuItems.filter(i => i.name.includes(searchInput.trim())).map(i => i.name),
        ...vendors.filter(v => v.name.includes(searchInput.trim())).map(v => v.name),
      ])).slice(0, 6)
    : [];

  // 搜尋結果
  const matchedItems = submittedSearch
    ? menuItems.filter(i => i.name.includes(submittedSearch))
    : [];

  const matchedVendors = submittedSearch
    ? vendors.filter(v => v.name.includes(submittedSearch) || v.description.includes(submittedSearch) || v.address.includes(submittedSearch)).sort((a, b) => Number(isOpenToday(b)) - Number(isOpenToday(a)))
    : vendors.sort((a, b) => Number(isOpenToday(b)) - Number(isOpenToday(a)));

  const showDropdown = focused && (suggestions.length > 0 || history.length > 0 || topRanks.length > 0);

  return (
    <CustomerLayout>
      {/* Hero */}
      <div className="rounded-2xl p-4 md:p-8 mb-3 md:mb-6" style={{ background: "#EFA010" }}>
        <h2 className="text-xl md:text-3xl font-bold mb-0.5" style={{ color: "#8B4A1C" }}>今天吃什麼？</h2>
        <p className="mb-3 text-sm md:text-base hidden sm:block" style={{ color: "#8B4A1C" }}>提前預訂、享早鳥優惠，便當準時取餐免等候</p>

        {/* 搜尋框 */}
        <div className="relative" ref={searchRef}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="搜尋餐點或店家..."
                className="pl-9 pr-8 bg-white text-gray-800 h-9"
                value={searchInput}
                onChange={e => { setSearchInput(e.target.value); if (!e.target.value) setSubmittedSearch(""); }}
                onFocus={() => setFocused(true)}
                onKeyDown={e => { if (e.key === "Enter" && searchInput.trim()) submitSearch(searchInput); }}
              />
              {searchInput && (
                <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={clearSearch}>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              className="px-3 h-9 rounded-md bg-[#8B4A1C] text-white text-sm font-medium hover:bg-[#7a3f18] transition-colors shrink-0"
              onClick={() => { if (searchInput.trim()) submitSearch(searchInput); }}
            >
              搜尋
            </button>
          </div>

          {/* 不雅字警告 */}
          {searchWarn && (
            <p className="text-xs text-red-600 mt-1.5 flex items-center gap-1">
              <X className="w-3 h-3" /> {searchWarn}
            </p>
          )}

          {/* Dropdown */}
          {showDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 overflow-hidden max-h-80 overflow-y-auto">
              {/* 即時建議 */}
              {suggestions.length > 0 && (
                <div>
                  {suggestions.map(s => (
                    <button
                      key={s}
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-left hover:bg-orange-50 transition-colors"
                      onMouseDown={() => submitSearch(s)}
                    >
                      <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="truncate">{s}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* 無建議時顯示 history + rank */}
              {suggestions.length === 0 && (
                <>
                  {history.length > 0 && (
                    <div className="px-4 pt-3 pb-1">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold text-gray-500 flex items-center gap-1">
                          <History className="w-3 h-3" /> 最近搜尋
                        </span>
                        <button className="text-xs text-gray-400 hover:text-gray-600" onMouseDown={clearHistory}>清除</button>
                      </div>
                      <div className="flex flex-wrap gap-1.5 pb-2">
                        {history.map(h => (
                          <button
                            key={h}
                            className="px-2.5 py-1 rounded-full text-xs bg-gray-100 text-gray-700 hover:bg-orange-100 hover:text-orange-700 transition-colors"
                            onMouseDown={() => submitSearch(h)}
                          >
                            {h}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {topRanks.length > 0 && (
                    <div className="px-4 pt-2 pb-3 border-t border-gray-50">
                      <div className="flex items-center gap-1 mb-2">
                        <TrendingUp className="w-3 h-3 text-orange-500" />
                        <span className="text-xs font-semibold text-gray-500">熱門搜尋</span>
                      </div>
                      <div className="space-y-0.5">
                        {topRanks.map((r, idx) => (
                          <button
                            key={r.keyword}
                            className="w-full flex items-center gap-2.5 py-1.5 text-sm text-left hover:bg-orange-50 rounded-lg px-1 transition-colors"
                            onMouseDown={() => submitSearch(r.keyword)}
                          >
                            <span className={`w-4 text-center text-xs font-bold shrink-0 ${idx < 3 ? "text-orange-500" : "text-gray-400"}`}>{idx + 1}</span>
                            <span className="truncate text-gray-700">{r.keyword}</span>
                            <span className="ml-auto text-xs text-gray-400 shrink-0">{r.count} 次</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 快捷操作列 — 手機版 */}
      <div className="grid grid-cols-3 gap-2 mb-4 sm:hidden">
        {[
          { icon: ClipboardList, label: "我的訂單", path: "/my-orders", badge: 0 },
          { icon: ShoppingCart, label: "購物車", path: "/cart", badge: count },
          { icon: Users, label: "開團訂餐", path: "/group-orders", badge: 0 },
        ].map(({ icon: Icon, label, path, badge }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className="relative flex flex-col items-center justify-center gap-1 bg-white rounded-xl py-3 shadow-sm border text-gray-700 active:bg-gray-50"
          >
            <Icon className="w-5 h-5 text-orange-500" />
            <span className="text-xs font-medium">{label}</span>
            {badge > 0 && (
              <span className="absolute top-2 right-3 w-4 h-4 bg-orange-500 text-white text-[10px] rounded-full flex items-center justify-center">{badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* 搜尋結果 */}
      {submittedSearch && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-1.5">
              <Search className="w-4 h-4 text-orange-500" />
              「{submittedSearch}」的搜尋結果
            </h3>
            <button className="text-xs text-muted-foreground flex items-center gap-0.5 hover:text-gray-700" onClick={clearSearch}>
              <X className="w-3 h-3" /> 清除搜尋
            </button>
          </div>

          {/* 餐點結果 */}
          {matchedItems.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                <UtensilsCrossed className="w-3 h-3" /> 餐點（{matchedItems.length}）
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {matchedItems.map(item => {
                  const vendor = vendors.find(v => v.id === item.vendorId);
                  return (
                    <Card
                      key={item.id}
                      className="cursor-pointer hover:shadow-md transition-shadow overflow-hidden"
                      onClick={() => vendor && navigate(`/menu/${vendor.id}#item-${item.id}`)}
                    >
                      <div className="h-20 bg-orange-50 relative overflow-hidden">
                        {item.image
                          ? <img src={item.image} alt={item.name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-2xl">🍱</div>
                        }
                      </div>
                      <CardContent className="p-2 relative">
                        <div className="text-sm font-medium line-clamp-1 pr-7">{item.name}</div>
                        <div className="text-xs text-orange-600 font-semibold">NT$ {item.price}</div>
                        {vendor && <div className="text-xs text-muted-foreground truncate">{vendor.name}</div>}
                        <button
                          className="absolute bottom-2 right-2 w-6 h-6 rounded-full bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 active:scale-90 transition-all disabled:opacity-40"
                          disabled={!vendor}
                          onClick={e => {
                            e.stopPropagation();
                            if (!vendor) return;
                            setAddingItem({ menuItem: item, vendorId: vendor.id });
                            setAddNote("");
                          }}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {matchedItems.length === 0 && (
            <div className="rounded-xl bg-orange-50 border border-orange-100 px-4 py-3 text-sm text-orange-700 mb-4">
              找不到「{submittedSearch}」的餐點，試試搜尋其他關鍵字
            </div>
          )}
        </div>
      )}

      {/* 翻牌區（只在無搜尋時顯示） */}
      {!submittedSearch && randomItems.length > 0 && (
        <div className="mb-4 md:mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm md:text-base font-semibold flex items-center gap-1.5">
              <Shuffle className="w-4 h-4 text-orange-500" /> 翻牌決定今天吃什麼！
            </h3>
            <button className="text-xs flex items-center gap-1" style={{ color: "#8B4A1C" }} onClick={() => deal(menuItems)}>
              <Shuffle className="w-3 h-3" /> 重新發牌
            </button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-5 sm:overflow-visible">
            {randomItems.map((item, i) => (
              <div key={`${item.itemName}-${i}`} className="shrink-0 w-[110px] sm:w-auto">
                <FlipCard item={item} onNavigate={() => item.vendorId && navigate(`/vendor/${item.vendorId}#item-${item.itemId}`)} />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5 text-center">點擊牌面翻開，再點一次前往店家</p>
        </div>
      )}

      {/* 合作店家 */}
      <h3 className="text-sm md:text-lg font-semibold mb-2 md:mb-3 flex items-center gap-2">
        <Store className="w-4 h-4 md:w-5 md:h-5 text-orange-500" />
        {submittedSearch ? `符合的店家（${matchedVendors.length}）` : "合作店家"}
      </h3>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-36 bg-gray-200 rounded-xl animate-pulse" />)}
        </div>
      ) : matchedVendors.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{submittedSearch ? "找不到符合的店家" : "目前尚無合作店家"}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-4">
          {matchedVendors.map(vendor => (
            <Card key={vendor.id} className={`cursor-pointer hover:shadow-md transition-all overflow-hidden ${!isOpenToday(vendor) ? "opacity-60 grayscale-[30%]" : ""}`} onClick={() => navigate(`/vendor/${vendor.id}`)}>
              <div className="h-24 md:h-36 bg-gradient-to-br from-orange-100 to-amber-100 relative">
                {vendor.coverImage
                  ? <img src={vendor.coverImage} alt={vendor.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-4xl">🍱</div>
                }
                {(() => {
                  const badge = getTodayBadge(vendor);
                  return <Badge className={`absolute top-1.5 right-1.5 text-xs px-1.5 py-0.5 ${badge.className}`} style={badge.style}>{badge.label}</Badge>;
                })()}
              </div>
              <CardContent className="p-2 md:p-3">
                <h4 className="font-semibold text-sm mb-0.5 line-clamp-1">{vendor.name}</h4>
                <p className="text-xs text-muted-foreground line-clamp-1 mb-1 hidden sm:block">{vendor.description}</p>
                <div className="flex items-center text-xs text-muted-foreground gap-2 flex-wrap">
                  {vendor.address && (
                    <span className="flex items-center gap-0.5 line-clamp-1">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate max-w-[80px]">{vendor.address}</span>
                    </span>
                  )}
                  {vendor.phone && (
                    <span className="hidden sm:flex items-center gap-0.5">
                      <Phone className="w-3 h-3" /> {vendor.phone}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 加入購物車彈窗 */}
      <Dialog open={!!addingItem} onOpenChange={open => { if (!open) setAddingItem(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>加入購物車</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex items-center gap-3">
              <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-orange-100 to-amber-100 flex items-center justify-center text-2xl">
                {addingItem?.menuItem.image
                  ? <img src={addingItem.menuItem.image} alt={addingItem.menuItem.name} className="w-full h-full object-cover" />
                  : "🍱"}
              </div>
              <div>
                <div className="font-semibold text-sm">{addingItem?.menuItem.name}</div>
                <div className="text-orange-600 font-bold text-sm">NT$ {addingItem?.menuItem.price}</div>
              </div>
            </div>
            <div>
              <Label className="text-sm">備註（選填）</Label>
              <Input
                className="mt-1"
                placeholder="例：不要辣、少油..."
                value={addNote}
                onChange={e => setAddNote(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && addingItem) {
                    addItem(addingItem.menuItem, addingItem.vendorId, addNote);
                    toast({ title: "已加入購物車", description: addingItem.menuItem.name });
                    setAddingItem(null);
                  }
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingItem(null)}>取消</Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
              onClick={() => {
                if (!addingItem) return;
                addItem(addingItem.menuItem, addingItem.vendorId, addNote);
                toast({ title: "已加入購物車", description: addingItem.menuItem.name });
                setAddingItem(null);
              }}
            >
              加入購物車
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 早鳥優惠 */}
      <details className="mt-4 md:mt-6 group">
        <summary className="cursor-pointer flex items-center gap-2 text-sm font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 select-none">
          <Clock className="w-4 h-4" /> 早鳥優惠說明
          <span className="ml-auto text-xs text-orange-400 group-open:hidden">展開</span>
          <span className="ml-auto text-xs text-orange-400 hidden group-open:block">收起</span>
        </summary>
        <div className="mt-1 text-sm text-orange-700 bg-orange-50 border border-orange-200 border-t-0 rounded-b-xl px-4 py-3 space-y-0.5">
          <div>• 提前 <b>7 天以上</b>訂購 → <b>9 折</b></div>
          <div>• 提前 <b>3～6 天</b>訂購 → <b>95 折</b></div>
          <div>• 提前 <b>1～2 天</b>訂購 → <b>98 折</b></div>
          <div>• 當天訂購 → 原價（視店家是否開放）</div>
        </div>
      </details>
    </CustomerLayout>
  );
}

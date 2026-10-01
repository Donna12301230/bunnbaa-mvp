import { ReactNode } from "react";
import MarketplaceHeader, { type MarketplaceTab } from "./MarketplaceHeader";

// 商家瀏覽動線共用的外框（/vendors、/vendor/:id、/item/:id）。
// 原本掛的是另一套 Navbar.tsx（購物車／我的訂單／我的開團連結指向的路由其實都
// 不存在，會 404），2026-09-21 改成跟 /home、/marketplace、/my-bookings 共用同一顆
// MarketplaceHeader，導覽列在全站保持一致。
// hero：全寬頁首橫幅（PageHero），放在導覽列與內容之間，例如 /vendors。
// active：導覽列要標成目前分頁的 tab，預設「商家」（原本唯一用途）；關於我們／
// 常見問題等頁尾連結頁不屬於任何 tab，呼叫端傳 undefined。
// active 傳 null＝不標任何分頁（傳 undefined 會被預設值吃掉、誤標成「商家」）。
export default function CustomerLayout({ children, hero, active = "vendors" }: { children: ReactNode; hero?: ReactNode; active?: MarketplaceTab | null }) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <MarketplaceHeader active={active ?? undefined} />
      {hero}
      <main className="flex-1 max-w-[1400px] mx-auto w-full px-4 md:px-6 py-6 md:py-12">
        {children}
      </main>
    </div>
  );
}

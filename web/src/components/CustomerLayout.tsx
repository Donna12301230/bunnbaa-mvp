import { tr } from "@/lib/i18n";
import { ReactNode } from "react";
import MarketplaceHeader, { type MarketplaceTab } from "./MarketplaceHeader";

// 商家瀏覽動線共用的外框（/vendors、/vendor/:id、/item/:id）。
// 原本掛的是另一套 Navbar.tsx（購物車／我的訂單／我的開團連結指向的路由其實都
// 不存在，會 404），2026-09-21 改成跟 /home、/marketplace、/my-bookings 共用同一顆
// MarketplaceHeader，導覽列在全站保持一致。
// hero：全寬頁首橫幅（PageHero），放在導覽列與內容之間，例如 /vendors。
// active：導覽列要標成目前分頁的 tab，預設「商家」（原本唯一用途）；關於我們／
// 常見問題等頁尾連結頁不屬於任何 tab，呼叫端傳 undefined。
export default function CustomerLayout({ children, hero, active = "vendors" }: { children: ReactNode; hero?: ReactNode; active?: MarketplaceTab }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <MarketplaceHeader active={active} />
      {hero}
      <main className="flex-1 max-w-6xl mx-auto w-full px-3 md:px-4 py-3 md:py-6">
        {children}
      </main>
      <footer className="text-center text-xs text-muted-foreground py-4 border-t bg-white">
        <a href="mailto:herzbaa@gmail.com" className="hover:text-orange-600 hover:underline">{tr("聯絡客服", "Contact support")}</a>
        <span className="mx-2">·</span>
        © 2026 {tr("赫滋與羊國際藝術有限公司", "Herz & Baa International Arts Co., Ltd.")}
      </footer>
    </div>
  );
}

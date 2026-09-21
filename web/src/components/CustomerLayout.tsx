import { ReactNode } from "react";
import MarketplaceHeader from "./MarketplaceHeader";

// 商家瀏覽動線共用的外框（/vendors、/vendor/:id、/item/:id）。
// 原本掛的是另一套 Navbar.tsx（購物車／我的訂單／我的開團連結指向的路由其實都
// 不存在，會 404），2026-09-21 改成跟 /home、/marketplace、/my-bookings 共用同一顆
// MarketplaceHeader，導覽列在全站保持一致。
export default function CustomerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <MarketplaceHeader active="vendors" />
      <main className="flex-1 max-w-6xl mx-auto w-full px-3 md:px-4 py-3 md:py-6">
        {children}
      </main>
      <footer className="text-center text-xs text-muted-foreground py-4 border-t bg-white">
        <a href="mailto:herzbaa@gmail.com" className="hover:text-orange-600 hover:underline">聯絡客服</a>
        <span className="mx-2">·</span>
        © 2026 赫滋與羊國際藝術有限公司
      </footer>
    </div>
  );
}

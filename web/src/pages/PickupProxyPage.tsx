import { useParams } from "wouter";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { ProxyPickupView } from "@/components/ProxyPickupPanel";

/**
 * 代領（規格 §6.4）舊版連結 #/pickup/:lockId/:token：代領人不用登入，打開就能出示 QR。
 * 2026-10-09 起改用代領碼（我的餐點 →「代領取餐」分頁輸入），這個路徑保留給已經傳出去的舊連結。
 * share_token 由伺服器比對；轉讓、贈送或取消轉讓後會換新，舊連結失效。
 */
export default function PickupProxyPage() {
  const { lockId, token } = useParams<{ lockId: string; token: string }>();
  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader />
      <div className="max-w-md mx-auto px-4 pt-12 md:pt-20 pb-16">
        <ProxyPickupView target={{ lockId, token }} />
      </div>
    </div>
  );
}

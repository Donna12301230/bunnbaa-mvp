import { useParams } from "wouter";
import { Users } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import PickupQr from "@/components/PickupQr";
import { tr } from "@/lib/i18n";

/**
 * 代領（規格 §6.4）：消費者把取餐連結分享給代領人，代領人不用登入，打開就能出示 QR。
 * 連結裡的 share_token 由伺服器比對；轉讓後會換新，舊連結失效。
 */
export default function PickupProxyPage() {
  const { lockId, token } = useParams<{ lockId: string; token: string }>();
  return (
    <div className="min-h-screen bg-background">
      <MarketplaceHeader />
      <div className="max-w-md mx-auto px-4 pt-12 md:pt-20 pb-16">
        <div className="bb-receipt space-y-4 text-center">
          <span className="bb-receipt__check" aria-hidden="true"><Users className="w-9 h-9" /></span>
          <h1 className="font-heading font-semibold text-[clamp(30px,5vw,44px)] leading-tight">{tr("代領取餐", "Proxy pickup")}</h1>
          <p className="text-sm text-muted-foreground">{tr("朋友請你幫忙帶便當。到店把這個 QR Code 給店員掃描即可。", "A friend asked you to pick up their meal. Show this QR code to the staff.")}</p>
          <div className="flex justify-center pt-2"><PickupQr lockId={lockId} shareToken={token} size={240} /></div>
        </div>
      </div>
    </div>
  );
}

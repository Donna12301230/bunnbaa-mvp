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
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader />
      <div className="max-w-sm mx-auto px-4 py-10">
        <div className="bg-white rounded-xl border border-border p-5 space-y-2 text-center">
          <h1 className="text-lg font-bold flex items-center justify-center gap-2"><Users className="w-5 h-5 text-orange-500" /> {tr("代領取餐", "Proxy pickup")}</h1>
          <p className="text-xs text-muted-foreground">{tr("朋友請你幫忙帶便當。到店把這個 QR Code 給店員掃描即可。", "A friend asked you to pick up their meal. Show this QR code to the staff.")}</p>
          <PickupQr lockId={lockId} shareToken={token} size={220} />
        </div>
      </div>
    </div>
  );
}

import { useParams } from "wouter";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { ProxyPickupView } from "@/components/ProxyPickupPanel";

/**
 * Proxy pickup, legacy link #/pickup/:lockId/:token: the proxy doesn't need to sign in and can show the QR right away.
 * Since 2026-10-09 proxy pickup codes are used instead (entered on the "Proxy pickup" tab under My meals); this path is kept for links already sent out.
 * share_token is checked by the server; it is regenerated after resale, gifting or cancelling a resale, which invalidates old links.
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

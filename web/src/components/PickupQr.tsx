import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RefreshCw } from "lucide-react";
import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";

export interface PickupQrInfo {
  item_name?: string;
  item_name_en?: string | null;
  vendor_id?: string;
  pickup_date?: string;
  pickup_window?: string;
}

interface Props {
  lockId?: string;
  shareToken?: string;
  /** Proxy pickup code (8 characters, no sign-in needed); the server looks up which order it is */
  proxyCode?: string;
  reservationId?: string;
  size?: number;
  /** Meal info returned along with the QR (shown on the proxy pickup screen to identify the order) */
  onInfo?: (info: PickupQrInfo) => void;
}

/**
 * Pickup QR (spec §6.2): a one-time, server-signed credential (id + expiry + nonce + HMAC); every generation uses a new nonce,
 * so reused screenshots or forgeries are rejected. Expires in 10 minutes; the screen refreshes it every 9 minutes.
 * Fallback: the vendor can also verify with the 4-digit pickup number + last three phone digits.
 */
export default function PickupQr({ lockId, shareToken, proxyCode, reservationId, size = 180, onInfo }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const onInfoRef = useRef(onInfo);
  onInfoRef.current = onInfo;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "issuePickupQr");
      const res = await fn(reservationId ? { reservation_id: reservationId } : proxyCode ? { proxy_code: proxyCode } : { lock_id: lockId, share_token: shareToken });
      const data = res.data as { token: string; pickup_code?: string } & PickupQrInfo;
      setToken(data.token);
      setCode(data.pickup_code ?? null);
      onInfoRef.current?.(data);
    } catch (err) {
      setError((err as Error).message);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, [lockId, shareToken, proxyCode, reservationId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 9 * 60 * 1000);
    return () => clearInterval(t);
  }, [refresh]);

  if (error) {
    return (
      <div className="text-center space-y-2 py-2">
        <p className="text-xs text-red-600">{error}</p>
        <Button size="sm" variant="outline" onClick={refresh}><RefreshCw /> {tr("重試", "Retry")}</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1.5 text-center py-2">
      <div className="bg-white p-2 rounded-md min-h-[100px] flex items-center justify-center" style={{ minWidth: size }}>
        {token ? <QRCodeSVG value={token} size={size} level="M" /> : <span className="text-xs text-muted-foreground">{tr("產生中…", "Loading…")}</span>}
      </div>
      {code && <span className="text-h3 font-bold tracking-[0.3em]">{code}</span>}
      <span className="text-caption text-muted-foreground">
        {tr("取餐時出示給店員掃描；掃不到可報 4 碼取餐號＋手機末三碼", "Show this to staff at pickup. If scanning fails, give the 4-digit code and the last 3 digits of your phone.")}
      </span>
      <Button variant="link" size="sm" onClick={refresh} disabled={loading}>
        <RefreshCw /> {tr("重新產生", "Refresh")}
      </Button>
    </div>
  );
}

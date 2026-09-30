import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RefreshCw } from "lucide-react";
import { httpsCallable } from "@/lib/callable";
import { functions } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { tr } from "@/lib/i18n";

interface Props {
  lockId?: string;
  shareToken?: string;
  reservationId?: string;
  size?: number;
}

/**
 * 取餐 QR（規格 §6.2）：伺服器簽章的一次性憑證（id＋到期＋nonce＋HMAC），每次產生都換 nonce，
 * 截圖重複使用或偽造皆無效。10 分鐘到期，畫面每 9 分鐘自動換一張。
 * 備援：店家也可以用 4 碼取餐號＋手機末三碼核對。
 */
export default function PickupQr({ lockId, shareToken, reservationId, size = 180 }: Props) {
  const [token, setToken] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "issuePickupQr");
      const res = await fn(reservationId ? { reservation_id: reservationId } : { lock_id: lockId, share_token: shareToken });
      const data = res.data as { token: string; pickup_code?: string };
      setToken(data.token);
      setCode(data.pickup_code ?? null);
    } catch (err) {
      setError((err as Error).message);
      setToken(null);
    } finally {
      setLoading(false);
    }
  }, [lockId, shareToken, reservationId]);

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

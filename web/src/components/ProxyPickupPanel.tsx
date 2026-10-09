import { useState, type FormEvent } from "react";
import { formatNT, formatPickupDate } from "@/lib/format";
import { Users } from "lucide-react";
import PickupQr, { type PickupQrInfo } from "@/components/PickupQr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVendors } from "@/hooks/useVendors";
import { getLang, loc, tr } from "@/lib/i18n";

type Target = { code: string } | { lockId: string; token: string };

/** 8 碼代領碼，顯示時切成兩段比較好念：ABCD-EFGH */
export function formatProxyCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** 使用者貼上的可能是代領碼，也可能是整段代領連結（新：/?tab=proxy&code=…#/my-bookings，舊：#/pickup/{lockId}/{token}） */
export function parseProxyInput(raw: string): Target | null {
  const text = raw.trim();
  const link = /#\/pickup\/([^/\s?#]+)\/([0-9a-f]{8,})/i.exec(text);
  if (link) return { lockId: link[1], token: link[2] };
  const fromUrl = /[?&]code=([A-Za-z0-9-]+)/.exec(text);
  const code = (fromUrl ? fromUrl[1] : text).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return code.length === 8 ? { code } : null;
}

/**
 * 代領取餐（2026-10-09）：朋友把「代領碼」或代領連結傳給你，在「我的餐點 → 代領取餐」輸入或貼上，
 * 就會出現取餐 QR。不用登入，也不會被導去別頁。舊的 #/pickup/:lockId/:token 連結（PickupProxyPage）也用這個畫面。
 */
export default function ProxyPickupPanel({ initial }: { initial?: string }) {
  const [draft, setDraft] = useState(initial ?? "");
  const [target, setTarget] = useState<Target | null>(() => (initial ? parseProxyInput(initial) : null));
  const [error, setError] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseProxyInput(draft);
    if (!parsed) {
      setError(tr("請輸入 8 碼代領碼（例如 ABCD-EFGH），或貼上朋友傳來的整段代領連結。", "Enter the 8-character proxy code (e.g. ABCD-EFGH), or paste the whole link your friend sent."));
      return;
    }
    setError("");
    setTarget(parsed);
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <form onSubmit={submit} className="bg-card border border-ink rounded-[1.75rem] p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" aria-hidden="true" />
          <h2 className="font-heading text-xl font-semibold">{tr("幫朋友代領", "Pick up for a friend")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{tr("輸入朋友給你的代領碼，或直接貼上代領連結，不用登入。", "Enter the proxy code your friend gave you, or paste their link. No sign-in needed.")}</p>
        <Label htmlFor="proxy-code" className="sr-only">{tr("代領碼或代領連結", "Proxy code or link")}</Label>
        <div className="flex gap-2">
          <Input
            id="proxy-code"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={tr("代領碼，例如 ABCD-EFGH", "Proxy code, e.g. ABCD-EFGH")}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="flex-1 font-mono tracking-wider"
          />
          <Button type="submit">{tr("顯示取餐碼", "Show code")}</Button>
        </div>
        {error && <p role="alert" className="text-caption text-red-600">{error}</p>}
      </form>

      {target && <ProxyPickupView key={"code" in target ? target.code : `${target.lockId}/${target.token}`} target={target} />}
    </div>
  );
}

export function ProxyPickupView({ target }: { target: Target }) {
  const [info, setInfo] = useState<PickupQrInfo | null>(null);
  const { data: vendors = [] } = useVendors();
  const vendor = info?.vendor_id ? vendors.find((v) => v.id === info.vendor_id) : undefined;
  const itemName = info ? (getLang() === "en" && info.item_name_en ? info.item_name_en : info.item_name) : null;
  return (
    <div className="bb-receipt space-y-3 text-center">
      <h2 className="font-heading font-semibold text-2xl leading-tight">{tr("代領取餐", "Proxy pickup")}</h2>
      {itemName && (
        <p className="text-sm">
          <strong>{itemName}</strong>
          {vendor && <>・{loc(vendor, "name")}</>}
          {info?.pickup_date && <span className="block text-muted-foreground">{formatPickupDate(info.pickup_date)} {info.pickup_window} {tr("取餐", "pickup")}</span>}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{tr("到店把這個 QR Code 給店員掃描即可。", "Show this QR code to the staff.")}</p>
      <div className="flex justify-center">
        <PickupQr {...("code" in target ? { proxyCode: target.code } : { lockId: target.lockId, shareToken: target.token })} size={240} onInfo={setInfo} />
      </div>
    </div>
  );
}

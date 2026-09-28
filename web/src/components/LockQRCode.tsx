import { QRCodeSVG } from "qrcode.react";

interface Props {
  lockId: string;
  vendorId: string;
}

/** QR 內容為 JSON 字串 { lockId, vendorId }；商家在 /lock/vendor/redeem 用相機掃碼，或手動輸入末 8 碼核對。 */
export default function LockQRCode({ lockId, vendorId }: Props) {
  const payload = JSON.stringify({ lockId, vendorId });
  const shortCode = lockId.slice(-8).toUpperCase();

  return (
    <div className="qr-block">
      <div className="qr-box">
        <QRCodeSVG value={payload} size={140} level="M" />
      </div>
      <div>
        <div className="faint">取餐編號</div>
        <div className="lock-code">{shortCode}</div>
        <div className="faint">出示 QR Code 或報這組編號給商家核對</div>
      </div>
    </div>
  );
}

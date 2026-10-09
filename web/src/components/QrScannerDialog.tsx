import { tr } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { CameraOff } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 解出的原始字串（LockQRCode／MyBookingsPage 產生的是 JSON { lockId, vendorId }） */
  onScan: (text: string) => void;
}

/**
 * 商家端相機掃碼：getUserMedia 取後鏡頭畫面，每一幀畫到隱藏 canvas 用 jsQR 解。
 * 不用瀏覽器原生 BarcodeDetector，因為 iOS Safari 不支援，店員手機大多是 iPhone。
 * 需要 HTTPS（localhost 例外）＋ firebase.json 的 Permissions-Policy 允許 camera=(self)。
 */
export default function QrScannerDialog({ open, onOpenChange, onScan }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;

    function tick() {
      if (stopped) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
          if (result?.data) {
            stopped = true;
            onScan(result.data);
            return;
          }
        }
      }
      frame = requestAnimationFrame(tick);
    }

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(tr("這個瀏覽器無法使用相機（需要 HTTPS），請改用下方手動輸入取餐號。", "This browser can't use the camera (HTTPS required). Enter the pickup number manually below."));
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        frame = requestAnimationFrame(tick);
      } catch (err) {
        const name = (err as DOMException)?.name;
        setError(
          name === "NotAllowedError"
            ? tr("相機權限被拒絕，請到瀏覽器設定允許使用相機，或改用手動輸入取餐號。", "Camera access was denied. Allow it in your browser settings, or enter the pickup number manually.")
            : name === "NotFoundError"
              ? tr("找不到可用的相機，請改用手動輸入取餐號。", "No camera found. Enter the pickup number manually.")
              : tr("無法開啟相機，請改用手動輸入取餐號。", "Couldn't open the camera. Enter the pickup number manually.")
        );
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onScan]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("掃描取餐 QR Code", "Scan pickup QR code")}</DialogTitle>
          <DialogDescription>{tr("請顧客打開「我的餐點」→「使用」，把 QR Code 對準框內", "Ask the customer to open My meals → Use, then point the QR code at the frame")}</DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="flex flex-col items-center gap-2 rounded-lg bg-muted p-6 text-center text-sm text-muted-foreground">
            <CameraOff className="w-6 h-6" />
            {error}
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-lg bg-black aspect-square">
            <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-[15%] rounded-lg border-2 border-white/80" />
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </DialogContent>
    </Dialog>
  );
}

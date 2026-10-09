import { tr } from "@/lib/i18n";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImagePlus, Upload, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase";

// 圖片存 Firebase Storage 的 vendors/{vendorId}/ 底下；storage.rules 依
// vendors/{vendorId}.owner_uid 限定只有店主能寫，並限制 image/* 且 ≤ 5MB。
const MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  label: string;
  vendorId: string | undefined;
  value: string;
  onChange: (url: string) => void;
}

function useImageUpload(vendorId: string | undefined, onChange: (url: string) => void) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      if (!vendorId) throw new Error(tr("這個帳號還沒綁定店家，請聯絡平台", "This account isn't linked to a vendor yet. Please contact the platform"));
      if (!file.type.startsWith("image/")) throw new Error(tr("只能上傳圖片檔", "Only image files can be uploaded"));
      if (file.size > MAX_BYTES) throw new Error(tr("圖片不能超過 5MB", "Images must be 5 MB or smaller"));
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "img";
      const fileRef = ref(storage, `vendors/${vendorId}/${crypto.randomUUID()}.${ext}`);
      await uploadBytes(fileRef, file, { contentType: file.type });
      onChange(await getDownloadURL(fileRef));
    } catch (err: any) {
      toast({ variant: "destructive", title: tr("上傳失敗", "Upload failed"), description: err.message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
  return { fileInputRef, uploading, handleFile };
}

/** 菜單編輯的每道菜照片（§3.2「每道菜都要有照片」）：小縮圖，點了上傳，右上角可移除 */
export function ImageThumbUpload({ vendorId, value, onChange, label }: { vendorId: string | undefined; value: string | null | undefined; onChange: (url: string) => void; label: string }) {
  const { fileInputRef, uploading, handleFile } = useImageUpload(vendorId, onChange);
  return (
    <span className="relative shrink-0">
      <button
        type="button"
        disabled={uploading || !vendorId}
        onClick={() => fileInputRef.current?.click()}
        title={label}
        aria-label={label}
        className="w-9 h-9 rounded-md border border-input bg-muted overflow-hidden flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {value ? <img src={value} alt="" className="w-full h-full object-cover" /> : <ImagePlus className={`w-4 h-4 text-muted-foreground ${uploading ? "animate-pulse" : ""}`} />}
      </button>
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label={tr("移除圖片", "Remove image")} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-surface-dark/80 text-white flex items-center justify-center">
          <X className="w-2.5 h-2.5" />
        </button>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </span>
  );
}

export function ImageUploadField({ label, vendorId, value, onChange }: Props) {
  const { fileInputRef, uploading, handleFile } = useImageUpload(vendorId, onChange);

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {value && (
        <div className="relative w-full h-32 rounded-lg overflow-hidden border bg-gray-50">
          <img src={value} alt={tr("圖片預覽", "Image preview")} className="w-full h-full object-cover" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-surface-dark/70 text-white hover:bg-surface-dark/90 hover:text-white [&_svg]:size-3.5"
            aria-label={tr("移除圖片", "Remove image")}
            onClick={() => onChange("")}
          >
            <X />
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={tr("https://... 或點右側按鈕上傳", "https://... or upload with the button")}
          className="text-sm"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-shrink-0 gap-1"
          disabled={uploading || !vendorId}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-4 h-4" />
          {uploading ? tr("上傳中…", "Uploading…") : tr("上傳", "Upload")}
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, X } from "lucide-react";
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

export function ImageUploadField({ label, vendorId, value, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      if (!vendorId) throw new Error("這個帳號還沒綁定商家，請聯絡平台");
      if (!file.type.startsWith("image/")) throw new Error("只能上傳圖片檔");
      if (file.size > MAX_BYTES) throw new Error("圖片不能超過 5MB");
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "img";
      const fileRef = ref(storage, `vendors/${vendorId}/${crypto.randomUUID()}.${ext}`);
      await uploadBytes(fileRef, file, { contentType: file.type });
      onChange(await getDownloadURL(fileRef));
    } catch (err: any) {
      toast({ variant: "destructive", title: "上傳失敗", description: err.message });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {value && (
        <div className="relative w-full h-32 rounded-lg overflow-hidden border bg-gray-50">
          <img src={value} alt="品項圖片預覽" className="w-full h-full object-cover" />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-surface-dark/70 text-white hover:bg-surface-dark/90 hover:text-white [&_svg]:size-3.5"
            aria-label="移除圖片"
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
          placeholder="https://... 或點右側按鈕上傳"
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
          {uploading ? "上傳中..." : "上傳"}
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

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Upload, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string;

interface Props {
  label: string;
  value: string;
  onChange: (url: string) => void;
}

export function ImageUploadField({ label, value, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", UPLOAD_PRESET);

      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`,
        { method: "POST", body: formData }
      );
      if (!res.ok) throw new Error("上傳失敗，請確認 Cloudinary 設定");
      const data = await res.json();
      onChange(data.secure_url as string);
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
          disabled={uploading}
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

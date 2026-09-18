import { useRef, useState } from "react";

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME as string;
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string;

interface Props {
  label: string;
  value: string;
  onChange: (url: string) => void;
}

/**
 * Ported from the old Parse prototype's ImageUploadField — unsigned
 * Cloudinary upload preset pattern, no backend involved. Not yet wired
 * into a page (there's no vendor menu-editing form in this MVP yet),
 * kept here as a ready-to-use building block for whenever that lands.
 */
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

      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("上傳失敗，請確認 Cloudinary 設定");
      const data = await res.json();
      onChange(data.secure_url as string);
    } catch (err) {
      alert("上傳失敗：" + (err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="field">
      <label>{label}</label>
      {value && (
        <div className="image-preview">
          <img src={value} alt="preview" />
          <button type="button" className="secondary" onClick={() => onChange("")}>
            移除
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://... 或點右側按鈕上傳"
        />
        <button
          type="button"
          className="secondary"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? "上傳中..." : "上傳"}
        </button>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />
    </div>
  );
}

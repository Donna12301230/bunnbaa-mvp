/**
 * 把使用者選的照片轉成 base64 送給 callable（拍照上架菜單）。先用 canvas 縮到長邊 maxSide、
 * 轉 JPEG，手機原圖動輒 5 MB 以上，縮完通常 < 500 KB；瀏覽器解不開（例如非 Safari 的 HEIC）
 * 就直接送原檔。
 */
export async function imageToBase64(file: File, maxSide = 1600): Promise<{ base64: string; mimeType: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
  } catch {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: file.type || "image/jpeg" };
  }
}

/**
 * Converts the photo the user picked to base64 for the callable (photo-to-menu listing). First scales it with canvas so the long side is maxSide
 * and converts to JPEG: original phone photos are often over 5 MB, and after scaling usually < 500 KB. If the browser can't decode it (e.g. HEIC outside Safari),
 * the original file is sent as is.
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

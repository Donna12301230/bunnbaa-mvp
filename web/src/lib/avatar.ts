// 使用者大頭貼——沒有真人上傳照片功能，用 DiceBear（免費、不用金鑰、確定性生成，
// 同一個 seed 永遠對應同一張圖）產生卡通人像，跟餐點/商家的真實照片分開，不會混用。
export function avatarUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}
